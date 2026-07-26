# Arcaia Complexity Regression Audit v0.1.140

Status: v0.1.140
Scope: Debug mode OFF normal runtime, plus runtime-affecting hooks in `injected-main.js`.

This audit applies `docs/complexity_guardrails.md` to the current implementation and looks for unnecessary state, observers, intervals, hooks, synthetic DOM, and fallback chains.

## Summary

No low-risk code deletion was made in v0.1.140.

The audit found several runtime complexity candidates, but none should be removed without targeted runtime verification. The first follow-up target was `rollingLiteObserver`, because it had the broadest normal-runtime footprint: a `MutationObserver`, `characterData: true`, initial burst timers, and a 5 second fallback interval. v0.1.141 removes the `characterData: true` observer option and gates the fallback interval outside conversation/visible pages.

## Mechanism count snapshot

| File | MutationObserver | setInterval | setTimeout | addEventListener | Hooks / synthetic DOM |
|---|---:|---:|---:|---:|---|
| `content.js` | 7 | 3 | 31 | 28 | no fetch/XHR hooks |
| `injected-main.js` | 0 | 1 | 2 | 4 | fetch/XHR hooks, Lite image placeholder helpers |

Notes:

- Counts are coarse. Some timers/listeners are user-action, startup, or diagnostic gated.
- v0.1.138 already removed the Markdown turn export focus fallback. No `data-arcaia-turn-export-focused` residue remains.

## Findings

### 1. `rollingLiteObserver` / Lite scheduling

Classification: `observer-risk`, `interval-risk`, `fallback-risk`.

Current shape:

- `MutationObserver` on `main` preferred, with fallback to `body` / document root.
- v0.1.140 observed `{ childList: true, subtree: true, characterData: true }`; v0.1.141 changes this to `{ childList: true, subtree: true }`.
- Uses initial burst timers from 0ms through 9000ms.
- Keeps a 5 second fallback interval.
- Also checks conversation URL changes from mutation callback.

Risk:

- `characterData: true` can trigger during text streaming and broad text changes.
- Initial burst + observer + interval may overlap after ChatGPT DOM stabilizes.
- URL-change checks partially overlap with the page conversation monitor.

Decision:

- Keep for now. Lite correctness is high impact.
- v0.1.141 completed the first reduction: remove `characterData: true` and gate the 5 second interval outside conversation/visible pages.

### 2. Main-world Lite conversation sync interval

Classification: `interval-risk`, `hook-adjacent`.

Current shape:

- v0.1.140 called `syncLiteDisplayConversationId('interval')` every 500ms.
- v0.1.142 replaces that with a 2500ms hidden-gated fallback.
- It also listens to `popstate` and `hashchange`, and content can request immediate sync via `SYNC_PAGE_CONVERSATION`.

Risk:

- 500ms was frequent for conversation state.
- Content-side page conversation monitor already has history hooks and fallback polling.
- v0.1.142 keeps immediate sync paths and slows only the main-world fallback.

Decision:

- v0.1.142 completed the first reduction: fallback interval changed from 500ms to 2500ms and does no work while the document is hidden.
- Keep the slower fallback for now because main-world state is used by fetch rewrite and Lite decisions.

### 3. Page conversation monitor

Classification: `interval-risk`, `hook-risk`, `fallback-risk`.

Current shape:

- Wraps `history.pushState` and `history.replaceState`.
- Listens to `popstate` and `hashchange`.
- Keeps a 2.5 second fallback interval.

Risk:

- Navigation monitoring exists in multiple places: content-side monitor, injected-main monitor, and Lite mutation URL check.

Decision:

- Keep for now. Stale conversation state would affect Lite, timestamps, and full-load state.
- Before reducing it, collect reason distribution and confirm `fallback_interval` rarely finds changes missed by hooks.

### 4. Message timestamp observer

Classification: `observer-risk`, `fallback-risk`.

Current shape:

- `MutationObserver` on `main` preferred.
- Observes child-list subtree only.
- Classifies mutations before scheduling timestamp apply. v0.1.148 keeps initial-history marking out of apply-time mutation handling so new-chat live DOM is not misclassified as existing history. v0.1.149 adds Debug-ON diagnostics only to distinguish observer silence from post-apply DOM replacement. v0.1.150 uses those logs to retarget the observer when ChatGPT replaces `main`. v0.1.151 makes Debug-OFF timestamp diagnostic details lazy/compact.
- Uses startup index fetch and one retry timer.

