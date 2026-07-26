# Arcaia Source Review v0.1.273

- Review date: 2026-07-26
- Baseline before review: `v0.1.272` / `6c40697`
- Reviewed release: `v0.1.273`
- Scope: repository-wide executable source and release configuration
- Decision: source-level stable baseline approved

## Review scope

The review covered:

- `manifest.json` permissions, host scope, content-script order, top-frame execution, background, offscreen, and web-accessible resources;
- startup settings synchronization, extension OFF／ON lifecycle, subsystem diff application, and popup rollback behavior;
- all normal-runtime MutationObservers, listeners, animation frames, timers, and cleanup paths;
- Main World fetch／XHR／History hooks, request gates, response rewrite, conversation-derived caches, and hook stop／restart behavior;
- SPA navigation, conversation DOM replacement, model decoration, header Markdown restoration, timestamps, Recent View, turn Markdown, and completion state;
- Markdown extraction, filename generation, download flow, pinned sorting／icons, Ctrl+Enter, block collapsing, loading title, and completion sound;
- standalone probe isolation and removal of generic Debug runtime paths;
- all JavaScript, Python helper scripts, tests, version consistency, and Git diff integrity.

## Findings resolved in this review

### R-273-01: SPA readiness was coupled to delayed model-trigger rendering

The pending conversation-DOM sync required both the replacement Composer and its model trigger. The header and Share control could already be ready while the trigger was still absent, unnecessarily delaying header Markdown restoration.

Resolution:

- readiness now requires the replacement Composer, not its model trigger;
- the existing Composer-local model-selector observer remains responsible for a trigger inserted later;
- the temporary pending observer processes only header／Composer replacement and header-local child-list changes;
- unrelated conversation-body mutations do not trigger repeated identity scans.

This preserves the probe-confirmed SPA fix without introducing polling or another permanent observer.

### R-273-02: provisional timestamps used a different font style

Provisional timestamps were italicized. In normal use, user timestamps are more likely to remain provisional briefly, which made only the user side appear italic.

Resolution:

- removed the provisional `font-style: italic` rule;
- retained lower opacity and the provisional data attribute, so status remains distinguishable without role-dependent typography.

## Review result by subsystem

| Area | Result | Notes |
|---|---|---|
| Manifest and permissions | Pass | ChatGPT-only host permission; top-frame content script; no remote code |
| Startup and settings | Pass | Fingerprint no-op, serialized writes, active-tab apply, and rollback are covered |
| OFF／ON lifecycle | Pass | UI, observers, listeners, timers, and Main World hooks stop and restart symmetrically |
| SPA navigation | Pass | History events are primary; no interval fallback; replacement DOM sync is identity-bound |
| Observer scope | Pass | Shared conversation observer is filtered; sidebar, header, model, and stream observers are localized |
| Timers | Pass | No conversation polling; remaining timers are bounded UI, fail-safe, or active-generation timers |
| Main World hooks | Pass | Unrelated fetches return directly; relevant response work is endpoint-gated; hooks uninstall on OFF |
| Recent View | Pass | Short-conversation no-op, CSS hiding, branch path selection, image guards, and full-load flow are covered |
| Timestamps | Pass | Conversation-bound index, stale-response rejection, provisional replacement, and generation defer are covered |
| Markdown export | Pass | Cookie-first fetch, bounded auth fallback, turn selection, filename, and header／turn buttons are covered |
| Model selector | Pass | Composer-local discovery, picker confirmation, Work effort confirmation, and cleanup are covered |
| Pinned UI | Pass | Section-scoped mutation filter, bounded startup burst, scoped ordering, and cleanup are covered |
| Completion feedback | Pass | Conversation-bound generation, navigation abandon, listener cleanup, and offscreen playback are covered |
| Diagnostic isolation | Pass | Generic Debug runtime is absent; manual probes are standalone and privacy-bounded |

## Validation

Executed successfully:

```text
JavaScript syntax checks: 10/10 executable files
Python compile checks:     3/3 helper scripts
Tests:                     155
Passed:                    143
Skipped:                   12 legacy-contract tests
Failed:                    0
git diff --check:          pass
```

The skipped tests are explicitly marked legacy contracts for runtime and UI paths removed in earlier releases; they are not unexpected skips from current behavior.

## Residual release risks

No source-level blocker remains. The following are external or architectural risks rather than current defects:

- ChatGPT DOM selectors and internal conversation endpoints can change independently of Arcaia.
- Automated tests use source contracts and local Playwright DOM fixtures; they do not replace a live ChatGPT smoke test after an extension reload.
- Main World network and History hooks are inherently sensitive integration points. Current gates and cleanup are covered, but coexistence with arbitrary third-party page patches is not exhaustively testable.
- `content.js` remains large. Further splitting should follow the existing low-risk extraction plan and must not be mixed into a stable hotfix.

## Stable-baseline decision

`v0.1.273` is suitable as the current stable source baseline. Future feature work should branch from this version, while live verification should continue to cover:

1. direct page load and left-sidebar SPA navigation;
2. header and turn Markdown buttons;
3. model decoration after Chat／Work and conversation changes;
4. Recent View and full-load behavior;
5. timestamps for both roles;
6. OFF／ON settings lifecycle and optional completion sound.
