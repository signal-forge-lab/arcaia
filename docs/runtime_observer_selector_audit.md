# Arcaia Debug-OFF Runtime Watcher / Selector Audit

> 2026-07-11 update: the current GPT-5.6 repository-wide review and remediation plan is recorded in `docs/source_review_gpt_5_6_v0_1_204.md`. That document supersedes this file for current P1/P2 priorities while preserving the historical evidence recorded here.

Status: v0.1.182
Scope: Debug mode OFF normal runtime only.

This memo separates normal runtime behavior from debug-only and diagnostic-only behavior so future performance work does not mix different execution paths.

## Scope rule

Included:

- observers/listeners/intervals/hooks active while Debug mode is OFF
- selectors used by those normal runtime paths
- user-triggered normal UI actions such as Markdown turn export

Excluded:

- Debug mode ON only stored logs, traces, and event diagnostics
- diagnostic ZIP / diagnostic bundle only collection
- one-shot manual diagnostics
- File export formatting helpers that do not watch DOM

## Debug-OFF runtime inventory

| Name | File | Type | Root / gate | Trigger | Main selector or hook | Current risk | Next action |
|---|---|---|---|---|---|---|---|
| `rollingLiteObserver` | `content.js` | `MutationObserver` + gated 5s interval | `main` preferred, body fallback | childList DOM mutation / gated fallback interval | `section[data-testid^="conversation-turn-"]` through Lite grouping | Medium | v0.1.141 removed `characterData: true` and gated the fallback interval outside conversation/visible pages. |
| `messageTimeObserver` | `content.js` | retargetable `MutationObserver` | current `main` preferred, reconnects if replaced | DOM mutation / schedule guards | `[data-message-author-role]`, message section lookup | High | v0.1.151 makes timestamp diagnostics lazy/compact in Debug OFF; v0.1.150 reconnect behavior remains. |
| `turnExportObserver` | `content.js` | `MutationObserver` + initial scans + scoped pointer/focus triggers | `main` preferred, body fallback | copy button added / startup scans / assistant interaction | `button[data-testid="copy-turn-action-button"]` | Medium | v0.1.147 restored pointer/focus triggers after v0.1.146 failed to show the `.md` icon for lazy toolbars. |
| `assistantLoadingFaviconObserver` | `content.js` | `MutationObserver` + interval | composer stop button gate | stop button state change / fallback | `button#composer-submit-button[data-testid="stop-button"]` | Low-Medium | Later: confirm fallback stops after generation. |
| `pinnedSortObserver` | `content.js` | `MutationObserver` | sidebar/nav root | sidebar changes | sidebar pinned row selectors | Low-Medium | v0.1.143 observes the sidebar/chat-history nav root instead of `document.body`. |
| `codeBlockCollapserObserver` | `content.js` | `MutationObserver` + main replacement observer | `main` for block processing; `documentElement` for main replacement detection only | code/writing block DOM or target data attribute mutation; main replacement | `pre[data-start][data-end]`, `[data-writing-block]`, `main` | Low-Medium | v0.1.182 retargets the block observer when ChatGPT replaces `main`, without restoring time-delay scans. |
| page conversation monitor | `content.js` + `injected-main.js` | history hooks + popstate/hashchange + gated intervals | top frame / main world | URL/conversation change | URL only | Medium | v0.1.142 slowed main-world sync fallback from 500ms to 2500ms and gated it while hidden; keep content-side fallback unless hook reliability is proven. |
| fetch patch | `injected-main.js` | hook | shared cheap gate before async rewrite | conversation fetch | conversation detail JSON URL | Medium-High | v0.1.145 adds `isConversationJsonFetchResponse()` / `shouldProcessConversationFetchResponse()` before async rewrite work. |
| XHR patch | `injected-main.js` | hook | URL/header capture gate + armed history probe gate | XHR open/send/header | backend API URL checks | Medium-High | v0.1.145 attaches response `loadend` inspection only when history probe is armed and URL matches conversation history. |

## Diagnostic-only inventory

These are intentionally excluded from normal runtime performance review.

| Name | Reason excluded |
|---|---|
| `collectDiagnosticBundleFromContent` heavy DOM details | Runs when diagnostic output is requested. |
| `collectNativeBranchNavigationDiagnostics` | Added for branch navigation investigation; diagnostic bundle only, no watcher. |
| `getDomDiagnosticsForBundle` | Debug/diagnostic collection only. |
| `collectPromptTocDiagnostics` | Debug/diagnostic collection path. |
| fresh Lite rewrite diagnostic | Toolbar diagnostic ZIP path only. |

## Debug-only inventory

These are excluded when evaluating Debug mode OFF behavior.

| Name | Reason excluded |
|---|---|
| `contentFailedTrace` detail collection | Debug-gated retained detail. |
| prompt TOC event diagnostics | Installed only when Debug mode is ON. |
| stored debug event arrays | Debug mode ON only. |
| main-world retained diagnostic arrays | Omitted when Debug mode is OFF. |

## Current small fix history

Markdown turn export styling is now treated as a native-first reference case:

- v0.1.136 removed `.arcaia-turn-export-button { color: inherit; }` so native `text-token-text-secondary` controls icon color.
- v0.1.137 added an extra focus fallback, but that proved broader than necessary.
- v0.1.138 removed the extra focus classes, `focusin` / `focusout` state, and custom focused background fallback after comparing the Markdown button with the native copy button.
- v0.1.139 documents the rule: prefer native ChatGPT DOM/classes before adding custom state, observers, intervals, hooks, or fallback chains.

## Priority queue

| Proposed version | Target | Change |
|---|---|---|
| later | Runtime watchers overall | Review Lite display, pinned sort, timestamp, turn export, favicon, and other Arcaia runtime watchers under the same policy used for block collapser: DOM-change-triggered, scoped roots, no broad polling or delay chains unless justified by diagnostics. |