Risk:

- Timestamp fallback/provisional logic is non-trivial.
- It shares toolbar-readiness signals with turn export.

Decision:

- Keep for now. It is already narrower than Lite and does not observe `characterData`.

### 5. Assistant loading favicon monitor

Classification: `observer-risk`, `interval-risk`.

Current shape:

- Observes the exact composer stop button when present.
- Uses a 1.5 second interval to refresh the observed button and state.
- Resyncs on `visibilitychange`, `focus`, and `pageshow`.

Risk:

- Interval plus lifecycle events may be redundant.

Decision:

- Lower priority. The observer target is narrow and failure impact is limited to favicon state.

### 6. Pinned sidebar sorting

Classification: `observer-risk`, `synthetic-dom-risk`, `fallback-risk`.

Current shape:

- Early gate observer on document root only when a saved order exists.
- v0.1.140 runtime observer watched `document.body` subtree; v0.1.143 moves it to the sidebar/chat-history nav root.
- Uses startup retry timers at 300ms, 900ms, and 1800ms.

Risk:

- Early gate plus runtime observer is a two-path design.
- The former runtime observer was body-wide; v0.1.143 narrows it to the sidebar/nav root.

Decision:

- Keep for now. Sidebar rendering can be late and replaced.
- v0.1.143 completed the first reduction: runtime observer now uses `PINNED_SORT_OBSERVER_ROOT_SELECTOR` / `getPinnedSortObserverRoot()`.

### 7. Markdown turn export observer

Classification: `observer-risk`, `fallback-risk`.

Current shape:

- Selector is narrowed to `button[data-testid="copy-turn-action-button"]`.
- Observer root prefers `main`.
- v0.1.140 used initial scans plus pointer/focus interaction triggers for lazily rendered toolbars. v0.1.146 removed those triggers, but browser verification showed the `.md` icon could disappear. v0.1.147 restores the scoped pointer/focus triggers.

Risk:

- Initial scans + observer alone were insufficient for lazy toolbars in browser verification, so v0.1.147 restores the interaction trigger path.

Decision:

- Keep for now. The v0.1.138 focus fallback removal already reduced the main over-specific behavior.
- Future target: test whether pointer/focus triggers can be removed after confirming MutationObserver catches lazy toolbar insertion.

### 8. Lite synthetic image placeholders

Classification: `synthetic-dom-risk`, `fallback-risk`.

Current shape:

- Main-world Lite rewrite can replace known image outputs with explicit placeholders.
- Synthetic placeholders are guarded for retained user-only turns with downstream image signals.
- Short conversations no-op to avoid placeholder-only hiding issues.

Risk:

- Synthetic nodes can confuse native rendering, branch navigation, or toolbar assumptions.

Decision:

- Keep for now. Existing tests cover short-conversation no-op and thumbnail false-positive avoidance.

### 9. Fetch/XHR hooks

Classification: `hook-risk`.

Current shape:

- Main-world fetch/XHR hooks capture backend conversation data and support Lite rewrite.
- Fetch observation happens before gated rewrite attempt.
- XHR captures headers and inspects loadend.

Risk:

- Hooks are high-risk by nature and can touch broad network traffic.

Decision:

- Keep for now. Backend extraction and Lite rewrite depend on main-world access.
- Future target: move cheap gates earlier and avoid unnecessary body clone/parse.

## Immediate deletion candidates

None selected in v0.1.140.

Reason:

- The only proven over-specific implementation, Markdown turn export focus fallback, was already removed in v0.1.138.
- Remaining candidates protect runtime reliability and need targeted measurement before deletion.
- Deleting them now would violate the complexity guardrail: prove the simpler mechanism is sufficient before removing fallback behavior.

## Recommended implementation queue

| Proposed version | Target | Goal | Risk |
|---|---|---|---|

## Release note

No new Debug-OFF runtime watcher/timer/hook was added. v0.1.140 is an audit and documentation release.
