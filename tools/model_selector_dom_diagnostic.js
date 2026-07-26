(() => {
  'use strict';

  const API_KEY = '__ARCAIA_MODEL_SELECTOR_DIAG__';
  const MAIN_PROTOCOL_SOURCE = 'aice-probe-main-v159';
  const PICKER_SELECTOR = '[data-testid="composer-intelligence-picker-content"]';
  const COMPOSER_SELECTOR = 'form[data-type="unified-composer"]';
  const CHATGPT_LAST_MODEL_COOKIE = 'oai-last-model-config';
  const WORK_MODEL_SETTINGS_STORAGE_KEY = 'oai/apps/tpp/model-settings';
  const WORK_THINKING_EFFORT_STORAGE_KEY = 'oai/apps/tpp/thinking-effort';
  const PERFORMANCE_LABELS = new Set([
    '軽', '最速', '中程度', '高い', '非常に高い', '最大',
    'Light', 'Fastest', 'Medium', 'High', 'Very high', 'Maximum'
  ]);
  const MAX_RECORDS = 240;
  const startedAt = performance.now();
  const records = [];
  const timers = new Set();
  let stopped = false;
  let latestConversationConfig = null;

  if (window[API_KEY]?.stop) {
    try { window[API_KEY].stop(); } catch {}
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseJsonValue(raw) {
    try {
      return JSON.parse(String(raw ?? ''));
    } catch {
      return null;
    }
  }

  function getCookieValue(name) {
    try {
      const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = String(document.cookie || '').match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function readStorageValue(key) {
    try {
      const raw = window.localStorage?.getItem?.(key);
      if (raw == null) return null;
      const parsed = parseJsonValue(raw);
      return parsed == null ? raw : parsed;
    } catch {
      return null;
    }
  }

  function summarizeModelConfig(config, effortOverride = null) {
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

  function getAuthoritySnapshot() {
    const newChatConfig = parseJsonValue(getCookieValue(CHATGPT_LAST_MODEL_COOKIE));
    const workConfig = readStorageValue(WORK_MODEL_SETTINGS_STORAGE_KEY);
    const workEffort = readStorageValue(WORK_THINKING_EFFORT_STORAGE_KEY);
    return {
      newChatCookie: summarizeModelConfig(newChatConfig),
      workLocalStorage: summarizeModelConfig(workConfig, workEffort),
      conversationCurrentBranch: latestConversationConfig ? { ...latestConversationConfig } : null
    };
  }

  function elapsedMs() {
    return Math.round((performance.now() - startedAt) * 10) / 10;
  }

  function elementSummary(element) {
    if (!(element instanceof Element)) return null;
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      role: element.getAttribute('role'),
      text: normalizeText(element.textContent || '').slice(0, 120),
      ariaChecked: element.getAttribute('aria-checked'),
      ariaExpanded: element.getAttribute('aria-expanded'),
      ariaControls: element.getAttribute('aria-controls'),
      ariaLabelledBy: element.getAttribute('aria-labelledby'),
      dataState: element.getAttribute('data-state'),
      dataTestId: element.getAttribute('data-testid'),
      hasSubmenu: element.hasAttribute('data-has-submenu')
    };
  }

  function getPicker() {
    return Array.from(document.querySelectorAll(PICKER_SELECTOR)).find((picker) => picker.isConnected) || null;
  }

  function getTrigger(picker = getPicker()) {
    const menu = picker?.closest?.('[role="menu"][aria-labelledby]') || null;
    const labelledBy = menu?.getAttribute?.('aria-labelledby');
    const exact = labelledBy ? document.getElementById(labelledBy) : null;
    if (exact instanceof HTMLButtonElement) return exact;

    const composer = document.querySelector(COMPOSER_SELECTOR);
    if (!composer) return null;
    return Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]')).find((button) => {
      const text = normalizeText(button.textContent || '');
      return PERFORMANCE_LABELS.has(text) || /GPT[-\s]?\d+(?:\.\d+)?/i.test(text);
    }) || null;
  }

  function getItems(picker = getPicker()) {
    if (!picker) return [];
    return Array.from(picker.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')).map(elementSummary);
  }

  function push(record) {
    records.push({ atMs: elapsedMs(), ...record });
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  }

  function snapshot(reason) {
    if (stopped) return;
    const picker = getPicker();
    const trigger = getTrigger(picker);
    push({
      type: 'snapshot',
      reason,
      trigger: elementSummary(trigger),
      picker: elementSummary(picker),
      items: getItems(picker),
      authorities: getAuthoritySnapshot()
    });
  }

  function scheduleSnapshots(reason) {
    for (const delay of [0, 10, 30, 60, 120, 250, 500, 1000]) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        snapshot(`${reason}:${delay}ms`);
      }, delay);
      timers.add(timer);
    }
  }

  function relevantTarget(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return null;
    return target.closest('[role="menuitem"], [role="menuitemradio"], button[aria-haspopup="menu"]');
  }

  function handleEvent(event) {
    const target = relevantTarget(event);
    if (!target) return;
    const picker = getPicker();
    const isPickerItem = Boolean(target.closest(PICKER_SELECTOR) || picker?.contains(target));
    const isTrigger = target.matches('button[aria-haspopup="menu"]');
    if (!isPickerItem && !isTrigger) return;
    push({
      type: 'event',
      eventType: event.type,
      target: elementSummary(target),
      defaultPrevented: Boolean(event.defaultPrevented)
    });
    scheduleSnapshots(`event:${event.type}`);
  }

  function handleMainMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== MAIN_PROTOCOL_SOURCE || data.type !== 'AICE_MAIN_EVENT') return;
    if (data.eventType !== 'current_conversation_model_config') return;
    const payload = data.payload || {};
    latestConversationConfig = {
      ...summarizeModelConfig(payload),
      source: normalizeText(payload.source || 'conversation_detail_current_branch').slice(0, 80),
      selectedMessageDistanceFromLeaf: Number.isFinite(Number(payload.selectedMessageDistanceFromLeaf))
        ? Number(payload.selectedMessageDistanceFromLeaf)
        : null,
      currentNodeUsed: Boolean(payload.currentNodeUsed),
      observedAt: Number(payload.observedAt) || Date.now()
    };
    push({
      type: 'authoritative_state_event',
      eventType: data.eventType,
      conversationCurrentBranch: { ...latestConversationConfig }
    });
    scheduleSnapshots('authoritative_state_event');
  }

  function mutationRelevant(mutation) {
    if (mutation.type === 'attributes') {
      const target = mutation.target;
      return target instanceof Element && Boolean(
        target.matches?.(`${PICKER_SELECTOR}, [role="menu"], [role="menuitem"], [role="menuitemradio"], button[aria-haspopup="menu"]`)
        || target.closest?.(PICKER_SELECTOR)
      );
    }
    const nodes = [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])];
    return nodes.some((node) => node instanceof Element && Boolean(
      node.matches?.(`${PICKER_SELECTOR}, [role="menu"]`)
      || node.querySelector?.(`${PICKER_SELECTOR}, [role="menu"]`)
    ));
  }

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.filter(mutationRelevant);
    if (!relevant.length) return;
    push({
      type: 'mutation',
      mutations: relevant.slice(0, 12).map((mutation) => ({
        mutationType: mutation.type,
        attributeName: mutation.attributeName || null,
        target: elementSummary(mutation.target)
      }))
    });
    scheduleSnapshots('mutation');
  });

  const eventTypes = ['pointerdown', 'pointerup', 'click', 'menu.itemSelect', 'select', 'change', 'input'];
  for (const type of eventTypes) document.addEventListener(type, handleEvent, true);
  window.addEventListener('message', handleMainMessage);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-checked', 'aria-expanded', 'aria-controls', 'data-state']
  });

  function stop() {
    if (stopped) return;
    observer.disconnect();
    for (const type of eventTypes) document.removeEventListener(type, handleEvent, true);
    window.removeEventListener('message', handleMainMessage);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    push({ type: 'stopped' });
    stopped = true;
  }

  function dump() {
    return {
      generatedAt: new Date().toISOString(),
      note: 'Model-selector DOM/event/authority diagnostic. Raw cookie/storage values, conversation IDs, and conversation text are not collected.',
      records: records.slice()
    };
  }

  function json() {
    return JSON.stringify(dump(), null, 2);
  }

  window[API_KEY] = Object.freeze({ stop, dump, json, snapshot });
  snapshot('installed');
  console.info('[Arcaia] Model selector diagnostic installed. Reproduce the selection flow, then run: copy(window.__ARCAIA_MODEL_SELECTOR_DIAG__.json())');
})();
