# Arcaia Model Selector / Decoration Runtime Contract

Status: canonical implementation contract for the current model-decoration subsystem.

Baseline reviewed against:

- Arcaia `v0.1.343`
- source baseline: the `v0.1.343` tree containing the GPT-surface conversation cold-start fix and flat conversation-message transport normalization
- `content_model_selector.js`
- `content.js`
- `injected-main.js`
- `tests/model-selector-resolver.test.js`
- `tools/arcaia_model_decoration_watch_probe_extension`

This document is intended to survive a future refactor. It describes the behavior that must remain true even if the current code structure is replaced completely.

Older source-review documents are historical evidence only. In particular, older reviews that mention a permanent document-root model-selector observer or earlier picker event assumptions must not be treated as the current design. For the current subsystem, this document, `AGENTS.md`, the current browser regression tests, and fresh probe evidence take precedence.

## 2026-09-01 Chat composer UI change evidence (Probe v1.0.28)

- New Chat and the promoted conversation both exposed two `aria-haspopup="menu"` buttons in the composer while the old text/testid based model-trigger classifier found zero candidates.
- The plus menu remained identifiable by its composer/plus testid hints, an aria-label, no `data-state`, and an SVG-only direct-child shape.
- The model menu consistently had no aria-label, `data-state="closed"` while closed, and direct `span + svg` children. Arcaia v0.1.352 therefore adds this shape only as a unique structural fallback after the stronger Work/text/model-version resolvers.
- The New Chat state was first preserved into a conversation with `new_chat_promotion`, then a second immediate `history.replaceState` changed the conversation key and cleared that provisional state before conversation detail was available. v0.1.352 permits exactly the next rekey when the immediately preceding reset was a New Chat/GPT-surface promotion and no conversation state has arrived yet; that rekey is recorded as `new_chat_promotion_rekey`.
- This does not make arbitrary conversation-to-conversation navigation sticky: once the one-step promotion rekey has been consumed, a later undecorated conversation change still clears the provisional state.

## 1. Purpose

The model-selector subsystem decorates the current ChatGPT Composer model control only when Arcaia has sufficiently strong evidence that the active model is GPT-5.6. The decoration exposes:

- model version, currently `GPT-5.6`;
- known Work family suffix when available: `Sol`, `Terra`, or `Luna`;
- known response-performance / thinking level;
- the current configured visual style.

It must continue to work across:

- Chat New Chat;
- Work New Chat;
- existing conversations;
- `/g/...` and `/gg/...` GPT surfaces;
- New Chat to conversation promotion;
- Composer and model-trigger replacement;
- Chat to Work surface changes;
- Work family changes;
- picker open / close / portal teardown;
- thinking-slider changes;
- temporary gaps before conversation detail arrives.

It must fail closed when the current model is explicitly known to be non-GPT-5.6.

## 2. Core invariants

### MS-INV-001 — Only GPT-5.6 is richly decorated

`applyRichState` must not leave rich decoration on a trigger when the resolved model is not GPT-5.6.

An explicit GPT-5.5 or other non-GPT-5.6 authority clears stale GPT-5.6 decoration. Ambiguous GPT-5 slugs without an explicit minor version are not equivalent to an explicit non-GPT-5.6 result.

### MS-INV-002 — State is context-bound

Every persistent or temporary model state must be tied to a model context. Current context classes are:

- `new_chat`
- `new_work`
- `conversation`
- `gpt_surface_chat`
- `gpt_surface_work`
- `gpt_surface`
- `other`

Raw context keys may contain route-specific values internally, but diagnostics must expose only classified context kinds.

### MS-INV-003 — Chat and Work authority must not bleed into each other

Chat New Chat state must not be reused as Work state merely because Work lacks authority. Work has its own live native trigger and storage sources. A Chat-to-Work transition is therefore a special boundary and must not preserve Chat state through generic decoration carry.

### MS-INV-004 — Explicit current UI beats stale fallback data

When the currently rendered native Work trigger or the currently selected picker item provides a complete current value, that value outranks older storage-derived or slider-index-derived values.

### MS-INV-005 — Click intent is not confirmation

A click on a picker item or model control is only a signal to rescan. Selection becomes authoritative only after a confirmed native state such as checked / selected / open / slider value is observed.

