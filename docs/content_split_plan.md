# Arcaia content.js Split History and Current Structure v0.1.281

## Current status in v0.1.281

This document is a historical split log that started at v0.1.112. Sections describing `content_zip.js`, diagnostic ZIP generation, and generic Debug runtime are retained only as implementation history; they are not the current runtime architecture.

The current manifest content-script order is:

```text
content_toolbar.js
content_markdown.js
content_filename.js
content_model_selector.js
content.js
```

Current status:

- `content_zip.js` has been removed and is not loaded by the manifest.
- `content_diagnostics.js` was removed after its pure helpers became unused by normal runtime.
- Generic Debug UI/runtime, persistent diagnostic logging, and diagnostic ZIP generation have been removed.
- Model-selector normal status is lightweight; detailed investigation is performed by standalone scripts under `tools/`.
- Assistant generation completion is conversation-bound. Final stream removal is deferred for one render opportunity so a pending `page_navigation` can cancel it; navigation away from an active generation is treated as `navigation_abandon`, not normal completion.
- Model-selector discovery is localized to the Composer, its direct parent, surface controls, the live trigger, the visible Picker, and the actual thinking slider. The former persistent `documentElement` observer has been removed.
- Confirmed Picker selection mutations are resolved from the retained Picker reference before Portal teardown, including GPT-5.6 to GPT-5.5 transitions.
- The shared conversation observer remains available to block, timestamp, and Markdown features, while Recent View only schedules regrouping for probe-confirmed turn, role, message-id, and roleless empty/non-empty transitions.
- Header Markdown startup temporarily observes the header only until the native Share action appears, then rebinds the same observer to the direct actions container; route changes reuse the existing page-state event path and no polling is used.
- SPA navigation and initial render keep one pending conversation-DOM sync keyed by route and DOM identity. Replacement header／Composer readiness triggers the first follow-up, and later conversation content-root readiness can trigger one second follow-up through the same sync path; displaced main-world History wrappers are repaired during the existing conversation sync request.
- While that pending sync is active on a conversation route, one temporary child-list observer covers the replacement DOM gap. Its callback ignores unrelated conversation mutations and reacts only to header／Composer replacement, header-local child changes, or the first conversation-section/content-root appearance.
- Conversation-DOM readiness requires the replacement Composer, not the model trigger. A delayed trigger remains the responsibility of the existing Composer-local model-selector observer, so header Markdown restoration is not coupled to model decoration timing.
- User and assistant timestamp badges use the same non-italic type style. Provisional timestamps remain distinguishable by their lower opacity and explicit provisional attribute.
- Recent View inserts its history controls immediately before the first visible turn, so the controls naturally appear only when the user reaches the top. It does not add a scroll listener.
- Progressive history loading keeps the popup-configured base turn count unchanged and applies a session-scoped override only to the current conversation, in steps of up to 10 turns with a staged maximum of 50.
- Full-history loading and progressive loading persist a conversation-scoped request and use a same-conversation document reload. A successful cloned conversation request returns HTTP 200 but does not update ChatGPT React state, so a plain refetch is not a valid UI refresh path.
- The action performs no Content-side conversation fetch, interval, scroll listener, or temporary route round trip. The scoped request is consumed by the normal page-load conversation response.
- Failed Recent View history actions render one temporary, accessible notice only from the failure path. The notice distinguishes whether the original conversation is currently visible and removes itself after seven seconds; successful actions render no notice.

## Purpose

At v0.1.112, `content.js` had grown to roughly 8,000 lines and contained startup injection, ChatGPT internal API export, Lite rendering, timestamps, pinned sidebar sorting, toolbar operations, diagnostics, ZIP creation, and message dispatch. The original goal was to split it gradually without changing runtime behavior.

v0.1.112 was the planning milestone. v0.1.113 performed the first low-risk split by extracting ZIP helper code. Later versions removed the generic diagnostic ZIP path and `content_zip.js`; the current v0.1.275 structure is documented above.

## Non-goals for early split milestones

- Do not split Lite implementation yet.
- Do not change backend rewrite behavior.
- Do not change message timestamp behavior.
- Do not convert content scripts to ES modules.
- Do not introduce a bundler.
- Do not change storage keys or protocol names.
- Do not change runtime behavior.

## Historical loading strategy (v0.1.112; obsolete)

Use Chrome extension multiple content scripts rather than ES modules for the first split.

Historical planned shape:

