using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ChatDeskWin;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new ChatDeskForm());
    }
}

public sealed class ChatDeskForm : Form
{
    private readonly WebView2 shell = new() { Dock = DockStyle.Fill };
    private readonly WebView2 chromium = new() { Dock = DockStyle.Fill };
    private readonly Panel chromiumPanel = new() { Dock = DockStyle.Fill, BackColor = Color.White, Visible = false };
    private readonly Panel chromiumToolbar = new() { Dock = DockStyle.Top, Height = 50, BackColor = Color.FromArgb(248,248,247) };
    private readonly Label chromiumTitle = new()
    {
        Text="ChatGPT sign-in · Chromium / Playwright", AutoSize=true,
        Location=new Point(18,15),Font=new Font("Segoe UI",10f,FontStyle.Bold)
    };
    private readonly Button returnButton = new()
    {
        Text="Back to ChatDesk", Size=new Size(165,32), Anchor=AnchorStyles.Top | AnchorStyles.Right,
        BackColor=Color.White,ForeColor=Color.Black,FlatStyle=FlatStyle.Flat
    };
    private readonly NotifyIcon tray;
    private readonly string dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ChatDeskLab");
    private Process? playwrightWorker;
    private CoreWebView2Environment? chromiumEnvironment;
    private bool chromiumInitialized;
    private bool chromiumInitializing;
    private bool completedPreference;
    private bool exiting;
    private int cdpPort;

    private string StateFile => Path.Combine(dataRoot,"login-step-completed.json");

    public ChatDeskForm()
    {
        Text="ChatDesk Lab";
        Icon=SystemIcons.Application;
        Size=new Size(1250,845);
        MinimumSize=new Size(900,620);
        BackColor=Color.White;
        StartPosition=FormStartPosition.CenterScreen;
        completedPreference=ReadCompletionPreference();
        Controls.Add(shell);
        chromiumToolbar.Controls.Add(chromiumTitle);
        chromiumToolbar.Controls.Add(returnButton);
        chromiumToolbar.Resize += (_,_) => returnButton.Left=chromiumToolbar.ClientSize.Width-returnButton.Width-18;
        returnButton.Top=9;
        returnButton.FlatAppearance.BorderColor=Color.FromArgb(210,210,210);
        returnButton.Click += (_,_) => HideChromium();
        chromiumPanel.Controls.Add(chromium);
        chromiumPanel.Controls.Add(chromiumToolbar);
        chromiumToolbar.BringToFront();
        Controls.Add(chromiumPanel);

        tray=new NotifyIcon {Icon=SystemIcons.Application,Text="ChatDesk Lab",Visible=true};
        var menu=new ContextMenuStrip();
        menu.Items.Add("Open ChatDesk",null,(_,_)=>RestoreWindow());
        menu.Items.Add("Show Chromium",null,async (_,_)=>{RestoreWindow();await StartChromiumAsync(true);});
        menu.Items.Add("Check login",null,(_,_)=>SendWorkerCommand("check"));
        menu.Items.Add("Exit",null,(_,_)=>{exiting=true;Close();});
        tray.ContextMenuStrip=menu;
        tray.DoubleClick += (_,_)=>RestoreWindow();
        FormClosing += (_,e)=>{if(!exiting){e.Cancel=true;Hide();}};
        FormClosed += (_,_)=>{StopWorker();tray.Dispose();};
        Shown += async (_,_)=>await InitializeShellAsync();
    }