### MS-INV-006 — Replacement gaps must not erase valid state prematurely

Composer and trigger replacement can temporarily produce an incomplete DOM. A scan caused by `trigger_disconnected` or a route transition must not erase an otherwise valid New Chat promotion state before the navigation-reset / replacement logic has had a chance to bind it to the new Composer.

### MS-INV-007 — Conversation detail is strongest when available

For an existing conversation, the model / thinking configuration derived from that conversation's current selected branch is the canonical long-lived authority once available.

The only current Work exception is a cold-start gap: while conversation detail is not yet available, a complete live Work native trigger may temporarily supply current state.

Conversation-detail transport may arrive as the legacy `mapping` graph or the current flat `messages` array. Main World normalizes the flat form into the same internal graph using the backend `messages[]` response order as the canonical display path and top-level `current_node` as the active leaf before deriving model authority. `metadata.parent_id` is retained as transport metadata but is not trusted as complete topology because observed responses may contain unresolved parent references. This transport normalization does not change the authority order in this contract.

### MS-INV-008 — No permanent broad page observer

The model-selector subsystem must not rely on a permanent `documentElement`-wide MutationObserver or polling loop. Normal observation is scoped to Composer, its immediate replacement boundaries, surface controls, visible picker, live slider, and current trigger.

## 3. Current state model

The current implementation uses several different state slots because they represent different lifetimes. A refactor may rename or combine them, but it must preserve their distinct semantics.

| Current state | Meaning | Lifetime / invalidation |
| --- | --- | --- |
| `currentState` | State currently intended for decoration | Current model context |
| `currentStateContextKey` | Context owning `currentState` | Cleared or rebound on navigation / explicit replacement |
| `conversationState` | Current-branch state supplied from conversation response | One conversation token |
| `conversationContextToken` | Conversation owning `conversationState` | Conversation change |
| `pendingPickerState` | State staged while picker interaction is still in progress | Current context, until confirmation / close / slider replacement |
| `pendingPickerContextKey` | Context owning staged picker state | Context change |
| `confirmedComposerState` | Explicitly confirmed picker selection used as current Composer authority | Current context |
| `confirmedComposerContextKey` | Context owning confirmed Composer selection | Context change / conversation authority replacement |
| `navigationCarryState` | Short-lived state preserved across a Work New Chat replacement gap | Exact destination context only |
| `navigationCarryContextKey` | Context owning navigation carry | Cleared once stronger authority arrives or route changes |
| `currentTrigger` | Button currently carrying Arcaia decoration | Current Composer only |

Do not collapse all of these into a single generic cache unless the replacement design can prove all of the same transition semantics.

## 4. Context detection

### 4.1 Conversation token

The model-selector runtime considers any pathname containing `/c/<token>` a conversation context.

This deliberately also matches Work / GPT paths such as `/g/.../c/...`.

### 4.2 Surface mode

Current surface resolution order is:

1. rendered `Chat` / `Work` radio button with `data-state="on"`;
2. `localStorage` key `oai/apps/tpp/chat-surface-mode`;
3. cookie `oai-chat-surface-mode`.

Therefore an external probe that only inspects the rendered Chat / Work control can legitimately report no visible surface while Arcaia internally resolves `work` through a fallback source.

### 4.3 Model context key

Current semantic mapping is:

| Route / surface | Internal context shape | Diagnostic kind |
| --- | --- | --- |
| `/c/...` anywhere in pathname | `conversation:<token>` | `conversation` |
| `/g/...` or `/gg/...`, Chat | `gpt_surface:<pathname>:chatgpt` | `gpt_surface_chat` |
| `/g/...` or `/gg/...`, Work | `gpt_surface:<pathname>:work` | `gpt_surface_work` |
| `/`, Chat | `new_surface:chatgpt` | `new_chat` |
| `/`, Work | `new_surface:work` | `new_work` |

## 5. Model and thinking normalization

### 5.1 Recognized GPT-5.6 slugs

The current normalizer accepts GPT-5.6-shaped slugs and extracts a known family suffix when present.

Known families:

- `Sol`
- `Luna`
- `Terra`

The alias `gpt-5-6-thinking` currently normalizes to `GPT-5.6 Sol`.

### 5.2 Ambiguous GPT-5