```json
"content_scripts": [
  {
    "matches": ["https://chatgpt.com/*"],
    "js": [
      "content_shared.js",
      "content_zip.js",
      "content_toolbar.js",
      "content.js"
    ],
    "run_at": "document_start",
    "all_frames": true,
    "match_about_blank": true
  }
]
```

This keeps the same content-script global scope and avoids module import/export risk. The final `content.js` remains the orchestrator and message dispatcher until later milestones.

## Historical v0.1.112 content.js map

The following line numbers are approximate from v0.1.112.

| Area | Approx lines | Notes |
|---|---:|---|
| Version/protocol constants | 1-20 | APP_VERSION, protocol source names, injected script id. |
| Early pinned sidebar gate | 20-100 | Runs very early and should not be moved first. |
| Shared utilities | 100-490 | Time, URL redaction, sleep, storage/debug helpers, conversation id helpers. |
| Main-world bridge | 490-630 | `postToMainAndWait` and main-world request wrappers. |
| ChatGPT internal fetch/export parsing | 630-1900 | Auth, raw conversation fetch, mapping/path parsing, markdown export helpers. |
| Lite/backend rewrite/client render logic | 1900-6100 | Largest and highest-risk area. Defer until later. |
| Pinned sidebar sorter | 6100-6930 | DOM-heavy. Defer until after low-risk split. |
| Turn export button | 6930-7170 | Medium-risk; depends on export helpers and DOM toolbar detection. |
| Page UI startup | 7170-7400 | Orchestration. Keep in content.js until boundaries stabilize. |
| Diagnostics bundle | 7400-7790 | Candidate for later split after ZIP/helper extraction. |
| Toolbar ZIP/Markdown operations | 7790-8020 | Good first functional split candidate after helpers are extracted. |
| Runtime message dispatcher | 8020-end | Keep in content.js until all target functions are stable globals. |

## Historical dependency direction

Preferred dependency direction:

```text
content_shared.js
  ↓
content_zip.js
  ↓
content_toolbar.js
  ↓
content_diagnostics.js
  ↓
content.js orchestrator / dispatcher
```

Temporary global namespace may be used during the transition:

```js
window.ArcaiaContentShared = { ... };
window.ArcaiaContentZip = { ... };
window.ArcaiaContentToolbar = { ... };
```

This is intentionally not exported to page scripts. It remains content-script isolated world state.

## Historical first split candidate

### Completed in v0.1.113: `content_zip.js`

This was selected first because ZIP helper logic is mostly self-contained and used by toolbar diagnostic ZIP only.

Moved in v0.1.113:

- `TOOLBAR_ZIP_ENCODER`
- `TOOLBAR_ZIP_CRC32_TABLE`
- CRC32 helper
- ZIP local-header helpers
- `createToolbarZipBlob`

Keep in `content.js` for now:

- `downloadBlob`
- diagnostic payload construction
- toolbar modal/toast
- runtime message dispatch

Acceptance criteria:

- Existing diagnostic ZIP download still works.
- No new fetches are introduced.
- `node --check content.js` passes.
- `node --test tests/lite-grouping.test.js --test-reporter=dot` passes.
- Test asserts that ZIP helper is loaded before content.js in manifest.


## Second split completed in v0.1.114

### Completed in v0.1.114: `content_toolbar.js`

Toolbar UI and page-job orchestration were extracted after the ZIP helper split was confirmed working.

Moved in v0.1.114:

- toolbar modal/toast helpers
- `startToolbarPageJob`
- `runToolbarMarkdownSave`
- `runToolbarDiagnosticZipSave`
- `startToolbarMarkdownSaveFromPopup`
- `startToolbarDiagnosticZipFromPopup`

Kept in `content.js`:

- `extractChatGPTInternal`
- `collectDiagnosticBundleFromContent`
- `buildToolbarDiagnosticZipPayload`
- `downloadText` / `downloadBlob`
- Debug mode state
- runtime dispatcher wiring

`content_toolbar.js` receives these dependencies from `content.js` through an explicit dependency object. This avoids moving diagnostics, export, Debug, or Lite logic in the same milestone.


## v0.1.115 hotfix note

After `content_toolbar.js` was extracted, popup fallback injection still injected only `content.js`. v0.1.115 fixes that path by injecting split content scripts in dependency order:

```text
content_zip.js
content_toolbar.js
content.js
```

