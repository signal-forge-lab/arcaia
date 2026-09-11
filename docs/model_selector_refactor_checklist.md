# Model Selector Refactor Checklist and Traceability Matrix

This document is a refactor guardrail for the behavior defined in `docs/model_selector_runtime_contract.md`.

It is not a request to refactor now. Its purpose is to make it possible to simplify or rewrite the subsystem later without deleting behavior whose purpose is no longer obvious from the code.

Baseline: Arcaia `v0.1.343`, including the GPT-surface conversation cold-start fix and response-order flat conversation-message transport normalization.

## 1. Before changing structure

Do all of the following before deleting or combining current mechanisms:

1. Read `docs/model_selector_runtime_contract.md` and the Model Selector section of `AGENTS.md`.
2. Run the current `tests/model-selector-resolver.test.js` suite and preserve a passing baseline.
3. Record which current failure mode each branch / observer / state slot protects.
4. Separate behavior changes from structural refactoring. A pure refactor should preserve the exact runtime contract.
5. Do not use an old source-review document as justification to restore removed observer or polling designs.
6. For live-DOM-dependent simplifications, use the maintained Model Decoration Watch Probe before deleting the old path.

## 2. Safe refactor target

The current source is harder to reason about than the ideal end state because observation, authority resolution, transition preservation, trigger targeting, and rendering live in one file.

A future refactor may simplify this into clearer conceptual units, for example:

- context / surface classification;
- authority readers;
- authority policy / precedence;
- transition policy;
- picker interaction state;
- observer binding;
- trigger resolution;
- decoration renderer / restoration;
- diagnostics.

These are conceptual boundaries, not a mandate to create nine files or classes. Prefer the fewest units that make authority order and transition policy explicit.

## 3. Mechanism deletion criteria

Never delete one of the following merely because it looks redundant.

| Current mechanism | Why it exists | It may be removed only if |
| --- | --- | --- |
| Composer subtree observer | Detect trigger add/remove and disconnection | Replacement mechanism reacts to the same DOM events without page-wide polling |
| Composer parent observer | Detect direct Composer replacement | Browser evidence shows replacement is always covered by a closer semantic event |
| Composer grandparent observer | Detect parent-container replacement | Browser evidence shows parent replacement can no longer bypass the parent observer |
| Temporary Composer bootstrap observer | Handle initial page state before Composer exists | Startup event guarantees Composer readiness before model subsystem starts |
| Surface radio observer | Catch Chat / Work changes without waiting for unrelated mutations | A stronger surface event is proven reliable in live browser |
| Picker-local observer | Confirm selected state and family changes | Native selection event is proven stable and supplies the same final state before teardown |
| Slider observer | Capture thinking-level change when storage does not update | Another confirmed authority covers slider-only changes in both Chat and Work |
| Current-trigger observer | Detect picker open/close and decoration removal | Equivalent close / teardown signal and same-trigger repair are preserved elsewhere |
| Capture-phase document click listener | Prompt timely rescan on surface / model control interaction | Proven native event arrives reliably without it; click must still not become authority |
| Window `storage` listener | Refresh Work / surface state after relevant key changes | Storage ceases to be a supported authority |
| Window `focus` listener | Refresh after off-tab changes | Probe proves no supported authority can change while tab is unfocused without another event |
| `confirmedComposerState` | Preserve a user-confirmed picker selection ahead of slower authority | New design has an explicit newer-than-background authority concept |
| `pendingPickerState` | Stage slider / family change until picker commit | New design distinguishes pending interaction from committed selection |
| `navigationCarryState` | Bridge Work replacement gap without cross-surface fallback | New transition model proves equivalent Work-only carry behavior |
| New Chat promotion preservation | Prevent authority-free scans from erasing state before conversation detail | Conversation transition becomes atomic or an equivalent handoff exists |
| Work conversation native cold-start fallback | Decorate Work conversation before conversation response authority arrives | Conversation detail is proven to always arrive before the current native trigger is needed |
| GPT-surface Chat conversation cookie + native-performance cold-start bridge | Directly loaded nested GPT-surface conversations can expose matching current native performance before conversation config is observed | A stronger current-page authority is proven to arrive before decoration is needed, or GPT-surface route semantics change so the bridge is no longer applicable |
| explicit selected performance-label priority | Avoid stale / shifted slider-index mapping | Native slider semantics become explicit and probe proves no mismatch across current UI variants |
| slider numeric fallback | Support picker states that expose no explicit selected performance label | Every supported picker variant provides an equivalent explicit authority |
| `textContent` / `aria-label` / `title` performance-trigger matching | Find native performance control despite extra text / accessibility-only label | Stable semantic selector replaces text-based trigger classification |
| route / conversation equality checks on async config | Prevent stale conversation config leakage | New transport intrinsically binds state to current conversation and proves stale responses cannot apply |

