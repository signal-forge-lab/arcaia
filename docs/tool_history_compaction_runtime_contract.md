# Tool History Compaction Runtime Contract

Status: canonical safety/design contract
Baseline implementation: Arcaia v0.1.371
Last validated: 2026-09-10
Feature key: `toolHistoryCompaction` (default OFF)

## 1. Why this document exists

Tool History Compaction is not a cosmetic-only feature. It was introduced to reduce the real cost of long ChatGPT conversations that contain many tool calls while preserving a small visible indication such as `ツール使用 × N` for each Assistant turn.

The implementation went through a real-browser failure investigation. A seemingly reasonable DOM-pruning implementation caused ChatGPT to fall into the page-level `Content failed to load / Try again` error boundary. The failure was intermittent because the physical DOM removal could appear harmless until a later React reconciliation.

This document records the evidence, rejected designs, current architecture, invariants, and validation procedure so that a future refactor, another AI, or another chat does not remove code that looks redundant but is required for correctness and stability.

**Any change to Tool History Compaction MUST read this document first.** Do not simplify the current design back to direct deletion of ChatGPT-owned DOM without new real-browser evidence that proves the ownership/reconciliation problem no longer exists.

## 2. User-visible requirement

When `toolHistoryCompaction=true`:

1. Historical tool payloads should consume substantially less memory/data than the original ChatGPT response.
2. The visible history should not show every historical tool-detail row.
3. Each Assistant turn that used tools should retain a lightweight indication: `ツール使用 × N`.
4. ChatGPT's own User/Assistant turn hierarchy must remain intact.
5. The feature must not cause `Content failed to load`, `Try again`, renderer restart, broken streaming, or broken future tool calls.
6. The latest two user-started turns are deliberately left uncompressed by the payload compactor as a safety window.
7. Turning the feature OFF must be reversible for Arcaia-owned presentation attributes/styles. Do not require a document reload merely to clean up Arcaia presentation state.

The feature is opt-in and defaults to OFF.

## 3. The failure that established the safety boundary

### 3.1 Original unsafe approach

The first implementation reused one native tool group as the visible summary and attempted to physically delete old tool-detail DOM nodes after a quiet period. The critical operation was equivalent to:

```js
candidate.remove();
```

The intent was reasonable: fewer DOM nodes should mean lower memory and rendering cost. The problem is ownership. Those nodes are owned by ChatGPT's React tree, not by Arcaia.

### 3.2 Real-browser reproduction

The dedicated validation conversation is:

```text
Use a dedicated user-approved ChatGPT test conversation URL. Do not commit the
actual conversation URL or conversation ID to this public repository.
```

Key reproduction conditions:

- Arcaia loaded as the unpacked extension.
- `toolHistoryCompaction=true`.
- Lite View disabled during the main isolation tests.
- Converlay was stopped for the decisive reproduction, so its unrelated conversation-list 429 traffic was not used as evidence against Arcaia.
- The test prompt forced a real Web tool call, because plain text-only turns did not reproduce the bug reliably.

With compaction ON, a Web tool call reproduced:

```text
Content failed to load
Try again
```

The conversation send itself returned HTTP 200. The failure happened on the client after tool rendering/reconciliation. With the same Web tool-call scenario and compaction OFF, the response completed normally. This isolated Tool History Compaction as the trigger.

### 3.3 Why a timing-only fix was insufficient

An intermediate fix delayed hard pruning while generation was active and converted the quiet timer into a real debounce. One trial succeeded, but a later tool-enabled send failed after historical React-owned tool nodes had already been physically removed while idle.

That proved the root cause was **not only when the node was removed**. The root cause was **physically detaching React-owned nodes at all**.

### 3.4 Stable safety fix

v0.1.370 changed the old hard-prune path so it no longer detaches React-owned DOM. The path name remains for internal scheduling compatibility, but its mutation is reversible soft-hide behavior.

v0.1.371 then added the real memory/data reduction at the correct boundary: **before the conversation payload is consumed by ChatGPT/React**, instead of deleting nodes after React has created and claimed them.

## 4. Real conversation data observed during investigation