This matters for already-open tabs and any page where the popup has to recover from `Receiving end does not exist` / content-script disconnect states.

## v0.1.116 hotfix note

After the toolbar split, the thin toolbar wrapper functions were accidentally left after the closing `})();` of the `content.js` IIFE. That was syntactically valid JavaScript, so `node --check` did not catch it, but those wrappers could no longer see `APP_VERSION` or other content-local state. Diagnostic ZIP save then failed with:

```text
APP_VERSION is not defined
```

v0.1.116 moved the wrappers back inside the `content.js` IIFE and added a regression test for wrapper placement.

## v0.1.117 stabilization gate

v0.1.117 is a stabilization-only milestone before any new split. It does not extract new files. Its purpose is to lock the split-safety rules before `content_diagnostics.js` work resumes.

Required split-safety checklist for future extraction tasks:

- Verify no content-local wrapper is left after the final `})();`.
- Verify every wrapper that references `APP_VERSION`, `debugModeEnabled`, or other content-local state remains inside the `content.js` IIFE.
- Verify helper files such as `content_toolbar.js`, `content_zip.js`, and future `content_diagnostics.js` do not directly reference content-local variables.
- Pass dependencies explicitly through a `deps` object or function arguments.
- Do not rely on `node --check` alone; add source-structure tests for split boundaries.
- Keep the manifest and popup auto-injection script order aligned whenever a split content script is added.


## Third split candidate

### v0.1.116 candidate: `content_diagnostics.js`

Move after toolbar split is stable.

Moved in v0.1.113:

- `collectDiagnosticBundleFromContent`
- DOM diagnostic helpers
- Lite diagnostic flatteners
- manual-debug diagnostic policy helpers

Keep Lite implementation itself in `content.js` until later.

## v0.1.118 small diagnostics split

v0.1.118 creates `content_diagnostics.js` and moves only the pure `simpleDiagnosticHash` helper. This was chosen as the first diagnostics extraction because it has no DOM, Chrome API, Debug mode, Lite state, timestamp, backend rewrite, or toolbar dependency.

`content.js` keeps a thin wrapper that calls `window.ArcaiaContentDiagnostics.simpleDiagnosticHash(text)`. Larger diagnostics functions remain intentionally in `content.js`.

Next candidate for v0.1.119: move one more small pure diagnostics helper, preferably a rectangle/shape normalizer or another dependency-light formatting helper. Do not move `collectDiagnosticBundleFromContent` or `buildToolbarDiagnosticZipPayload` wholesale.

## v0.1.119 small diagnostics split continuation

v0.1.119 continues the conservative diagnostics split by moving the pure rectangle-shape normalizer `normalizeRectForDiagnostics(rect)` into `content_diagnostics.js`.

`content.js` still owns the DOM call to `getBoundingClientRect()`. Only the plain-object rounding/shape normalization moves to the helper file, so DOM traversal, Debug mode, Lite behavior, timestamp behavior, backend rewrite, and diagnostic ZIP payload semantics remain unchanged.

Recommended next step after v0.1.119: pause broad diagnostics extraction unless another similarly pure helper is obvious. Do not move large diagnostic bundle orchestration without a separate boundary review.

## Deferred split candidates

### Timestamp split

`content_timestamps.js` should wait until diagnostics/toolbar are stable. It has DOM observer and assistant generation timing dependencies.

### Lite split

`content_lite.js` and `content_lite_backend_rewrite.js` should be last. Lite contains the most fragile code and interacts with backend rewrite, DOM hiding, image placeholders, and main-world state.

### Pinned sidebar split

Pinned sidebar sorting can move after early gate behavior is preserved. The early gate at the top of `content.js` is startup-sensitive and should remain untouched until a dedicated milestone.

## Required safety checks for every split milestone

Run all of the following before commit:

```powershell
node --check content.js
node --check injected-main.js
node --check popup.js
node --test tests/lite-grouping.test.js --test-reporter=dot
git diff --check
```

Also verify by grep that no old version remains outside README history.

## Recommended next milestone

After v0.1.119, pause broad diagnostics extraction unless another similarly pure helper is obvious. Do not move `collectDiagnosticBundleFromContent`, `buildToolbarDiagnosticZipPayload`, timestamp, Lite, backend rewrite, or pinned sidebar code wholesale without a separate boundary review.

## v0.1.120 post-split stabilization review

