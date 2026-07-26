# Arcaia GPT-5.6 Source Review and Remediation Plan

- Review date: 2026-07-11
- Reviewed version: `0.1.204`
- Review scope: Arcaia repository-wide static review
- Primary runtime scope: Debug mode OFF
- Review baseline commit: `4cab09c Create shorter futuristic completion sound`
- DOM policy: Direct dependency on the current ChatGPT DOM is allowed. Do not add speculative compatibility fallbacks merely to avoid DOM dependency.

## 1. Purpose

This document records the GPT-5.6 source review result, the evidence behind each finding, the accepted runtime mechanisms, and the planned remediation order.

The review focused on:

1. selectors, observers, and listeners that are broader than necessary;
2. diagnostic or debug work that still executes while Debug mode is OFF;
3. repeated timers, intervals, DOM scans, layout reads, and network hooks that may affect performance;
4. lifecycle bugs, duplicate startup paths, leaks, races, and feature restart behavior;
5. other correctness, maintenance, and regression risks.

Debug-mode-ON-only behavior was excluded unless its setup or argument construction leaked into Debug-OFF runtime.

## 2. Review principles

### 2.1 DOM dependency is acceptable

The review does not classify direct use of ChatGPT DOM structure, `role`, `aria-*`, `data-testid`, or stable parent/child relationships as a defect by itself.

The preferred order remains:

1. use the current native DOM directly;
2. use the narrowest proven observer root;
3. reuse an existing event or observer path;
4. add a fallback only after a real failure mode is measured;
5. avoid speculative fallback chains and React Fiber dependencies.

### 2.2 Broad mechanisms require evidence

A broad observer, document-level listener, interval, or hook is acceptable when:

- a narrower path was tested and failed;
- the callback has a cheap relevance gate;
- expensive work is coalesced or Debug-gated;
- the mechanism is required for a user-visible feature;
- cleanup and restart behavior are deterministic.

## 3. Repository state at review time

Main executable files:

| File | Approximate size | Role |
|---|---:|---|
| `content.js` | 463 KB | Main content runtime, Lite, timestamps, sidebar, export, diagnostics |
| `injected-main.js` | 126 KB | Main-world fetch/XHR hooks and Lite response rewrite |
| `popup.js` | 85 KB | Popup UI and commands |
| `content_model_selector.js` | 25 KB | GPT-5.6 rich model selector |
| `content_toolbar.js` | 15 KB | Toolbar save orchestration |
| `offscreen.js` | 13 KB | Completion sound playback and synthesis |

Review-time validation:

```text
tests 95
pass 95
fail 0
```

Unrelated pre-existing working-tree changes, excluded from all review and remediation commits:

```text
M zip_project.bat
?? icons/toolbar - コピー/
```

## 4. Executive summary

No destructive or immediate-stop defect was found. The main user-facing mechanisms are operational and the existing tests pass.

The review found five P1 remediation items and three P2 items.

### P1

1. content scripts and main-world hooks are injected into all frames and `about:blank`;
2. pinned sidebar startup retries can multiply pending timers indefinitely;
3. heavy Lite layout diagnostics execute in normal Debug-OFF runtime;
4. a delayed startup diagnostic bundle is constructed even while Debug mode is OFF;
5. fetch/XHR wrappers perform diagnostic body/header work before cheap URL/debug gates.

### P2

1. extension OFF → ON does not restart the code-block collapser observer;
2. extension OFF removes UI but leaves many observers, intervals, listeners, and hooks alive;
3. conversation URL fallback intervals exist in both isolated-world and main-world runtimes.

## 5. P1 findings and remediation design

## P1-1: all-frame and `about:blank` injection

### Current behavior

`manifest.json` uses:

```json
"all_frames": true,
"match_about_blank": true
```

Before the top-frame guard in `startArcaiaPageUi()`, each eligible frame can execute:

- all split content-script file loading;
- the pinned-sort early gate startup;
- `injected-main.js` injection;
- startup storage synchronization;
- main-world fetch/XHR patch setup;
- the main-world 2.5-second conversation URL synchronization interval.

The popup already sends commands explicitly to `frameId: 0`, and the old capture iframe path is documented as removed.

### Risk

