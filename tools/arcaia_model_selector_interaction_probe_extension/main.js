(() => {
  'use strict';

  const API_KEY = '__ARCAIA_MODEL_SELECTOR_INTERACTION_PROBE_MAIN__';
  const SOURCE = 'arcaia-model-selector-interaction-probe-main-v1';
  const CLIENT_SOURCE = 'arcaia-model-selector-interaction-probe-v1';
  const CHAT_MODEL_COOKIE = 'oai-last-model-config';
  const SURFACE_STORAGE = 'oai/apps/tpp/chat-surface-mode';
  const WORK_MODEL_STORAGE = 'oai/apps/tpp/model-settings';
  const WORK_EFFORT_STORAGE = 'oai/apps/tpp/thinking-effort';
  const RELEVANT_KEYS = new Map([
    [SURFACE_STORAGE, 'surface_mode'],
    [WORK_MODEL_STORAGE, 'work_model'],
    [WORK_EFFORT_STORAGE, 'work_effort']
  ]);

  if (window[API_KEY]?.stop) {
    try { window[API_KEY].stop(); } catch {}
  }

  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  let stopped = false;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseJson(raw) {
    try { return JSON.parse(String(raw ?? '')); } catch { return null; }
  }

  function readStorageJson(key) {
    try {
      const raw = window.localStorage?.getItem?.(key);
      if (raw == null) return null;
      const parsed = parseJson(raw);
      return parsed == null ? raw : parsed;
    } catch {
      return null;
    }
  }

  function cookieValue(name) {
    try {
      const escaped = String(name).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
      const match = String(document.cookie || '').match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function modelSlugFrom(value) {
    if (!value || typeof value !== 'object') return '';
    return normalizeText(
      value.model
      || value.modelSlug
      || value.model_slug
      || value.lastUsedModelSlug
      || value.last_used_model_slug
      || ''
    ).toLowerCase();
  }

  function effortFrom(value, override = '') {
    if (override) return normalizeText(override).toLowerCase();
    if (!value || typeof value !== 'object') return '';
    return normalizeText(
      value.effort
      || value.thinkingEffort
      || value.thinking_effort
      || ''
    ).toLowerCase();
  }

  function summarizeModel(value) {
    const slug = modelSlugFrom(value);
    let family = null;
    if (/(?:^|[-_.])sol(?:[-_.]|$)/i.test(slug) || /gpt[-_.]?5[-_.]?6[-_.]?thinking/i.test(slug)) family = 'sol';
    else if (/(?:^|[-_.])terra(?:[-_.]|$)/i.test(slug)) family = 'terra';
    else if (/(?:^|[-_.])luna(?:[-_.]|$)/i.test(slug)) family = 'luna';
    const gpt56 = /gpt[-_.]?5[-_.]?6/i.test(slug) || /gpt[-_.]?5[-_.]?thinking/i.test(slug);
    const gpt5Alias = /gpt[-_.]?5(?:[-_.](?:sol|terra|luna|thinking))?/i.test(slug);
    return {
      present: Boolean(slug),
      gpt56,
      gpt5Alias,
      family,
      separatorPattern: slug.includes('-') && slug.includes('_')
        ? 'mixed'
        : slug.includes('-')
          ? 'hyphen'
          : slug.includes('_')
            ? 'underscore'
            : slug.includes('.')
              ? 'dot'
              : 'none',
      lengthBucket: slug.length === 0 ? 'empty' : slug.length <= 20 ? 'short' : slug.length <= 50 ? 'medium' : 'long'
    };
  }

  function summarizeEffort(value, override = '') {
    const effort = effortFrom(value, override);
    const known = new Set(['min', 'standard', 'extended', 'xhigh', 'max']);
    return {
      present: Boolean(effort),
      value: known.has(effort) ? effort : effort ? 'other' : null
    };
  }

  function summarizeSurface(value) {
    const normalized = normalizeText(typeof value === 'string' ? value : '').toLowerCase();
    if (normalized === 'work') return 'work';
    if (normalized === 'chatgpt' || normalized === 'chat') return 'chatgpt';
    return normalized ? 'other' : null;
  }

  function snapshot() {
    const surfaceRaw = readStorageJson(SURFACE_STORAGE);
    const workModelRaw = readStorageJson(WORK_MODEL_STORAGE);
    const workEffortRaw = readStorageJson(WORK_EFFORT_STORAGE);
    const chatCookieRaw = parseJson(cookieValue(CHAT_MODEL_COOKIE));
    return {
      surface: summarizeSurface(surfaceRaw),
      chatModel: summarizeModel(chatCookieRaw),
      chatEffort: summarizeEffort(chatCookieRaw),
      workModel: summarizeModel(workModelRaw),
      workEffort: summarizeEffort(null, typeof workEffortRaw === 'string' ? workEffortRaw : '')
    };
  }

  function emit(type, payload = {}, requestId = null) {
    window.postMessage({
      source: SOURCE,
      type,
      requestId,
      payload
    }, '*');
  }

  function relevantStorageThis(storage) {
    try { return storage === window.localStorage; } catch { return false; }
  }

  Storage.prototype.setItem = function patchedSetItem(key, value) {
    const result = originalSetItem.apply(this, arguments);
    try {
      const keyClass = RELEVANT_KEYS.get(String(key || ''));
      if (!stopped && keyClass && relevantStorageThis(this)) {
        emit('storage_mutation', { operation: 'set', keyClass, state: snapshot() });
      }
    } catch {}
    return result;
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    const result = originalRemoveItem.apply(this, arguments);
    try {
      const keyClass = RELEVANT_KEYS.get(String(key || ''));
      if (!stopped && keyClass && relevantStorageThis(this)) {
        emit('storage_mutation', { operation: 'remove', keyClass, state: snapshot() });
      }
    } catch {}
    return result;
  };

  function handleStorage(event) {
    const keyClass = RELEVANT_KEYS.get(String(event?.key || ''));
    if (!stopped && keyClass) emit('storage_event', { keyClass, state: snapshot() });
  }

  function handleMessage(event) {
    if (event.source !== window || stopped) return;
    const data = event.data;
    if (data?.source !== CLIENT_SOURCE) return;
    if (data.type === 'MAIN_SNAPSHOT_REQUEST' && typeof data.requestId === 'string') {
      emit('MAIN_SNAPSHOT_RESPONSE', { state: snapshot() }, data.requestId);
      return;
    }
    if (data.type === 'MAIN_STOP_REQUEST') stop();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener('message', handleMessage);
    if (Storage.prototype.setItem === patchedSetItem) Storage.prototype.setItem = originalSetItem;
    if (Storage.prototype.removeItem === patchedRemoveItem) Storage.prototype.removeItem = originalRemoveItem;
  }

  const patchedSetItem = Storage.prototype.setItem;
  const patchedRemoveItem = Storage.prototype.removeItem;
  window.addEventListener('storage', handleStorage);
  window.addEventListener('message', handleMessage);
  window[API_KEY] = Object.freeze({ stop, snapshot });
  emit('ready', { state: snapshot() });
})();
