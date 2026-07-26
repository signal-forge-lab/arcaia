(() => {
  'use strict';

  const API_KEY = '__ARCAIA_ASSISTANT_COMPLETION_SIGNAL_DIAG__';
  const MAX_RECORDS = 900;
  const HEARTBEAT_INTERVAL_MS = 1000;
  const STREAM_ROOT_SELECTOR = '[data-scroll-root]';
  const ASSISTANT_TURN_SELECTOR = 'section[data-turn="assistant"]';
  const ASSISTANT_ROLE_SELECTOR = '[data-message-author-role="assistant"]';
  const COPY_BUTTON_SELECTOR = 'button[data-testid="copy-turn-action-button"]';
  const ERROR_RETRY_BUTTON_SELECTOR = 'button[data-testid="regenerate-thread-error-button"]';
  const ERROR_BLOCK_SELECTOR = '.text-token-text-error';
  const COMPOSER_EDITOR_SELECTOR = 'form[data-type="unified-composer"] #prompt-textarea[contenteditable="true"][role="textbox"][aria-multiline="true"]';
  const STOP_BUTTON_SELECTOR = [
    'button[data-testid="stop-button"]',
    'button[aria-label="回答を停止"]',
    'button[aria-label="Stop generating"]'
  ].join(', ');
  const ARCAIA_TIMESTAMP_SELECTOR = '[data-arcaia-message-time-badge="true"]';
  const RELEVANT_ATTRIBUTE_NAMES = new Set([
    'data-stream-active',
    'data-testid',
    'data-turn',
    'data-turn-id',
    'data-message-id',
    'data-state',
    'data-is-intersecting',
    'aria-label',
    'aria-busy',
    'aria-disabled',
    'disabled',
    'hidden'
  ]);

  if (window[API_KEY]?.stop) {
    try { window[API_KEY].stop(); } catch {}
  }

  const startedAtMonotonic = performance.now();
  const startedAtEpoch = Date.now();
  const records = [];
  const timers = new Set();
  const eventBindings = [];
  let stopped = false;
  let previousState = null;
  let heartbeatExpectedAt = startedAtMonotonic + HEARTBEAT_INTERVAL_MS;
  let heartbeatCount = 0;
  let resourceObserver = null;

  function elapsedMs() {
    return Math.round((performance.now() - startedAtMonotonic) * 10) / 10;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isElement(value) {
    return value instanceof Element;
  }

  function push(record) {
    if (stopped) return null;
    const item = {
      atMs: elapsedMs(),
      atIso: nowIso(),
      visibilityState: document.visibilityState,
      hasFocus: typeof document.hasFocus === 'function' ? Boolean(document.hasFocus()) : null,
      ...record
    };
    records.push(item);
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
    return item;
  }

  function sanitizeId(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  }

  function getStreamRoot() {
    const main = document.querySelector('main#main');
    return main?.closest?.(STREAM_ROOT_SELECTOR)
      || document.querySelector(STREAM_ROOT_SELECTOR)
      || null;
  }

  function getAssistantTurns() {
    return Array.from(document.querySelectorAll(ASSISTANT_TURN_SELECTOR));
  }

  function getLatestAssistantTurn() {
    return getAssistantTurns().at(-1) || null;
  }

  function getAssistantTurnKey(turn) {
    if (!isElement(turn)) return null;
    const role = turn.querySelector(ASSISTANT_ROLE_SELECTOR);
    return sanitizeId(
      role?.getAttribute('data-message-id')
      || turn.getAttribute('data-turn-id')
      || turn.getAttribute('data-testid')
      || null
    );
  }

  function getComposerEditor() {
    return document.querySelector(COMPOSER_EDITOR_SELECTOR) || null;
  }

  function getComposerTextState() {
    const editor = getComposerEditor();
    if (!editor) {
      return {
        composerEditorExists: false,
        composerHasText: false,
        composerTextLength: 0
      };
    }
    const rawComposerValue = (
      editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
    )
      ? editor.value
      : editor.textContent;
    const normalizedLength = String(rawComposerValue || '').replace(/\s+/g, ' ').trim().length;
    return {
      composerEditorExists: true,
      composerHasText: normalizedLength > 0,
      composerTextLength: normalizedLength
    };
  }

  function isConfirmedErrorRetryButton(button) {
    return Boolean(
      isElement(button)
      && button.matches(ERROR_RETRY_BUTTON_SELECTOR)
      && button.closest(ERROR_BLOCK_SELECTOR)
    );
  }

  function getState() {
    const streamRoot = getStreamRoot();
    const turns = getAssistantTurns();
    const latestTurn = turns.at(-1) || null;
    const latestRole = latestTurn?.querySelector?.(ASSISTANT_ROLE_SELECTOR) || null;
    const latestCopy = latestTurn?.querySelector?.(COPY_BUTTON_SELECTOR) || null;
    const latestErrorRetry = latestTurn?.querySelector?.(ERROR_RETRY_BUTTON_SELECTOR) || null;
    const stopButton = document.querySelector(STOP_BUTTON_SELECTOR);
    const arcaiaTimestamp = latestTurn?.querySelector?.(ARCAIA_TIMESTAMP_SELECTOR) || null;
    const composerTextState = getComposerTextState();
    return {
      streamRootExists: Boolean(streamRoot?.isConnected),
      streamActive: Boolean(streamRoot?.hasAttribute?.('data-stream-active')),
      assistantTurnCount: turns.length,
      latestAssistantKey: getAssistantTurnKey(latestTurn),
      latestAssistantRoleExists: Boolean(latestRole?.isConnected),
      latestAssistantCopyButton: Boolean(latestCopy?.isConnected),
      latestAssistantErrorRetry: Boolean(
        latestErrorRetry?.isConnected && isConfirmedErrorRetryButton(latestErrorRetry)
      ),
      latestAssistantErrorBlock: Boolean(latestErrorRetry?.closest?.(ERROR_BLOCK_SELECTOR)),
      latestAssistantTimestampBadge: Boolean(arcaiaTimestamp?.isConnected),
      latestAssistantButtonCount: latestTurn?.querySelectorAll?.('button')?.length || 0,
      stopButtonExists: Boolean(stopButton?.isConnected),
      ...composerTextState,
      totalCopyButtonCount: document.querySelectorAll(COPY_BUTTON_SELECTOR).length,
      totalErrorRetryButtonCount: Array.from(
        document.querySelectorAll(ERROR_RETRY_BUTTON_SELECTOR)
      ).filter(isConfirmedErrorRetryButton).length
    };
  }

  function stateDiff(previous, next) {
    if (!previous) return { initial: true, state: next };
    const changed = {};
    for (const key of Object.keys(next)) {
      if (previous[key] !== next[key]) changed[key] = { from: previous[key], to: next[key] };
    }
    return changed;
  }

  function snapshot(reason = 'manual', extra = {}) {
    if (stopped) return null;
    const state = getState();
    const changes = stateDiff(previousState, state);
    const item = push({ type: 'snapshot', reason, state, changes, ...extra });
    previousState = state;
    return item;
  }

  function selectorHitSummary(node) {
    if (!isElement(node)) return null;
    const has = (selector) => Boolean(node.matches?.(selector) || node.querySelector?.(selector));
    return {
      tag: node.tagName.toLowerCase(),
      dataTestId: sanitizeId(node.getAttribute('data-testid')),
      dataTurn: sanitizeId(node.getAttribute('data-turn')),
      dataTurnId: sanitizeId(node.getAttribute('data-turn-id')),
      dataMessageId: sanitizeId(node.getAttribute('data-message-id')),
      assistantTurn: has(ASSISTANT_TURN_SELECTOR),
      assistantRole: has(ASSISTANT_ROLE_SELECTOR),
      copyButton: has(COPY_BUTTON_SELECTOR),
      errorRetryButton: has(ERROR_RETRY_BUTTON_SELECTOR),
      stopButton: has(STOP_BUTTON_SELECTOR),
      timestampBadge: has(ARCAIA_TIMESTAMP_SELECTOR)
    };
  }

  function mutationTouchesLatestAssistant(mutation, latestTurn) {
    if (!latestTurn) return false;
    const target = mutation.target instanceof Node ? mutation.target : null;
    if (target && (target === latestTurn || latestTurn.contains(target))) return true;
    const nodes = [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])];
    return nodes.some((node) => (
      node === latestTurn
      || (node instanceof Node && latestTurn.contains(node))
      || (isElement(node) && node.contains(latestTurn))
    ));
  }

  function summarizeMutations(mutations) {
    const latestTurn = getLatestAssistantTurn();
    const summary = {
      callbackMutationCount: mutations.length,
      childListCount: 0,
      attributesCount: 0,
      characterDataCount: 0,
      latestAssistantMutationCount: 0,
      relevantAttributeChanges: [],
      addedNodeSamples: [],
      removedNodeSamples: []
    };

    for (const mutation of mutations) {
      if (mutation.type === 'childList') summary.childListCount += 1;
      if (mutation.type === 'attributes') summary.attributesCount += 1;
      if (mutation.type === 'characterData') summary.characterDataCount += 1;
      if (mutationTouchesLatestAssistant(mutation, latestTurn)) summary.latestAssistantMutationCount += 1;

      if (
        mutation.type === 'attributes'
        && RELEVANT_ATTRIBUTE_NAMES.has(mutation.attributeName)
        && summary.relevantAttributeChanges.length < 16
      ) {
        const target = isElement(mutation.target) ? mutation.target : null;
        const isStreamAttribute = mutation.attributeName === 'data-stream-active';
        summary.relevantAttributeChanges.push({
          attributeName: mutation.attributeName,
          oldValue: mutation.oldValue,
          currentValue: target?.getAttribute?.(mutation.attributeName) ?? null,
          presentAfterCallback: Boolean(target?.hasAttribute?.(mutation.attributeName)),
          exactStreamRoot: isStreamAttribute ? target === getStreamRoot() : null,
          target: selectorHitSummary(mutation.target)
        });
      }

      for (const node of Array.from(mutation.addedNodes || [])) {
        if (summary.addedNodeSamples.length >= 12) break;
        const sample = selectorHitSummary(node);
        if (sample && Object.values(sample).some((value) => value === true)) {
          summary.addedNodeSamples.push(sample);
        }
      }

      for (const node of Array.from(mutation.removedNodes || [])) {
        if (summary.removedNodeSamples.length >= 12) break;
        const sample = selectorHitSummary(node);
        if (sample && Object.values(sample).some((value) => value === true)) {
          summary.removedNodeSamples.push(sample);
        }
      }
    }
    return summary;
  }

  const observer = new MutationObserver((mutations) => {
    const summary = summarizeMutations(mutations);
    const before = previousState;
    const state = getState();
    const changes = stateDiff(before, state);
    const hasStateChange = Object.keys(changes).length > 0;
    const relevant = Boolean(
      hasStateChange
      || summary.latestAssistantMutationCount
      || summary.relevantAttributeChanges.length
      || summary.addedNodeSamples.length
      || summary.removedNodeSamples.length
    );
    if (!relevant) return;
    push({ type: 'mutation', summary, state, changes });
    previousState = state;
  });

  function addEvent(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    eventBindings.push({ target, type, handler, options });
  }

  function recordLifecycleEvent(event) {
    snapshot(`event:${event.type}`, {
      event: {
        type: event.type,
        persisted: 'persisted' in event ? Boolean(event.persisted) : null
      }
    });
  }

  for (const type of ['visibilitychange', 'freeze', 'resume']) {
    addEvent(document, type, recordLifecycleEvent, true);
  }
  for (const type of ['focus', 'blur', 'pageshow', 'pagehide']) {
    addEvent(window, type, recordLifecycleEvent, true);
  }

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: Array.from(RELEVANT_ATTRIBUTE_NAMES),
    characterData: true
  });

  function sanitizeBackendPath(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.includes('/backend-api/')) return null;
      return url.pathname
        .replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/ig, ':id')
        .replace(/\/c\/[^/]+/g, '/c/:id')
        .replace(/\/conversation\/[^/]+/g, '/conversation/:id');
    } catch {
      return null;
    }
  }

  function startResourceObserver() {
    if (typeof PerformanceObserver !== 'function') {
      push({ type: 'resource_observer_unavailable' });
      return;
    }
    try {
      resourceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const path = sanitizeBackendPath(entry.name);
          if (!path) continue;
          push({
            type: 'resource_complete',
            resource: {
              path,
              initiatorType: entry.initiatorType || null,
              startTimeMs: Math.round(Number(entry.startTime || 0) * 10) / 10,
              durationMs: Math.round(Number(entry.duration || 0) * 10) / 10,
              responseEndMs: Math.round(Number(entry.responseEnd || 0) * 10) / 10,
              transferSize: Number(entry.transferSize || 0),
              encodedBodySize: Number(entry.encodedBodySize || 0),
              decodedBodySize: Number(entry.decodedBodySize || 0),
              responseStatus: Number(entry.responseStatus || 0) || null
            },
            state: getState()
          });
        }
      });
      resourceObserver.observe({ type: 'resource', buffered: false });
    } catch (error) {
      push({
        type: 'resource_observer_error',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const heartbeatTimer = setInterval(() => {
    const now = performance.now();
    const driftMs = Math.round((now - heartbeatExpectedAt) * 10) / 10;
    heartbeatExpectedAt = now + HEARTBEAT_INTERVAL_MS;
    heartbeatCount += 1;
    if (driftMs > 500 || heartbeatCount % 10 === 0) {
      push({
        type: 'heartbeat',
        heartbeatCount,
        driftMs,
        state: getState()
      });
    }
  }, HEARTBEAT_INTERVAL_MS);
  timers.add(heartbeatTimer);

  function candidateEvents() {
    return records.filter((record) => {
      if (record.type === 'resource_complete') return true;
      if (record.type !== 'mutation' && record.type !== 'snapshot') return false;
      const changes = record.changes || {};
      return Boolean(
        changes.streamActive
        || changes.stopButtonExists
        || changes.latestAssistantKey
        || changes.latestAssistantCopyButton
        || changes.latestAssistantErrorRetry
        || changes.latestAssistantErrorBlock
        || changes.latestAssistantTimestampBadge
        || changes.composerHasText
        || changes.composerTextLength
      );
    });
  }

  function dump() {
    return {
      generatedAt: nowIso(),
      startedAt: new Date(startedAtEpoch).toISOString(),
      elapsedMs: elapsedMs(),
      stopped,
      note: 'Assistant completion signal diagnostic. Conversation text, innerHTML, outerHTML, request bodies, response bodies, cookies, and headers are not collected.',
      selectors: {
        streamRoot: STREAM_ROOT_SELECTOR,
        assistantTurn: ASSISTANT_TURN_SELECTOR,
        copyButton: COPY_BUTTON_SELECTOR,
        errorRetryButton: ERROR_RETRY_BUTTON_SELECTOR,
        errorBlock: ERROR_BLOCK_SELECTOR,
        stopButton: STOP_BUTTON_SELECTOR,
        composerEditor: COMPOSER_EDITOR_SELECTOR,
        arcaiaTimestamp: ARCAIA_TIMESTAMP_SELECTOR
      },
      currentState: getState(),
      candidateEvents: candidateEvents(),
      records: records.slice()
    };
  }

  function json() {
    return JSON.stringify(dump(), null, 2);
  }

  function clear() {
    records.length = 0;
    previousState = getState();
    push({ type: 'cleared', state: previousState });
    return true;
  }

  function mark(label = 'manual') {
    return snapshot(`mark:${String(label).slice(0, 100)}`);
  }

  function stop() {
    if (stopped) return dump();
    observer.disconnect();
    resourceObserver?.disconnect?.();
    resourceObserver = null;
    for (const binding of eventBindings) {
      binding.target.removeEventListener(binding.type, binding.handler, binding.options);
    }
    eventBindings.length = 0;
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    push({ type: 'stopped', state: getState() });
    stopped = true;
    return dump();
  }

  window[API_KEY] = Object.freeze({ stop, dump, json, snapshot, mark, clear });
  previousState = getState();
  push({ type: 'installed', state: previousState });
  startResourceObserver();
  console.info(
    '[Arcaia] Assistant completion signal diagnostic installed. '
    + 'Send a prompt, move this tab to the background, wait for completion, return, then run: '
    + 'copy(window.__ARCAIA_ASSISTANT_COMPLETION_SIGNAL_DIAG__.json())'
  );
})();
