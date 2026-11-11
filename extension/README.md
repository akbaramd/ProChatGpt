# ChatGPT Auto-Continue 0.4.4 (Firefox)

Per-conversation follow-up automation via the ordinary ChatGPT page UI. Each saved chat has its own Enabled state, follow-up text, delay and send cap. Multiple chats can run in separate tabs; a Web Lock prevents two tabs of the same chat from sending concurrently.

## Installation

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and select this folder's `manifest.json`. Reload existing ChatGPT tabs after updating the extension. The temporary add-on must be loaded again after Firefox restarts.

Open each saved conversation (`/c/... ` or `/g/.../c/...`) and enable it individually from the in-page control or the toolbar popup. Unconfigured chats remain Off. `maxSends=0` means unbounded, but live testing should always use a small cap.

## Reliability model

- A click attempt is marked before dispatch. If ChatGPT accepts a message and a subsequent click handler throws, the durable receipt remains intact and a duplicate is never submitted automatically.
- Web Lock ownership is tied to a unique token; releasing a previous conversation's lock cannot clear a newer conversation's owner. Navigation resets the old chat's acquisition cooldown.
- Send is resolved inside the active composer form, and unrelated submit, voice and hidden buttons are rejected. Specific ChatGPT composer selectors take precedence over inline edit boxes.
- Recovery actions roll back the persisted phase if a draft or page change prevents the intended first-party action; a UI intent is not treated as a completed reload, Stop or Retry.
- The watchdog observes DOM changes and also polls every 2.5 seconds. Mutation bursts are coalesced, with a slower cadence while answers stream.
- Composer submission reacquires the active editor after React/Lexical remounts, verifies the entered text, waits up to 8 seconds for Send readiness and reports exact pre-click failure reasons. A missing or replaced editor can be filled again only when empty; existing user drafts are never overwritten.
- It recognizes multiple conversation DOM families (`data-chatgpt-search-unit-key`, `data-message-author-role`, `section[data-turn]`), composer variants, and send-button IDs. It only sends after a completed assistant turn and preserves unrelated user drafts.
- Retry and Connection interrupted errors use one persisted incident state machine: observe, refresh once, reconcile, optionally Stop/Retry, and resume only after safe settlement. Unconfirmed user prompts are not resent.
- Each chat has its own durable send receipt. A receipt is persisted *before* clicking Send so reloads cannot blindly replay the same assistant turn. Unknown delivery remains blocked until a new completed assistant reply is observed.
- ChatGPT-specific rate limits, usage limits and maximum-conversation-length notices are terminal/wait conditions, not something the extension attempts to bypass.
- A browser-reported outage lasting 45 seconds may trigger one guarded reload after connectivity returns. A genuinely unanswered user turn with no visible generation, error, limit or draft may trigger a separate guarded UI reload after six minutes; **at most two such reloads per hour** and at least ten minutes apart. No reload is permission to send a duplicate prompt.
- Browser suspension, unavailable ChatGPT service, UI redesigns and hard conversation limits can still stop a run; uninterrupted/infinite continuation cannot be guaranteed.

## Diagnostics and reproduction

The installed extension cannot write files to its own read-only installation directory. **Structured traces are continuously persisted in Firefox `browser.storage.local`**, in one bounded ring per tab/session (up to 1,200 events each). The storage survives page reloads and normal browser restarts. Trace retention is limited to approximately 14 days or 100 sessions, with 1,200 events per tab; older entries are pruned at most once a day.

Use **Auto-Continue → Activity & metrics → Export diagnostics (.json)** either inside the page or from the toolbar popup. The extension background page uses the Firefox Downloads API and saves the file under **Downloads/AutoContinue/diagnostics/AutoContinue-diagnostics-YYYY-MM-DD-HH-MM-SS.json**. Copy this JSON to the project or attach it when investigating a failure. Trace events record status transitions, send preparation/clicks, abort reasons, Web Lock leadership, retry attempts, reload decisions, and periodic heartbeats. They exclude message bodies, cookies, API tokens and full conversation URLs. Short chat IDs are included for correlation.

For an intermittent stall, preserve the tab without manually resending, export diagnostics, and inspect chronological `events` for `guard`, `state`, `send-not-clicked`, `send-clicked`, `send-exception`, `retry-clicked`, `stall-reload`, `stall-reload-suppressed`, `watchdog-exception` or `heartbeat`. In particular, `paused-unconfirmed` means sending again could duplicate an already-accepted user turn; `another-tab` means that chat is owned by another tab.

