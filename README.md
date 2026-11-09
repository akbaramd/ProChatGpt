# ChatDesk Lab

**Project:** ProChatGpt (ChatDesk Lab prototype)

## Architecture

- **React**: full desktop chat shell, conversation list, composer, activity timeline.
- **.NET 10 / WebView2**: native Windows host with persistent Chromium profile.
- **Playwright via loopback CDP**: browser UI interactor; controls ChatGPT's visible page, not private backend APIs.
- **IPC**: JSON line commands from C# to Node and typed response events back to the React WebView2.
- **IndexedDB**: local cache for already opened messages, local-only conversations, and app preferences.
- No OpenAI API key, cookie extraction, Sentinel endpoint emulation, or private network calls from ChatDesk.

## Implemented and tested

- ChatGPT session persisted in embedded Chromium.
- Read sidebar anchors from the live ChatGPT UI, including additional scroll-loaded items.
- Click ChatDesk conversation -> navigate Chromium to the matching `/c/{id}` URL -> read visible user and assistant message text, then cache under the remote conversation ID.
- Lazy-load local older message batches and request older visible DOM messages from Chromium on scroll.
- New chat, Instant / Medium / High selection via ChatGPT's UI control, send prompt, observe visibly rendered response snapshots.
- Real native React send -> Chromium ChatGPT send -> displayed text returned to the React interface: **verified with a test conversation**.
- Visible Thinking status / summary headers when ChatGPT shows them. Raw internal chain-of-thought is not available.
- Stop button routed to ChatGPT's visible Stop control, with early-cancel handling when the control has not appeared yet.
- Rename through the ChatGPT sidebar menu.
- Delete through the ChatGPT sidebar Delete action and its confirmation dialog. The app asks for explicit confirmation and only removes the local copy after the UI reports success.
- Locally stored conversations with no linked remote URL are not automatically deleted in ChatGPT or pushed to an unrelated conversation.

## Test matrix

| Case | Status |
| --- | --- |
| React Vite build and Windows host | PASS |
| Chromium live account session and login observation | PASS |
| Live sidebar sync | PASS: 24 visible/scroll-loaded items observed; not proof of complete account coverage |
| Live existing conversation opened in React | PASS |
| Visible assistant message text after full DOM render | PASS |
| Live newly-created message and response | PASS |
| Mode slider | PASS: Instant/Medium/High values 0/1/2 in current ChatGPT UI |
| Stop button end-to-end | UI event test + early-cancel fixture passed; live account stop remains unverified after the fix |
| Thinking summary | UI extraction and event forwarding implemented; exact available text depends on the model/UI |
| Delete remote | Confirmation path passed in an isolated Playwright fixture; no existing account conversation deleted by tests |
| Rename remote | Implemented; not end-to-end verified on live account |
| Import / local persistence / scrolling | PASS on local fixtures |
| Private ChatGPT API calls / raw reasoning | Not implemented |

## Caveats

ChatGPT website automation is fragile. Any DOM change may break selectors. This is an experimental prototype and **not a supported ChatGPT client API**. Automated programmatic extraction of service output may conflict with OpenAI's terms.

**Security:** The WebView2 prototype exposes a localhost CDP debugging endpoint while running. The endpoint can expose session state to other processes on the same computer. Do not distribute this build or use it in a shared/untrusted environment before removing or securing CDP. No password or cookie is explicitly copied into the React frontend.

A browser session is not a durable OAuth identity token. The ChatDesk UI can only display what the official ChatGPT website visibly renders.

## Run

```powershell
npm install
npm run build
dotnet build host\ChatDeskWin\ChatDeskWin.csproj -c Release
.\run-windows.ps1
```

Executable: `host\ChatDeskWin\bin\Release\net10.0-windows\ChatDeskWin.exe`

Tests:

```powershell
npm test
npm run smoke
npm run smoke:auth
node scripts/smoke-bridge.mjs
```

## Recurring fixed-message job (cron-style)

Select an existing **linked** ChatGPT conversation and open **Recurring message** in the toolbar.