v0.1.120 is a review-only stabilization milestone after the v0.1.117-v0.1.119 split sequence. Real-world verification reported no current behavior problem.

Review result:

- `content_diagnostics.js` contains only small dependency-light helpers.
- `content.js` remains the orchestrator for DOM access, Lite behavior, timestamp behavior, backend rewrite, Debug mode, toolbar dependency injection, and message dispatch.
- `content_toolbar.js`, `content_zip.js`, and `content_diagnostics.js` remain helper files loaded before `content.js`.
- Broad movement of `collectDiagnosticBundleFromContent` or `buildToolbarDiagnosticZipPayload` remains deferred.

Gate to v0.1.121:

- Proceed to Lite image placeholder false-positive review only if v0.1.120 checks pass and no real-world regression is reported.

## v0.1.121 Lite image placeholder false-positive review

v0.1.121 reviews the Lite synthetic image placeholder guards after real-world verification reported no current behavior problem.

Review result:

- Placeholder insertion is still limited to retained user-only turns.
- Image signal lookup stops before the next retained user turn.
- User-authored messages are not treated as image signals.
- Search result thumbnail paths remain ignored to reduce false positives.
- No Lite behavior change is introduced in this milestone.

Gate to v0.1.122:

- Proceed to timestamp existing-history review only if v0.1.121 checks pass and no placeholder false positive is reported.

## v0.1.122 timestamp existing-history review

v0.1.122 reviews the existing-history timestamp safeguards after real-world verification reported no current behavior problem.

Review result:

- Initial DOM role nodes are marked before timestamp index refresh on startup.
- Conversation changes reset timestamp state and mark the newly visible DOM as initial history.
- Initial existing DOM waits for the main-world timestamp index instead of immediately receiving current-time provisional badges.
- Provisional timestamps remain available for genuinely new DOM blocks when the index has not caught up.
- No content-side conversation fetch is introduced.
- No timestamp behavior change is introduced in this milestone.

Gate to v0.1.123:

- Proceed to the next boundary planning task only if v0.1.122 checks pass and no timestamp regression is reported.

## v0.1.123 next-boundary planning

v0.1.123 is a planning-only milestone after v0.1.120-v0.1.122 review tasks. It does not extract another source helper.

Decision:

- Pause broad diagnostics extraction.
- Do not move `collectDiagnosticBundleFromContent` or `buildToolbarDiagnosticZipPayload` without a dedicated design task.
- Keep timestamp, Lite, backend rewrite, and pinned sidebar code in `content.js` until a focused boundary review is approved.
- Prefer the next implementation work to be either a real-world behavior fix if a regression appears, or a Markdown/export boundary review before any export split.

Recommended next task:

- v0.1.124 should be either `Markdown/export boundary review` or a targeted behavior fix requested from real-world testing.

## v0.1.124 Markdown/export boundary review

v0.1.124 is a planning-and-test milestone for Markdown/export boundaries. It does not extract another source helper.

Review result:

- Keep Markdown body generation and ChatGPT internal extraction in `content.js` for now.
- Keep `content_toolbar.js` as UI/job orchestration only. It should call injected dependencies such as `extractChatGPTInternal`, `makeBaseExportName`, and `downloadText` instead of owning export logic.
- Keep single-turn export button logic in `content.js` until a dedicated turn-export boundary review is approved.
- Do not move `extractChatGPTInternal`, `buildMarkdownDraft`, `buildSingleTurnMarkdownDraft`, or `downloadText` in the same task.
- A future Markdown/export split should start with pure text formatting helpers only, not data fetching or DOM toolbar code.

Gate after v0.1.124:

- Proceed to v0.1.125 only if tests pass and no Markdown/diagnostic ZIP/turn export regression is reported.
- Recommended v0.1.125 direction: either pause for real-world verification, or create a small `content_markdown.js` boundary plan before any actual extraction.

## v0.1.125 content_markdown boundary plan

v0.1.125 is a planning-and-test milestone for the first possible `content_markdown.js` extraction. It does not create the helper file yet.

Review result:

- First extraction candidate: pure Markdown message-body helpers only.
- Candidate helpers: `sanitizeMarkdownText`, `buildNonTextMarkdownBody`, `renderMarkdownMessageBody`, `pickMarkdownUserMessages`, and `pickFinalAssistantMessageForMarkdown`.
- Keep `buildMarkdownDraft` and `buildSingleTurnMarkdownDraft` in `content.js` because they currently depend on `APP_VERSION`, `nowIso()`, and export metadata assembly.
- Keep filename helpers, `downloadText`, `downloadBlob`, `extractChatGPTInternal`, and turn export DOM code in `content.js`.
- Future `content_markdown.js` must not directly reference `APP_VERSION`, `chrome.*`, `document`, or `fetch`.

