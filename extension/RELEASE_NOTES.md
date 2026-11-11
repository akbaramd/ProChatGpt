# ChatGPT Auto-Continue v0.4.3 — Firefox extension

Per-conversation ChatGPT follow-up automation for Firefox with independent tab jobs, Web Locks to prevent duplicate sends, and durable pre-send receipts.

## Changes
- Prioritized ChatGPT's visible first-party Retry button for `Message delivery timed out` and `Error in input stream`; no unnecessary Refresh before the first Retry.
- Removed a progress-quiescence requirement that could indefinitely postpone Retry when a failing response's DOM/status kept changing.
- Handles a stale `in_progress` marker when a timeout Retry is available without an active Stop control.
- Preserves bounded recovery and sends the next continuation only after the recovered response completes. Added regression tests reproducing the supplied timeout-button markup.
- Historical stale `in_progress` markers no longer prevent completion detection for the latest assistant turn when ChatGPT omits its terminal-state attribute.
- Prevented duplicate user prompts if a Send click is accepted but its JavaScript handler throws afterward.
- Fixed a Web Locks ownership race and the old conversation's lock-attempt cooldown leaking into the next conversation.
- Restricted Send discovery to the active composer form; excluded unrelated submit/voice buttons and inline edit inputs.
- Fixed persisted recovery state when a planned reload, Stop or Retry cannot actually execute because the UI changed.
- Added browser and unit regression tests for click-then-throw, rapid chat switching, Submit selection, composer priority and deferred recovery.
- Fixed Composer text insertion and Send synchronization when React/Lexical remounts the editor or Send button.
- Added bounded repair for an empty replacement editor, delayed Send readiness, and protection for manual drafts.
- Improved active-form Send selection, hidden control filtering, and precise failed-send diagnostic reasons.
- Added regression tests for remounted editors, delayed Send and stale controls.
- Fixed the GitHub release ZIP to include popup.js and all scripts referenced by popup.html. Added automated artifact-completeness checks.
- Fixed historical `Connection interrupted` warnings being mistaken for current errors.
- Recovery for `Error in input stream` and `Connection interrupted`: observe, reload once when stalled, reconcile, and use first-party Stop or Retry only when safe.
- Support for multiple ChatGPT DOM layouts and composer/send-button states.
- Configurations and tracking per conversation, with safe handling of manual drafts, rate limits, and length limits.
- Bounded diagnostic traces with JSON export to Downloads and analysis scripts.
- Unit, stress, and simulated browser tests for retry, interruption, and multi-tab behavior.

## Install (development build)
1. Download and extract `AutoContinue-0.4.3-Firefox.zip` from the GitHub Release assets.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on** and choose the extracted `manifest.json`.
4. Reload open ChatGPT tabs and enable the extension for each saved conversation.

This is an unsigned, temporary development extension. Firefox removes temporary add-ons on restart. The ZIP is not a signed, one-click XPI.

## Diagnostics
Export JSON under **Activity & metrics → Export diagnostics** to `Downloads/AutoContinue/diagnostics/`.

## Limitations
The extension uses ChatGPT's first-party browser UI and does not bypass service limits or guarantee uninterrupted operation while the browser or service is unavailable. It does not resend user messages whose delivery is uncertain.