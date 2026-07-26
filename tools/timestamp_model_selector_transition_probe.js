(() => {
  'use strict';

  const API_KEY = '__ARCAIA_TIMESTAMP_MODEL_SELECTOR_TRANSITION_PROBE__';
  const MAIN_SOURCE = 'aice-probe-main-v159';
  const CONTENT_SOURCE = 'aice-probe-content-v159';
  const MAX_RECORDS = 640;
  const WATCHDOG_MS = 1000;
  const COMPOSER = 'form[data-type="unified-composer"]';
  const PICKER = '[data-testid="composer-intelligence-picker-content"]';
  const MESSAGE_ROLES =
    '[data-message-author-role="user"], [data-message-author-role="assistant"]';
  const TIME_BADGE = '[data-arcaia-message-time-badge="true"]';
  const TIME_APPLIED = '[data-arcaia-message-time-applied="true"]';
  const TIME_PROVISIONAL =
    '[data-arcaia-message-time-badge="true"][data-arcaia-timestamp-provisional="true"]';
  const MODEL_RICH = 'button[data-arcaia-model-rich="true"]';
  const MODEL_RICH_CONTENT = '[data-arcaia-model-rich-content="true"]';
  const CHAT_MODEL_COOKIE = 'oai-last-model-config';
  const SURFACE_STORAGE = 'oai/apps/tpp/chat-surface-mode';
  const SURFACE_COOKIE = 'oai-chat-surface-mode';
  const WORK_MODEL_STORAGE = 'oai/apps/tpp/model-settings';
  const WORK_EFFORT_STORAGE = 'oai/apps/tpp/thinking-effort';
  const PERFORMANCE_LABELS = new Set([
    '軽', '最速', '中程度', '高い', '非常に高い', '最大',
    'Light', 'Fastest', 'Medium', 'High', 'Very high', 'Maximum'
  ]);
  const RELEVANT_SELECTOR = [
    COMPOSER,
    PICKER,
    MESSAGE_ROLES,
    TIME_BADGE,
    TIME_APPLIED,
    MODEL_RICH,
    MODEL_RICH_CONTENT,
    'button[role="radio"]',
    'button[aria-haspopup="menu"]'
  ].join(', ');

  if (window[API_KEY]?.stop) {
    try { window[API_KEY].stop(); } catch {}
  }

  const startedAt = performance.now();
  const startedAtIso = new Date().toISOString();
  const records = [];
  const timers = new Set();
  const tokenMaps = new Map();
  const tokenCounters = new Map();
  const requestStartedAt = new Map();
  const conversationConfigs = new Map();
  let stopped = false;
  let observer = null;
  let watchdog = null;
  let snapshotQueued = false;
  let pendingSnapshotReason = null;
  let lastSnapshot = null;
  let lastSignature = '';
  let droppedRecordCount = 0;
  let snapshotChangeCount = 0;
  let protocolRequestCount = 0;
  let protocolResponseCount = 0;
  let timestampIndexEventCount = 0;
  let conversationModelEventCount = 0;
  let relevantMutationCallbackCount = 0;
  let errorCount = 0;

  function elapsedMs() {
    return Math.round((performance.now() - startedAt) * 10) / 10;
  }

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function safeText(value, limit = 180) {
    return text(value)
      .replace(/https?:\/\/\S+/gi, '<url>')
      .replace(/\/c\/[^/?#\s]+/gi, '/c/<conversation>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
      .slice(0, limit) || null;
  }

  function parseJson(raw) {
    try { return JSON.parse(String(raw ?? '')); } catch { return null; }
  }

  function token(kind, rawValue) {
    if (rawValue == null || rawValue === '') return null;
    const raw = String(rawValue);
    if (!tokenMaps.has(kind)) tokenMaps.set(kind, new Map());
    const map = tokenMaps.get(kind);
    if (!map.has(raw)) {
      const next = (tokenCounters.get(kind) || 0) + 1;
      tokenCounters.set(kind, next);
      map.set(raw, kind + '-' + String(next));
    }
    return map.get(raw);
  }

  function cookie(name) {
    try {
      const escaped = String(name).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
      const match = String(document.cookie || '').match(
        new RegExp('(?:^|; )' + escaped + '=([^;]*)')
      );
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function storage(key) {
    try {
      const raw = window.localStorage?.getItem?.(key);
      if (raw == null) return null;
      const parsed = parseJson(raw);
      return parsed == null ? raw : parsed;
    } catch {
      return null;
    }
  }

  function modelConfig(config, effortOverride = null) {
    const modelSlug = text(
      config?.model
      || config?.modelSlug
      || config?.model_slug
      || config?.lastUsedModelSlug
      || config?.last_used_model_slug
      || ''
    );
    const thinkingEffort = text(
      effortOverride
      || config?.effort
      || config?.thinkingEffort
      || config?.thinking_effort
      || ''
    ).toLowerCase();
    return {
      modelSlug: modelSlug.slice(0, 80) || null,
      thinkingEffort: thinkingEffort.slice(0, 40) || null
    };
  }

  function isGpt56(value) {
    return /(?:^|[-_])gpt[-_]?5(?:[-_.]?6)(?:[-_]|$)/i.test(text(value));
  }

  function explicitModelVersion(value) {
    const match = text(value).match(/\bGPT[-\u2011\u2013\s]?(\d+(?:\.\d+)?)\b/i);
    return match ? 'GPT-' + match[1] : null;
  }

  function knownPerformance(element) {
    const label = text(element?.textContent || '');
    return PERFORMANCE_LABELS.has(label) ? label : null;
  }

  function rawConversationId() {
    return String(window.location?.pathname || '').match(/\/c\/([^/?#]+)/i)?.[1] || null;
  }

  function locationSnapshot() {
    const pathname = String(window.location?.pathname || '/');
    const rawId = rawConversationId();
    return {
      pageKind: rawId
        ? 'conversation'
        : pathname === '/'
          ? 'home'
          : /^\/g\//i.test(pathname)
            ? 'gpt'
            : /^\/project/i.test(pathname)
              ? 'project'
              : 'other',
      conversationToken: token('conversation', rawId)
    };
  }

  function surfaceSnapshot() {
    const active = Array.from(document.querySelectorAll('button[role="radio"][data-state="on"]'))
      .find((button) => /^(Chat|Work)$/i.test(text(button.textContent || ''))) || null;
    const activeText = text(active?.textContent || '').toLowerCase();
    const normalize = (value) => {
      const normalized = text(value).toLowerCase();
      return normalized === 'work' || normalized === 'chatgpt' ? normalized : null;
    };
    const dom = activeText === 'work' ? 'work' : activeText === 'chat' ? 'chatgpt' : null;
    const stored = normalize(storage(SURFACE_STORAGE));
    const fromCookie = normalize(cookie(SURFACE_COOKIE));
    return {
      dom,
      storage: stored,
      cookie: fromCookie,
      effective: dom || stored || fromCookie || null
    };
  }

  function authoritySnapshot(location, surface) {
    const chatRaw = cookie(CHAT_MODEL_COOKIE);
    const chat = modelConfig(chatRaw == null ? null : parseJson(chatRaw));
    const work = modelConfig(storage(WORK_MODEL_STORAGE), storage(WORK_EFFORT_STORAGE));
    const conversation = location.conversationToken
      ? conversationConfigs.get(location.conversationToken) || null
      : null;
    let expected = null;
    let expectedSource = null;
    if (location.conversationToken) {
      expected = conversation;
      expectedSource = conversation
        ? 'conversation_detail_current_branch'
        : 'conversation_detail_not_observed';
    } else if (surface.effective === 'work') {
      expected = work;
      expectedSource = 'work_local_storage';
    } else if (surface.effective === 'chatgpt') {
      expected = chat;
      expectedSource = 'new_chat_cookie';
    }
    return {
      newChatCookie: chat,
      workLocalStorage: work,
      conversationCurrentBranch: conversation,
      expected,
      expectedSource,
      expectedGpt56: Boolean(
        expected?.modelSlug
        && expected?.thinkingEffort
        && isGpt56(expected.modelSlug)
      )
    };
  }

  function menuButtonSummary(button) {
    if (!(button instanceof HTMLButtonElement)) return null;
    return {
      dataTestId: button.getAttribute('data-testid') || null,
      ariaExpanded: button.getAttribute('aria-expanded') || null,
      knownPerformance: knownPerformance(button),
      explicitModelVersion: explicitModelVersion(button.textContent || ''),
      richApplied: button.getAttribute('data-arcaia-model-rich') === 'true',
      richModelVersion: button.getAttribute('data-arcaia-model-version') || null,
      richPerformance: button.getAttribute('data-arcaia-model-performance') || null,
      childElementCount: button.children?.length || 0
    };
  }

  function pickerItemSummary(item) {
    if (!(item instanceof Element)) return null;
    return {
      role: item.getAttribute('role') || null,
      ariaChecked: item.getAttribute('aria-checked') || null,
      dataState: item.getAttribute('data-state') || null,
      dataTestId: item.getAttribute('data-testid') || null,
      knownPerformance: knownPerformance(item),
      explicitModelVersion: explicitModelVersion(item.textContent || '')
    };
  }

  function modelSnapshot(location) {
    const surface = surfaceSnapshot();
    const authority = authoritySnapshot(location, surface);
    const composers = Array.from(document.querySelectorAll(COMPOSER));
    const pickers = Array.from(document.querySelectorAll(PICKER));
    const menuButtons = composers.flatMap((composer) => (
      Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]'))
    ));
    const richButtons = Array.from(document.querySelectorAll(MODEL_RICH));
    const candidateButtons = menuButtons.filter((button) => (
      knownPerformance(button) || explicitModelVersion(button.textContent || '')
    ));
    return {
      surface,
      authority,
      composerCount: composers.length,
      pickerCount: pickers.length,
      visiblePickerCount: pickers.filter((picker) => {
        const menu = picker.closest?.('[role="menu"]');
        return picker.isConnected && !picker.hidden && menu?.getAttribute?.('data-state') !== 'closed';
      }).length,
      composerMenuButtonCount: menuButtons.length,
      candidateTriggerCount: candidateButtons.length,
      richAppliedCount: richButtons.length,
      decorationMissing: Boolean(
        authority.expectedGpt56
        && composers.length
        && richButtons.length === 0
      ),
      menuButtons: menuButtons.slice(0, 16).map(menuButtonSummary),
      pickerItems: pickers.slice(0, 3).flatMap((picker) => (
        Array.from(picker.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'))
          .slice(0, 20)
          .map(pickerItemSummary)
      ))
    };
  }

  function messageId(roleElement) {
    return roleElement.getAttribute('data-message-id')
      || roleElement.closest?.('[data-message-id]')?.getAttribute?.('data-message-id')
      || null;
  }

  function timestampSnapshot(location) {
    const roleNodes = Array.from(document.querySelectorAll(MESSAGE_ROLES));
    const badges = Array.from(document.querySelectorAll(TIME_BADGE));
    const provisional = Array.from(document.querySelectorAll(TIME_PROVISIONAL));
    const messages = roleNodes.slice(-30).map((roleElement) => {
      const scope = roleElement.closest?.(
        'section[data-turn], section[data-testid^="conversation-turn-"], article, [data-message-id]'
      ) || roleElement.parentElement || roleElement;
      const badge = scope?.querySelector?.(TIME_BADGE) || null;
      const rawMessageId = messageId(roleElement);
      const rawBadgeMessageId = badge?.getAttribute?.('data-arcaia-message-id')
        || badge?.dataset?.arcaiaMessageId
        || null;
      return {
        role: roleElement.getAttribute('data-message-author-role') || null,
        messageToken: token('message', rawMessageId),
        hasMessageId: Boolean(rawMessageId),
        hasBadge: Boolean(badge),
        provisional: badge?.getAttribute?.('data-arcaia-timestamp-provisional') === 'true',
        badgeSource: badge?.dataset?.arcaiaTimestampSource || null,
        badgeMessageToken: token('message', rawBadgeMessageId)
      };
    });
    return {
      conversationToken: location.conversationToken,
      roleCount: roleNodes.length,
      userRoleCount: roleNodes.filter((node) => node.getAttribute('data-message-author-role') === 'user').length,
      assistantRoleCount: roleNodes.filter((node) => node.getAttribute('data-message-author-role') === 'assistant').length,
      messageIdPresentCount: roleNodes.filter((node) => Boolean(messageId(node))).length,
      badgeCount: badges.length,
      provisionalBadgeCount: provisional.length,
      authoritativeBadgeCount: badges.length - provisional.length,
      appliedContainerCount: document.querySelectorAll(TIME_APPLIED).length,
      allBadgesProvisional: Boolean(badges.length && badges.length === provisional.length),
      messages
    };
  }

  function buildSnapshot() {
    const location = locationSnapshot();
    return {
      location,
      timestamp: timestampSnapshot(location),
      model: modelSnapshot(location)
    };
  }

  function push(record) {
    records.push({ atMs: elapsedMs(), ...record });
    if (records.length > MAX_RECORDS) {
      droppedRecordCount += records.length - MAX_RECORDS;
      records.splice(0, records.length - MAX_RECORDS);
    }
  }

  function captureSnapshot(reason = 'snapshot', force = false) {
    if (stopped) return false;
    const snapshot = buildSnapshot();
    const signature = JSON.stringify(snapshot);
    if (!force && signature === lastSignature) return false;
    lastSnapshot = snapshot;
    lastSignature = signature;
    snapshotChangeCount += 1;
    push({ type: 'snapshot', reason, snapshot });
    return true;
  }

  function queueSnapshot(reason) {
    if (stopped) return;
    pendingSnapshotReason = reason;
    if (snapshotQueued) return;
    snapshotQueued = true;
    queueMicrotask(() => {
      snapshotQueued = false;
      const nextReason = pendingSnapshotReason || 'dom_signal';
      pendingSnapshotReason = null;
      captureSnapshot(nextReason);
    });
  }

  function settle(reason) {
    queueSnapshot(reason + ':microtask');
    for (const delay of [50, 250, 1000]) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        captureSnapshot(reason + ':' + String(delay) + 'ms');
      }, delay);
      timers.add(timer);
    }
  }

  function timestampIndexResult(payload) {
    const index = payload?.messageTimestampIndex || payload?.index || null;
    return {
      ok: Boolean(payload?.ok),
      updateCount: Number(payload?.updateCount) || 0,
      indexPresent: Boolean(index),
      indexOk: Boolean(index?.ok),
      indexConversationToken: token('conversation', index?.conversationId),
      indexMessageCount: Number(index?.messageCount) || 0,
      indexSource: text(index?.source).slice(0, 100) || null,
      indexError: safeText(index?.error)
    };
  }

  function handleProtocol(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || (data.source !== MAIN_SOURCE && data.source !== CONTENT_SOURCE)) return;
    const requestToken = token('request', data.requestId);

    if (data.source === CONTENT_SOURCE) {
      if (!['GET_MESSAGE_TIMESTAMP_INDEX', 'SYNC_PAGE_CONVERSATION'].includes(data.type)) return;
      protocolRequestCount += 1;
      if (data.requestId) requestStartedAt.set(String(data.requestId), performance.now());
      push({
        type: 'protocol_request',
        requestType: data.type,
        requestToken,
        reason: safeText(data.payload?.reason, 100),
        requestedConversationToken: token('conversation', data.payload?.conversationId),
        location: locationSnapshot()
      });
      settle('protocol_request:' + data.type);
      return;
    }

    if (data.type === 'AICE_MAIN_EVENT') {
      const eventType = data.eventType || data.payload?.event || null;
      const payload = data.payload || {};
      if (eventType === 'message_timestamp_index_updated') {
        timestampIndexEventCount += 1;
        push({
          type: 'main_event',
          eventType,
          reason: safeText(payload.reason, 100),
          conversationToken: token('conversation', payload.conversationId),
          messageCount: Number(payload.messageCount) || 0,
          updateCount: Number(payload.updateCount) || 0,
          location: locationSnapshot()
        });
        settle('main_event:' + eventType);
        return;
      }
      if (eventType === 'current_conversation_model_config') {
        conversationModelEventCount += 1;
        const conversationToken = token('conversation', payload.conversationId);
        const config = {
          ...modelConfig(payload),
          source: text(payload.source || 'conversation_detail_current_branch').slice(0, 100),
          selectedMessageDistanceFromLeaf: Number.isFinite(Number(payload.selectedMessageDistanceFromLeaf))
            ? Number(payload.selectedMessageDistanceFromLeaf)
            : null,
          currentNodeUsed: Boolean(payload.currentNodeUsed),
          reason: safeText(payload.reason, 100)
        };
        if (conversationToken) conversationConfigs.set(conversationToken, config);
        push({ type: 'main_event', eventType, conversationToken, config, location: locationSnapshot() });
        settle('main_event:' + eventType);
        return;
      }
      if (eventType === 'page_navigation') {
        push({
          type: 'main_event',
          eventType,
          reason: safeText(payload.reason, 100),
          location: locationSnapshot()
        });
        settle('main_event:' + eventType);
      }
      return;
    }

    if (!['MESSAGE_TIMESTAMP_INDEX_RESULT', 'PAGE_CONVERSATION_SYNC_RESULT'].includes(data.type)) return;
    protocolResponseCount += 1;
    const started = data.requestId ? requestStartedAt.get(String(data.requestId)) : null;
    const latencyMs = Number.isFinite(started)
      ? Math.round((performance.now() - started) * 10) / 10
      : null;
    const result = data.type === 'MESSAGE_TIMESTAMP_INDEX_RESULT'
      ? timestampIndexResult(data.payload || {})
      : {
          ok: Boolean(data.payload?.ok),
          changed: Boolean(data.payload?.changed),
          skipped: Boolean(data.payload?.skipped),
          reason: safeText(data.payload?.reason, 100),
          conversationToken: token(
            'conversation',
            data.payload?.conversationId || data.payload?.currentConversationId
          ),
          configuredConversationToken: token(
            'conversation',
            data.payload?.configuredConversationId || data.payload?.liteDisplay?.conversationId
          ),
          mismatch: Boolean(data.payload?.conversationIdMismatch || data.payload?.mismatch)
        };
    push({
      type: 'protocol_response',
      responseType: data.type,
      requestToken,
      latencyMs,
      result,
      location: locationSnapshot()
    });
    settle('protocol_response:' + data.type);
  }

  function nodeRelevant(node) {
    return node instanceof Element && Boolean(
      node.matches?.(RELEVANT_SELECTOR) || node.querySelector?.(RELEVANT_SELECTOR)
    );
  }

  function mutationRelevant(mutation) {
    if (mutation.type === 'attributes') {
      const target = mutation.target instanceof Element ? mutation.target : null;
      return Boolean(
        target?.matches?.(RELEVANT_SELECTOR)
        || target?.closest?.(COMPOSER)
        || target?.closest?.(PICKER)
      );
    }
    return [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])]
      .some(nodeRelevant);
  }

  function handleMutations(mutations) {
    const relevant = Array.from(mutations || []).filter(mutationRelevant);
    if (!relevant.length) return;
    relevantMutationCallbackCount += 1;
    push({
      type: 'dom_signal',
      recordCount: relevant.length,
      attributes: Array.from(new Set(
        relevant.map((mutation) => mutation.attributeName).filter(Boolean)
      )).slice(0, 16)
    });
    queueSnapshot('relevant_dom_mutation');
  }

  function interactionSummary(target) {
    if (!(target instanceof Element)) return null;
    const surfaceButton = target.closest?.('button[role="radio"]');
    if (surfaceButton) {
      const label = text(surfaceButton.textContent || '').toLowerCase();
      return {
        kind: 'surface_radio',
        surface: label === 'work' ? 'work' : label === 'chat' ? 'chatgpt' : null,
        dataState: surfaceButton.getAttribute('data-state') || null
      };
    }
    const pickerItem = target.closest?.('[role="menuitem"], [role="menuitemradio"]');
    if (pickerItem?.closest?.(PICKER)) {
      return { kind: 'picker_item', item: pickerItemSummary(pickerItem) };
    }
    const menuButton = target.closest?.('button[aria-haspopup="menu"]');
    if (menuButton?.closest?.(COMPOSER)) {
      return { kind: 'composer_menu_button', button: menuButtonSummary(menuButton) };
    }
    return null;
  }

  function handleUiEvent(event) {
    const interaction = interactionSummary(
      event.target instanceof Element ? event.target : null
    );
    if (!interaction) return;
    push({ type: 'interaction', eventType: event.type, interaction });
    settle('interaction:' + event.type);
  }

  function handleNavigation(event) {
    push({ type: 'navigation_signal', eventType: event.type, location: locationSnapshot() });
    settle('navigation_signal:' + event.type);
  }

  function handleStorage(event) {
    const key = String(event?.key || '');
    if (![SURFACE_STORAGE, WORK_MODEL_STORAGE, WORK_EFFORT_STORAGE].includes(key)) return;
    push({ type: 'storage_signal', key });
    settle('storage_signal:' + key);
  }

  function handleError(event) {
    errorCount += 1;
    push({
      type: 'window_error',
      message: safeText(event?.message || event?.error?.message),
      filenameOmitted: true,
      line: Number(event?.lineno) || null,
      column: Number(event?.colno) || null
    });
  }

  function handleRejection(event) {
    errorCount += 1;
    push({
      type: 'unhandled_rejection',
      reason: safeText(event?.reason?.message || event?.reason)
    });
  }

  function report() {
    return {
      schemaVersion: 1,
      probe: 'arcaia-timestamp-model-selector-transition',
      diagnosticOnly: true,
      warning: 'This probe intentionally uses a document-root observer, settle timers, and a 1-second watchdog. Do not copy them into Debug-OFF runtime code.',
      privacy: {
        conversationTextCollected: false,
        rawUrlsCollected: false,
        rawConversationIdsCollected: false,
        rawMessageIdsCollected: false,
        rawRequestIdsCollected: false,
        rawCookieValuesCollected: false,
        rawStorageValuesCollected: false,
        modelSlugAndThinkingEffortCollected: true
      },
      startedAt: startedAtIso,
      durationMs: elapsedMs(),
      stopped,
      watchdogIntervalMs: WATCHDOG_MS,
      counters: {
        snapshotChangeCount,
        protocolRequestCount,
        protocolResponseCount,
        timestampIndexEventCount,
        conversationModelEventCount,
        relevantMutationCallbackCount,
        errorCount,
        droppedRecordCount
      },
      currentSnapshot: stopped ? lastSnapshot : buildSnapshot(),
      records: records.slice()
    };
  }

  function stop() {
    if (stopped) return report();
    captureSnapshot('before_stop', true);
    stopped = true;
    observer?.disconnect?.();
    observer = null;
    if (watchdog) clearInterval(watchdog);
    watchdog = null;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    document.removeEventListener('click', handleUiEvent, true);
    document.removeEventListener('menu.itemSelect', handleUiEvent, true);
    window.removeEventListener('popstate', handleNavigation);
    window.removeEventListener('hashchange', handleNavigation);
    window.removeEventListener('pageshow', handleNavigation);
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener('message', handleProtocol);
    window.removeEventListener('error', handleError, true);
    window.removeEventListener('unhandledrejection', handleRejection, true);
    push({ type: 'stopped' });
    return report();
  }

  function download() {
    const output = stop();
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = objectUrl;
    anchor.download = 'arcaia-timestamp-model-selector-transition-probe-' + timestamp + '.json';
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    return output;
  }

  observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'data-message-author-role',
      'data-message-id',
      'data-arcaia-message-time-badge',
      'data-arcaia-message-time-applied',
      'data-arcaia-timestamp-provisional',
      'data-arcaia-model-rich',
      'data-arcaia-model-version',
      'data-arcaia-model-performance',
      'data-state',
      'aria-checked',
      'aria-expanded',
      'aria-controls'
    ]
  });
  document.addEventListener('click', handleUiEvent, true);
  document.addEventListener('menu.itemSelect', handleUiEvent, true);
  window.addEventListener('popstate', handleNavigation);
  window.addEventListener('hashchange', handleNavigation);
  window.addEventListener('pageshow', handleNavigation);
  window.addEventListener('storage', handleStorage);
  window.addEventListener('message', handleProtocol);
  window.addEventListener('error', handleError, true);
  window.addEventListener('unhandledrejection', handleRejection, true);
  watchdog = setInterval(() => captureSnapshot('watchdog'), WATCHDOG_MS);

  window[API_KEY] = Object.freeze({
    report,
    snapshot: () => captureSnapshot('manual', true),
    stop,
    download
  });
  captureSnapshot('installed', true);
  console.info(
    '[Arcaia] Timestamp/model-selector transition probe installed. '
    + 'Reproduce a conversation switch and the Work model-decoration failure, then run '
    + 'window.' + API_KEY + '.download()'
  );
})();