Gate after v0.1.125:

- v0.1.126 may create `content_markdown.js` only for the pure helper set above.
- Do not move export metadata, download, extraction, or turn export DOM logic in v0.1.126.

## v0.1.126 content_markdown small helper extraction

v0.1.126 creates `content_markdown.js` and moves only the first approved pure helper set from v0.1.125.

Extraction result:

- `content_markdown.js` contains only pure Markdown message-body helpers.
- Moved helpers: `sanitizeMarkdownText`, `buildNonTextMarkdownBody`, `renderMarkdownMessageBody`, `pickMarkdownUserMessages`, and `pickFinalAssistantMessageForMarkdown`.
- `content.js` keeps thin wrappers that call `window.ArcaiaContentMarkdown`.
- `content.js` keeps `buildMarkdownDraft`, `buildSingleTurnMarkdownDraft`, filename helpers, `downloadText`, `downloadBlob`, `extractChatGPTInternal`, and turn export DOM code.
- `content_markdown.js` must not directly reference `APP_VERSION`, `chrome.*`, `document`, or `fetch`.

Gate after v0.1.126:

- Pause for real-world verification before moving any larger Markdown/export logic.
- Do not move metadata assembly or download/extraction code without another boundary review.

## v0.1.127 content_markdown split stabilization review

v0.1.127 is a minimum stabilization review after the v0.1.126 `content_markdown.js` split. Real-world verification reported no current behavior problem.

Review result:

- `content_markdown.js` remains dependency-light and does not own export metadata, download, extraction, or DOM code.
- Manifest and popup auto-injection continue to load `content_markdown.js` before `content.js`.
- Markdown save, single-turn save, and diagnostic ZIP behavior are expected to remain unchanged.

Gate after v0.1.127:

- v0.1.128 may review Markdown draft metadata boundaries without adding another source split.

## v0.1.128 Markdown draft metadata boundary review

v0.1.128 reviews `buildMarkdownDraft` and `buildSingleTurnMarkdownDraft` before any larger Markdown draft split.

Review result:

- Keep full draft builders in `content.js` for now.
- `APP_VERSION` and `nowIso()` remain content-side dependencies.
- A metadata line formatter may be moved only if `APP_VERSION` and `generatedAt` are passed as arguments, not referenced directly from `content_markdown.js`.
- The next safe extraction is limited to pure line/heading helpers, not full draft generation.

Gate after v0.1.128:

- v0.1.129 may add small Markdown draft formatter helpers to `content_markdown.js` if they remain pure and dependency-injected.

## v0.1.129 small Markdown draft formatter extraction

v0.1.129 adds small pure Markdown draft formatter helpers to `content_markdown.js`.

Extraction result:

- Added `buildMarkdownHeaderLines`, `buildMarkdownTurnHeading`, and `buildMarkdownRoleHeading` to `content_markdown.js`.
- `content.js` still owns full draft orchestration, export metadata source selection, `APP_VERSION`, `nowIso()`, filename helpers, download, extraction, and turn export DOM code.
- `content.js` passes `APP_VERSION` and `generatedAt` into pure helper arguments.
- `content_markdown.js` still must not directly reference `APP_VERSION`, `chrome.*`, `document`, or `fetch`.

Gate after v0.1.129:

- Pause for real-world verification before any larger Markdown/export split.
- The next extraction, if any, should be another tiny formatter-only task or a filename pure-helper boundary review.

## v0.1.130 filename / export name helper final split

v0.1.130 is the final task in the current split cycle.

Extraction result:

- Creates `content_filename.js` for dependency-light filename/export-name helpers.
- Moves `makeSafeFileName`, `formatDateTimeForFile`, date picking, `makeBaseExportName`, and `makeSingleTurnExportName` behind `window.ArcaiaContentFilename`.
- `content.js` keeps thin wrappers and passes `normalizeTimestampToDate` into date formatting/export-name helpers.
- `downloadText` and `downloadBlob` remain in `content.js` because they touch Blob, URL, DOM, and click side effects.
- `content_filename.js` must not directly reference `APP_VERSION`, `chrome.*`, `document`, `fetch`, or `URL.createObjectURL`.