The live test conversation showed a typical Web search tool sequence containing, approximately:

- Assistant tool invocation (`assistant / code / recipient=web.run`): about 1.3 KB.
- Small tool/request-side result message: about 1.2 KB.
- Heavy tool/result-side message: about 7.6-8.7 KB.

The heavy result message's visible `content.parts` was comparatively small. Most weight was in metadata, especially:

- `metadata.search_result_groups`
- `metadata.inline_cot_expandable_content`

This evidence is why v0.1.371 targets these fields instead of blanking the entire message or deleting graph nodes.

Important counting rule: one Web search can create multiple `role=tool` messages. The visible `ツール使用 × N` count is therefore **not the number of `role=tool` result messages**. Tool invocation count is derived from Assistant messages whose `recipient` is non-empty and not `all`.

## 5. Rejected designs

### 5.1 Physically remove historical tool DOM

**Rejected.** It breaks the React virtual-DOM/real-DOM ownership contract and can fail on a later reconciliation rather than immediately.

Never reintroduce `Element.remove()`, `removeChild()`, `replaceChildren()`, or equivalent destructive mutation against ChatGPT-owned tool/history descendants as a memory optimization.

### 5.2 Empty the children of a React-owned tool node after render

**Rejected for the same reason.** Keeping the outer DOM node but deleting its children still mutates structure that React believes it owns. It is not materially safer than removing the parent.

### 5.3 Keep a minimal native tool shell by guessing result metadata

Experiments retained an empty `search_result_groups` shell and then a single minimal entry. Neither reliably caused the current ChatGPT history renderer to create the old native `span.group/tool-message` row.

More importantly, with Tool History Compaction OFF, the current ChatGPT history renderer also did not recreate those old Web tool rows for the tested historical response. Therefore the native tool-row selector cannot be treated as a stable contract for historical summaries.

### 5.4 Insert a new summary child into the Assistant React subtree

Avoided. Arcaia does not need to add a child DOM node to achieve the summary. A data attribute plus CSS pseudo-element is lighter and does not alter the React-owned child structure.

## 6. Current v0.1.371 architecture

The design deliberately separates **payload compaction** from **summary presentation**.

```text
ChatGPT conversation response
        |
        v
Main World / injected-main.js
        |
        +--> observe ORIGINAL normalized conversation
        |      |
        |      +--> build Tool History Summary Index
        |             Assistant final-message-id -> tool invocation count
        |
        +--> compactHistoricalToolPayload(...)
        |      |
        |      +--> preserve latest 2 user-started turns
        |      +--> only completed historical role=tool messages
        |      +--> search_result_groups = []
        |      +--> delete inline_cot_expandable_content
        |      +--> preserve message/node identity and graph structure
        |
        v
rewritten conversation response -> ChatGPT / React

Main World summary index
        |
        +--> tool_history_summary_index_updated event
        +--> SYNC_PAGE_CONVERSATION response
        |
        v
Content Script / content.js
        |
        +--> merge indexes from paginated responses in same conversation
        +--> match final Assistant data-message-id
        +--> set data-* summary attributes only
        |
        v
CSS ::before -> `ツール使用 × N`
```

### 6.1 Main World responsibilities

Relevant state/functions in `injected-main.js` include:

- `toolHistorySummaryIndex`
- `toolHistorySummaryIndexesByConversation`
- `buildToolHistorySummaryIndexFromConversation(...)`
- `observeToolHistorySummaryIndexFromConversation(...)`
- `getToolHistorySummaryIndexForContent(...)`
- `compactHistoricalToolPayload(...)`
- `shouldApplyToolHistoryCompactionToFetch(...)`

The summary index is built from the **original normalized conversation** before heavy metadata is stripped. This ordering is intentional. Do not move summary-index construction after payload compaction unless tests and live evidence prove all required tool identity/count information remains available.

Tool invocation detection currently treats an Assistant message as an invocation when its `recipient` is present and not `all`.

For each user-started turn, the summary target is the final visible Assistant text message (`recipient=all`, `content_type=text`, completed/end-turn semantics). The resulting shape is conceptually:

```js
{
  conversationId,
  summarizedTurnCount,
  totalToolInvocations,
  byAssistantMessageId: {
    "<final-assistant-message-id>": {
      assistantMessageId: "<same-id>",
      toolCount: 1
    }
  }
}
```

The index is kept in a bounded per-conversation cache and is supplied both by event and by `SYNC_PAGE_CONVERSATION`, so SPA timing does not require polling.

### 6.2 Payload compaction responsibilities

`compactHistoricalToolPayload(...)` must remain conservative.

Current contract:

- Deep-clone/derive the outgoing canonical payload rather than mutate unrelated cached source state.
- Work only on the selected/reachable conversation path.
- Count user-started turns.
- Preserve the latest two user-started turns without tool-payload compaction.
- Touch only completed historical `role=tool` messages.
- Remove the measured heavy historical fields, currently `metadata.search_result_groups` and `metadata.inline_cot_expandable_content`.
- Preserve message ID, node ID, parent/children graph placement, `metadata.parent_id`, role, recipient, status, and other metadata unless a separate evidence-backed change explicitly expands the compaction contract.
- Do not blank final Assistant text or citation-bearing final Assistant metadata.

Do not generalize this into "strip unknown tool metadata". Unknown/new ChatGPT tool schemas must fail conservative: keep data until a probe shows what is safe to remove.

### 6.3 Content Script responsibilities

Relevant state/functions in `content.js` include:

- `toolHistoryPayloadSummaryIndex`
- `mergeToolHistoryPayloadSummaryIndex(...)`
- `applyToolHistoryPayloadSummaryIndex(...)`
- `clearToolHistoryPayloadSummaryAttributes(...)`
- existing tool-history hydration/idle/soft-hide scheduling

The content side does not fetch conversation history just to build the tool summary. It consumes Main World state already observed from ChatGPT's own conversation response.

`mergeToolHistoryPayloadSummaryIndex(...)` is required for long conversations. ChatGPT may return only the current page/window of messages. Loading an older page must merge Assistant-message-ID entries for the same conversation instead of replacing the newer page's index. A different conversation ID must replace/reset the index rather than mix histories.

### 6.4 Summary presentation contract

When the historical native tool row is absent, `applyToolHistoryPayloadSummaryIndex(...)` matches:

```text
[data-message-author-role="assistant"][data-message-id="..."]
```

and adds only Arcaia-owned attributes such as:

- `data-arcaia-tool-history-payload-summary="true"`
- `data-arcaia-tool-history-payload-tool-count="N"`
- `data-arcaia-tool-history-payload-summary-text="ツール使用 × N"`

The text is rendered via CSS `::before`.

**A CSS pseudo-element is not a DOM child node.** This is intentional. It gives the user a persistent tool-use marker while leaving the Assistant element's React-owned child hierarchy untouched.

If a native tool-history row is present, avoid rendering a duplicate payload-summary marker for that same turn.

## 7. Answer to the "keep the DOM hierarchy but empty the contents" question

There are two different meanings of "keep the hierarchy":

1. **Keep the ChatGPT conversation/Assistant turn hierarchy.** This is what the current design does. User and Assistant message elements remain React-owned and structurally intact. Historical heavy tool detail is removed before rendering, so React never needs to allocate much of that detail.
2. **Keep a dedicated native tool DOM shell and empty only its children.** This is not currently safe or stable as an after-render mutation, and the current ChatGPT history renderer does not reliably create such a shell even when compaction is OFF.

Therefore the current contract is: preserve the conversation/Assistant hierarchy, do not force a native tool subtree to exist, and render the minimal tool-use indication using attributes plus a pseudo-element.

If a future ChatGPT renderer exposes a stable React-owned minimal-tool-shell data contract, it may be investigated. It must first be proven with an isolated probe and real-browser A/B validation. Do not infer such a contract from CSS selectors alone.

## 8. Non-negotiable safety invariants

The following are regression-sensitive invariants, not optional implementation details:

1. **Never physically detach ChatGPT/React-owned historical tool DOM as an optimization.**
2. **Never empty or replace React-owned tool children after render as a substitute for detaching the parent.**
3. Build the tool-use summary index from the original normalized conversation response, before destructive payload compaction.
4. Count Assistant tool invocations, not raw `role=tool` result-message count.
5. Keep the latest two user-started turns uncompressed unless new real-browser evidence explicitly changes this safety window.
6. Compact only known, measured heavy metadata from completed historical tool messages. Unknown formats remain intact.
7. Preserve conversation graph/message identity (`id`, node placement, parent/children, `metadata.parent_id`) and final Assistant response/citation data.
8. Summary UI must not require inserting a new child into ChatGPT's Assistant React subtree. Prefer the current `data-*` + `::before` model.
9. Same-conversation paginated summary indexes must merge by final Assistant message ID; cross-conversation state must not merge.
10. Do not add polling or periodic refetching for this feature. Use existing conversation-response observation, Main World events, SPA sync, and shared DOM observation.
11. Feature OFF must clear Arcaia summary attributes/style state and restore any Arcaia soft-hidden native rows where applicable.
12. A static unit-test pass is not sufficient for a change that touches payload rewriting, tool summary mapping, or ChatGPT-owned DOM. A real tool-enabled browser test is mandatory.

## 9. Real-browser validation procedure

Use the dedicated test conversation above. Do not use the development conversation itself as the test target because sending to the same conversation that is coordinating the test can deadlock/interrupt the workflow.

Recommended validation sequence:

1. Load the current unpacked Arcaia build with the normal persistent test profile.
2. Confirm `toolHistoryCompaction=true` in the effective Main World config.
3. Confirm the target test conversation URL is exact.
4. Confirm no unrelated automation such as Converlay is generating traffic that would confuse attribution when investigating a failure.
5. Use a prompt that **must invoke a real tool**. The established low-risk probe used one Web search and an exact short final response.
6. Observe during generation and after completion:
   - no `Content failed to load`;
   - no `Try again` page-level fallback;
   - stream completes normally;
   - final Assistant answer exists;
   - next tool-enabled send still works.
7. Repeat at least three consecutive tool-enabled sends. One success is not enough; the original physical-removal bug could fail only on a later reconciliation.
8. Reload the conversation so ChatGPT performs a fresh conversation-detail fetch.
9. Verify summary-index entries match the returned conversation page/window and visible Assistant messages receive `ツール使用 × N`.
10. Verify `toolHistoryPayloadLastRewrite` reports a real byte reduction for historical heavy tool payloads.
11. Run focused regression tests, then all `tests/*.test.js`, then `git diff --check`.

The established 2026-09-10 final live sequence used Web-tool diagnostics 14, 15, and 16. All three completed without `Content failed to load` or `Try again`.

## 10. Measured results from the final v0.1.371 validation

On the final fresh conversation-detail response in the dedicated test conversation:

```text
Conversation payload:
  before: 128,556 bytes
  after:  106,510 bytes
  reduction: 17.15%

Historical tool-message portion:
  before: 29,689 bytes
  after:   7,927 bytes
  reduction: 73.30%
```

The response window contained five tool-using Assistant turns. Main World produced:

```text
summarizedTurnCount = 5
totalToolInvocations = 5
```

and all five visible final Assistant messages received a rendered `ツール使用 × 1` marker through the attribute/pseudo-element path.

The fact that a reload showed five entries does not imply earlier diagnostics were lost. ChatGPT's conversation-detail response was a paginated/current window. The content-side merge contract exists specifically so additional pages can accumulate same-conversation summary entries rather than overwrite them.

Final regression result after the pagination merge guard was added:

```text
Focused regression:
  155 tests
  141 PASS
  14 SKIP
  0 FAIL

All 25 test files:
  308 tests
  294 PASS
  14 SKIP
  0 FAIL

git diff --check:
  exit 0
  existing LF -> CRLF warning for content_filename.js only
```

## 11. Existing regression coverage that must remain meaningful

`tests/lite-grouping.test.js` contains the primary Tool History Compaction contract tests, including coverage equivalent to:

- Tool History Compaction is opt-in.
- React-owned tool DOM remains connected; the old hard path resolves to reversible soft-hide rather than physical removal.
- Hydration/generation timing remains safe.
- Historical payload compaction preserves recent turns and strips only known heavy historical detail.
- Same-conversation paginated tool-summary indexes merge rather than replace one another.
- Different conversations do not cross-contaminate summary state.
- v0.1.371 executable entry points remain version-aligned.

When refactoring tests, preserve the **behavioral assertion**, not only the current function name. A test that merely checks a string exists is not a replacement for the payload/merge behavior tests.

## 12. Refactor checklist

Before merging/refining any code that touches this feature, answer all of the following:

- [ ] Did I read this contract before changing the implementation?
- [ ] Does any new code call `remove`, `removeChild`, `replaceChildren`, `innerHTML=''`, or equivalent on ChatGPT-owned tool/history DOM?
- [ ] Is the summary index still built from the original normalized response before tool metadata is stripped?
- [ ] Is `N` still the number of Assistant tool invocations rather than the number of `role=tool` messages?
- [ ] Are the latest two user-started turns still preserved from payload compaction?
- [ ] Are only evidence-backed heavy fields stripped?
- [ ] Are message IDs, graph links, status, and final Assistant content/citations preserved?
- [ ] Does pagination merge same-conversation indexes and reset on conversation change?
- [ ] Is the summary still rendered without inserting a new React child node?
- [ ] Does feature OFF clean up Arcaia-owned attributes/styles?
- [ ] Did focused tests pass?
- [ ] Did all `tests/*.test.js` pass?
- [ ] Did `git diff --check` pass?
- [ ] Did at least three consecutive real tool-enabled sends pass in the dedicated validation conversation?
- [ ] Did the next send after an idle period also work? This matters because the original bug often appeared only on a later reconciliation.

If any answer is "no" or "unknown", the refactor is not complete.

## 13. Change-control rule for future ChatGPT UI/schema changes

ChatGPT's DOM and conversation schema are external, evolving contracts. If a future build changes tool-message structure, do not immediately broaden selectors or strip additional fields in production code.

Use this sequence:

1. Reproduce the new behavior in the dedicated test conversation.
2. Capture privacy-bounded structure/keys/counts/byte sizes with an isolated probe.
3. Establish which layer changed: transport schema, Main World normalization, React rendering, or DOM selector.
4. Add/update the smallest regression test that represents the observed contract.
5. Make the smallest implementation change.
6. Re-run the full real-browser sequence above.
7. Update this document when the proven safety contract changes.

Do not treat a ChatGPT DOM class name or one successful manual send as a stable contract.

## 14. Quick diagnosis guide

If `Content failed to load` reappears after a future Tool History refactor:

1. Check whether any code again physically mutates/detaches ChatGPT-owned history DOM.
2. A/B test the same real tool call with `toolHistoryCompaction=true` and `false`.
3. Confirm the send request itself succeeded before blaming network/server failure.
4. Inspect whether the failure occurs during the first tool render or only on the next send after idle compaction.
5. Check `toolHistoryPayloadLastRewrite` for byte counts and the Main World summary index for invocation counts.
6. Verify content-side message IDs match the summary index and that pagination did not replace same-conversation entries.

Do not attribute unrelated 429 traffic from another automation to Arcaia without causal evidence.

## 15. Canonical source map

The contract currently spans these locations:

```text
injected-main.js
  conversation response observation
  summary-index construction/cache/events
  historical tool payload compaction
  SYNC_PAGE_CONVERSATION summary-index supply

content.js
  same-conversation summary-index merge
  Assistant message-id matching
  data-* summary attributes
  CSS ::before summary rendering
  hydration/idle scheduling and reversible native-row soft-hide fallback
  feature cleanup

popup.js / manifest.json
  feature setting/version plumbing

tests/lite-grouping.test.js
  primary behavioral regression contracts

AGENTS.md
  mandatory pointer to this document for future implementation/refactor work
```

If these responsibilities are moved during a refactor, update this source map and preserve the invariants above. Code location is replaceable; the proven behavior and safety boundary are not.