Slugs that identify GPT-5 but do not include an explicit minor version are treated as ambiguous, not as proof of GPT-5.5 or another non-GPT-5.6 model.

This distinction is required to prevent temporary generic GPT-5 conversation metadata from erasing a previously confirmed GPT-5.6 selection.

#### 2026-08-30 live cold-start evidence

`Arcaia Model Decoration Watch Probe v1.0.25` captured a direct conversation cold start where:

- the route / supplied conversation correlation succeeded;
- `current_conversation_model_config` arrived twice with `configPresent=true` and `thinkingEffortPresent=true`;
- the selected slug structure was `gpt5_thinking_alias` with `version6Present=false`;
- the native Composer performance control resolved to `高い`;
- Arcaia remained `conversation_waiting_for_detail` with `currentStatePresent=false`, `conversationStatePresent=false`, `triggerFound=true`, and `triggerApplied=false`;
- no decoration was applied.

Therefore this incident is **not** a missing conversation-config transport event and **not** a model-trigger discovery failure. The unresolved boundary is model identity normalization / metadata field selection before conversation state is committed.

Do not promote every generic GPT-5 thinking alias to GPT-5.6 from this evidence alone. `v1.0.26` exists specifically to compare the privacy-sanitized structure of `resolved_model_slug`, `model_slug`, and `default_model_slug` on the same current-branch message and determine whether the current precedence discards a later explicit GPT-5.6 field.

### 5.3 Performance / thinking mapping

Canonical semantic mapping:

| effort | Japanese | English |
| --- | --- | --- |
| `min` | `軽` / legacy `最速` | `Light` / legacy `Fastest` |
| `standard` | `中程度` | `Medium` |
| `extended` | `高い` | `High` |
| `xhigh` | `非常に高い` | `Very high` |
| `max` | `最大` | `Maximum` |

The current slider fallback mapping is:

```text
aria-valuenow 0 -> min
aria-valuenow 1 -> standard
aria-valuenow 2 -> extended
aria-valuenow 3 -> xhigh
aria-valuenow 4 -> max
```

This mapping is a fallback, not the strongest authority. If the picker exposes an explicit selected native performance label, the selected label must win even when `aria-valuenow` appears stale or semantically shifted.

Do not "fix" future Work mismatches by blindly shifting this array. First determine whether the native selected label, slider semantics, or another authority changed.

## 6. Current selectors and their semantic purpose

These are implementation selectors, not public ChatGPT contracts. A refactor may replace them only if the same semantic boundary remains covered.

| Selector / pattern | Current value | Semantic purpose |
| --- | --- | --- |
| Composer | `form[data-type="unified-composer"]` | Scope all model-trigger UI and local mutation handling |
| Picker content | `[data-testid="composer-intelligence-picker-content"]` | Visible model / performance picker root |
| Thinking slider host | `[data-testid="composer-model-picker-slider-simple-view"]` | Restrict slider discovery to actual thinking-level UI |
| Slider | host descendant `[role="slider"]` | Confirm native thinking value changes |
| Surface controls | `button[role="radio"]` | Detect Chat / Work selection |
| Generic model trigger candidates | `button[aria-haspopup="menu"]` inside current Composer | Locate current model control |
| Work native wrapper | `[data-animated-slider-trigger="true"]` | Identify Work's pre-picker current-state display |
| Work model label | `[class*="_SliderTriggerModelLabel"]` | Read current Work model / family |
| Work effort label | `[class*="_SliderTriggerEffortLabel"]` | Read current Work thinking level |
| Selected picker items | `menuitemradio`, `radio`, `option`, `menuitem` | Capture current native selection across current DOM variants |

### 6.1 Selected-state attributes

Current selected-item logic recognizes:

- `aria-checked="true"`
- `aria-selected="true"`
- `data-state="checked"`
- `data-state="on"`

### 6.2 Performance-label trigger recognition

A Composer menu button may be treated as a performance trigger when a known label appears in one of:

- `textContent`
- `aria-label`
- `title`

The label may be the entire normalized value, a leading token, or a trailing token. This exists because native controls have appeared with extra label text around the performance value.

### 6.3 Explicit model trigger recognition

If a button's visible text contains an explicit model version matching the expected model version, it may be used as a fallback trigger even when the performance text is not rendered.