## 4. Requirement-to-test traceability

The exact implementation can change, but each behavior below requires at least one maintained executable regression.

| Requirement | Current regression evidence |
| --- | --- |
| Internal probe output remains privacy-bounded | `model selector exposes a privacy-bounded internal probe snapshot for new Chat resolution` |
| New Chat cold start can decorate native performance trigger with extra text | `new Chat cold start decorates a performance trigger with extra native label text` |
| Chat and Work keep independent authority | `model selector follows new Chat and Work authoritative state without cross-surface carryover` |
| Work live pre-picker authority outranks stale storage and unknown state fails closed | `model selector prefers native Work pre-picker authority over stale storage and fails closed on unknown values` |
| Same-context / route gap preserves confirmed GPT-5.6 until conversation detail | `route transition preserves confirmed GPT-5.6 on the same trigger until the new conversation authority resolves` |
| Replacement Composer can receive decoration while old Composer still exists | `route transition decorates the replacement composer even while the previous composer is still connected` |
| Composer parent replacement rebinds observers | `model selector automatically rebinds when the composer parent is replaced` |
| Decoration removed from same connected trigger is repaired | `model selector repairs decoration stripped from the connected model trigger` |
| Work New Chat preserves confirmed GPT-5.6 across replacement when storage is absent | `Work New Chat keeps confirmed GPT-5.6 across a replacement composer when legacy Work storage is absent` |
| Chat New Chat state is not carried into Work | `Chat New Chat state is not carried into Work when Work authority is absent` |
| New Chat -> conversation promotion survives delayed detail | `new Chat promotion keeps confirmed GPT-5.6 across a replacement composer until conversation detail arrives` |
| Trigger-disconnected scan cannot erase promotion state before navigation reset | `new Chat promotion survives a trigger-disconnected scan that runs before navigation reset` |
| GPT surface Chat -> conversation promotion survives delayed detail | `GPT surface promotion keeps confirmed GPT-5.6 until conversation detail arrives` |
| Explicit GPT-5.5 picker state clears stale GPT-5.6 | `explicit GPT-5.5 picker candidate clears GPT-5.6 decoration instead of falling back to current state` |
| Click intent alone never confirms selection | `model selector does not promote click intent until the picker confirms the checked state` |
| Closing picker can still commit explicit GPT-5.5 before slow cookie update | `confirmed GPT-5.5 selection from a closing picker clears stale GPT-5.6 decoration before cookie catches up` |
| Work slider state is staged and survives focusout / close commit | `Work thinking slider commits on picker focusout and survives the close rescan` |
| Work family-only picker can switch Sol / Terra / Luna | `Work family-only picker items update Sol Terra Luna decoration without GPT prefix or storage authority` |
| First-open Work picker can derive effort from slider when storage is absent | `Work picker first open derives performance from confirmed slider when legacy storage is absent` |
| Explicit selected performance label outranks stale slider index | `Work picker explicit selected performance label overrides stale slider index mapping` |
| Work conversation cold start can use complete live native trigger before conversation detail | `Work conversation cold start uses live native trigger authority while conversation detail is unavailable` |
| GPT-surface Chat conversation cold start can use GPT-5.6 cookie only when native performance matches | `GPT surface conversation cold start uses matching native performance plus GPT-5.6 cookie while detail is unavailable` |
| A stale GPT-5.6 cookie must not decorate when current native performance disagrees | `GPT surface conversation cold start does not use stale GPT-5.6 cookie when native performance disagrees` |
| Work slider fallback still works when storage does not update | `Work thinking slider uses confirmed aria-valuenow when legacy Work storage no longer updates` |
| Chat slider uses the same confirmed numeric path where appropriate | `Chat thinking slider uses the same confirmed aria-valuenow path` |
| Ambiguous GPT-5 detail does not erase confirmed GPT-5.6; explicit model eventually can | `ambiguous GPT-5 conversation detail preserves confirmed GPT-5.6 until an explicit model replaces it` |
| Diagnostic event sanitizer correlates source boundaries without leaking raw data | `model selector diagnostic correlates events with sanitized authoritative sources` |

The static source-contract test in `tests/lite-grouping.test.js` also protects important observer scopes, attribute filters, feature lifecycle, and version consistency. It is supplementary; live-behavior regressions above are the primary behavioral protection.