1. Enter the fixed follow-up prompt, interval in minutes (minimum **1**, maximum 1440), and Instant / Medium / High.
2. Press **Start recurring job**. The first message is due after one full interval, not immediately.
3. Use **Run now** for a deliberate immediate test, or **Pause / Resume / Stop job** to manage the timer.
4. On every due tick, the Playwright worker navigates to the same conversation. If a response is still generating in that conversation it uses ChatGPT's visible **Stop** control, waits for the UI to settle, then sends the fixed prompt. If the conversation is idle, it sends directly. The app never overwrites an unsent browser draft or interrupts a different active ChatDesk conversation.
5. Missing ticks are discarded rather than replayed in a burst. Three consecutive tick errors pause the schedule.
6. One recurring job is supported at a time. While enabled, its configuration is stored at `%LOCALAPPDATA%\\ChatDeskLab\\recurring-job.json`. It resumes after relaunch, with a fresh interval, only while the **ChatDesk desktop app and Chromium worker are running**; minimizing to the system tray keeps the app running. Fully exiting ChatDesk stops execution until the next launch.

The scheduler uses a Node timer inside ChatDesk, **not the Windows Task Scheduler or an external cron service**. Starting requires explicit user action; this implementation never automatically creates a job on an arbitrary conversation.

### Scheduled-message tests

- Interval validation and one-minute cadence: PASS.
- No duplicate or catch-up requests: PASS.
- Stop a simulated in-progress response before the next send: PASS.
- Cancel a previous same-thread request before continuing: PASS.
- Do not interrupt another conversation or overwrite a browser draft: PASS.
- Persistent configuration and restart behavior: PASS.
- React modal configuration, High effort, Run now, response display, Pause/Resume/Stop: PASS in a mocked-browser Playwright UI test.

Actual recurring submission to a user's account has **not** been activated or live-tested automatically; its target conversation and message must be selected by the user.

## Recurring fixed-message jobs (opt-in, in the Windows application)

Select an **existing linked ChatGPT conversation**, then open **Recurring message** in the toolbar.

- Configure fixed message, interval (default **1 minute**, allowed 1–1440 minutes), and Instant/Medium/High Thinking mode.
- Click **Start recurring job** to activate it. No job runs without user activation.
- Each due tick uses the same Chromium conversation. If its previous response is still generating, ChatDesk requests Stop through the visible ChatGPT button, verifies it is no longer generating, and only then sends the next fixed message.
- If a different conversation is generating, or the composer contains an unsent draft, the tick is skipped without replacing user work.
- **Delivery timeout**: when ChatGPT displays a visible `Message delivery timed out` banner and `Retry` control, ChatDesk shows the same error with a Retry action. The first scheduled timeout retries the *existing* response once using ChatGPT's Retry control—not another Send. If that fails, the schedule pauses to avoid duplicate messages. Rate-limit errors also pause the schedule.
- Job settings are saved at `%LOCALAPPDATA%\ChatDeskLab\recurring-job.json`. An enabled job resumes on the next app launch with a new interval. Missed deadlines are never replayed in a burst.
- **Pause / Resume / Stop job** are in the recurring panel. Pausing or stopping the job prevents future ticks but does not delete conversation history. Closing the app to the tray keeps the Windows host and scheduler running; exiting stops them.
- The app does not persist account credentials in the scheduler config. The scheduled message itself is stored locally in plaintext; protect the Windows user profile.
- There is no guarantee that a site outage can be retried successfully. ChatGPT may change its UI/DOM selectors. The Retry logic does not bypass Cloudflare or rate limits.

### Verification

- 25 Node unit tests passed, including live DOM-shaped fixture tests, early Stop, manual Retry without resending the prompt, one scheduled automatic Retry, 1-minute timing, no missed-run replay and opt-in persistence.
- React smoke for open conversation, new message, recurring start/pause/resume/stop, visible timeout banner and Retry: passed.
- On the signed-in Windows app, sidebar sync and opening a previously existing conversation to show both its user message and assistant answer: passed.
- **Not activated on the user's live ChatGPT account:** no recurring fixed message was supplied; no autonomous messages were sent during this test.