    private bool ReadCompletionPreference()
    {
        try
        {
            if(!File.Exists(StateFile))return false;
            using var data=JsonDocument.Parse(File.ReadAllText(StateFile));
            return data.RootElement.TryGetProperty("completed",out var value)&&value.ValueKind==JsonValueKind.True;
        }
        catch{return false;}
    }
    private void SaveCompletionPreference()
    {
        Directory.CreateDirectory(dataRoot);
        File.WriteAllText(StateFile,JsonSerializer.Serialize(new {completed=completedPreference}));
    }
    private static string FindProjectRoot()
    {
        DirectoryInfo? dir=new(AppContext.BaseDirectory);
        for(int i=0;i<10&&dir!=null;i++,dir=dir.Parent)
            if(File.Exists(Path.Combine(dir.FullName,"scripts","auth-browser.cjs")) &&
                File.Exists(Path.Combine(dir.FullName,"dist","index.html")))return dir.FullName;
        throw new FileNotFoundException("Missing React build or Playwright observer. Run npm run build.");
    }
    private static int AvailableLocalPort()
    {
        using var listener=new TcpListener(IPAddress.Loopback,0);
        listener.Start();
        var port=((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }
    private void RestoreWindow()
    {
        Show();
        WindowState=FormWindowState.Normal;
        Activate();
    }
    private async Task InitializeShellAsync()
    {
        try
        {
            Directory.CreateDirectory(dataRoot);
            var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(dataRoot,"react-shell"));
            await shell.EnsureCoreWebView2Async(env);
            shell.CoreWebView2.Settings.IsWebMessageEnabled=true;
            shell.CoreWebView2.WebMessageReceived += async (_,e) =>
            {
                try
                {
                    using var data=JsonDocument.Parse(e.WebMessageAsJson);
                    if(!data.RootElement.TryGetProperty("type",out var type))return;
                    switch(type.GetString())
                    {
                        case "auth:start":
                            await StartChromiumAsync(true);
                            break;
                        case "auth:complete":
                            if(playwrightWorker is {HasExited:false})
                            {
                                SendAuthEvent("checking","Checking the signed-in UI in the embedded Chromium browser...");
                                SendWorkerCommand("check");
                            }
                            else await StartChromiumAsync(true);
                            break;
                        case "auth:reset":
                            completedPreference=false;
                            SaveCompletionPreference();
                            SendAuthEvent("signed_out");
                            await StartChromiumAsync(true);
                            break;
                        case "schedule":
                        {
                            var root=data.RootElement;
                            if(!root.TryGetProperty("action",out var actionElement) ||
                                actionElement.ValueKind!=JsonValueKind.String)break;
                            var action=actionElement.GetString();
                            if(action is not ("start" or "pause" or "resume" or "stop" or "runNow" or "status"))break;
                            if(playwrightWorker is not {HasExited:false})
                            {
                                SendScheduleEvent(JsonSerializer.Serialize(new {
                                    type="schedule",@event="error",
                                    message="Chromium scheduler is not connected"
                                }));
                                break;
                            }
                            SendWorkerCommand(root.GetRawText());
                            break;
                        }
                        case "sync":
                        {
                            // Strict protocol: Playwright receives only a typed sync action.
                            var root=data.RootElement;
                            if(!root.TryGetProperty("action",out var a)||a.ValueKind!=JsonValueKind.String||
                               !root.TryGetProperty("requestId",out var req)||req.ValueKind!=JsonValueKind.String)break;
                            string? action=a.GetString();
                            string? requestId=req.GetString();
                            if(string.IsNullOrWhiteSpace(requestId)||requestId.Length>90||
                               (action!="list"&&action!="open"&&action!="older"&&action!="delete"&&action!="rename"&&action!="status"))break;
                            if(playwrightWorker is not {HasExited:false})
                            {
                                SendSyncEvent(JsonSerializer.Serialize(new {type="sync",requestId,action,ok=false,error="Browser observer is not connected"}));
                                break;
                            }
                            SendWorkerCommand(root.GetRawText());
                            break;
                        }
                        case "chat:open":
                        {
                            if(!data.RootElement.TryGetProperty("remoteUrl",out var urlElement) ||
                                urlElement.ValueKind!=JsonValueKind.String)break;
                            string? destination=urlElement.GetString();
                            if(destination==null||!Uri.TryCreate(destination,UriKind.Absolute,out var parsed)||
                                parsed.Scheme!="https"||parsed.Host!="chatgpt.com"||
                                !System.Text.RegularExpressions.Regex.IsMatch(parsed.AbsolutePath,
                                  @"^/c/[0-9a-fA-F-]{30,}$")||parsed.Query.Length>0||parsed.Fragment.Length>0)break;
                            await StartChromiumAsync(true);
                            if(chromium.CoreWebView2!=null)
                                chromium.CoreWebView2.Navigate(parsed.GetLeftPart(UriPartial.Path));
                            break;
                        }
                        case "chat:send":
                        {
                            var root=data.RootElement;
                            string id=root.TryGetProperty("id",out var itemId)?itemId.GetString()??"": "";
                            string chatId=root.TryGetProperty("chatId",out var cid)?cid.GetString()??"": "";
                            string prompt=root.TryGetProperty("prompt",out var pr)?pr.GetString()??"": "";
                            string effort=root.TryGetProperty("effort",out var ef)?ef.GetString()??"": "";
                            string? remoteUrl=root.TryGetProperty("remoteUrl",out var url)&&url.ValueKind==JsonValueKind.String?url.GetString():null;
                            if(!completedPreference||playwrightWorker is not {HasExited:false})
                            {
                                SendChatError(id,chatId,"Browser is not connected or authenticated.");
                                break;
                            }
                            if(id.Length is < 1 or > 90 || chatId.Length is < 1 or > 90 || prompt.Length is < 1 or > 12000 ||
                                (effort!="instant"&&effort!="medium"&&effort!="high"))
                            {
                                SendChatError(id,chatId,"Invalid message or effort value.");
                                break;
                            }
                            if(remoteUrl!=null&&(!Uri.TryCreate(remoteUrl,UriKind.Absolute,out var parsed)||parsed.Scheme!="https"||
                                parsed.Host!="chatgpt.com"||!parsed.AbsolutePath.StartsWith("/c/",StringComparison.Ordinal)))
                            {
                                SendChatError(id,chatId,"Invalid conversation URL.");
                                break;
                            }
                            SendWorkerCommand(JsonSerializer.Serialize(new {type="chat_send",id,chatId,prompt,effort,remoteUrl}));
                            break;
                        }
                        case "chat:retry":
                        {
                            var root=data.RootElement;
                            if(root.TryGetProperty("id",out var retryId)&&retryId.ValueKind==JsonValueKind.String)
                                SendWorkerCommand(JsonSerializer.Serialize(new {type="chat_retry",id=retryId.GetString()}));
                            break;
                        }
                        case "chat:cancel":
                        {
                            var root=data.RootElement;
                            if(root.TryGetProperty("id",out var cid)&&cid.ValueKind==JsonValueKind.String)
                                SendWorkerCommand(JsonSerializer.Serialize(new {type="chat_cancel",id=cid.GetString()}));
                            break;
                        }
                    }
                }
                catch(Exception error){SendAuthEvent("error",error.Message);}
            };
            // Only expose this bridge on our local React page; never on ChatGPT itself.
            const string bridge=@"(() => {
                const listeners=new Set();
                const chatListeners=new Set();
                const syncListeners=new Set();
                const scheduleListeners=new Set();
                window.chrome.webview.addEventListener('message',event=>{
                    if(event.data?.type==='auth-status')listeners.forEach(cb=>cb(event.data));
                    if(event.data?.type==='chat')chatListeners.forEach(cb=>cb(event.data));
                    if(event.data?.type==='sync')syncListeners.forEach(cb=>cb(event.data));
                    if(event.data?.type==='schedule')scheduleListeners.forEach(cb=>cb(event.data));
                });
                window.chatdesk={
                    status:async()=>({apiEnabled:false,authEnabled:true,authState:'signed_out'}),
                    beginLogin:async()=>{window.chrome.webview.postMessage({type:'auth:start'});return true;},
                    confirmLogin:async()=>{window.chrome.webview.postMessage({type:'auth:complete'});return true;},
                    resetLogin:async()=>{window.chrome.webview.postMessage({type:'auth:reset'});return true;},
                    onAuthEvent:cb=>{listeners.add(cb);return()=>listeners.delete(cb);},
                    onStream:()=>()=>{},
                    onChatEvent:cb=>{chatListeners.add(cb);return()=>chatListeners.delete(cb);},
                    onSyncEvent:cb=>{syncListeners.add(cb);return()=>syncListeners.delete(cb);},
                    onScheduleEvent:cb=>{scheduleListeners.add(cb);return()=>scheduleListeners.delete(cb);},
                    scheduleCommand:async payload=>{window.chrome.webview.postMessage({...payload,type:'schedule'});return true;},
                    syncBrowser:async payload=>{window.chrome.webview.postMessage({...payload,type:'sync'});return true;},
                    sendBrowserMessage:async data=>{window.chrome.webview.postMessage({...data,type:'chat:send'});return {ok:true};},
                    cancelBrowserMessage:async id=>{window.chrome.webview.postMessage({type:'chat:cancel',id});return true;},
                    retryBrowserMessage:async id=>{window.chrome.webview.postMessage({type:'chat:retry',id});return true;},
                    openBrowserConversation:async remoteUrl=>{window.chrome.webview.postMessage({type:'chat:open',remoteUrl});return true;},
                    sendApi:async()=>({ok:false,error:'Browser-driven chats are used by this prototype'})
                };
            })();";
            await shell.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(bridge);
            var root=FindProjectRoot();
            shell.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "chatdesk-app.example",Path.Combine(root,"dist"),CoreWebView2HostResourceAccessKind.Deny);
            shell.CoreWebView2.NavigationCompleted += async (_,args) =>
            {
                if(!args.IsSuccess)return;
                SendAuthEvent(completedPreference?"opening":"signed_out");
                if(completedPreference)await StartChromiumAsync(false); // Revalidate saved browser session
            };
            shell.CoreWebView2.Navigate("https://chatdesk-app.example/index.html");
        }
        catch(Exception error){MessageBox.Show(this,error.ToString(),"ChatDesk startup error");}
    }

    private async Task StartChromiumAsync(bool show)
    {
        try
        {
            // Keep the Chromium control visible in the native window hierarchy
            // (behind the React shell) so WebView2 can continue rendering and
            // Playwright can inspect the signed-in UI after a cold restart.
            chromiumPanel.Visible=true;
            if(show){chromiumPanel.BringToFront();RestoreWindow();}
            else {chromiumPanel.SendToBack();shell.BringToFront();}
            if(chromiumInitialized)
            {
                if(playwrightWorker is {HasExited:false})SendWorkerCommand("check");
                else StartPlaywrightObserver();
                return;
            }
            if(chromiumInitializing)return;
            chromiumInitializing=true;
            SendAuthEvent("opening");
            cdpPort=AvailableLocalPort();
            // For this local test only: a loopback CDP port is exposed to Playwright.
            // Do not deploy with CDP enabled in a production authentication flow.
            var options=new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments=$"--remote-debugging-port={cdpPort} --remote-debugging-address=127.0.0.1"
            };
            chromiumEnvironment=await CoreWebView2Environment.CreateAsync(
                null,Path.Combine(dataRoot,"chatgpt-profile"),options);
            await chromium.EnsureCoreWebView2Async(chromiumEnvironment);
            chromium.CoreWebView2.NewWindowRequested += BrowserNewWindowRequested;
            chromium.CoreWebView2.NavigationCompleted += (_,args) =>
            {
                if(!args.IsSuccess)SendAuthEvent("warning","The ChatGPT page could not be loaded.");
                else SendWorkerCommand("check");
            };
            chromiumInitialized=true;
            chromium.CoreWebView2.Navigate("https://chatgpt.com/");
            StartPlaywrightObserver();
        }
        catch(Exception error){SendAuthEvent("error",error.Message);chromiumInitialized=false;}
        finally{chromiumInitializing=false;}
    }

    private async void BrowserNewWindowRequested(object? sender,CoreWebView2NewWindowRequestedEventArgs args)
    {
        var deferral=args.GetDeferral();
        try
        {
            if(chromiumEnvironment==null)return;
            var popup=new Form {Text="ChatDesk — Sign in",Width=780,Height=700,StartPosition=FormStartPosition.CenterParent};
            var view=new WebView2 {Dock=DockStyle.Fill};
            popup.Controls.Add(view);
            await view.EnsureCoreWebView2Async(chromiumEnvironment);
            args.NewWindow=view.CoreWebView2;
            args.Handled=true;
            popup.Show(this);
            SendWorkerCommand("check");
        }
        finally{deferral.Complete();}
    }

    private void HideChromium()
    {
        // Hidden in z-order rather than Visible=false: this preserves a live
        // rendered Chromium document for the existing login monitor.
        chromiumPanel.Visible=true;
        chromiumPanel.SendToBack();
        shell.BringToFront();
        RestoreWindow();
    }

    private void StartPlaywrightObserver()
    {
        if(playwrightWorker is {HasExited:false})return;
        try
        {
            var start=new ProcessStartInfo("node")
            {
                WorkingDirectory=FindProjectRoot(),UseShellExecute=false,
                RedirectStandardOutput=true,RedirectStandardError=true,
                RedirectStandardInput=true,CreateNoWindow=true
            };
            start.ArgumentList.Add(Path.Combine(FindProjectRoot(),"scripts","auth-browser.cjs"));
            start.Environment["CHATDESK_CDP_PORT"]=cdpPort.ToString();
            start.Environment["CHATDESK_SCHEDULER_FILE"]=Path.Combine(dataRoot,"recurring-job.json");
            var worker=new Process {StartInfo=start,EnableRaisingEvents=true};
            worker.OutputDataReceived += (_,e)=>{if(e.Data!=null)HandleObserverEvent(e.Data);};
            worker.ErrorDataReceived += (_,e)=>{if(!string.IsNullOrEmpty(e.Data))Debug.WriteLine("[Playwright] "+e.Data);};
            worker.Exited += (_,_)=>SendAuthEvent("monitor_stopped");
            if(!worker.Start())throw new InvalidOperationException("Playwright observer could not start");
            playwrightWorker=worker;
            worker.BeginOutputReadLine();
            worker.BeginErrorReadLine();
        }
        catch(Exception error){SendAuthEvent("error",error.Message);}
    }

    private void HandleObserverEvent(string json)
    {
        try
        {
            using var data=JsonDocument.Parse(json);
            if(!data.RootElement.TryGetProperty("type",out var t))return;
            var type=t.GetString()??"";
            if(type=="chat")
            {
                if(!IsDisposed)BeginInvoke((Action)(()=>SendChatEvent(json)));
                return;
            }
            if(type=="sync")
            {
                if(!IsDisposed)BeginInvoke((Action)(()=>SendSyncEvent(json)));
                return;
            }
            if(type=="schedule")
            {
                if(!IsDisposed)BeginInvoke((Action)(()=>SendScheduleEvent(json)));
                return;
            }
            if(type=="authenticated")
            {
                BeginInvoke((Action)(()=>{
                    completedPreference=true;
                    SaveCompletionPreference();
                    HideChromium();
                    Text="ChatDesk Lab — Conversations";
                    SendAuthEvent("authenticated","Signed-in chat UI detected by Playwright.");
                }));
                return;
            }
            var msg=data.RootElement.TryGetProperty("message",out var m)?m.GetString():null;
            SendAuthEvent(type,msg);
        }
        catch(Exception error){Debug.WriteLine(error);}
    }
    private void SendScheduleEvent(string json)
    {
        if(InvokeRequired)
        {
            if(!IsDisposed)BeginInvoke((Action)(()=>SendScheduleEvent(json)));
            return;
        }
        if(shell.CoreWebView2!=null)
            shell.CoreWebView2.PostWebMessageAsJson(json);
    }

    private void SendChatError(string id,string chatId,string message)
    {
        SendChatEvent(JsonSerializer.Serialize(new {type="chat",@event="error",id,chatId,message}));
    }

    private void SendSyncEvent(string json)
    {
        if(InvokeRequired)
        {
            if(!IsDisposed)BeginInvoke((Action)(()=>SendSyncEvent(json)));
            return;
        }
        if(shell.CoreWebView2!=null)
            shell.CoreWebView2.PostWebMessageAsJson(json);
    }

    private void SendChatEvent(string json)
    {
        if(InvokeRequired)
        {
            if(!IsDisposed)BeginInvoke((Action)(()=>SendChatEvent(json)));
            return;
        }
        if(shell.CoreWebView2!=null)
            shell.CoreWebView2.PostWebMessageAsJson(json);
    }

    private void SendWorkerCommand(string command)
    {
        try
        {
            if(playwrightWorker is {HasExited:false})
            {
                playwrightWorker.StandardInput.WriteLine(command);
                playwrightWorker.StandardInput.Flush();
            }
        }
        catch(Exception error){Debug.WriteLine(error);}
    }
    private void SendAuthEvent(string state,string? message=null)
    {
        if(InvokeRequired)
        {
            if(!IsDisposed)BeginInvoke((Action)(()=>SendAuthEvent(state,message)));
            return;
        }
        if(shell.CoreWebView2!=null)
            shell.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {type="auth-status",state,message}));
    }
    private void StopWorker()
    {
        SendWorkerCommand("quit");
    }
}