(() => {
  'use strict';

  const API_KEY = '__ARCAIA_MODEL_SELECTOR_THINKING_LEVEL_PROBE__';
  const MAIN_SOURCE = 'aice-probe-main-v159';
  const MAX_RECORDS = 900;
  const WATCHDOG_MS = 500;
  const COMPOSER = 'form[data-type="unified-composer"]';
  const PICKER = '[data-testid="composer-intelligence-picker-content"]';
  const SLIDER = '[role="slider"], input[type="range"]';
  const SLIDER_PART = [
    '[data-slot="slider"]',
    '[data-slot="slider-thumb"]',
    '[data-slot="slider-track"]',
    '[data-slot="slider-range"]'
  ].join(', ');
  const MENU_ITEM = '[role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"]';
  const WORK_MODEL_STORAGE = 'oai/apps/tpp/model-settings';
  const WORK_EFFORT_STORAGE = 'oai/apps/tpp/thinking-effort';
  const SURFACE_STORAGE = 'oai/apps/tpp/chat-surface-mode';
  const CHAT_MODEL_COOKIE = 'oai-last-model-config';
  const SURFACE_COOKIE = 'oai-chat-surface-mode';
  const PERFORMANCE_LABELS = new Set([
    '軽', '最速', '中程度', '高い', '非常に高い', '最大',
    'Light', 'Fastest', 'Medium', 'High', 'Very high', 'Maximum'
  ]);
  const DETAIL_LABELS = new Set(['詳細設定', 'Advanced settings']);
  const RELEVANT_SELECTOR = [
    COMPOSER,
    PICKER,
    SLIDER,
    SLIDER_PART,
    '[role="menu"]',
    MENU_ITEM,
    'button[aria-haspopup="menu"]',
    'button[data-arcaia-model-rich="true"]'
  ].join(', ');

  if (window[API_KEY]?.stop) {
    try { window[API_KEY].stop(); } catch {}
  }

  const startedAt = performance.now();
  const startedAtIso = new Date().toISOString();
  const records = [];
  const timers = new Set();
  const nodeTokens = new WeakMap();
  const valueTokens = new Map();
  const tokenCounters = new Map();
  let stopped = false;
  let observer = null;
  let watchdog = null;
  let snapshotQueued = false;
  let pendingSnapshotReason = null;
  let lastSnapshot = null;
  let lastSignature = '';
  let droppedRecordCount = 0;
  let snapshotChangeCount = 0;
  let relevantMutationCallbackCount = 0;
  let interactionCount = 0;
  let storageChangeCount = 0;
  let modelConfigEventCount = 0;
  let errorCount = 0;

  function elapsedMs() {
    return Math.round((performance.now() - startedAt) * 10) / 10;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseJson(raw) {
    try { return JSON.parse(String(raw ?? '')); } catch { return null; }
  }

  function token(kind, rawValue) {
    if (rawValue == null || rawValue === '') return null;
    const raw = String(rawValue);
    const key = kind + '\u0000' + raw;
    if (!valueTokens.has(key)) {
      const next = (tokenCounters.get(kind) || 0) + 1;
      tokenCounters.set(kind, next);
      valueTokens.set(key, kind + '-' + String(next));
    }
    return valueTokens.get(key);
  }

  function nodeToken(node) {
    if (!(node instanceof Element)) return null;
    if (!nodeTokens.has(node)) {
      const next = (tokenCounters.get('node') || 0) + 1;
      tokenCounters.set('node', next);
      nodeTokens.set(node, 'node-' + String(next));
    }
    return nodeTokens.get(node);
  }

  function safeError(value, limit = 180) {
    return normalizeText(value)
      .replace(/https?:\/\/\S+/gi, '<url>')
      .replace(/\/c\/[^/?#\s]+/gi, '/c/<conversation>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
      .slice(0, limit) || null;
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

  function cookie(name) {
    try {
      const escaped = String(name).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
      const match = String(document.cookie || '').match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function modelConfig(config, effortOverride = null) {
    const modelSlug = normalizeText(
      config?.model
      || config?.modelSlug
      || config?.model_slug
      || config?.lastUsedModelSlug
      || config?.last_used_model_slug
      || ''
    );
    const thinkingEffort = normalizeText(
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

  function explicitModelVersion(value) {
    const match = normalizeText(value).match(/\bGPT[-\u2011\u2013\s]?(\d+(?:\.\d+)?)\b/i);
    return match ? 'GPT-' + match[1] : null;
  }

  function knownPerformance(value) {
    const normalized = normalizeText(value);
    if (PERFORMANCE_LABELS.has(normalized)) return normalized;
    for (const label of PERFORMANCE_LABELS) {
      if (normalized === label || normalized.startsWith(label + ' ')) return label;
    }
    return null;
  }

  function knownDetailLabel(value) {
    const normalized = normalizeText(value);
    for (const label of DETAIL_LABELS) {
      if (normalized === label || normalized.startsWith(label + ' ')) return label;
    }
    return null;
  }

  function numericAttribute(element, name) {
    const raw = element?.getAttribute?.(name);
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : String(raw).slice(0, 40);
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected || element.hidden) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    return Boolean(element.getClientRects?.().length);
  }

  function classTokens(element) {
    if (!(element instanceof Element)) return [];
    return Array.from(element.classList || [])
      .filter((name) => /^[a-z0-9_!:@/.[\]-]{1,80}$/i.test(name))
      .slice(0, 16);
  }

  function relationshipSummary(element) {
    if (!(element instanceof Element)) return null;
    const menu = element.closest?.('[role="menu"]') || null;
    const picker = element.closest?.(PICKER) || null;
    const composer = element.closest?.(COMPOSER) || null;
    const labelledBy = menu?.getAttribute?.('aria-labelledby') || null;
    const controllingTrigger = labelledBy ? document.getElementById(labelledBy) : null;
    return {
      parentToken: nodeToken(element.parentElement),
      menuToken: nodeToken(menu),
      pickerToken: nodeToken(picker),
      composerToken: nodeToken(composer),
      menuLabelledByToken: token('dom-id', labelledBy),
      controllingTriggerToken: nodeToken(controllingTrigger)
    };
  }

  function ancestorChain(element, limit = 7) {
    const chain = [];
    let current = element instanceof Element ? element.parentElement : null;
    while (current && chain.length < limit) {
      chain.push({
        nodeToken: nodeToken(current),
        tag: current.tagName.toLowerCase(),
        role: current.getAttribute('role') || null,
        dataTestId: current.getAttribute('data-testid') || null,
        dataSlot: current.getAttribute('data-slot') || null,
        isMenu: current.matches?.('[role="menu"]') || false,
        isPicker: current.matches?.(PICKER) || false,
        isComposer: current.matches?.(COMPOSER) || false,
        classTokens: classTokens(current).slice(0, 8)
      });
      if (current.matches?.('[role="menu"]') || current.matches?.(COMPOSER)) break;
      current = current.parentElement;
    }
    return chain;
  }

  function inlinePositionSignal(element) {
    if (!(element instanceof HTMLElement)) return null;
    return {
      left: String(element.style.left || '').slice(0, 80) || null,
      right: String(element.style.right || '').slice(0, 80) || null,
      width: String(element.style.width || '').slice(0, 80) || null,
      transform: String(element.style.transform || '').slice(0, 120) || null,
      translate: String(element.style.translate || '').slice(0, 80) || null
    };
  }

  function sliderSummary(element) {
    if (!(element instanceof Element)) return null;
    const input = element instanceof HTMLInputElement && element.type === 'range' ? element : null;
    const ariaValueText = normalizeText(element.getAttribute('aria-valuetext') || '');
    return {
      nodeToken: nodeToken(element),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || null,
      inputType: input?.type || null,
      visible: isVisible(element),
      value: input ? String(input.value || '').slice(0, 40) || null : null,
      min: input ? String(input.min || '').slice(0, 40) || null : numericAttribute(element, 'aria-valuemin'),
      max: input ? String(input.max || '').slice(0, 40) || null : numericAttribute(element, 'aria-valuemax'),
      step: input ? String(input.step || '').slice(0, 40) || null : null,
      ariaValueNow: numericAttribute(element, 'aria-valuenow'),
      ariaValueText: knownPerformance(ariaValueText),
      ariaLabel: knownDetailLabel(element.getAttribute('aria-label') || '')
        || knownPerformance(element.getAttribute('aria-label') || ''),
      dataTestId: element.getAttribute('data-testid') || null,
      dataSlot: element.getAttribute('data-slot') || null,
      dataState: element.getAttribute('data-state') || null,
      orientation: element.getAttribute('aria-orientation') || element.getAttribute('data-orientation') || null,
      classTokens: classTokens(element),
      inlinePosition: inlinePositionSignal(element),
      childElementCount: element.children?.length || 0,
      relationships: relationshipSummary(element),
      ancestorChain: ancestorChain(element)
    };
  }

  function sliderPartSummary(element) {
    if (!(element instanceof Element)) return null;
    return {
      nodeToken: nodeToken(element),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || null,
      dataSlot: element.getAttribute('data-slot') || null,
      visible: isVisible(element),
      inlinePosition: inlinePositionSignal(element),
      relationships: relationshipSummary(element),
      ancestorChain: ancestorChain(element)
    };
  }

  function itemSummary(element) {
    if (!(element instanceof Element)) return null;
    return {
      nodeToken: nodeToken(element),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || null,
      visible: isVisible(element),
      ariaChecked: element.getAttribute('aria-checked') || null,
      ariaSelected: element.getAttribute('aria-selected') || null,
      dataState: element.getAttribute('data-state') || null,
      ariaExpanded: element.getAttribute('aria-expanded') || null,
      dataTestId: element.getAttribute('data-testid') || null,
      dataSlot: element.getAttribute('data-slot') || null,
      knownPerformance: knownPerformance(element.textContent || ''),
      detailLabel: knownDetailLabel(element.textContent || ''),
      explicitModelVersion: explicitModelVersion(element.textContent || ''),
      relationships: relationshipSummary(element)
    };
  }

  function menuSummary(menu) {
    if (!(menu instanceof Element)) return null;
    const items = Array.from(menu.querySelectorAll(MENU_ITEM));
    const sliders = Array.from(menu.querySelectorAll(SLIDER));
    const relevantItems = items.filter((item) => (
      knownPerformance(item.textContent || '')
      || knownDetailLabel(item.textContent || '')
      || explicitModelVersion(item.textContent || '')
      || item.getAttribute('aria-checked') != null
    ));
    return {
      nodeToken: nodeToken(menu),
      visible: isVisible(menu),
      dataState: menu.getAttribute('data-state') || null,
      dataSide: menu.getAttribute('data-side') || null,
      ariaLabelledByToken: token('dom-id', menu.getAttribute('aria-labelledby')),
      classTokens: classTokens(menu),
      itemCount: items.length,
      sliderCount: sliders.length,
      relevantItems: relevantItems.slice(0, 24).map(itemSummary),
      sliders: sliders.slice(0, 8).map(sliderSummary)
    };
  }

  function buttonSummary(button) {
    if (!(button instanceof HTMLButtonElement)) return null;
    return {
      nodeToken: nodeToken(button),
      visible: isVisible(button),
      dataTestId: button.getAttribute('data-testid') || null,
      dataSlot: button.getAttribute('data-slot') || null,
      ariaHaspopup: button.getAttribute('aria-haspopup') || null,
      ariaExpanded: button.getAttribute('aria-expanded') || null,
      ariaControlsToken: token('dom-id', button.getAttribute('aria-controls')),
      dataState: button.getAttribute('data-state') || null,
      knownPerformance: knownPerformance(button.textContent || ''),
      detailLabel: knownDetailLabel(button.textContent || ''),
      explicitModelVersion: explicitModelVersion(button.textContent || ''),
      richApplied: button.getAttribute('data-arcaia-model-rich') === 'true',
      richModelVersion: button.getAttribute('data-arcaia-model-version') || null,
      richPerformance: button.getAttribute('data-arcaia-model-performance') || null,
      childElementCount: button.children?.length || 0,
      relationships: relationshipSummary(button)
    };
  }

  function surfaceSnapshot() {
    const active = Array.from(document.querySelectorAll('button[role="radio"][data-state="on"]'))
      .find((button) => /^(Chat|Work)$/i.test(normalizeText(button.textContent || ''))) || null;
    const label = normalizeText(active?.textContent || '').toLowerCase();
    const normalize = (value) => {
      const text = normalizeText(value).toLowerCase();
      return text === 'work' || text === 'chatgpt' ? text : null;
    };
    return {
      dom: label === 'work' ? 'work' : label === 'chat' ? 'chatgpt' : null,
      storage: normalize(storage(SURFACE_STORAGE)),
      cookie: normalize(cookie(SURFACE_COOKIE))
    };
  }

  function authoritySnapshot() {
    const chatRaw = cookie(CHAT_MODEL_COOKIE);
    return {
      newChatCookie: modelConfig(chatRaw == null ? null : parseJson(chatRaw)),
      workLocalStorage: modelConfig(storage(WORK_MODEL_STORAGE), storage(WORK_EFFORT_STORAGE))
    };
  }

  function arcaiaSnapshot() {
    try {
      const status = window.__ARCAIA_MODEL_SELECTOR_UI__?.getStatus?.() || null;
      if (!status) return null;
      return {
        started: Boolean(status.started),
        modelVersion: normalizeText(status.modelVersion).slice(0, 40) || null,
        modelLabel: explicitModelVersion(status.modelLabel || ''),
        performance: knownPerformance(status.performance || ''),
        thinkingEffort: normalizeText(status.thinkingEffort).slice(0, 40) || null,
        modelSource: normalizeText(status.modelSource).slice(0, 100) || null,
        triggerApplied: Boolean(status.triggerApplied),
        pickerObserved: Boolean(status.pickerObserved),
        lastReason: normalizeText(status.lastReason).slice(0, 120) || null,
        lastScanResult: {
          outcome: normalizeText(status.diagnosticSnapshot?.lastScanResult?.outcome).slice(0, 80) || null,
          reason: normalizeText(status.diagnosticSnapshot?.lastScanResult?.reason).slice(0, 120) || null,
          contextKind: normalizeText(status.diagnosticSnapshot?.lastScanResult?.contextKind).slice(0, 80) || null
        },
        resolvedContext: {
          contextKind: normalizeText(status.diagnosticSnapshot?.lastResolvedContext?.contextKind).slice(0, 80) || null,
          activeSurfaceMode: normalizeText(status.diagnosticSnapshot?.lastResolvedContext?.activeSurfaceMode).slice(0, 40) || null,
          modelSource: normalizeText(status.diagnosticSnapshot?.lastResolvedContext?.modelSource).slice(0, 100) || null,
          modelLabel: explicitModelVersion(status.diagnosticSnapshot?.lastResolvedContext?.modelLabel || ''),
          thinkingEffort: normalizeText(status.diagnosticSnapshot?.lastResolvedContext?.thinkingEffort).slice(0, 40) || null
        }
      };
    } catch (error) {
      return { error: safeError(error instanceof Error ? error.message : error) };
    }
  }

  function buildSnapshot() {
    const composers = Array.from(document.querySelectorAll(COMPOSER));
    const composerButtons = composers.flatMap((composer) => (
      Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]'))
    ));
    const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter((menu) => {
      if (menu.querySelector(SLIDER)) return true;
      if (menu.querySelector(PICKER)) return true;
      return Array.from(menu.querySelectorAll(MENU_ITEM)).some((item) => (
        knownPerformance(item.textContent || '')
        || knownDetailLabel(item.textContent || '')
        || explicitModelVersion(item.textContent || '')
      ));
    });
    const sliders = Array.from(document.querySelectorAll(SLIDER));
    const sliderParts = Array.from(document.querySelectorAll(SLIDER_PART));
    const richButtons = Array.from(document.querySelectorAll('button[data-arcaia-model-rich="true"]'));
    return {
      surface: surfaceSnapshot(),
      authority: authoritySnapshot(),
      composerCount: composers.length,
      pickerCount: document.querySelectorAll(PICKER).length,
      relevantMenuCount: menus.length,
      sliderCount: sliders.length,
      visibleSliderCount: sliders.filter(isVisible).length,
      sliderPartCount: sliderParts.length,
      richButtonCount: richButtons.length,
      composerButtons: composerButtons.slice(0, 16).map(buttonSummary),
      menus: menus.slice(0, 12).map(menuSummary),
      sliders: sliders.slice(0, 12).map(sliderSummary),
      sliderParts: sliderParts.slice(0, 24).map(sliderPartSummary),
      arcaia: arcaiaSnapshot()
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
      const nextReason = pendingSnapshotReason || 'queued';
      pendingSnapshotReason = null;
      captureSnapshot(nextReason);
    });
  }

  function settle(reason) {
    queueSnapshot(reason + ':microtask');
    for (const delay of [30, 100, 300, 1000]) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        captureSnapshot(reason + ':' + String(delay) + 'ms');
      }, delay);
      timers.add(timer);
    }
  }

  function interactionSummary(target) {
    if (!(target instanceof Element)) return null;
    const nearestSliderPart = target.closest?.(SLIDER_PART) || null;
    const slider = target.closest?.(SLIDER)
      || nearestSliderPart?.querySelector?.(SLIDER)
      || nearestSliderPart;
    if (slider) return { kind: 'thinking_slider', slider: sliderSummary(slider) };
    const item = target.closest?.(MENU_ITEM);
    if (item && (
      knownPerformance(item.textContent || '')
      || knownDetailLabel(item.textContent || '')
      || explicitModelVersion(item.textContent || '')
      || item.getAttribute('aria-checked') != null
    )) return { kind: 'relevant_menu_item', item: itemSummary(item) };
    const button = target.closest?.('button');
    if (button && (
      button.closest?.(COMPOSER)
      || knownDetailLabel(button.textContent || '')
      || knownPerformance(button.textContent || '')
    )) return { kind: 'relevant_button', button: buttonSummary(button) };
    return null;
  }

  function handleUiEvent(event) {
    const interaction = interactionSummary(event.target instanceof Element ? event.target : null);
    if (!interaction) return;
    interactionCount += 1;
    push({
      type: 'interaction',
      eventType: event.type,
      key: event.type === 'keydown' ? String(event.key || '').slice(0, 30) || null : null,
      interaction
    });
    settle('interaction:' + event.type + ':' + interaction.kind);
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
        || target?.closest?.(PICKER)
        || target?.closest?.('[role="menu"]')
        || target?.closest?.(COMPOSER)
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
      )).slice(0, 20),
      targets: relevant.slice(0, 8).map((mutation) => {
        const target = mutation.target instanceof Element ? mutation.target : null;
        return target ? {
          nodeToken: nodeToken(target),
          tag: target.tagName.toLowerCase(),
          role: target.getAttribute('role') || null,
          isSlider: target.matches?.(SLIDER) || false,
          inMenu: Boolean(target.closest?.('[role="menu"]')),
          inPicker: Boolean(target.closest?.(PICKER)),
          inComposer: Boolean(target.closest?.(COMPOSER))
        } : null;
      }).filter(Boolean)
    });
    queueSnapshot('relevant_dom_mutation');
  }

  function handleStorage(event) {
    const key = String(event?.key || '');
    if (![SURFACE_STORAGE, WORK_MODEL_STORAGE, WORK_EFFORT_STORAGE].includes(key)) return;
    storageChangeCount += 1;
    push({ type: 'storage_signal', key });
    settle('storage_signal:' + key);
  }

  function handleProtocol(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== MAIN_SOURCE || data.type !== 'AICE_MAIN_EVENT') return;
    const eventType = data.eventType || data.payload?.event || null;
    if (eventType !== 'current_conversation_model_config') return;
    modelConfigEventCount += 1;
    push({
      type: 'main_event',
      eventType,
      conversationToken: token('conversation', data.payload?.conversationId),
      config: {
        ...modelConfig(data.payload || {}),
        source: normalizeText(data.payload?.source).slice(0, 100) || null,
        reason: normalizeText(data.payload?.reason).slice(0, 100) || null
      }
    });
    settle('main_event:' + eventType);
  }

  function handleError(event) {
    errorCount += 1;
    push({
      type: 'window_error',
      message: safeError(event?.message || event?.error?.message),
      filenameOmitted: true
    });
  }

  function handleRejection(event) {
    errorCount += 1;
    push({ type: 'unhandled_rejection', reason: safeError(event?.reason?.message || event?.reason) });
  }

  function report() {
    return {
      schemaVersion: 1,
      probe: 'arcaia-model-selector-thinking-level',
      diagnosticOnly: true,
      warning: 'This probe intentionally uses a document-root observer, short settle timers, a 500ms watchdog, layout visibility checks, and Arcaia diagnostic snapshots. Do not copy them into Debug-OFF runtime code.',
      privacy: {
        conversationTextCollected: false,
        arbitraryMenuTextCollected: false,
        rawUrlsCollected: false,
        rawConversationIdsCollected: false,
        rawCookieValuesCollected: false,
        rawStorageValuesCollected: false,
        knownModelVersionPerformanceAndThinkingEffortCollected: true,
        domClassTokensCollected: true
      },
      startedAt: startedAtIso,
      durationMs: elapsedMs(),
      stopped,
      watchdogIntervalMs: WATCHDOG_MS,
      counters: {
        snapshotChangeCount,
        relevantMutationCallbackCount,
        interactionCount,
        storageChangeCount,
        modelConfigEventCount,
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
    for (const eventType of ['pointerdown', 'pointerup', 'click', 'input', 'change', 'keydown', 'menu.itemSelect']) {
      document.removeEventListener(eventType, handleUiEvent, true);
    }
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
    anchor.download = 'arcaia-model-selector-thinking-level-probe-' + timestamp + '.json';
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
      'aria-checked',
      'aria-selected',
      'aria-expanded',
      'aria-controls',
      'aria-labelledby',
      'aria-valuenow',
      'aria-valuetext',
      'aria-valuemin',
      'aria-valuemax',
      'value',
      'style',
      'data-state',
      'data-arcaia-model-rich',
      'data-arcaia-model-version',
      'data-arcaia-model-performance'
    ]
  });
  for (const eventType of ['pointerdown', 'pointerup', 'click', 'input', 'change', 'keydown', 'menu.itemSelect']) {
    document.addEventListener(eventType, handleUiEvent, true);
  }
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
    '[Arcaia] Model-selector thinking-level probe installed. '
    + 'Change the thinking-level slider, close and reopen the picker, then run '
    + 'window.' + API_KEY + '.download()'
  );
})();