Split cycle closure:

- Stop planned source-splitting after v0.1.130.
- v0.1.131 should return to product development or targeted bug fixes.
- Further splitting should only happen when it directly supports a concrete feature/fix.

## v0.1.131 single-turn filename turn number

v0.1.131 returns to product-facing improvement after the split cycle.

Change result:

- Single-turn Markdown export filenames include the turn number.
- Format: `<date>_<title>_turn_003-of-012.md` when the total turn count is known.
- If the total turn count is unavailable, the fallback is `<date>_<title>_turn_003.md`.
- The change is implemented inside `content_filename.js`; `downloadText` and `downloadBlob` remain in `content.js`.

## v0.1.133 short conversation Lite no-op hotfix

v0.1.133 prevents Lite from becoming effectively active on short conversations where no history would be hidden.

Fix result:

- DOM Lite uses `below_lite_turn_threshold` when the plan has no hidden sections.
- The Lite toolbar is hidden in that no-op state.
- Any previously hidden Lite sections are unhidden before returning the no-op state.
- Backend rewrite skips short conversations before placeholder insertion.

## v0.1.134 turn export selector and branch navigation safety

v0.1.134 tightens the normal-runtime turn export selector/observer path and adds branch navigation diagnostics without adding a persistent watcher.

Change result:

- Turn export copy button selector is narrowed to `button[data-testid="copy-turn-action-button"]`.
- Turn export observer root now prefers `main` before `document.body`.
- Native branch navigation controls are guarded so the Markdown button is not inserted into that UI.
- Branch navigation diagnostics are collected only when a diagnostic bundle is requested; no new normal-runtime observer or interval is added.
- Debug mode OFF normal runtime review remains focused on active selectors, observers, hooks, and event listeners only.

## v0.1.135 Markdown turn export button native focus style

v0.1.135 aligns the Markdown turn export button with native ChatGPT response-action button styling.

Change result:

- The Markdown button now uses the same native-style button classes as neighboring response action buttons.
- The icon is wrapped in a native-style `h-8 w-8` flex centering span.
- Custom hover background, opacity, margin, and fixed 28px sizing were removed from Arcaia CSS so focus/hover behavior follows ChatGPT's existing toolbar styles.

## v0.1.136 Debug-OFF runtime audit and Markdown focus style fix

v0.1.136 adds `docs/runtime_observer_selector_audit.md` to separate Debug-OFF normal runtime observers/selectors/hooks from debug-only and diagnostic-only paths.

It also fixes Markdown turn export button focus styling:

- removed Arcaia's `color: inherit` override so native `text-token-text-secondary` controls icon color
- added focus/focus-visible background using `--token-surface-hover`
- kept native button classes and the `h-8 w-8` icon wrapper

## v0.1.137 Markdown turn export focus fallback

v0.1.137 fixes a focus-style edge case where `document.activeElement` can be the Markdown turn export button while CSS `:focus` / `:focus-visible` does not match and `--token-surface-hover` is empty.

Change result:

- added native-style focus classes to the Markdown turn export button
- added a `focusin` / `focusout` data attribute fallback on the button itself
- changed the custom fallback background to `background-color` with `--token-surface-hover`, `--main-surface-secondary`, and an rgba fallback

## v0.1.138 Markdown turn export native style simplification

v0.1.138 reverts the extra Markdown turn export focus fallback and keeps the button aligned with the native ChatGPT response action button shape.

Change result:

- removed `focus:bg-token-surface-hover` and `focus-visible:bg-token-surface-hover` from the Markdown turn export button
- removed the `focusin` / `focusout` data-attribute fallback
- removed the custom `data-arcaia-turn-export-focused` background rule
- kept only the native-style response action button classes plus Arcaia identification classes

## v0.1.139 complexity guardrails

v0.1.139 adds a development guardrail document to prevent over-specific fixes from accumulating into unnecessary runtime complexity.

Change result:

- added `docs/complexity_guardrails.md`
- documented native-first, user-action-only, diagnostic-only, observer/interval/hook/synthetic-DOM/fallback review rules
- recorded the Markdown turn export v0.1.137 -> v0.1.138 focus fallback simplification as the reference example
- no new Debug-OFF runtime watcher/timer/hook was added

## v0.1.140 complexity regression audit

v0.1.140 applies `docs/complexity_guardrails.md` to current Debug-OFF runtime behavior.

