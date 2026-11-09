const path = require('node:path');
const { app, BrowserWindow, WebContentsView, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const { streamOpenAI } = require('./stream.cjs');

const PARTITION = 'persist:chatdesk-session-v1';
let window, browserView, tray, browserVisible = false, quitting = false;
function sendStatus(value) {
  if (window && !window.isDestroyed()) window.webContents.send('browser:status',value);
}
function layout() {
  if (!window || !browserView) return;
  const [w,h] = window.getContentSize();
  browserView.setBounds({x:244,y:62,width:Math.max(100,w-244),height:Math.max(100,h-62)});
}
function setBrowserVisible(visible) {
  browserVisible = visible;
  if (visible) {
    window.contentView.addChildView(browserView);
    layout();
  } else {
    window.contentView.removeChildView(browserView);
  }
  return browserVisible;
}
function createWindow() {
  window = new BrowserWindow({
    width:1200,height:820,minWidth:860,minHeight:580,backgroundColor:'#f8f8f8',
    title:'ChatDesk Lab',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}
  });
  browserView = new WebContentsView({
    webPreferences:{partition:PARTITION,contextIsolation:true,nodeIntegration:false,sandbox:true}
  });
  browserView.webContents.setWindowOpenHandler(({url}) => {
    // Login popups may need their own browser window. Reuse this app's persistent session.
    if (!/^https:\/\//i.test(url)) return {action:'deny'};
    return {action:'allow',overrideBrowserWindowOptions:{
      width:820,height:720,autoHideMenuBar:true,
      webPreferences:{partition:PARTITION,contextIsolation:true,nodeIntegration:false,sandbox:true}
    }};
  });
  browserView.webContents.on('did-finish-load',() => sendStatus({state:'loaded',url:browserView.webContents.getURL()}));
  browserView.webContents.on('did-fail-load',(_,code,description,url,isMainFrame) => {
    if (isMainFrame && code!==-3) sendStatus({state:'error',description,url});
  });
  browserView.webContents.loadURL('https://chatgpt.com/');
  if (app.isPackaged) window.loadFile(path.join(__dirname,'../dist/index.html'));
  else window.loadURL('http://127.0.0.1:5173/');
  window.on('resize',layout);
  window.on('close',(event)=>{
    if (!quitting && tray) { event.preventDefault(); window.hide(); }
  });
  window.on('closed',()=> { window=null; });
  window.webContents.on('did-finish-load',()=>sendStatus({state:'ready'}));
}
function createTray() {
  const iconPath = path.join(__dirname,'../assets/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) return;
  tray = new Tray(icon);
  tray.setToolTip('ChatDesk Lab — background browser stays open');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Open ChatDesk',click:()=>{window.show();window.focus();}},
    {label:'Quit',click:()=>{quitting=true;app.quit();}}
  ]));
  tray.on('double-click',()=>{window.show();window.focus();});
}
app.whenReady().then(()=>{
  createWindow(); createTray();
  app.on('activate',()=>{if(window)window.show();else createWindow();});
});
app.on('window-all-closed',()=>{if(!tray){quitting=true;app.quit();}});
app.on('before-quit',()=>{quitting=true;});
ipcMain.handle('app:status',()=>({
  browserPartition:PARTITION,
  apiEnabled:!!process.env.OPENAI_API_KEY,
  appVersion:app.getVersion(),
  persistentProfile:path.join(app.getPath('userData'),'Partitions')
}));
ipcMain.handle('browser:show',(_e,visible)=>setBrowserVisible(visible));
ipcMain.handle('browser:reload',()=>{browserView.webContents.reload();return true;});
ipcMain.handle('api:send',async(event,payload)=>{
  const {id,messages} = payload||{};
  if (!process.env.OPENAI_API_KEY) return {ok:false,error:'OPENAI_API_KEY is not configured'};
  if (!Array.isArray(messages)||messages.length>100||!messages.every(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.length<=16000))
    return {ok:false,error:'Invalid messages'};
  if (typeof id !== 'string' || id.length>64) return {ok:false,error:'Invalid request id'};
  // Starts streaming asynchronously; all events remain correlated to a request id.
  streamOpenAI({key:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-5-mini',messages,
    emit:(data)=>{if(!event.sender.isDestroyed())event.sender.send('api:stream',{id,...data});}
  }).catch(err=>{if(!event.sender.isDestroyed())event.sender.send('api:stream',{id,type:'error',text:err.message});});
  return {ok:true};
});