- repeated script parse/initialization per frame;
- repeated fetch/XHR patches per frame realm;
- repeated intervals per frame;
- unnecessary interaction with hidden and `about:blank` frames;
- harder lifecycle and diagnosis.

### Remediation

- remove `all_frames: true`;
- remove `match_about_blank: true`;
- keep the normal content script top-frame-only;
- add a regression test that rejects all-frame configuration.

### Validation

- extension loads on a normal ChatGPT page;
- popup commands reach the top frame;
- Lite, timestamps, sidebar, model selector, turn export, Ctrl+Enter, code folding, and completion sound still work;
- no iframe-specific feature is lost.

## P1-2: pinned sidebar retry timer multiplication

### Current behavior

`startPinnedSortUi()` schedules startup scans at 300, 900, and 1800 ms every time it runs. If the sidebar observer root is missing, it also schedules another call to `startPinnedSortUi()` after 500 ms.

When the sidebar is absent for a long time, every 500-ms retry schedules another three delayed scans. Pending timers therefore accumulate.

### Risk

- increasing number of delayed scans on login, narrow-layout, sidebar-hidden, or slow-render pages;
- redundant DOM scans;
- difficult-to-reason startup behavior.

### Remediation

- schedule the startup burst once only;
- keep at most one pending retry timer;
- retry for a bounded duration/count;
- clear the retry timer as soon as a valid observer root is found;
- do not add a new observer or fallback path.

### Validation

- source test confirms one retry timer and a bounded retry count/deadline;
- pinned sorting still initializes when the sidebar appears late;
- retry state resets correctly after extension lifecycle changes.

## P1-3: Lite runtime builds heavy layout diagnostics

### Current behavior

Normal Lite apply paths call `getLiteGroupingDiagnostics()`, which always calls `collectLiteRuntimeLayoutDiagnostics()`.

That diagnostic path performs repeated layout-sensitive work, including:

- `getComputedStyle()`;
- `getBoundingClientRect()`;
- `offsetHeight`, `clientHeight`, and `scrollHeight` reads;
- viewport intersection checks;
- scroll-container discovery;
- broad selector queries;
- text previews and hashes;
- retained/hidden section samples.

This can run from the Lite mutation observer, startup burst, and fallback interval while Debug mode is OFF.

### Risk

- unnecessary CPU use in long conversations;
- possible forced layout/reflow;
- repeated construction of objects used only for diagnostics;
- higher observer callback cost.

### Remediation

Split Lite state into:

1. a lightweight normal-runtime summary required for behavior and the visible Lite bar;
2. optional detailed diagnostics built only when Debug mode is ON or an explicit diagnostic command requests them.

The normal summary should retain only values required by runtime logic, such as:

- section/group counts;
- retained/hidden counts;
- fallback flags/reasons;
- reconcile counters;
- minimal current Lite state.

Detailed layout, sample, hash, preview, and scroll-container data must not be built in Debug-OFF apply paths.

### Validation

- Lite behavior and visible counts remain unchanged;
- Debug-ON diagnostic ZIP still contains detailed layout diagnostics;
- Debug-OFF source tests assert that layout diagnostics are not called from normal Lite apply;
- existing Lite grouping tests remain green.

## P1-4: delayed startup diagnostic work runs with Debug OFF

### Current behavior

About 1.8 seconds after page startup, the runtime unconditionally builds:

- main-world Lite status;
- `getDomDiagnosticsForBundle()`;
- rolling Lite state;
- root-cause hints;
- an event payload passed to `appendStoredDebugEvent()`.

`appendStoredDebugEvent()` returns immediately while Debug mode is OFF, but all expensive arguments have already been evaluated.

### Risk

- a full conversation DOM diagnostic scan shortly after every load;
- unnecessary main-world request and object construction;
- startup contention during ChatGPT rendering.

### Remediation

- do not register the delayed diagnostic timer while Debug mode is OFF;
- retain the current diagnostic behavior when Debug mode is ON;
- add a source regression test proving the timer/body is Debug-gated before diagnostic construction.

### Validation

- Debug OFF startup does not call `getDomDiagnosticsForBundle()`;
- Debug ON retains the startup diagnostic event;
- no user-visible behavior changes.

## P1-5: fetch/XHR cheap gates occur too late

### Current behavior

The main-world wrappers perform work for every request before they know whether it is relevant:

- URL and method normalization;
- request-body summarization for deletion diagnostics;
- header collection and merging;
- response metadata construction;
- Promise rewrapping for unrelated fetches;
- XHR per-request header/body metadata allocation.

Some header capture remains functionally useful because internal API export can fall back to observed Authorization and `oai-*` headers. Lite response rewrite also requires a fetch hook for matching conversation-detail responses.

### Risk

- diagnostic work during normal Debug-OFF traffic;
- extra allocations for unrelated requests;
- unnecessary Promise wrapper on unrelated fetches;
- broader-than-required request instrumentation.

### Remediation

Use a staged gate:

1. cheaply classify the URL/method;
2. return the original fetch result directly for unrelated requests;
3. collect only required auth headers for relevant backend/session requests;
4. summarize bodies and record deletion/non-GET diagnostics only when Debug mode is ON;
5. wrap response promises only when either auth observation, Debug monitoring, history probing, timestamp extraction, or Lite rewrite can apply;
6. add equivalent Debug/URL gates to XHR metadata collection.

Do not remove the functional Lite rewrite or explicit internal-export fallback.

### Validation

- unrelated fetches call and return the original fetch directly;
- Debug-OFF non-GET requests do not parse/summarize request bodies;
- matching conversation-detail responses still produce timestamp indexes and Lite rewrites;
- explicit Debug-ON deletion/non-GET monitoring still works;
- Markdown/internal export fallback remains available.

## 6. P2 findings and future plan

## P2-1: code-block collapser does not restart after extension re-enable

### Finding

Disabling Arcaia calls `cleanupCodeBlockCollapserUi()`, which disconnects both code-block observers. Re-enabling calls `startArcaiaPageUi()`, but `arcaiaPageUiStarted` is already true, so it returns before restarting the collapser. The explicit re-enable sequence restarts other features but omits `startCodeBlockCollapserUi()`.

### Planned fix

- explicitly restart the code-block collapser in `setExtensionEnabled(true)`;
- add an OFF → ON lifecycle regression test.

## P2-2: extension OFF is not a complete runtime stop

### Finding

The OFF switch removes visible UI and gates many callbacks, but leaves multiple observers, intervals, listeners, and main-world hooks alive.

### Planned decision

Clarify and implement one of:

- display/features disabled, runtime watchers retained; or
- full extension runtime stop with per-feature `start()`/`stop()` lifecycle.

The UI wording currently implies the second behavior. A lifecycle refactor should be done deliberately rather than adding ad-hoc disconnect calls.

## P2-3: duplicate 2.5-second conversation URL fallbacks

### Finding

Both `content.js` and `injected-main.js` maintain a 2.5-second conversation URL synchronization fallback. Existing history hooks and mutation-triggered checks make these intervals secondary reliability mechanisms.

### Planned action

- first add hidden-page and extension-disabled gates where missing;
- use a dedicated navigation probe before deleting either interval;
- retain both until event reliability is proven.

## 7. Runtime mechanisms accepted by this review

## 7.1 GPT-5.6 rich model selector

Accepted design:

- document-root observer for trigger/portal replacement discovery;
- picker-local observer while open;
- `menu.itemSelect` as the primary selection event;
- microtask click fallback only;
- no interval or fixed-millisecond state settlement.

Evidence:

- Probe confirmed `click → menu.itemSelect → menu DOM removal → trigger replacement`;
- the picker is portal-rendered;
- the trigger is React-replaced;
- callbacks filter relevant nodes and state.

No review-time change is required.

## 7.2 Message timestamp observer

Accepted design:

- observes `main` when available;
- `childList + subtree` only;
- retargets when ChatGPT replaces `main`;
- detailed snapshots are Debug-gated.

The retarget path is supported by prior diagnostics that observed a disconnected root.

## 7.3 Code-block collapser observers

Accepted design:

- block processing observer on `main`;
- lightweight document-root observer only to detect `main` replacement;
- attribute filter limited to relevant code/writing-block attributes.

The current structure is acceptable. P2-1 concerns lifecycle restart, not observer scope.

## 7.4 Assistant generation, title, favicon, and completion sound monitor

Accepted design:

- composer-form child-list observer;
- exact composer submit/stop button attribute observer;
- shared generation state for title and completion sound;
- broad loading-element trace starts only while Debug mode is ON.

