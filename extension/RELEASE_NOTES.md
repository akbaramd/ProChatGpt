# ChatGPT Auto-Continue v0.4.1 — Firefox extension

Per-conversation ChatGPT follow-up automation for Firefox with independent tab jobs, Web Locks to prevent duplicate sends, and durable pre-send receipts.

## Changes
- Fixed historical `Connection interrupted` warnings being mistaken for current errors.
- Recovery for `Error in input stream` and `Connection interrupted`: observe, reload once when stalled, reconcile, and use first-party Stop or Retry only when safe.
- Support for multiple ChatGPT DOM layouts and composer/send-button states.
- Configurations and tracking per conversation, with safe handling of manual drafts, rate limits, and length limits.
- Bounded diagnostic traces with JSON export to Downloads and analysis scripts.
- Unit, stress, and simulated browser tests for retry, interruption, and multi-tab behavior.

## Install (development build)
1. Download and extract `AutoContinue-0.4.1-Firefox.zip` from the GitHub Release assets.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on** and choose the extracted `manifest.json`.
4. Reload open ChatGPT tabs and enable the extension for each saved conversation.

This is an unsigned, temporary development extension. Firefox removes temporary add-ons on restart. The ZIP is not a signed, one-click XPI.

## Diagnostics
Export JSON under **Activity & metrics → Export diagnostics** to `Downloads/AutoContinue/diagnostics/`.

## Limitations
The extension uses ChatGPT's first-party browser UI and does not bypass service limits or guarantee uninterrupted operation while the browser or service is unavailable. It does not resend user messages whose delivery is uncertain.