Change result:

- added `docs/complexity_regression_audit_v0_1_140.md`
- classified observer / interval / hook / fallback / synthetic-DOM complexity candidates
- confirmed the v0.1.137 Markdown focus fallback residue is absent
- selected no immediate code deletion because remaining candidates protect runtime reliability and need targeted measurement first
- no new Debug-OFF runtime watcher/timer/hook was added

## v0.1.141 rolling Lite observer lightweight guard

v0.1.141 reduces rolling Lite normal-runtime observer/timer cost without changing Lite grouping behavior.

Change result:

- removed `characterData: true` from `rollingLiteObserver` so text-node streaming does not trigger Lite re-apply by itself
- kept `childList` + `subtree` because Lite grouping depends on turn/message DOM additions and removals
- replaced the unconditional 5s fallback scheduling call with `startRollingLiteFallbackInterval()`
- added `shouldRunRollingLiteFallbackInterval()` so the fallback interval is a cheap no-op outside conversation pages or while the document is hidden
- no new Debug-OFF runtime watcher/timer/hook was added; existing fallback interval was gated

## v0.1.142 main-world Lite conversation sync fallback guard

v0.1.142 reduces the main-world Lite conversation sync fallback cost while preserving immediate content-side sync requests.

Change result:

- replaced the hard-coded 500ms `syncLiteDisplayConversationId('interval')` loop with `LITE_CONVERSATION_SYNC_FALLBACK_INTERVAL_MS = 2500`
- added `shouldRunLiteConversationSyncFallbackInterval()` so the fallback is a cheap no-op while the document is hidden
- kept `SYNC_PAGE_CONVERSATION` handling so content-side history hooks can still request immediate main-world sync
- kept `popstate` and `hashchange` immediate sync scheduling
- no new Debug-OFF runtime watcher/timer/hook was added; an existing fallback interval was slowed and gated

## v0.1.143 pinned sidebar observer root narrowing

v0.1.143 narrows pinned sidebar sorting's normal-runtime observer away from `document.body`.

Change result:

- added `PINNED_SORT_OBSERVER_ROOT_SELECTOR` for the ChatGPT sidebar / chat history nav root
- added `getPinnedSortObserverRoot()` and `observePinnedSortRoot()`
- changed `startPinnedSortUi()` to observe the sidebar/nav root instead of `document.body`
- retained startup retry scans because the sidebar may render late
- no new Debug-OFF runtime watcher/timer/hook was added; an existing observer was moved to a narrower root

## v0.1.144 pinned sidebar bottom drop hotfix

v0.1.144 fixes a pinned sidebar drag/drop edge case where rows could be moved to the top through second-from-bottom positions, but not reliably to the final bottom position.

Change result:

- added explicit last-row lower-half handling for pinned sidebar dragover
- added list-level fallback handling so dragging over the lower half of the current last pinned row shows an append marker
- kept the narrowed sidebar/nav observer root from v0.1.143
- no new Debug-OFF runtime watcher/timer/hook was added

## v0.1.145 fetch/XHR hook cheap-gate review

v0.1.145 reduces normal main-world hook work without changing backend rewrite behavior.

Change result:

- added `isConversationJsonFetchResponse()` as the shared cheap gate for conversation-detail JSON responses
- added `shouldProcessConversationFetchResponse()` and uses it before calling the async rewrite path from patched `fetch`
- kept timestamp-index extraction and backend Lite rewrite behavior for matching conversation JSON responses
- changed XHR response inspection so the `loadend` listener is attached only when the manual history probe is armed and the XHR URL matches conversation history
- no new Debug-OFF runtime watcher/timer/hook was added; existing hooks now return earlier for unrelated traffic

## v0.1.146 turn export discovery trigger cleanup

v0.1.146 reduces Markdown turn export discovery to native copy-button DOM discovery paths.

Change result:

- removed the document-level `pointerover` / `focusin` interaction triggers from turn export discovery
- kept initial scans and the `MutationObserver` that reacts when native copy buttons are added
- kept the narrowed `button[data-testid="copy-turn-action-button"]` selector and branch-navigation guard
- no new Debug-OFF runtime watcher/timer/hook was added; existing document-level event listeners were removed

## v0.1.147 turn export lazy-toolbar trigger restore

v0.1.147 restores the Markdown turn export lazy-toolbar interaction triggers after browser verification showed v0.1.146 could fail to show the `.md` download icon.