## 7. Authority hierarchy

The easiest way to lose behavior in a refactor is to flatten all sources into a single "best value" function. The order depends on context and interaction phase.

### 7.1 Visible picker phase

While a visible picker exists, `scan()` resolves the picker before normal context authority.

Within picker resolution:

1. explicit selected performance label;
2. while picker remains open, existing confirmed GPT-5.6 performance / effort may be retained instead of prematurely trusting a changing slider;
3. slider numeric fallback when no stronger explicit label/current state is available;
4. explicit checked item model version;
5. currently open / selected model candidate;
6. current GPT-5.6 state only when picker performance exists but no explicit model candidate is present.

For Work family-only picker items (`Sol`, `Terra`, `Luna`), family changes are staged while the picker is open and committed only after confirmation / close.

### 7.2 Confirmed Composer selection

If `confirmedComposerState` belongs to the current context, it is checked before conversation / New Chat resolution. This represents a user-confirmed picker selection that is newer than slower background authority.

### 7.3 Existing conversation

Authority order:

1. confirmed Composer selection for the same context;
2. current conversation branch config for the same conversation token;
3. if the conversation config has not arrived yet and surface is Work, complete live Work native trigger authority;
4. if the conversation is nested under a GPT surface, surface is Chat, conversation config has not arrived, the New Chat cookie resolves to GPT-5.6, and the currently rendered native performance label exactly matches that cookie-derived performance, use the cookie state as a provisional cold-start authority;
5. otherwise `conversation_waiting_for_detail`.

The Work cold-start fallback is valid only when the live native trigger supplies either:

- a complete GPT-5.6 state with known thinking effort; or
- an explicit non-GPT-5.6 model.

A partial Work native trigger with unknown effort does not invent state and must continue waiting for conversation detail.

The GPT-surface Chat cold-start fallback is intentionally narrower than normal New Chat resolution:

- it applies only on a `/g/...` or `/gg/...` path that also contains a conversation token;
- the cookie alone is insufficient;
- the currently rendered Composer must expose the same known performance label as the cookie-derived GPT-5.6 state;
- if the Composer explicitly shows a non-GPT-5.6 model, the fallback is forbidden;
- once current conversation branch authority arrives, that conversation authority supersedes the provisional fallback.

This rule exists because a directly loaded GPT-surface conversation can render its Composer and native performance control before Arcaia observes any conversation model-config response. Without this bounded bridge the subsystem remains in `conversation_waiting_for_detail` indefinitely even though the page exposes matching current UI evidence.

### 7.4 Work New Chat / Work GPT surface without conversation detail

The current decision considers:

1. navigation carry when it was explicitly created for the current context;
2. live Work native trigger if it has current authority;
3. Work storage:
   - `oai/apps/tpp/model-settings`
   - `oai/apps/tpp/thinking-effort`
4. navigation carry as a temporary fallback only if no stronger Work authority exists.

When both navigation carry and live Work native GPT-5.6 are present during a replacement gap, the carry can temporarily outrank the native effort to avoid a stale transient native value replacing the just-confirmed state.

### 7.5 Chat New Chat

Current New Chat Chat authority comes from cookie `oai-last-model-config`.

That cookie is not a generic fallback for Work.

## 8. Conversation-authority supply chain

Conversation state crosses the Main World / Content boundary. A refactor must preserve the complete chain, not just `content_model_selector.js`.

### 8.1 Main World extraction

`injected-main.js` builds the current conversation config from the existing conversation payload:

1. find root node;
2. collect nodes reachable from that root;
3. select the current / latest leaf used by the existing conversation path logic;
4. build the selected path;
5. walk backward from the leaf;
6. use the first message metadata containing both a model slug and thinking effort.

Model slug source order inside message metadata:

1. `resolved_model_slug`
2. `model_slug`
3. `default_model_slug`

The 2026-08-30 v1.0.25 live incident above makes this precedence an active investigation boundary. Do not change the order yet without v1.0.26 evidence: `resolved_model_slug` may be the strongest backend authority, but it may also be a generic alias while a later field retains the user-facing explicit minor version.

Thinking fields:

- `thinking_effort`
- `thinkingEffort`

The resulting config is cached by conversation ID and emitted as `current_conversation_model_config`.

