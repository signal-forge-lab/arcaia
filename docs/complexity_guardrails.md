# Arcaia Complexity Guardrails

Status: v0.1.139
Scope: normal development, reviews, and hotfixes for Arcaia.

This document exists to prevent fixes from becoming more complex than the problem they solve. The default is to align with ChatGPT's native DOM, native classes, and existing Arcaia runtime paths before adding new state, observers, timers, hooks, or fallbacks.

## Core rule

Before adding a new mechanism, prove that a simpler one is insufficient.

Use this order:

1. Reuse ChatGPT native DOM structure, class names, attributes, and event behavior.
2. Reuse an existing Arcaia observer, hook, listener, timer, or state path.
3. Run the logic only from a user action, such as a click or toolbar command.
4. Run the logic only during diagnostic ZIP / manual diagnostics.
5. Add new runtime state, observer, timer, hook, synthetic DOM, or fallback only when the previous options cannot satisfy the requirement.

## Complexity budget checklist

Every non-trivial change should answer these questions in the PR/task note or implementation summary.

- What exact user-visible problem is being solved?
- Is there a native ChatGPT element already doing the same thing?
- Can the change copy the native element's DOM/class structure instead of adding custom behavior?
- Does the code run while Debug mode is OFF?
- Does the code run continuously, or only on user action / diagnosis?
- Is an observer, interval, hook, or synthetic DOM node being added?
- If a fallback is added, what failure mode proves it is necessary?
- What condition removes, stops, or gates the fallback?
- Could the fallback create false positives, stale state, duplicated UI, or branch/navigation confusion?
- What is the smallest test or console probe that validates the behavior?

## Add-before-delete rule

Avoid stacking fixes on top of previous fixes when the previous fix was too broad.

When a follow-up investigation shows an earlier change was unnecessary or over-specific:

1. State that the earlier judgment was incorrect or insufficient.
2. Remove or narrow the earlier mechanism first.
3. Then add only the minimum replacement, if still needed.

The v0.1.137 -> v0.1.138 Markdown turn export focus handling is the reference example: the extra focus fallback was removed after comparison with the native copy button showed that native-style structure was enough.

## Runtime mechanism policy

### MutationObserver

Use a new observer only when:

- no existing observer covers the same DOM area and timing,
- the observed root is as narrow as practical,
- the callback filters mutations before doing expensive work,
- the callback is debounced or coalesced when repeated mutations are expected,
- the observer is gated by feature state and can disconnect when no longer needed.

Avoid:

- body-wide subtree observers when `main`, sidebar, composer, or a known container is available,
- `characterData: true` unless text-node changes are required,
- observers that trigger a full DOM scan on every mutation,
- observers added only to compensate for uncertain selectors.

### Intervals and bursts

Use intervals only as a reliability fallback, not as the primary design.

Intervals should have:

- a documented reason,
- the longest practical cadence,
- a cheap no-op path,
- an exit or gate when the feature is disabled or not on a conversation page.

Initial burst timers should be considered temporary compatibility logic. Keep them only when event-driven hooks are not reliable enough.

### Hooks and patches

Hooks such as `fetch`, `XMLHttpRequest`, or `history.pushState` should:

- return quickly for unrelated calls,
- avoid cloning or parsing bodies until all cheap gates pass,
- preserve original behavior as closely as possible,
- expose diagnostic information without retaining heavy debug details while Debug mode is OFF.

### Synthetic DOM and placeholders

Synthetic nodes are high-risk because they can confuse ChatGPT's own rendering and navigation assumptions.

Before adding or keeping synthetic DOM:

- verify that hiding or annotating native DOM cannot solve the same problem,
- keep markers explicit with Arcaia-specific attributes,
- ensure removal/restoration is deterministic,
- confirm branch navigation, copy toolbar, timestamps, and Recent View do not misinterpret the node.

### Fallbacks

Fallbacks are allowed only when a real failure mode is observed.

Avoid speculative fallback chains. Every fallback should have one of these scopes:

- user action only,
- diagnostic only,
- feature-enabled only,
- short-lived retry only,
- cheap interval fallback with a clear gate.

## Normal runtime vs diagnostic-only

Do not mix diagnostic convenience with normal runtime behavior.

Normal runtime changes must be reviewed separately from:

- diagnostic ZIP collection,
- Debug mode stored logs,
- one-shot console probes,
- temporary investigation helpers,
- local memos.

Diagnostic code can inspect broadly when explicitly requested. Normal runtime code should stay narrow and event-driven.

## Review labels

Use these labels in notes or task summaries.

- `native-first`: uses ChatGPT native structure/classes rather than custom behavior.
- `runtime-off`: does not run in Debug OFF normal runtime.
- `user-action-only`: runs only after an explicit user action.
- `diagnostic-only`: runs only during diagnostics.
- `observer-risk`: adds or changes a MutationObserver.
- `interval-risk`: adds or changes a setInterval / repeated timer.
- `hook-risk`: adds or changes fetch/XHR/history patches.
- `synthetic-dom-risk`: adds or changes non-native DOM used as content/UI.
- `fallback-risk`: adds fallback behavior that may mask stale selectors or state.

## Current watchlist

These areas should be reviewed before further feature work expands them.

1. `rollingLiteObserver` / Lite DOM control: observer, 5s interval, initial burst, Prompt TOC coupling, and conversation-change coupling.
2. `injected-main.js` Lite conversation sync: 500ms interval and URL/conversation-state syncing.
3. Page conversation monitor: history hooks plus 2.5s fallback interval.
4. Message timestamp observer: root scope, debounce, and fallback behavior.
5. Lite synthetic image placeholders: ensure they do not create false image placeholders or branch/navigation confusion.
6. Pinned sidebar sorting: early observer plus runtime observer should remain sidebar-scoped.
7. Markdown turn export observer: should remain anchored to native copy buttons and avoid custom focus/pressed state.

## Release note requirement

When a release changes runtime complexity, include one of these statements:

- `No new Debug-OFF runtime watcher/timer/hook was added.`
- `A Debug-OFF runtime watcher/timer/hook was added because ...`
- `Existing runtime complexity was reduced by ...`