Correction:

- The v0.1.146 assumption was insufficient: native copy-button `MutationObserver` discovery alone did not reliably cover lazy toolbar display.
- Restored `installTurnExportInteractionTriggers()` with document-level `pointerover` and `focusin` triggers scoped to assistant / conversation-turn targets.
- Kept the v0.1.134 narrowed copy button selector and branch-navigation guard.
- This intentionally re-adds the previous discovery fallback because visible `.md` button availability is more important than this small event-listener reduction.

## v0.1.148 new-chat timestamp provisional fix

v0.1.148 fixes a new-chat timestamp regression where live messages could be treated as initial existing DOM during the startup guard window and therefore show no timestamp.

Correction:

- The previous guarded apply behavior was too broad: it marked newly added live DOM as initial existing DOM while the index was still unavailable.
- Initial-history marking is now limited to explicit startup and conversation-change snapshots.
- `applyMessageTimestampBadges()` no longer calls `markInitialMessageTimeRoleNodes()` for newly observed DOM.
- Newly added live user / assistant DOM can again receive provisional `dom_first_observed_at` timestamps until an official index replaces them.

## v0.1.149 timestamp diagnostic expansion only

v0.1.149 does not change timestamp behavior. It expands Debug-ON diagnostics so the next new-chat timestamp report can be judged from logs instead of another hypothesis-driven behavior change.

Diagnostic additions:

- records whether the message timestamp observer target is still connected
- records timestamp mutation classification counts and reasons
- records schedule/apply/index-refresh debug events
- records before/after apply DOM snapshots with message IDs, badge presence, provisional flags, skip reasons, and text previews
- exposes current DOM snapshot and recent timestamp debug events in `messageTimestampUi`
- Debug-OFF output remains compact; heavy snapshots and event history are only exposed in Debug ON diagnostics

## v0.1.150 timestamp observer retarget fix

v0.1.150 fixes the new-chat timestamp observer target after v0.1.149 diagnostics showed `messageTimeObserverTarget.isConnected === false` while current DOM role nodes existed.

Fix result:

- added `getMessageTimestampObserverRoot()`, `observeMessageTimestampRoot()`, and `ensureMessageTimestampObserverRoot()`
- reconnects the timestamp observer when the previous `main` target was replaced by ChatGPT
- calls the reconnect guard before timestamp apply scheduling and timestamp index refresh scheduling
- keeps the message DOM selector, provisional timestamp fallback, and startup/conversation snapshot guard unchanged
- keeps the Debug-ON diagnostics from v0.1.149 so the next ZIP can confirm `targetConnected: true`

## v0.1.151 timestamp Debug-OFF diagnostic cost reduction

v0.1.151 keeps the v0.1.149/v0.1.150 timestamp diagnostics but avoids building diagnostic detail objects when Debug mode is OFF.

Change result:

- `pushMessageTimeDebugEvent()` now accepts lazy detail factories and returns before evaluating them when Debug mode is OFF
- timestamp debug event call sites now pass detail factories for schedule/apply/mutation/index/observer events
- `getMessageTimeObserverDiagnostic()` omits heavy target detail by default when Debug mode is OFF
- Debug ON diagnostic ZIP content remains available for timestamp investigation
- timestamp display behavior is unchanged

## v0.1.152 toolbar icon and extension-level enable switch

v0.1.152 adds a monochrome toolbar icon derived from the accepted main icon concept and a top-level Arcaia enable switch in the popup.

Change result:

- `icons/toolbar/icon16.png` / `icon32.png` / `icon48.png` / `icon128.png` are the Chrome action toolbar PNG assets
- `manifest.json` points toolbar action icons at PNG assets instead of SVG to avoid Chrome action fallback icons
- popup menu uses a compact checkbox-backed `role="switch"` control
- toggle state is stored in `chrome.storage.local` under `arcaia_extension_enabled_v1`
- content and main-world scripts receive `AICE_SET_EXTENSION_ENABLED`
- disabled state cleans visible Arcaia UI and gates Lite/timestamp/turn export/favicon/sidebar actions
- main-world Lite backend rewrite is skipped while Arcaia is disabled
- Lite ON keeps the Lite toolbar visible even when a short conversation needs no DOM hiding
- pinned sidebar sorting defers while ChatGPT native rename/menu interactions are active so rename, drag, and icon changes are not blocked