### 8.2 Content acceptance

`content.js` accepts a `current_conversation_model_config` event only when the supplied conversation ID matches the current route conversation ID.

It then calls:

```text
__ARCAIA_MODEL_SELECTOR_UI__.applyConversationModelConfig(...)
```

### 8.3 Explicit conversation sync

During page / conversation synchronization, Content requests `SYNC_PAGE_CONVERSATION` from Main World. A cached conversation model config is applied only when:

- a destination conversation ID exists;
- the route still points at the same conversation after the async sync;
- the returned config belongs to that same conversation.

Afterward Content invokes `scan('conversation_state_sync_complete')`.

These ID / route equality checks are safety boundaries and must not be removed as "duplicate checks" without replacement evidence.

## 9. Trigger resolution

When Arcaia has state, it still needs the correct current Composer button.

Current resolution order:

1. caller-provided preferred trigger, if it belongs to the current Composer;
2. existing `currentTrigger`, if still in the current Composer;
3. Work native trigger;
4. Composer menu button matching expected performance label;
5. Composer menu button matching expected explicit model version;
6. a single Composer menu button only during an exact navigation-carry case;
7. no trigger.

Do not broaden the final single-button fallback outside navigation carry. A generic "only menu button on page" fallback would risk decorating unrelated Composer controls.

## 10. Decoration application contract

`applyRichState` currently enforces the following user-visible and cleanup behavior:

1. target must be an `HTMLButtonElement` in the current Composer;
2. state must be GPT-5.6;
3. any other Arcaia-decorated model trigger is restored first;
4. native button width is captured before decoration when measurable;
5. native non-SVG label child is hidden with an Arcaia-owned attribute, not deleted;
6. Arcaia rich content is inserted before the native SVG chevron when present;
7. original `title` and `aria-label` are preserved before replacement;
8. title / aria-label expose model and performance semantics;
9. Arcaia state is recorded through attributes:
   - `data-arcaia-model-rich`
   - `data-arcaia-model-version`
   - `data-arcaia-model-performance`
   - `data-arcaia-model-style`
10. Composer editor end padding is increased only by the extra width introduced by decoration;
11. trigger state observation is rebound to the decorated trigger.

`restoreTrigger` must undo every Arcaia-owned mutation and restore original title / aria-label.

## 11. Observer and event contract

### 11.1 Composer observer

Root:

`form[data-type="unified-composer"]`

Mode:

`childList: true, subtree: true`

It does not rescan for every mutation. It reacts when:

- the current decorated trigger is no longer in the current Composer -> `trigger_disconnected`;
- a node containing `button[aria-haspopup="menu"]` is added -> `composer_trigger_added`;
- such a node is removed -> `composer_trigger_removed`.

### 11.2 Composer parent observer

Root: Composer direct parent.

Mode: `childList: true`.

Purpose: detect Composer identity replacement -> `composer_replaced`.

### 11.3 Composer grandparent observer

Root: parent of the Composer parent.

Mode: `childList: true`.

Purpose: detect a replacement that removes / replaces the Composer parent -> `composer_parent_replaced`.

### 11.4 Composer bootstrap observer

Used only when no Composer exists.

Root: `document.body` or `document.documentElement`.

Mode: `childList: true, subtree: true`.

It disconnects as soon as the Composer appears and queues `composer_bootstrap_added`.

This is the only model-selector path allowed to temporarily observe such a broad root. It is not a permanent page observer.

### 11.5 Surface-mode observer

Observed elements: current `Chat` / `Work` radio buttons.

Attributes:

- `data-state`
- `aria-checked`
- `aria-selected`

Relevant change -> `surface_state_changed`.

### 11.6 Picker observer

Root: visible picker only.

Mode:

- `childList: true`
- `subtree: true`
- `attributes: true`

Attributes:

- `aria-checked`
- `aria-selected`
- `aria-expanded`
- `data-state`

Responsibilities:

- detect explicit confirmed performance / model selection;
- stage Work family changes;
- follow picker content replacement;
- rebind the thinking-slider observer.

### 11.7 Thinking-slider observer

Root: actual slider found inside the known thinking-slider host.

Attribute:

- `aria-valuenow`

A numeric change is staged as pending state. It is not immediately assumed to be committed while the picker is still open.