The older global `logs` and `metrics` keys remain for backward compatibility but may lose updates under concurrent writes. **Per-tab traces are authoritative** for multi-tab debugging. Clearing diagnostics is explicit in the popup.

## Tests

Run from the repository root:

```powershell
node --test tests/watchdog-core.test.cjs tests/conversation-settings.test.cjs tests/incident-recovery.test.cjs tests/trace.test.cjs tests/recovery-policy.test.cjs tests/extension-stress.test.cjs tests/diagnostics-analyzer.test.cjs tests/background-export.test.cjs
node --test tests/extension-popup.test.cjs tests/extension-send.test.cjs
```

The first suite includes 10,000-turn lifecycle simulation, 5,000 unsafe states, 10,000 log events, multi-writer isolation, and recovery guard policy. The browser fixtures exercise real DOM events in a local Edge/Chromium test page, not an active ChatGPT account. They cover alternate markup families, disabled Send, Retry, stale Stop, navigation, cross-tab locks, durable receipt, and repeated follow-ups.

This extension drives the first-party UI of an authenticated ChatGPT page. It does not call private endpoints or extract browser session secrets.
### Analyze an exported file

```powershell
node scripts/analyze-auto-continue-diagnostics.cjs "C:\\Users\\<User>\\Downloads\\AutoContinue\\diagnostics\\AutoContinue-diagnostics-....json"
```

The background download request requires Firefox's `downloads` permission. The add-on's settings and traces stay separate from your ChatGPT chat history.
## Stream failure recovery (0.4.0)

Both Retry and Connection interrupted errors use the same persisted per-conversation incident state machine (extension/incident-recovery.js).

- Wait for a genuine stall: 10 seconds for Retry and 45 seconds for Connection interrupted, plus at least 30 seconds without fresh assistant output.
- Persist an incident checkpoint BEFORE one page reload. After reload, watch for 30 seconds; if the assistant continues generating new text, never click Stop.
- If the stream remains stuck after reload, click the first-party Stop control only once after an additional quiet period; wait at least 15 seconds for Stop to disappear.
- If the failed answer still offers Retry, click the first-party Retry at most once, then wait for a completed response. Never re-submit the same user prompt on uncertain delivery.
- Only after a completed new assistant turn or a verified stable partial interruption may the next follow-up be scheduled. Human drafts, rate limits, and unanswered user turns block sending.
- An unresolved incident remains on hold rather than entering infinite reload/Stop/Retry loops.

Each incident checkpoint is stored under autoContinue:conversation:<path>:incident. Trace events include incident-heartbeat, incident-transition, incident-reload, incident-stop-clicked, incident-retry-clicked, incident-released and incident-action-error. No conversation text is included.

Tests: node --test tests/incident-recovery.test.cjs tests/incident-browser.test.cjs

Reference material: OpenAI help article https://help.openai.com/en/articles/7996703-troubleshooting-chatgpt-error-messages ; web-stream report https://github.com/openai/codex/issues/51973 ; open source extension https://github.com/kartikkabadi/chatgpt-yolo ; network recommendations https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps .

Uninterrupted operation through browser shutdown, service outages, account limits or changing UI is not guaranteed.
## Incident recovery sequence (0.3.3)

- Retry/error banner: wait 10 seconds and 30 seconds without response progress; persist state and reload once. After 30 seconds of post-refresh observation, use first-party Retry if needed. Stop any remaining active reply first.
- Connection interrupted: observe at least 45 seconds, including 30 seconds unchanged, then reload once. Recheck for 30 seconds. Click Stop once only when no progress is observed; require an additional 15-second grace and 30 seconds of stability before releasing a partial response.
- Each incident persists its phase, source key, progress length, and counts of Reload, Stop, Retry. Late-growing output prevents sending another user prompt. Unknown delivery remains blocked.
- Browser UI state is not server task state. The warning can coexist with continuing server work, so the extension cannot guarantee task termination from visible controls alone.
## 0.4.1 — historical interruption isolation

An earlier assistant turn may retain a `Connection interrupted` notice after a later assistant response has completed. The watchdog excludes historical notices from its global fallback detector. It still recognizes an active `Error in input stream` with Retry after the latest turn. Verified with a Playwright regression fixture in `tests/incident-browser.test.cjs`.