No review-time change is required.

## 7.5 Markdown turn-export discovery

Accepted design:

- `main`-root observer;
- exact native copy-button selector;
- document-level `pointerover` and `focusin` listeners scoped immediately to assistant/turn elements.

Prior browser verification showed that removing the interaction listeners caused the Markdown icon to fail on lazy toolbars. This fallback is therefore evidence-based and retained.

## 7.6 Pinned sidebar observer root

Accepted design:

- sidebar/chat-history-root observer rather than body-wide observation.

Only the retry scheduling is defective; the observer root itself is acceptable.

## 8. Debug-OFF audit summary

Correctly gated:

- stored debug event writes;
- Content failed trace observer;
- prompt TOC event diagnostics;
- chat-loading element trace;
- retained main-world observation arrays;
- Network Lite Probe extra requests;
- detailed timestamp snapshots;
- explicit diagnostic ZIP details.

Debug-OFF leaks identified:

1. delayed startup DOM diagnostic construction;
2. Lite runtime layout diagnostics;
3. fetch/XHR request-body and metadata preparation before Debug gates.

## 9. Test gaps found by the review

The existing 95 tests are useful but rely heavily on source-pattern assertions. They did not detect:

- expensive arguments evaluated before a Debug-gated logger returns;
- retry timer multiplication;
- all-frame main-world setup;
- OFF → ON observer restart omission;
- unrelated fetches passing through diagnostic preparation and Promise wrapping.

Required regression coverage:

1. Debug-OFF startup does not build DOM diagnostics;
2. pinned sort has one bounded retry timer;
3. manifest injects only into the top frame;
4. Debug-OFF Lite normal apply does not run layout diagnostics;
5. unrelated fetch returns through a direct original-fetch path;
6. Debug-OFF request bodies are not summarized;
7. matching conversation fetch still rewrites and extracts timestamps;
8. extension OFF → ON restarts code-block observers.

## 10. Implementation order

### Phase P1

1. P1-4: gate delayed startup diagnostics;
2. P1-2: stop pinned retry multiplication;
3. P1-3: split Lite runtime summary from heavy diagnostics;
4. P1-5: move fetch/XHR cheap gates forward;
5. P1-1: switch manifest to top-frame-only and run browser smoke checks.

The implementation may be committed in smaller reviewable commits, but all five P1 items must be completed before P2 work begins.

### Phase P2

1. restore code-block collapser after re-enable;
2. define and implement full extension runtime lifecycle;
3. probe and simplify duplicate navigation fallbacks.

## 10.1 P2-1 / P2-2 implementation contract

Release `0.1.206` changes the popup `有効` switch from a display-only gate to a runtime lifecycle switch.

When switched OFF, Arcaia now stops or removes:

- model-selector observers and document listeners;
- code-block observers and generated toggle UI;
- message-timestamp observer and pending timers;
- Rolling Lite observer, fallback interval, startup burst and pending timers;
- page-conversation history hooks, URL fallback interval and navigation listeners;
- assistant generation observers, page listeners, title state and notification monitoring;
- Debug-only loading observer/listeners;
- Ctrl+Enter document listener;
- pinned-sidebar observer, startup timers, drag listeners and temporary picker listeners;
- turn-export observer, interaction listeners, startup timers and inserted buttons;
- main-world `fetch` / XHR wrappers;
- main-world Lite conversation URL fallback interval and navigation listeners.

The Chrome runtime message listener and the main-world/content message bridge remain installed intentionally. They are the minimal control path required to receive a later ON command without reloading the tab. They do not keep feature observers, polling intervals or network wrappers active.

When switched ON, the normal startup path is executed again. This includes `startCodeBlockCollapserUi()`, fixing the previous OFF → ON restart omission.

## 10.2 P2-3 URL-monitoring responsibilities

There are two low-frequency 2.5-second fallback intervals. They serve different execution worlds.

### Content-world interval

`PAGE_CONVERSATION_FALLBACK_INTERVAL_MS` detects ChatGPT SPA URL or conversation-ID changes that were not observed through:

- wrapped `history.pushState` / `history.replaceState`;
- `popstate` / `hashchange`;
- the existing relevant DOM-mutation path.

On a detected change it:

- clears the cached main-world Lite status;
- resets full-load-once state when moving between conversations;
- resets timestamp and Rolling Lite state;
- requests main-world conversation synchronization;
- schedules timestamp, Lite and assistant-state updates for the new conversation.

### Main-world interval

`LITE_CONVERSATION_SYNC_FALLBACK_INTERVAL_MS` keeps the main-world Lite configuration aligned with the current page URL. It protects:

- the `liteDisplayConfig.conversationId` used by backend conversation-response rewriting;
- full-load-once state from leaking into a different conversation;
- the rule that only the currently open conversation response may be rewritten.

Both intervals are hidden-page gated where applicable and are now stopped completely while Arcaia is OFF.

Release `0.1.207` removes both intervals after a navigation Probe confirmed that History events update `location.href` before canonical, sidebar and turn DOM state. The Probe covered sidebar navigation, browser back/forward, new-chat transitions and first-message conversation-ID assignment. Main world now wraps `history.pushState` and `history.replaceState`, listens for `popstate` and `hashchange`, synchronizes Lite state immediately, and emits one `page_navigation` event through the existing bridge. Content world consumes that event and no longer wraps History or polls the URL. A queued resync preserves the latest navigation when another event arrives while an earlier content synchronization is still in flight.

## 11. Stop conditions

Stop and request user input if any P1 fix would require:

- changing an accepted user-visible feature contract;
- removing a reliability fallback whose necessity was previously proven;
- introducing a new broad observer or polling path;
- changing internal API behavior beyond preserving current export/Lite functionality;
- touching unrelated working-tree changes;
- requiring a push or external deployment.

## 12. Completion record

This section is updated as remediation proceeds.

| Item | Status | Commit | Notes |
|---|---|---|---|
| Review documentation | COMPLETE | `f9f74f6` | This document |
| P1-1 top-frame-only injection | COMPLETE | `18796e7` | `all_frames=false`; `match_about_blank` removed |
| P1-2 bounded pinned retry | COMPLETE | `18796e7` | One startup burst and one retry timer maximum |
| P1-3 lightweight Lite runtime summary | COMPLETE | `18796e7` | Layout and sample diagnostics are Debug-gated |
| P1-4 Debug-OFF startup diagnostic gate | COMPLETE | `18796e7` | Delayed startup diagnostic timer is not registered in Debug OFF |
| P1-5 fetch/XHR cheap gate | COMPLETE | `18796e7` | Unrelated requests return directly; body/response diagnostics require Debug ON |
| P2-1 collapser restart | COMPLETE | `9887f66` | Full startup runs after re-enable, including code-block observers |
| P2-2 full OFF lifecycle | COMPLETE | `9887f66` | Feature observers, intervals, listeners and network hooks stop; control bridge remains |
| P2-3 interval consolidation | COMPLETE | `698ba7e` | Main-world History events are the source of truth; both 2.5-second intervals removed in `0.1.207` |

### P1 validation result

Validated after implementation:

- `node --check content.js`
- `node --check injected-main.js`
- `node --check popup.js`
- `node --test tests/lite-grouping.test.js`
- `git diff --check`

Result:

```text
tests 96
pass 96
fail 0
```

Release version after P1: `0.1.205`.

### P2 validation result

Validated after the P2-1 / P2-2 implementation:

- `node --check content.js`
- `node --check injected-main.js`
- `node --check popup.js`
- `node --test tests/lite-grouping.test.js`
- `git diff --check`

Result:

```text
tests 96
pass 96
fail 0
```

Release version: `0.1.206`.

### P2-3 validation result

Release `0.1.207` removes `PAGE_CONVERSATION_FALLBACK_INTERVAL_MS` and `LITE_CONVERSATION_SYNC_FALLBACK_INTERVAL_MS`. Regression coverage requires main-world `pushState` / `replaceState` hooks, `popstate` / `hashchange` listeners, OFF-time hook restoration, ON-time reinstallation, main-to-content `page_navigation` delivery, and queued content resynchronization for rapid consecutive navigation.

Validated after implementation:

- `node --check content.js`
- `node --check injected-main.js`
- `node --check popup.js`
- `node --test tests/lite-grouping.test.js`
- `git diff --check`

Result:

```text
tests 96
pass 96
fail 0
```

Release version: `0.1.207`.