### 11.8 Current trigger observer

Root: current model trigger.

Attributes:

- `aria-expanded`
- `data-state`
- `data-arcaia-model-rich`

Responsibilities:

- repair decoration removed from the same connected trigger;
- detect picker open;
- capture final picker state before portal teardown;
- commit pending picker state when necessary;
- rescan after picker close.

### 11.9 Document click listener

Capture-phase click listener is retained for two narrow purposes:

- Chat / Work surface control click -> queue rescan;
- Composer model / performance trigger click -> queue rescan.

Click itself is never treated as a selected model / performance value.

### 11.10 Storage and focus events

`storage` changes for the known surface / Work keys queue a scan.

`window.focus` queues a scan to refresh state after returning to the tab.

### 11.11 Scheduling

`queueScan` coalesces scans and normally executes on `requestAnimationFrame`.

`setTimeout(..., 0)` exists only as a fallback when `requestAnimationFrame` is unavailable. It is not a polling mechanism.

## 12. Scan contract

Every normal scan follows this conceptual order:

1. ensure style exists;
2. bind / refresh surface observers;
3. bind / refresh Composer observers;
4. locate visible picker and bind picker / slider observers;
5. if picker is visible, resolve picker state and stop there;
6. otherwise resolve current context authority;
7. if a candidate state exists, set current state and apply to current trigger;
8. if no candidate exists:
   - preserve current decoration only when no stronger authority contradicts it;
   - preserve a pending New Chat promotion only when no stronger authority contradicts it;
   - otherwise clear state and restore native trigger.

The distinction between `authorityPresent` and `explicitNonGpt56` matters:

- missing authority may justify temporary preservation;
- explicit non-GPT-5.6 authority requires clearing;
- an authority element that is present but incomplete must not be silently replaced by stale cross-surface data.

## 13. Navigation-reset contract

`resetForNavigation` exists because SPA navigation and Composer replacement do not happen atomically.

### 13.1 Same context

If the context key did not change, preserve state and queue a rescan.

### 13.2 New Chat Chat -> conversation promotion

Preserve a confirmed GPT-5.6 New Chat state while conversation detail is pending.

Reason: `new_chat_promotion`.

### 13.3 GPT surface Chat -> conversation promotion

Preserve a confirmed GPT-5.6 state from `gpt_surface_chat` while conversation detail is pending.

Reason: `gpt_surface_chat_promotion`.

### 13.4 Work New Chat carry

Work state may be carried into the new Work context only when all of the following hold:

- current state is GPT-5.6;
- destination is `new_surface:work`;
- active surface is Work;
- the current decoration is still confirmed in the active Composer;
- Work storage does not currently provide a valid GPT-5.6 state;
- Work storage does not explicitly identify a non-GPT-5.6 model.

Reason: `work_new_chat_carry`.

### 13.5 Confirmed decoration carry

If the currently decorated trigger is still in the active Composer, state may survive a navigation gap unless crossing Chat -> Work.

Reason: `confirmed_decoration`.

### 13.6 Chat -> Work boundary

`crossingChatToWork` explicitly blocks generic confirmed-decoration carry. Work must establish its own authority.

### 13.7 No preserve condition

Clear state, restore all Arcaia trigger mutations, and record `navigation_reset`.

## 14. Known race conditions and why the guards exist

These are not speculative edge cases. They correspond to probe evidence and browser regressions.

### 14.1 Trigger-disconnected scan before navigation reset

Observed failure:

1. New Chat has valid GPT-5.6 state;
2. Composer / trigger is replaced;
3. `trigger_disconnected` scan runs before `resetForNavigation`;
4. conversation authority is not available yet;
5. older code cleared New Chat state as `resolved_state_unavailable`;
6. navigation reset then had nothing left to promote.

Required behavior:

An authority-free scan during this promotion gap must preserve the pending New Chat promotion state.

### 14.2 Native performance trigger includes extra text

Observed failure:

Probe could identify a native performance control as `高い`, but Arcaia only matched exact `textContent` and failed to target it.

Required behavior:

Known performance labels must be recognized from `textContent`, `aria-label`, or `title`, including safe leading / trailing extra text.

### 14.3 Work selected label disagrees with slider index

Observed failures:

- native `非常に高い` selected while `aria-valuenow=4`, Arcaia showed `最大`;
- native `高い` selected while `aria-valuenow=3`, Arcaia showed `非常に高い`.

Required behavior:

Explicit selected native performance label outranks numeric slider fallback.

### 14.4 Work conversation cold start before conversation detail

Observed failure:

Work conversation Composer already displayed a complete current native GPT-5.6 / thinking state, but `resolveCurrentContextState` returned `conversation_waiting_for_detail` before consulting Work native authority.

Required behavior:

While conversation detail is unavailable, complete live Work native trigger authority may decorate the current Work conversation. Once conversation detail arrives, conversation authority becomes canonical.

## 15. Main lifecycle integration

### 15.1 Startup

`content_model_selector.js` loads before `content.js`.

When model decoration is enabled, Content:

1. applies configured visual style;
2. calls model-selector `start()`.

### 15.2 Feature setting change

Changing only model decoration or model decoration style reconfigures only this subsystem.

- enabled -> set style + start;
- disabled -> cleanup with `feature_disabled`.

### 15.3 Extension shutdown / disabled mode

Global Arcaia cleanup calls model-selector `cleanup(reason)`.

Cleanup must:

- disconnect all model-selector observers;
- clear temporary picker / carry state;
- remove event listeners;
- restore native trigger DOM / attributes;
- release Composer width reservation.

## 16. Diagnostics contract

The normal UI status remains lightweight. Generic persistent debug logging is not part of the runtime.

The request-driven internal probe snapshot currently exposes only privacy-bounded diagnostic facts such as:

- active surface mode;
- classified context kinds;
- whether New Chat / conversation / confirmed Composer / navigation-carry state exists;
- whether context ownership matches the current context;
- recent navigation-reset decisions;
- last state mutation kind / reason;
- model source enum;
- known thinking effort / known performance label;
- trigger found / applied / currently in Composer;
- last scan reason / outcome.

Raw conversation IDs, raw context keys, URLs, cookies, storage values, or conversation text must not cross this diagnostic boundary.

The external `Arcaia Model Decoration Watch Probe` is the preferred evidence tool for intermittent failures. It may observe more page structure, but it remains independent from normal Arcaia runtime and obeys the same privacy constraints.

The probe and runtime do not intentionally share identical recognition rules. The probe may classify broader structural clues as diagnostic candidates—for example a Work pre-picker label shape that is useful evidence but is not yet accepted as runtime authority. A probe saying "candidate / signal found" therefore does not by itself mean Arcaia is allowed to decorate from that value. Future refactors must preserve this distinction between **diagnostic evidence** and **trusted runtime authority**.

## 17. What is intentionally not part of the design

Do not reintroduce these during cleanup or refactor without new evidence:

- permanent `documentElement` model-selector observer;
- polling / `setInterval` for model state;
- fixed-delay settlement as the primary picker mechanism;
- generic page-wide model-button scan;
- Chat cookie as a fallback for missing Work authority;
- click intent as final selection authority;
- unconditional slider-index authority when a native selected label exists;
- Content-side extra conversation fetch solely for model decoration;
- stale conversation config applied without route / conversation matching;
- broad "only menu button on page" decoration fallback;
- persistent diagnostic logs in normal runtime.

## 18. Known external assumptions

The subsystem currently assumes these ChatGPT implementation details exist. They are not guaranteed stable APIs and must be re-probed if they change:

- Composer `data-type="unified-composer"`;
- picker test IDs;
- Work `data-animated-slider-trigger` wrapper;
- Work model / effort class-name fragments;
- surface radio semantics;
- current performance labels;
- Work storage keys;
- New Chat cookie shape;
- conversation metadata fields;
- slider `aria-valuenow` semantics.

When one of these assumptions changes, first determine which semantic authority replaced it. Do not layer a new fallback on top of an obsolete path without deciding whether the old path should be removed.

## 19. Maintenance rule

Any future model-selector behavior change must update this document in the same logical change when it changes one of:

- authority order;
- selector meaning;
- observer scope;
- transition carry / clear semantics;
- model / effort normalization;
- trigger targeting;
- Main World conversation-state supply;
- cleanup behavior;
- diagnostic boundary.

The companion `docs/model_selector_refactor_checklist.md` is the acceptance checklist for future structural work.