## 5. Required live smoke scenarios after structural refactor

Automated fixture tests do not replace live ChatGPT verification. At minimum, perform these manual / probe-backed scenarios after a meaningful refactor:

### Scenario A — Chat New Chat cold start

- Open New Chat on Chat surface.
- Confirm GPT-5.6 decoration appears without opening picker.
- Confirm displayed performance matches native value.

### Scenario B — New Chat -> conversation

- Start from a correctly decorated New Chat.
- Send a message so the route promotes into a conversation.
- Confirm decoration does not disappear during Composer / route replacement.
- Confirm conversation-detail authority eventually takes over without visual reset.

### Scenario C — Chat -> Work

- Begin with Chat decorated.
- Switch to Work without opening picker.
- Confirm Chat state is not blindly carried.
- Confirm Work establishes its own model / family / effort.

### Scenario D — Work cold start existing conversation

- Open an existing Work conversation directly.
- Before delayed conversation detail is available, confirm complete native Work trigger can decorate.
- After conversation response is available, confirm conversation authority remains consistent.

### Scenario E — Work performance choices

- Choose `高い`, `非常に高い`, and `最大`.
- Verify native selection and Arcaia decoration agree for each.
- Especially verify `非常に高い` does not become `最大`.

### Scenario F — Work family choices

- Switch among Sol / Terra / Luna.
- Confirm family display does not commit from click intent before native confirmation.

### Scenario G — Explicit non-GPT-5.6

- Change to an explicitly different model.
- Confirm GPT-5.6 decoration is removed rather than preserved through fallback.

### Scenario H — Composer / trigger replacement

- Exercise route / surface changes that replace Composer or model trigger.
- Confirm decoration rebinds without duplicate decorated buttons or stale padding.

## 6. Probe use during refactor

Keep the external `Arcaia Model Decoration Watch Probe` available during structural work.

Useful evidence categories include:

- route / surface generation;
- candidate trigger presence;
- decorated trigger count;
- Work pre-picker authority;
- native picker authority;
- conversation model-config supply;
- `resolvedContextKind`;
- `scanReason` / `scanOutcome`;
- navigation-reset history;
- last state mutation;
- whether state exists but cannot be applied to a trigger.

Do not add new persistent diagnostic logging to Arcaia merely because a refactor is in progress. Extend the external probe or the request-driven privacy-safe internal snapshot only when a concrete evidence gap exists.

## 7. Refactor acceptance gates

A model-selector refactor is not complete until all of the following are true:

1. Every requirement in the traceability table still has executable coverage.
2. `tests/model-selector-resolver.test.js` passes completely.
3. Full repository tests pass with no new unexpected skip.
4. JavaScript syntax checks pass.
5. `git diff --check` passes.
6. No permanent broad observer or polling was introduced.
7. Chat / Work authority remains separated.
8. Explicit non-GPT-5.6 still clears decoration.
9. Conversation async results are still route / conversation bound.
10. All Arcaia-owned DOM / attributes / editor padding restore on cleanup.
11. At least the live smoke scenarios affected by the refactor are verified in a real ChatGPT tab.
12. If observer / selector / authority logic changed, Model Decoration Watch Probe evidence is captured for the changed boundary.

## 8. What may be simplified without changing behavior

The following are good future cleanup candidates because they are structural, not behavioral, provided the contract remains intact:

- centralize authority precedence into an explicit policy function rather than distributed nested ternaries;
- centralize context ownership checks;
- separate pure normalization / classification from DOM reading;
- separate observer binding from mutation interpretation;
- separate transition-preservation decisions from mutation callbacks;
- separate trigger-target selection from decoration rendering;
- keep probe-state recording out of normal behavior decisions;
- replace repeated state-shape construction with one small canonical state factory if it makes invariants clearer.

Do not perform all of these at once. The safest sequence is to extract pure logic behind unchanged tests first, then one runtime boundary at a time.

## 9. Documentation maintenance

When a future bug fix adds a new protection branch:

1. add a regression that reproduces the failure before the fix;
2. record the failure mode in the runtime contract if it changes an invariant or authority rule;
3. add or update the matching traceability row here;
4. state whether the new code supersedes an older branch or must coexist with it;
5. remove superseded logic instead of leaving two equivalent fallbacks when evidence proves one is obsolete.

This last step is important: the goal of this documentation is not to fossilize every line of current code. It is to preserve required behavior while making it safe to delete obsolete implementation later.
