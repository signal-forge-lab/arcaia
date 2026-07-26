(() => {
  'use strict';

  const APP_VERSION = '0.1.275';
  const MAIN_PROTOCOL_SOURCE = 'aice-probe-main-v159';
  const CONTENT_PROTOCOL_SOURCE = 'aice-probe-content-v159';
  const GLOBAL_KEY = '__AICE_PROBE_MAIN_STATE_V40__';
  const LEGACY_GLOBAL_KEYS = ['__AICE_PROBE_MAIN_STATE__', '__AICE_PROBE_MAIN_STATE_V36__', '__AICE_PROBE_MAIN_STATE_V37__', '__AICE_PROBE_MAIN_STATE_V38__', '__AICE_PROBE_MAIN_STATE_V39__'];
  const LITE_STORAGE_KEY = '__AICE_LITE_DISPLAY_CONFIG__';
  const EXTENSION_ENABLED_STORAGE_KEY = 'arcaia_extension_enabled_v1';
  const HEADER_PREFIXES = ['chatgpt-', 'oai-'];
  const TARGET_PATH = '/backend-api/';
  const MAX_OBSERVATIONS = 80;
  const MAX_CONVERSATION_DERIVED_STATE_CACHE_ENTRIES = 4;
  const NATIVE_LITE_TURN_COUNT = 3;
  const CONFIGURED_LITE_TURN_COUNT_MAX = 10;
  const RECENT_VIEW_EXPANDED_TURN_COUNT_MAX = 50;
  const CAPTURE_TURN_COUNT_MAX = 80;
  const BACKEND_REWRITE_DEFAULT_ENABLED = true;
  const BACKEND_REWRITE_CAPTURE_ENABLED = true;
  const LITE_IMAGE_PLACEHOLDER_TEXT = [
    '🖼️ この回答は画像出力です。',
    'Recent Viewでは画像本体は表示されません。',
    '通常表示で確認してください。'
  ].join('\n');

  function getArcaiaCaptureMode() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const enabled = params.get('arcaia_capture') === '1';
      const requestedTurnCount = Math.max(NATIVE_LITE_TURN_COUNT, Math.min(CAPTURE_TURN_COUNT_MAX, Math.floor(Number(params.get('arcaia_capture_turns') || NATIVE_LITE_TURN_COUNT))));
      return { enabled, requestedTurnCount };
    } catch {
      return { enabled: false, requestedTurnCount: NATIVE_LITE_TURN_COUNT };
    }
  }

  function readExtensionEnabledFromStorage() {
    try { return window.sessionStorage?.getItem?.(EXTENSION_ENABLED_STORAGE_KEY) !== 'false'; } catch { return true; }
  }

  function writeExtensionEnabledToStorage(enabled) {
    try { window.sessionStorage?.setItem?.(EXTENSION_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false'); } catch {}
  }

  function restoreLegacyMainWorldHooks() {
    const restored = [];
    for (const key of LEGACY_GLOBAL_KEYS) {
      try {
        const previous = window[key];
        if (!previous || previous === window[GLOBAL_KEY]) continue;
        if (typeof previous.stopMainWorldRuntime === 'function') {
          previous.stopMainWorldRuntime('legacy_version_replaced');
          restored.push(`${key}.runtime`);
        }
        if (typeof previous.originalFetch === 'function') {
          window.fetch = previous.originalFetch;
          restored.push(`${key}.fetch`);
        }
        if (previous.originalXHROpen) {
          XMLHttpRequest.prototype.open = previous.originalXHROpen;
          restored.push(`${key}.xhr.open`);
        }
        if (previous.originalXHRSend) {
          XMLHttpRequest.prototype.send = previous.originalXHRSend;
          restored.push(`${key}.xhr.send`);
        }
        if (previous.originalXHRSetRequestHeader) {
          XMLHttpRequest.prototype.setRequestHeader = previous.originalXHRSetRequestHeader;
          restored.push(`${key}.xhr.setRequestHeader`);
        }
        try {
          previous.installed = false;
          previous.disabledBy = APP_VERSION;
          previous.disabledAt = Date.now();
        } catch {}
      } catch {}
    }
    return restored;
  }

  const restoredLegacyHooksAtStartup = restoreLegacyMainWorldHooks();
  function isMainExtensionEnabled() {
    return state?.extensionEnabled !== false;
  }

  function emitMainEvent(eventType, payload = {}) {
    try {
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'AICE_MAIN_EVENT',
        eventType,
        payload: {
          appVersion: APP_VERSION,
          at: Date.now(),
          atIso: new Date().toISOString(),
          event: eventType,
          ...payload
        }
      }, '*');
    } catch {}
  }


  if (window[GLOBAL_KEY]?.installed) {
    const previous = window[GLOBAL_KEY];
    if (previous?.appVersion === APP_VERSION) {
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'MAIN_ALREADY_INSTALLED',
        payload: previous.publicSnapshot?.()
      }, '*');
      return;
    }
    try {
      if (typeof previous?.stopMainWorldRuntime === 'function') previous.stopMainWorldRuntime('version_replaced');
      if (typeof previous?.originalFetch === 'function') window.fetch = previous.originalFetch;
      if (previous?.originalXHROpen) XMLHttpRequest.prototype.open = previous.originalXHROpen;
      if (previous?.originalXHRSend) XMLHttpRequest.prototype.send = previous.originalXHRSend;
      if (previous?.originalXHRSetRequestHeader) XMLHttpRequest.prototype.setRequestHeader = previous.originalXHRSetRequestHeader;
      if (previous?.originalHistoryPushState) window.history.pushState = previous.originalHistoryPushState;
      if (previous?.originalHistoryReplaceState) window.history.replaceState = previous.originalHistoryReplaceState;
    } catch {}
    try {
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'MAIN_REINSTALLING_NEW_VERSION',
        payload: { previousAppVersion: previous?.appVersion || null, nextAppVersion: APP_VERSION }
      }, '*');
    } catch {}
  }


  function extractConversationIdFromCurrentUrl() {
    try {
      const match = String(window.location.href || '').match(/\/c\/([a-f0-9-]+)/i);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  function isHistorySearchNavigationUrl(value = window.location.href) {
    try {
      const url = new URL(String(value || ''), window.location.origin);
      return String(url.searchParams.get('src') || '').toLowerCase() === 'history_search';
    } catch {
      return /(?:^|[?&])src=history_search(?:&|$)/i.test(String(value || ''));
    }
  }

  function defaultLiteDisplayConfig() {
    const conversationId = extractConversationIdFromCurrentUrl();
    const capture = getArcaiaCaptureMode();
    const historySearchBypass = isHistorySearchNavigationUrl();
    // 通常ページのconversation JSON rewriteはデフォルトON。
    // ChatGPT本体へ渡すconversation payload自体を縮小し、描画負荷と長いスクロール体感を抑える。
    // capture iframeはURLパラメータだけで独立動作させ、親ページのON/OFF保存状態を読ませない。
    if (capture.enabled) {
      return {
        appVersion: APP_VERSION,
        enabled: Boolean(conversationId),
        conversationId: conversationId || null,
        turnCount: capture.requestedTurnCount,
        baseTurnCount: NATIVE_LITE_TURN_COUNT,
        turnCountOverride: null,
        turnCountOverrideConversationId: null,
        updatedAt: null,
        updatedAtIso: null,
        defaultOn: true,
        captureMode: true,
        userDisabled: false,
        configSource: 'capture_url_params',
        backendRewriteEnabled: BACKEND_REWRITE_CAPTURE_ENABLED,
        liteShowImages: true,
        fullLoadOnce: false,
        fullLoadConversationId: null,
        fullLoadExpiresAt: null
      };
    }
    if (historySearchBypass) {
      return {
        appVersion: APP_VERSION,
        enabled: false,
        conversationId: conversationId || null,
        turnCount: NATIVE_LITE_TURN_COUNT,
        baseTurnCount: NATIVE_LITE_TURN_COUNT,
        turnCountOverride: null,
        turnCountOverrideConversationId: null,
        updatedAt: null,
        updatedAtIso: null,
        defaultOn: true,
        captureMode: false,
        userDisabled: false,
        historySearchBypass: true,
        configSource: 'history_search_bypass',
        backendRewriteEnabled: BACKEND_REWRITE_DEFAULT_ENABLED,
        liteShowImages: true,
        fullLoadOnce: false,
        fullLoadConversationId: null,
        fullLoadExpiresAt: null
      };
    }
    return {
      appVersion: APP_VERSION,
      enabled: Boolean(conversationId),
      conversationId: conversationId || null,
      turnCount: NATIVE_LITE_TURN_COUNT,
      baseTurnCount: NATIVE_LITE_TURN_COUNT,
      turnCountOverride: null,
      turnCountOverrideConversationId: null,
      updatedAt: null,
      updatedAtIso: null,
      defaultOn: true,
      captureMode: false,
      userDisabled: false,
      configSource: conversationId
        ? 'default_on_backend_rewrite_enabled_css_hide_fallback'
        : 'default_on_waiting_for_conversation_id_backend_rewrite_enabled_css_hide_fallback',
      backendRewriteEnabled: BACKEND_REWRITE_DEFAULT_ENABLED,
      liteShowImages: true,
      fullLoadOnce: false,
      fullLoadConversationId: null,
      fullLoadExpiresAt: null
    };
  }

  function readLiteDisplayConfigFromStorage() {
    const fallback = defaultLiteDisplayConfig();
    const capture = getArcaiaCaptureMode();
    if (capture.enabled) return fallback;
    try {
      const raw = window.sessionStorage?.getItem?.(LITE_STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      const parsedAppVersion = typeof parsed?.appVersion === 'string' ? parsed.appVersion : null;
      const currentConversationId = extractConversationIdFromCurrentUrl();
      const storedDisabled = Boolean(parsed?.enabled === false || parsed?.userDisabled === true || parsed?.configSource === 'popup_disable' || parsed?.configSource === 'full_load_lite_off');
      const legacyOrDifferentVersion = parsedAppVersion !== APP_VERSION;

      // 拡張更新/再読み込み後に旧版のRecent View OFFが残ると、初期表示でRecent Viewが効かない。
      // 旧版またはappVersionなしのOFF設定は初期化し、v0.1.60のデフォルトONへ戻す。
      if (storedDisabled && legacyOrDifferentVersion) {
        let storageCleared = false;
        try { storageCleared = clearLiteDisplayConfigFromStorage(); } catch {}
        const eventPayload = {
          parsedAppVersion,
          currentAppVersion: APP_VERSION,
          storedConfigSource: parsed?.configSource || null,
          storedUpdatedAtIso: parsed?.updatedAtIso || null,
          currentConversationId,
          storageCleared,
          fallbackEnabled: fallback.enabled
        };
        emitMainEvent('lite_config_ignored_legacy_disabled_storage', eventPayload);
        return {
          ...fallback,
          configSource: 'default_on_backend_rewrite_enabled_ignored_legacy_disabled_storage',
          previousStoredConfigSource: parsed?.configSource || null,
          previousStoredAppVersion: parsedAppVersion
        };
      }

      if (legacyOrDifferentVersion && parsed?.backendRewriteEnabled !== BACKEND_REWRITE_DEFAULT_ENABLED) {
        let storageCleared = false;
        try { storageCleared = clearLiteDisplayConfigFromStorage(); } catch {}
        const eventPayload = {
          parsedAppVersion,
          currentAppVersion: APP_VERSION,
          storedConfigSource: parsed?.configSource || null,
          storedBackendRewriteEnabled: parsed?.backendRewriteEnabled,
          currentConversationId,
          storageCleared,
          fallbackBackendRewriteEnabled: fallback.backendRewriteEnabled
        };
        emitMainEvent('lite_config_ignored_legacy_rewrite_storage', eventPayload);
        return {
          ...fallback,
          configSource: 'default_on_backend_rewrite_enabled_ignored_legacy_rewrite_storage',
          previousStoredConfigSource: parsed?.configSource || null,
          previousStoredAppVersion: parsedAppVersion,
          previousStoredBackendRewriteEnabled: parsed?.backendRewriteEnabled
        };
      }

      const normalized = normalizeLiteDisplayConfig(parsed);
      if (normalized.enabled && currentConversationId && normalized.conversationId !== currentConversationId) {
        normalized.conversationId = currentConversationId;
      }
      normalized.configSource = 'sessionStorage';
      return normalized;
    } catch {
      return fallback;
    }
  }

  function normalizeLiteDisplayConfig(config) {
    const capture = getArcaiaCaptureMode();
    const currentConversationId = extractConversationIdFromCurrentUrl();
    const historySearchBypass = isHistorySearchNavigationUrl();
    if (capture.enabled) {
      // capture iframeは親ページと同じsessionStorageを共有しうるため、保存済みenabled:falseやturnCount=3を無視する。
      return {
        appVersion: APP_VERSION,
        sourceAppVersion: typeof config?.appVersion === 'string' ? config.appVersion : null,
        enabled: Boolean(currentConversationId),
        conversationId: currentConversationId || null,
        turnCount: capture.requestedTurnCount,
        baseTurnCount: NATIVE_LITE_TURN_COUNT,
        turnCountOverride: null,
        turnCountOverrideConversationId: null,
        updatedAt: config?.updatedAt || null,
        updatedAtIso: config?.updatedAtIso || null,
        defaultOn: true,
        captureMode: true,
        configSource: 'capture_url_params',
        backendRewriteEnabled: BACKEND_REWRITE_CAPTURE_ENABLED,
        liteShowImages: true,
        fullLoadOnce: false,
        fullLoadConversationId: null,
        fullLoadExpiresAt: null
      };
    }

    const baseTurnCountRaw = Math.floor(Number(config?.baseTurnCount ?? config?.turnCount ?? NATIVE_LITE_TURN_COUNT));
    const baseTurnCount = Number.isFinite(baseTurnCountRaw)
      ? Math.max(1, Math.min(CONFIGURED_LITE_TURN_COUNT_MAX, baseTurnCountRaw))
      : NATIVE_LITE_TURN_COUNT;
    const hasTurnCountOverride = config?.turnCountOverride != null && config?.turnCountOverride !== '';
    const overrideTurnCountRaw = hasTurnCountOverride ? Math.floor(Number(config.turnCountOverride)) : NaN;
    const turnCountOverride = hasTurnCountOverride && Number.isFinite(overrideTurnCountRaw)
      ? Math.max(baseTurnCount, Math.min(RECENT_VIEW_EXPANDED_TURN_COUNT_MAX, overrideTurnCountRaw))
      : null;
    const turnCountOverrideConversationId = typeof config?.turnCountOverrideConversationId === 'string'
      && config.turnCountOverrideConversationId
      ? config.turnCountOverrideConversationId
      : null;
    const turnCount = currentConversationId
      && turnCountOverrideConversationId === currentConversationId
      && turnCountOverride != null
      ? turnCountOverride
      : baseTurnCount;
    // 通常ページのBackend JSON rewriteはON、DOM側はContent failed回避のCSS hide fallback。
    // enabled:false は、明示的なユーザーOFF(userDisabled=true)のときだけ尊重する。
    const userDisabled = Boolean(config?.userDisabled === true || config?.configSource === 'popup_disable');
    const enabled = Boolean(currentConversationId) && !userDisabled && !historySearchBypass;
    const conversationId = historySearchBypass
      ? currentConversationId
      : (enabled ? currentConversationId : null);
    const previousConfigSource = String(config?.configSource || '');
    return {
      appVersion: APP_VERSION,
      sourceAppVersion: typeof config?.appVersion === 'string' ? config.appVersion : null,
      enabled,
      conversationId: conversationId || null,
      turnCount,
      baseTurnCount,
      turnCountOverride,
      turnCountOverrideConversationId,
      updatedAt: config?.updatedAt || null,
      updatedAtIso: config?.updatedAtIso || null,
      defaultOn: true,
      captureMode: false,
      userDisabled,
      historySearchBypass,
      configSource: historySearchBypass
        ? 'history_search_bypass'
        : userDisabled
          ? (config?.configSource || 'user_disabled')
          : previousConfigSource === 'history_search_bypass'
            ? 'history_search_bypass_released'
            : (config?.configSource || 'default_on_backend_rewrite_enabled_css_hide_fallback'),
      backendRewriteEnabled: Boolean(config?.backendRewriteEnabled !== false && BACKEND_REWRITE_DEFAULT_ENABLED),
      backendRewriteExperiment: Boolean(config?.backendRewriteExperiment === true),
      liteShowImages: config?.liteShowImages !== false,
      fullLoadOnce: Boolean(config?.fullLoadOnce),
      fullLoadConversationId: typeof config?.fullLoadConversationId === 'string' ? config.fullLoadConversationId : null,
      fullLoadRequestedAt: Number(config?.fullLoadRequestedAt || 0) || null,
      fullLoadExpiresAt: Number(config?.fullLoadExpiresAt || 0) || null,
      fullLoadConsumedAt: Number(config?.fullLoadConsumedAt || 0) || null
    };
  }

  function writeLiteDisplayConfigToStorage(config) {
    try {
      if (getArcaiaCaptureMode().enabled) return;
      const stored = { ...(config || {}), appVersion: APP_VERSION, storedAt: Date.now(), storedAtIso: new Date().toISOString() };
      window.sessionStorage?.setItem?.(LITE_STORAGE_KEY, JSON.stringify(stored));
    } catch {}
  }

  function clearLiteDisplayConfigFromStorage() {
    try {
      if (getArcaiaCaptureMode().enabled) return false;
      window.sessionStorage?.removeItem?.(LITE_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function readLiteDisplayRawStorageForDebug() {
    try {
      const raw = window.sessionStorage?.getItem?.(LITE_STORAGE_KEY);
      return raw ? { exists: true, approxBytes: raw.length, parsed: JSON.parse(raw) } : { exists: false, approxBytes: 0, parsed: null };
    } catch (error) {
      return { exists: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function createBoundedConversationCache(limit = MAX_CONVERSATION_DERIVED_STATE_CACHE_ENTRIES) {
    const entries = new Map();
    const safeLimit = Math.max(1, Number(limit) || 1);
    return {
      set(conversationId, value) {
        const key = String(conversationId || '').trim();
        if (!key || value == null) return false;
        entries.delete(key);
        entries.set(key, value);
        while (entries.size > safeLimit) {
          entries.delete(entries.keys().next().value);
        }
        return true;
      },
      get(conversationId) {
        const key = String(conversationId || '').trim();
        if (!key || !entries.has(key)) return null;
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        return value;
      }
    };
  }

  const state = window[GLOBAL_KEY] = {
    installed: true,
    appVersion: APP_VERSION,
    installedAt: Date.now(),
    authorization: null,
    extraHeaders: {},
    updatedAt: null,
    responseProbes: [],
    extensionEnabled: readExtensionEnabledFromStorage(),
    historyProbeArmedUntil: 0,
    liteDisplayConfig: readLiteDisplayConfigFromStorage(),
    liteDisplayRewriteCount: 0,
    liteDisplayLastRewrite: null,
    messageTimestampIndex: null,
    messageTimestampIndexUpdateCount: 0,
    messageTimestampIndexesByConversation: createBoundedConversationCache(),
    conversationModelConfigsByConversation: createBoundedConversationCache(),
    fetchHooked: false,
    xhrHooked: false,
    originalFetch: null,
    originalXHROpen: null,
    originalXHRSend: null,
    originalXHRSetRequestHeader: null,
    historyHooked: false,
    originalHistoryPushState: null,
    originalHistoryReplaceState: null,
    historyPushStateWrapper: null,
    historyReplaceStateWrapper: null,
    observedPageUrl: window.location.href,
    observedPageConversationId: extractConversationIdFromCurrentUrl(),
    runtimeActive: false,
    stopMainWorldRuntime: null,
    publicSnapshot: null,
    restoredLegacyHooksAtStartup
  };

  function nowIso(ts = Date.now()) {
    return new Date(ts).toISOString();
  }

  function normalizeTimestampToIso(value) {
    if (value == null || value === '') return null;
    let date = null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      date = new Date(value > 1000000000000 ? value : value * 1000);
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (/^\d+(\.\d+)?$/.test(trimmed)) return normalizeTimestampToIso(Number(trimmed));
      date = new Date(trimmed);
    } else if (value instanceof Date) {
      date = value;
    }
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }

  function pickTimestamp(message, names) {
    const metadata = message?.metadata || {};
    for (const name of names) {
      const value = name.startsWith('metadata.') ? metadata[name.slice('metadata.'.length)] : message?.[name];
      const iso = normalizeTimestampToIso(value);
      if (iso) return { iso, source: name, value };
    }
    return { iso: null, source: null, value: null };
  }

  function isTimestampVisibleMessage(message) {
    const role = message?.author?.role || null;
    if (role !== 'user' && role !== 'assistant') return false;
    if (message?.metadata?.is_visually_hidden_from_conversation) return false;
    if (role === 'assistant' && message.recipient && message.recipient !== 'all') return false;
    return true;
  }

  function buildMessageTimestampIndexFromConversation(raw, url = '') {
    const conversationId = raw?.conversation_id || extractConversationIdFromConversationDetailUrl(url) || extractConversationIdFromCurrentUrl();
    const byMessageId = {};
    const byNodeId = {};
    const roleOrder = [];
    const mapping = raw?.mapping && typeof raw.mapping === 'object' ? raw.mapping : {};
    for (const [nodeId, node] of Object.entries(mapping)) {
      const message = node?.message;
      if (!message || !isTimestampVisibleMessage(message)) continue;
      const role = message.author.role;
      const messageId = message.id || nodeId;
      const created = pickTimestamp(message, ['create_time', 'create_time_ms', 'created_at', 'createdAt', 'timestamp', 'metadata.create_time', 'metadata.created_at', 'metadata.sent_at', 'metadata.received_at']);
      const updated = pickTimestamp(message, ['update_time', 'update_time_ms', 'updated_at', 'updatedAt', 'metadata.update_time', 'metadata.updated_at', 'metadata.finish_time', 'metadata.finished_at']);
      const chosen = created.iso ? created : updated;
      const item = {
        messageId,
        nodeId,
        role,
        iso: chosen.iso,
        source: chosen.source,
        createTimeIso: created.iso,
        createTimeSource: created.source,
        updateTimeIso: updated.iso,
        updateTimeSource: updated.source,
        kind: role === 'user' ? 'sent' : 'received',
        status: message.status || null,
        contentType: message.content?.content_type || null
      };
      byMessageId[messageId] = item;
      byNodeId[nodeId] = item;
      roleOrder.push(item);
    }
    roleOrder.sort((a, b) => String(a.iso || '').localeCompare(String(b.iso || '')));
    return {
      ok: true,
      appVersion: APP_VERSION,
      source: 'main_world_existing_conversation_fetch',
      conversationId,
      updatedAt: Date.now(),
      updatedAtIso: nowIso(),
      messageCount: roleOrder.length,
      byMessageId,
      byNodeId,
      roleOrder
    };
  }

  function observeMessageTimestampIndexFromConversation(raw, url = '', reason = 'conversation_fetch') {
    try {
      const index = buildMessageTimestampIndexFromConversation(raw, url);
      state.messageTimestampIndex = index;
      state.messageTimestampIndexesByConversation.set(index.conversationId, index);
      state.messageTimestampIndexUpdateCount = (state.messageTimestampIndexUpdateCount || 0) + 1;
      emitMainEvent('message_timestamp_index_updated', {
        reason,
        conversationId: index.conversationId || null,
        messageCount: index.messageCount || 0,
        updateCount: state.messageTimestampIndexUpdateCount
      });
      return index;
    } catch (error) {
      state.messageTimestampIndex = {
        ok: false,
        appVersion: APP_VERSION,
        source: 'main_world_existing_conversation_fetch',
        updatedAt: Date.now(),
        updatedAtIso: nowIso(),
        error: error instanceof Error ? error.message : String(error)
      };
      return state.messageTimestampIndex;
    }
  }

  function buildCurrentConversationModelConfig(raw, url = '') {
    const root = findRootNode(raw);
    if (!root) return null;
    const reachableIds = collectReachableNodeIds(raw, root);
    const leaf = findLatestLeafNodeForLite(raw, reachableIds);
    const pathIds = buildPathFromLeaf(raw, root, leaf);
    for (let index = pathIds.length - 1; index >= 0; index -= 1) {
      const metadata = raw?.mapping?.[pathIds[index]]?.message?.metadata;
      if (!metadata || typeof metadata !== 'object') continue;
      const modelSlug = String(
        metadata.resolved_model_slug
        || metadata.model_slug
        || metadata.default_model_slug
        || ''
      ).trim();
      const thinkingEffort = String(metadata.thinking_effort || metadata.thinkingEffort || '').trim().toLowerCase();
      if (!modelSlug || !thinkingEffort) continue;
      return {
        conversationId: raw?.conversation_id || extractConversationIdFromConversationDetailUrl(url) || null,
        modelSlug,
        thinkingEffort,
        source: 'conversation_detail_current_branch',
        selectedMessageDistanceFromLeaf: pathIds.length - 1 - index,
        currentNodeUsed: Boolean(raw?.current_node && leaf?.id === raw.current_node),
        observedAt: Date.now()
      };
    }
    return null;
  }

  function observeCurrentConversationModelConfig(raw, url = '', reason = 'conversation_fetch') {
    const config = buildCurrentConversationModelConfig(raw, url);
    if (!config) return null;
    state.conversationModelConfigsByConversation.set(config.conversationId, config);
    emitMainEvent('current_conversation_model_config', {
      ...config,
      reason
    });
    return config;
  }

  function getMessageTimestampIndexForContent(requestedConversationId = null) {
    const conversationId = String(requestedConversationId || '').trim();
    const messageTimestampIndex = conversationId
      ? state.messageTimestampIndexesByConversation.get(conversationId)
      : state.messageTimestampIndex;
    return {
      ok: true,
      appVersion: APP_VERSION,
      messageTimestampIndex: messageTimestampIndex || null,
      updateCount: state.messageTimestampIndexUpdateCount || 0,
      note: '会話IDが指定された場合は、その会話のexisting conversation fetch responseから抽出済みのtimestamp indexだけを返します。追加fetchは行いません。'
    };
  }

  function getConversationModelConfigForContent(requestedConversationId = null) {
    const conversationId = String(requestedConversationId || '').trim();
    if (!conversationId) return null;
    return state.conversationModelConfigsByConversation.get(conversationId);
  }

  function getConversationIdSyncDiagnostic() {
    const currentConversationId = extractConversationIdFromCurrentUrl();
    const configuredConversationId = state.liteDisplayConfig?.conversationId || null;
    const mismatch = currentConversationId !== configuredConversationId;
    return {
      currentConversationId,
      configuredConversationId,
      mismatch,
      warning: mismatch
        ? `main-world liteDisplay.conversationId mismatch: page=${currentConversationId || 'null'}, config=${configuredConversationId || 'null'}`
        : null
    };
  }

  function syncLiteDisplayConversationId(reason = 'url_poll') {
    if (!isMainExtensionEnabled()) {
      return { changed: false, skipped: true, reason: 'extension_disabled' };
    }
    const before = state.liteDisplayConfig || defaultLiteDisplayConfig();
    const currentConversationId = extractConversationIdFromCurrentUrl();
    const normalized = normalizeLiteDisplayConfig(before);
    const fullLoadMismatch = Boolean(
      before.fullLoadConversationId
      && before.fullLoadConversationId !== currentConversationId
    );
    if (fullLoadMismatch) {
      normalized.fullLoadOnce = false;
      normalized.fullLoadConversationId = null;
      normalized.fullLoadRequestedAt = null;
      normalized.fullLoadExpiresAt = null;
    }
    const changed = before.conversationId !== normalized.conversationId
      || Boolean(before.enabled) !== Boolean(normalized.enabled)
      || fullLoadMismatch;
    if (!changed) return { changed: false, ...getConversationIdSyncDiagnostic() };

    normalized.updatedAt = Date.now();
    normalized.updatedAtIso = nowIso(normalized.updatedAt);
    normalized.configSource = currentConversationId ? `page_url_sync:${reason}` : 'not_conversation_page';
    state.liteDisplayConfig = normalized;
    writeLiteDisplayConfigToStorage(normalized);
    const diagnostic = getConversationIdSyncDiagnostic();
    emitMainEvent('lite_config_synced_to_page_url', {
      reason,
      previousConversationId: before.conversationId || null,
      conversationId: currentConversationId,
      enabled: normalized.enabled,
      fullLoadMismatch,
      mismatchAfterSync: diagnostic.mismatch
    });
    return { changed: true, ...diagnostic };
  }

  function toAbsoluteUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, window.location.origin).href;
      if (input instanceof URL) return input.href;
      if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
      return String(input || '');
    } catch {
      return String(input || '');
    }
  }

  function classifyChatGPTEndpoint(pathOrUrl) {
    let pathname = String(pathOrUrl || '');
    try { pathname = new URL(pathOrUrl, window.location.origin).pathname; } catch {}
    if (/\/backend-api\/conversation\/[^/?#]+$/.test(pathname)) return 'conversation_detail';
    if (pathname === '/backend-api/conversations') return 'conversation_list';
    if (/\/backend-api\/files\/download\//.test(pathname)) return 'file_download';
    if (/\/backend-api\//.test(pathname)) return 'other_backend_api';
    return 'other';
  }

  function safeUrlInfo(url) {
    try {
      const u = new URL(url, window.location.origin);
      return {
        origin: u.origin,
        pathname: u.pathname,
        endpointKind: classifyChatGPTEndpoint(u.pathname),
        searchKeys: Array.from(u.searchParams.keys()).slice(0, 20),
        isSameOrigin: u.origin === window.location.origin,
        hrefRedacted: `${u.origin}${u.pathname}${u.search ? '?...' : ''}`
      };
    } catch {
      return {
        origin: null,
        pathname: String(url || '').slice(0, 300),
        endpointKind: classifyChatGPTEndpoint(String(url || '')),
        searchKeys: [],
        isSameOrigin: null,
        hrefRedacted: String(url || '').slice(0, 300)
      };
    }
  }

  function normalizeHttpMethod(method) {
    return String(method || 'GET').toUpperCase();
  }

  function shouldObserve(url) {
    if (!url) return false;
    try {
      const u = new URL(url, window.location.origin);
      if (u.origin !== window.location.origin) return false;
      if (u.pathname.includes('/backend-api/')) return true;
      if (u.pathname.includes('/api/auth/session')) return true;
      // Keep this deliberately narrow. We do not want a full browsing/network logger.
      return false;
    } catch {
      return String(url).includes(TARGET_PATH) || String(url).includes('/api/auth/session');
    }
  }

  function collectHeaders(headersLike) {
    const result = {};
    if (!headersLike) return result;

    try {
      if (typeof Headers !== 'undefined' && headersLike instanceof Headers) {
        headersLike.forEach((value, key) => {
          result[String(key)] = String(value);
        });
        return result;
      }
    } catch {}

    if (Array.isArray(headersLike)) {
      for (const pair of headersLike) {
        if (Array.isArray(pair) && pair.length >= 2) {
          result[String(pair[0])] = String(pair[1]);
        }
      }
      return result;
    }

    if (typeof headersLike === 'object') {
      for (const [key, value] of Object.entries(headersLike)) {
        if (value != null) result[String(key)] = String(value);
      }
    }
    return result;
  }

  function mergeHeaderSources(...sources) {
    const merged = {};
    for (const source of sources) Object.assign(merged, collectHeaders(source));
    return merged;
  }

  function getHeaderCaseInsensitive(headers, targetName) {
    const target = targetName.toLowerCase();
    for (const [key, value] of Object.entries(headers || {})) {
      if (key.toLowerCase() === target) return value;
    }
    return null;
  }

  function sanitizeHeaders(headers) {
    const headerKeys = Object.keys(headers || {});
    const lowerToOriginal = {};
    for (const key of headerKeys) lowerToOriginal[key.toLowerCase()] = key;

    const authorization = getHeaderCaseInsensitive(headers, 'authorization');
    const authScheme = authorization ? String(authorization).split(/\s+/)[0] || 'present' : null;
    const matchedExtraHeaderKeys = headerKeys.filter((key) => {
      const lower = key.toLowerCase();
      return HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix));
    });

    return {
      headerKeys: headerKeys.sort(),
      hasAuthorization: Boolean(authorization),
      authorizationScheme: authScheme,
      authorizationLength: authorization ? String(authorization).length : 0,
      matchedExtraHeaderKeys: matchedExtraHeaderKeys.sort(),
      hasOaiDeviceIdHeader: Boolean(lowerToOriginal['oai-device-id'])
    };
  }

  function extractExtraHeaders(headers) {
    const extraHeaders = {};
    for (const [key, value] of Object.entries(headers || {})) {
      const lower = key.toLowerCase();
      if (HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
        extraHeaders[key] = value;
      }
    }
    return extraHeaders;
  }


  function isConversationHistoryUrl(url) {
    try {
      const u = new URL(url, window.location.origin);
      if (u.origin !== window.location.origin) return false;
      return /\/backend-api\/conversation\/[^/?#]+/.test(u.pathname);
    } catch {
      return /\/backend-api\/conversation\//.test(String(url || ''));
    }
  }

  function pushLimited(list, item, max = MAX_OBSERVATIONS) {
    list.push(item);
    if (list.length > max) list.splice(0, list.length - max);
  }

  function maybeParseJsonText(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null;
    try { return JSON.parse(trimmed); } catch { return null; }
  }

  function countBy(values) {
    const counts = {};
    for (const value of values) {
      const key = String(value || 'unknown');
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  const PAGINATION_FALSE_POSITIVE_KEYS = new Set([
    'previewable',
    'preview_language',
    'custom_symbol_offsets'
  ]);

  function isPaginationLikeKey(key) {
    const lower = String(key || '').toLowerCase();
    if (!lower || PAGINATION_FALSE_POSITIVE_KEYS.has(lower)) return false;
    if (/^(cursor|limit|offset|pagination|before|after|previous|has_more|hasmore|end_cursor|start_cursor|page_token|next_page_token|previous_page_token|continuation|continuation_token)$/.test(lower)) return true;
    return /(cursor|limit|offset|pagination|before|after|has_more|hasmore|end_cursor|start_cursor|page_token|next_page_token|previous_page_token|continuation_token)/.test(lower);
  }

  function walkForProbeKeys(value, path = '', out = [], depth = 0) {
    if (!value || typeof value !== 'object' || depth > 5 || out.length > 120) return out;
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 8); i += 1) walkForProbeKeys(value[i], `${path}[]`, out, depth + 1);
      return out;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      const lower = key.toLowerCase();
      if (isPaginationLikeKey(key)) {
        out.push({ path: childPath, key, valueType: child == null ? 'null' : Array.isArray(child) ? 'array' : typeof child });
      }
      walkForProbeKeys(child, childPath, out, depth + 1);
    }
    return out;
  }

  function analyzeConversationLikeJson(json) {
    const mapping = json && typeof json === 'object' && !Array.isArray(json) ? json.mapping : null;
    const nodes = mapping && typeof mapping === 'object' ? Object.values(mapping) : [];
    const messages = nodes.map((node) => node && node.message).filter(Boolean);
    const roles = messages.map((message) => message?.author?.role || message?.role || 'unknown');
    const contentTypes = messages.map((message) => message?.content?.content_type || 'unknown');
    const statusValues = messages.map((message) => message?.status || 'unknown');
    const childCounts = nodes.map((node) => Array.isArray(node?.children) ? node.children.length : 0);
    const leafNodeCount = childCounts.filter((count) => count === 0).length;
    const paginationLikeKeyPaths = walkForProbeKeys(json).slice(0, 80);
    return {
      topLevelKeys: json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json).sort().slice(0, 80) : [],
      hasMapping: Boolean(mapping),
      mappingNodeCount: nodes.length,
      messageNodeCount: messages.length,
      leafNodeCount,
      roleCounts: countBy(roles),
      contentTypeCounts: countBy(contentTypes),
      statusCounts: countBy(statusValues),
      paginationLikeKeyCount: paginationLikeKeyPaths.length,
      paginationLikeKeyPaths,
      hasTitle: Boolean(json?.title),
      hasConversationId: Boolean(json?.conversation_id || json?.conversationId),
      defaultModelSlug: json?.default_model_slug || null
    };
  }


  function extractConversationIdFromConversationDetailUrl(url) {
    try {
      const u = new URL(url, window.location.origin);
      const match = u.pathname.match(/\/backend-api\/conversation\/([^/?#]+)$/);
      return match ? match[1] : null;
    } catch {
      const match = String(url || '').match(/\/backend-api\/conversation\/([^/?#]+)$/);
      return match ? match[1] : null;
    }
  }

  function findRootNode(raw) {
    if (raw?.mapping?.['client-created-root']) return raw.mapping['client-created-root'];
    for (const node of Object.values(raw?.mapping || {})) {
      if (node && node.parent === null) return node;
    }
    return null;
  }

  function getLeafNodes(raw, reachableIds) {
    const leaves = [];
    for (const id of reachableIds) {
      const node = raw?.mapping?.[id];
      if (!node) continue;
      const children = Array.isArray(node.children) ? node.children.filter((childId) => reachableIds.has(childId)) : [];
      if (children.length === 0) leaves.push(node);
    }
    return leaves;
  }

  function collectReachableNodeIds(raw, root) {
    const ids = new Set();
    const stack = [root?.id].filter(Boolean);
    while (stack.length) {
      const id = stack.pop();
      if (!id || ids.has(id)) continue;
      ids.add(id);
      const node = raw?.mapping?.[id];
      const children = Array.isArray(node?.children) ? node.children : [];
      for (const child of children) stack.push(child);
    }
    return ids;
  }

  function findLatestLeafNodeForLite(raw, reachableIds) {
    if (raw?.current_node && raw?.mapping?.[raw.current_node]) return raw.mapping[raw.current_node];
    const leaves = getLeafNodes(raw, reachableIds).filter((node) => node?.message);
    let latest = null;
    for (const node of leaves) {
      if (!latest || (node.message?.create_time || 0) > (latest.message?.create_time || 0)) latest = node;
    }
    return latest;
  }

  function buildPathFromLeaf(raw, root, leaf) {
    const path = [];
    const seen = new Set();
    let id = leaf?.id;
    while (id && !seen.has(id)) {
      const node = raw?.mapping?.[id];
      if (!node) break;
      seen.add(id);
      path.push(id);
      if (id === root?.id) break;
      id = node.parent;
    }
    return path.reverse();
  }

  function isVisuallyHiddenMessage(message) {
    return message?.metadata?.is_visually_hidden_from_conversation === true;
  }

  function isLiteImageLikeObject(value) {
    if (!value || typeof value !== 'object') return false;
    const contentType = String(value.content_type || value.type || value.mime_type || '').toLowerCase();
    if (contentType.includes('image') || contentType.startsWith('image/')) return true;
    if (value.asset_pointer || value.image_url || value.metadata?.generation || value.metadata?.dalle) return true;
    if (typeof value.url === 'string' && value.url.toLowerCase().includes('image')) return true;
    return Object.keys(value).some((key) => {
      const lowered = String(key || '').toLowerCase();
      return lowered.includes('image') || lowered.includes('dalle') || lowered.includes('asset_pointer');
    });
  }

  function hasLiteImageLikeContent(value, depth = 0) {
    if (!value || depth > 5) return false;
    if (Array.isArray(value)) return value.some((item) => hasLiteImageLikeContent(item, depth + 1));
    if (typeof value !== 'object') return false;
    if (isLiteImageLikeObject(value)) return true;
    return Object.values(value).some((item) => hasLiteImageLikeContent(item, depth + 1));
  }

  function normalizePartToText(part) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (part.content_type === 'text' && typeof part.text === 'string') return part.text;
    if (hasLiteImageLikeContent(part)) return LITE_IMAGE_PLACEHOLDER_TEXT;
    return '';
  }

  function extractTextFromMessage(message) {
    const content = message?.content;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const contentType = String(content?.content_type || '').toLowerCase();
    const textLike = contentType === 'text' || contentType === 'multimodal_text';
    const text = textLike ? parts.map(normalizePartToText).filter(Boolean).join('\n\n').trim() : '';
    if (text) return text;
    if (hasLiteImageLikeContent(content) || hasLiteImageLikeContent(message?.metadata)) return LITE_IMAGE_PLACEHOLDER_TEXT;
    return '';
  }

  function applyLiteImagePlaceholderToMessage(message) {
    const role = message?.author?.role || null;
    if (role !== 'assistant') return false;
    if (!hasLiteImageLikeContent(message?.content) && !hasLiteImageLikeContent(message?.metadata)) return false;
    const text = extractTextFromMessage(message);
    const normalizedText = text.includes(LITE_IMAGE_PLACEHOLDER_TEXT)
      ? text
      : [text, LITE_IMAGE_PLACEHOLDER_TEXT].filter(Boolean).join('\n\n');
    message.content = {
      content_type: 'text',
      parts: [normalizedText || LITE_IMAGE_PLACEHOLDER_TEXT]
    };
    message.metadata = {
      ...(message.metadata || {}),
      arcaia_lite_image_placeholder: true
    };
    return true;
  }

  function isIgnoredLiteImageSignalPath(path, key = '') {
    const loweredPath = String(path || '').toLowerCase();
    const loweredKey = String(key || '').toLowerCase();
    if (loweredPath.includes('.search_result_groups')) return true;
    if (loweredPath.includes('.search_results')) return true;
    if (loweredKey === 'thumbnail_url' || loweredKey === 'thumbnail' || loweredKey === 'thumbnails') return true;
    return false;
  }

  function isLiteImageSignalMessage(message) {
    if (!message) return false;
    const role = message?.author?.role || null;
    if (role === 'user') return false;
    const signalKeys = collectLiteImageSignalKeys({ content: message?.content || null, metadata: message?.metadata || null });
    if (signalKeys.length > 0) return true;
    if (hasLiteImageLikeContent(message?.content)) return true;
    if (role === 'assistant' && hasLiteImageLikeContent(message?.metadata)) return true;
    return false;
  }

  function findLiteImageSignalAfterUser(raw, pathIds, userNodeId, stopUserNodeIds) {
    const startIndex = (pathIds || []).indexOf(userNodeId);
    if (startIndex < 0) return null;
    for (let i = startIndex + 1; i < (pathIds || []).length; i += 1) {
      const id = pathIds[i];
      if (stopUserNodeIds?.has(id)) return null;
      const message = raw?.mapping?.[id]?.message || null;
      if (isLiteImageSignalMessage(message)) {
        return {
          nodeId: id,
          role: message?.author?.role || null,
          contentType: message?.content?.content_type || null
        };
      }
    }
    return null;
  }

  function createSyntheticLiteImagePlaceholderNode(sourceUserNodeId, sourceSignal = {}, index = 0) {
    const nodeId = `arcaia_lite_image_placeholder_${sourceUserNodeId || 'unknown'}_${index}`;
    const now = Date.now() / 1000;
    return {
      id: nodeId,
      message: {
        id: nodeId,
        author: { role: 'assistant', name: null, metadata: {} },
        create_time: now,
        update_time: now,
        content: { content_type: 'text', parts: [LITE_IMAGE_PLACEHOLDER_TEXT] },
        status: 'finished_successfully',
        end_turn: true,
        weight: 1,
        metadata: {
          arcaia_lite_image_placeholder: true,
          arcaia_lite_synthetic_placeholder: true,
          source_user_node_id: sourceUserNodeId || null,
          source_signal_node_id: sourceSignal?.nodeId || null,
          source_signal_role: sourceSignal?.role || null,
          source_signal_content_type: sourceSignal?.contentType || null
        },
        recipient: 'all',
        channel: null
      },
      parent: null,
      children: []
    };
  }

  function classifyLitePathMessage(raw, nodeId) {
    const node = raw?.mapping?.[nodeId];
    const message = node?.message;
    const role = message?.author?.role || null;
    const text = extractTextFromMessage(message);
    const keep = Boolean(
      message &&
      !isVisuallyHiddenMessage(message) &&
      (role === 'user' || role === 'assistant') &&
      !(role === 'assistant' && message.recipient && message.recipient !== 'all') &&
      text
    );
    return { id: nodeId, role, keep };
  }

  function incrementLiteTraceCount(target, key) {
    const normalized = String(key || 'unknown');
    target[normalized] = (target[normalized] || 0) + 1;
  }

  function getLiteMessageDropReason(raw, nodeId) {
    const node = raw?.mapping?.[nodeId];
    const message = node?.message;
    const role = message?.author?.role || null;
    const text = extractTextFromMessage(message);
    if (!message) return 'no_message';
    if (isVisuallyHiddenMessage(message)) return 'visually_hidden';
    if (!(role === 'user' || role === 'assistant')) return 'non_user_assistant_role';
    if (role === 'assistant' && message.recipient && message.recipient !== 'all') return 'assistant_recipient_not_all';
    if (!text) return 'empty_text';
    return null;
  }

  function summarizeLiteMessageNode(raw, nodeId, extra = {}) {
    const node = raw?.mapping?.[nodeId] || null;
    const message = node?.message || null;
    const content = message?.content || null;
    const text = extractTextFromMessage(message);
    return {
      id: nodeId || null,
      parent: node?.parent || null,
      childCount: Array.isArray(node?.children) ? node.children.length : 0,
      role: message?.author?.role || null,
      recipient: message?.recipient || null,
      status: message?.status || null,
      contentType: content?.content_type || null,
      textLength: text ? text.length : 0,
      textPreview: text ? text.slice(0, 80) : '',
      createTime: message?.create_time || null,
      updateTime: message?.update_time || null,
      visuallyHidden: isVisuallyHiddenMessage(message),
      hasImageLikeContent: hasLiteImageLikeContent(content),
      hasImageLikeMetadata: hasLiteImageLikeContent(message?.metadata),
      metadataKeys: message?.metadata && typeof message.metadata === 'object' ? Object.keys(message.metadata).slice(0, 30) : [],
      ...extra
    };
  }

  function collectLiteImageSignalKeys(value, depth = 0, path = '$', out = []) {
    if (!value || typeof value !== 'object' || depth > 5 || out.length >= 40) return out;
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 20); i += 1) {
        const childPath = `${path}[${i}]`;
        if (!isIgnoredLiteImageSignalPath(childPath)) collectLiteImageSignalKeys(value[i], depth + 1, childPath, out);
        if (out.length >= 40) break;
      }
      return out;
    }
    for (const [key, child] of Object.entries(value)) {
      if (out.length >= 40) break;
      const lowered = String(key || '').toLowerCase();
      const childPath = `${path}.${key}`;
      if (isIgnoredLiteImageSignalPath(childPath, key)) continue;
      if (lowered.includes('image') || lowered.includes('dalle') || lowered.includes('asset_pointer') || lowered.includes('generation')) {
        out.push({ path: childPath, key, reason: 'key_name' });
      }
      if (typeof child === 'string') {
        const loweredValue = child.toLowerCase();
        if (loweredValue.includes('image') || loweredValue.startsWith('image/') || loweredValue.includes('asset_pointer')) {
          out.push({ path: childPath, key, reason: 'string_value', valuePreview: child.slice(0, 80) });
        }
      } else if (child && typeof child === 'object') {
        const childType = String(child.content_type || child.type || child.mime_type || '').toLowerCase();
        if (childType.includes('image') || childType.startsWith('image/')) {
          out.push({ path: childPath, key, reason: 'object_type', type: childType });
        }
        collectLiteImageSignalKeys(child, depth + 1, childPath, out);
      }
    }
    return out;
  }

  function collectLiteImageSignalScan(raw, pathIdSet = null) {
    const hits = [];
    const roleCounts = {};
    const contentTypeCounts = {};
    for (const [nodeId, node] of Object.entries(raw?.mapping || {})) {
      if (hits.length >= 80) break;
      const message = node?.message || null;
      if (!message) continue;
      const content = message.content || null;
      const metadata = message.metadata || null;
      const imageLikeContent = hasLiteImageLikeContent(content);
      const imageLikeMetadata = hasLiteImageLikeContent(metadata);
      const signalKeys = collectLiteImageSignalKeys({ content, metadata });
      if (!imageLikeContent && !imageLikeMetadata && signalKeys.length === 0) continue;
      const role = message?.author?.role || null;
      const contentType = content?.content_type || null;
      incrementLiteTraceCount(roleCounts, role);
      incrementLiteTraceCount(contentTypeCounts, contentType);
      hits.push(summarizeLiteMessageNode(raw, nodeId, {
        onSelectedPath: pathIdSet ? pathIdSet.has(nodeId) : null,
        imageLikeContent,
        imageLikeMetadata,
        signalKeys: signalKeys.slice(0, 20)
      }));
    }
    return {
      hitCount: hits.length,
      roleCounts,
      contentTypeCounts,
      hits
    };
  }

  function buildLiteRewriteDecisionTrace(raw, reachableIds, latestLeaf, pathIds, kept, turns, retainedTurns, selectedSet, orderedSelectedNodeIds) {
    const pathIdSet = new Set(pathIds || []);
    const selectedRoleCounts = {};
    const selectedContentTypeCounts = {};
    const keptRoleCounts = {};
    const pathRoleCounts = {};
    const dropReasonCounts = {};
    const pathMessageDiagnostics = (pathIds || []).map((nodeId, index) => {
      const item = classifyLitePathMessage(raw, nodeId);
      const dropReason = item.keep ? null : getLiteMessageDropReason(raw, nodeId);
      const selected = selectedSet ? selectedSet.has(nodeId) : false;
      const node = raw?.mapping?.[nodeId];
      const message = node?.message;
      const role = message?.author?.role || null;
      const contentType = message?.content?.content_type || null;
      incrementLiteTraceCount(pathRoleCounts, role);
      if (item.keep) incrementLiteTraceCount(keptRoleCounts, role);
      if (selected) {
        incrementLiteTraceCount(selectedRoleCounts, role);
        incrementLiteTraceCount(selectedContentTypeCounts, contentType);
      }
      if (dropReason) incrementLiteTraceCount(dropReasonCounts, dropReason);
      if (item.keep && !selected) incrementLiteTraceCount(dropReasonCounts, 'kept_but_not_retained_turn');
      return summarizeLiteMessageNode(raw, nodeId, {
        pathIndex: index,
        keep: item.keep,
        selected,
        dropReason,
        keptButNotRetainedTurn: Boolean(item.keep && !selected)
      });
    });
    const leafCandidates = getLeafNodes(raw, reachableIds || new Set()).filter((node) => node?.message);
    const leafCandidateDiagnostics = leafCandidates
      .slice()
      .sort((a, b) => (b.message?.create_time || 0) - (a.message?.create_time || 0))
      .slice(0, 20)
      .map((node) => summarizeLiteMessageNode(raw, node.id, { selectedLeaf: node.id === latestLeaf?.id }));
    const retainedTurnDiagnostics = (retainedTurns || []).map((turn, index) => {
      const roleCounts = {};
      const contentTypeCounts = {};
      let imageLikeNodeCount = 0;
      for (const item of turn.messages || []) {
        const node = raw?.mapping?.[item.id];
        const message = node?.message;
        const role = message?.author?.role || item.role || null;
        const contentType = message?.content?.content_type || null;
        incrementLiteTraceCount(roleCounts, role);
        incrementLiteTraceCount(contentTypeCounts, contentType);
        if (hasLiteImageLikeContent(message?.content) || hasLiteImageLikeContent(message?.metadata)) imageLikeNodeCount += 1;
      }
      return {
        retainedIndex: index,
        originalTurnIndex: Math.max(0, (turns || []).length - (retainedTurns || []).length) + index,
        messageIds: (turn.messages || []).map((item) => item.id),
        roleCounts,
        contentTypeCounts,
        userOnly: Boolean(roleCounts.user && !roleCounts.assistant && !roleCounts.tool),
        imageLikeNodeCount
      };
    });
    return {
      traceVersion: 'lite_rewrite_decision_trace_v1',
      leafSelection: {
        currentNodeId: raw?.current_node || null,
        currentNodeExists: Boolean(raw?.current_node && raw?.mapping?.[raw.current_node]),
        selectedLeafId: latestLeaf?.id || null,
        selectedLeafFromCurrentNode: Boolean(raw?.current_node && raw?.mapping?.[raw.current_node] && latestLeaf?.id === raw.current_node),
        leafCandidateCount: leafCandidates.length,
        leafCandidates: leafCandidateDiagnostics
      },
      path: {
        pathNodeCount: (pathIds || []).length,
        pathRoleCounts,
        keptRoleCounts,
        selectedRoleCounts,
        selectedContentTypeCounts,
        selectedMessageNodeIds: (orderedSelectedNodeIds || []).slice(0, 80),
        messageDiagnostics: pathMessageDiagnostics.slice(-120)
      },
      turns: {
        keptTurnCount: (turns || []).length,
        retainedTurnCount: (retainedTurns || []).length,
        userOnlyRetainedTurnCount: retainedTurnDiagnostics.filter((turn) => turn.userOnly).length,
        retainedTurnDiagnostics
      },
      excludedMessageReasonCounts: dropReasonCounts,
      imageSignalScan: collectLiteImageSignalScan(raw, pathIdSet)
    };
  }

  function buildLiteRewriteFlatDiagnosticsFromTrace(summary, trace) {
    const safeJson = (value) => {
      try { return JSON.stringify(value || {}); } catch { return '{}'; }
    };
    const cleanPreview = (value) => String(value || '').replace(/\s+/g, ' ').slice(0, 80);
    const messageLine = (item) => [
      `id=${item?.id || ''}`,
      `pathIndex=${item?.pathIndex ?? ''}`,
      `role=${item?.role || ''}`,
      `contentType=${item?.contentType || ''}`,
      `recipient=${item?.recipient || ''}`,
      `status=${item?.status || ''}`,
      `keep=${item?.keep === true}`,
      `selected=${item?.selected === true}`,
      `dropReason=${item?.dropReason || ''}`,
      `keptButNotRetained=${item?.keptButNotRetainedTurn === true}`,
      `textLength=${item?.textLength ?? 0}`,
      `imageContent=${item?.hasImageLikeContent === true || item?.imageLikeContent === true}`,
      `imageMetadata=${item?.hasImageLikeMetadata === true || item?.imageLikeMetadata === true}`,
      `preview=${cleanPreview(item?.textPreview)}`
    ].join(' | ');
    const imageLine = (item) => [
      messageLine(item),
      `onSelectedPath=${item?.onSelectedPath === true}`,
      `signalKeys=${Array.isArray(item?.signalKeys) ? item.signalKeys.map((x) => x?.path || x?.key || '').filter(Boolean).slice(0, 8).join(',') : ''}`
    ].join(' | ');
    const pathMessages = Array.isArray(trace?.path?.messageDiagnostics) ? trace.path.messageDiagnostics : [];
    const imageHits = Array.isArray(trace?.imageSignalScan?.hits) ? trace.imageSignalScan.hits : [];
    const retainedTurns = Array.isArray(trace?.turns?.retainedTurnDiagnostics) ? trace.turns.retainedTurnDiagnostics : [];
    const leafCandidates = Array.isArray(trace?.leafSelection?.leafCandidates) ? trace.leafSelection.leafCandidates : [];
    return {
      ok: Boolean(summary && trace && !trace.omitted),
      traceVersion: 'lite_rewrite_flat_diagnostics_v1',
      summaryFound: Boolean(summary),
      traceFound: Boolean(trace && !trace.omitted),
      traceOmittedReason: trace?.omittedReason || null,
      selectedRoleCountsText: safeJson(summary?.selectedRoleCounts || trace?.path?.selectedRoleCounts),
      selectedContentTypeCountsText: safeJson(summary?.selectedContentTypeCounts || trace?.path?.selectedContentTypeCounts),
      excludedReasonCountsText: safeJson(summary?.excludedMessageReasonCounts || trace?.excludedMessageReasonCounts),
      imageSignalRoleCountsText: safeJson(summary?.imageSignalScanSummary?.roleCounts || trace?.imageSignalScan?.roleCounts),
      imageSignalContentTypeCountsText: safeJson(summary?.imageSignalScanSummary?.contentTypeCounts || trace?.imageSignalScan?.contentTypeCounts),
      userOnlyRetainedTurnCount: summary?.userOnlyRetainedTurnCount ?? trace?.turns?.userOnlyRetainedTurnCount ?? null,
      imageSignalHitCount: summary?.imageSignalScanSummary?.hitCount ?? trace?.imageSignalScan?.hitCount ?? null,
      liteShowImages: summary?.liteShowImages !== false,
      liteImageDisplayNodeCount: summary?.liteImageDisplayNodeCount ?? null,
      liteImageDisplayNodeSamplesFlat: Array.isArray(summary?.liteImageDisplayNodes) ? summary.liteImageDisplayNodes.map((item) => [`sourceUserNodeId=${item?.sourceUserNodeId || ''}`, `sourceNodeId=${item?.nodeId || ''}`, `sourceRole=${item?.role || ''}`, `sourceContentType=${item?.contentType || ''}`, `addedPathNodeCount=${item?.addedPathNodeCount ?? ''}`].join(' | ')) : [],
      syntheticImagePlaceholderCount: summary?.syntheticImagePlaceholderCount ?? null,
      syntheticImagePlaceholderSamplesFlat: Array.isArray(summary?.syntheticImagePlaceholders) ? summary.syntheticImagePlaceholders.map((item) => [`id=${item?.id || ''}`, `sourceUserNodeId=${item?.sourceUserNodeId || ''}`, `sourceNodeId=${item?.nodeId || ''}`, `sourceRole=${item?.role || ''}`, `sourceContentType=${item?.contentType || ''}`].join(' | ')) : [],
      selectedMessageNodeIdsText: Array.isArray(trace?.path?.selectedMessageNodeIds) ? trace.path.selectedMessageNodeIds.join(',') : '',
      leafSelectionText: trace?.leafSelection ? [
        `currentNodeId=${trace.leafSelection.currentNodeId || ''}`,
        `currentNodeExists=${trace.leafSelection.currentNodeExists === true}`,
        `selectedLeafId=${trace.leafSelection.selectedLeafId || ''}`,
        `selectedLeafFromCurrentNode=${trace.leafSelection.selectedLeafFromCurrentNode === true}`,
        `leafCandidateCount=${trace.leafSelection.leafCandidateCount ?? ''}`
      ].join(' | ') : '',
      pathDropSamplesFlat: pathMessages.filter((item) => item?.dropReason || item?.keptButNotRetainedTurn).slice(-120).map(messageLine),
      pathSelectedSamplesFlat: pathMessages.filter((item) => item?.selected).slice(-120).map(messageLine),
      imageSignalHitSamplesFlat: imageHits.slice(-120).map(imageLine),
      retainedTurnSamplesFlat: retainedTurns.slice(-80).map((turn) => [
        `retainedIndex=${turn?.retainedIndex ?? ''}`,
        `originalTurnIndex=${turn?.originalTurnIndex ?? ''}`,
        `userOnly=${turn?.userOnly === true}`,
        `imageLikeNodeCount=${turn?.imageLikeNodeCount ?? 0}`,
        `roleCounts=${safeJson(turn?.roleCounts)}`,
        `contentTypeCounts=${safeJson(turn?.contentTypeCounts)}`,
        `messageIds=${Array.isArray(turn?.messageIds) ? turn.messageIds.join(',') : ''}`
      ].join(' | ')),
      leafCandidateSamplesFlat: leafCandidates.slice(0, 40).map((item) => [
        `id=${item?.id || ''}`,
        `selectedLeaf=${item?.selectedLeaf === true}`,
        `role=${item?.role || ''}`,
        `contentType=${item?.contentType || ''}`,
        `status=${item?.status || ''}`,
        `textLength=${item?.textLength ?? 0}`,
        `imageContent=${item?.hasImageLikeContent === true}`,
        `imageMetadata=${item?.hasImageLikeMetadata === true}`,
        `preview=${cleanPreview(item?.textPreview)}`
      ].join(' | '))
    };
  }

  function buildFreshLiteRewriteDiagnostic(raw, requestedTurnCount, context = {}) {
    const startedAt = Date.now();
    if (!raw || typeof raw !== 'object' || !raw.mapping || typeof raw.mapping !== 'object') {
      return {
        ok: false,
        appVersion: APP_VERSION,
        action: 'fresh_lite_rewrite_diagnostic',
        error: 'conversation mappingがありません。',
        generatedAt: startedAt,
        generatedAtIso: nowIso(),
        context: context || null
      };
    }
    try {
      const safeTurnCount = Math.max(1, Math.min(50, Number(requestedTurnCount || NATIVE_LITE_TURN_COUNT) || NATIVE_LITE_TURN_COUNT));
      const config = normalizeLiteDisplayConfig(state.liteDisplayConfig || defaultLiteDisplayConfig());
      const built = buildLiteRawForPage(raw, safeTurnCount, { liteShowImages: config.liteShowImages !== false });
      return {
        ok: true,
        appVersion: APP_VERSION,
        action: 'fresh_lite_rewrite_diagnostic',
        source: 'main_world_one_shot_lite_trace',
        generatedAt: startedAt,
        generatedAtIso: nowIso(),
        elapsedMs: Date.now() - startedAt,
        requestedTurnCount: safeTurnCount,
        conversationId: raw?.conversation_id || context?.conversationId || extractConversationIdFromCurrentUrl() || null,
        context: context || null,
        before: analyzeConversationLikeJson(raw),
        after: built?.liteRaw ? analyzeConversationLikeJson(built.liteRaw) : null,
        summary: built?.summary || null,
        liteRewriteFlatDiagnostics: built?.summary?.liteRewriteFlatDiagnostics || null
      };
    } catch (error) {
      return {
        ok: false,
        appVersion: APP_VERSION,
        action: 'fresh_lite_rewrite_diagnostic',
        source: 'main_world_one_shot_lite_trace',
        generatedAt: startedAt,
        generatedAtIso: nowIso(),
        elapsedMs: Date.now() - startedAt,
        requestedTurnCount,
        conversationId: raw?.conversation_id || context?.conversationId || extractConversationIdFromCurrentUrl() || null,
        context: context || null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  function buildLiteRawForPage(raw, requestedTurnCount, options = {}) {
    if (!raw || typeof raw !== 'object' || !raw.mapping || typeof raw.mapping !== 'object') {
      throw new Error('conversation mapping is missing.');
    }
    const root = findRootNode(raw);
    if (!root?.id) throw new Error('root node could not be detected.');
    const reachableIds = collectReachableNodeIds(raw, root);
    const latestLeaf = findLatestLeafNodeForLite(raw, reachableIds);
    if (!latestLeaf?.id) throw new Error('latest leaf node could not be detected.');
    const pathIds = buildPathFromLeaf(raw, root, latestLeaf);
    const kept = pathIds.map((id) => classifyLitePathMessage(raw, id)).filter((item) => item.keep);

    const turns = [];
    let currentTurn = null;
    for (const item of kept) {
      if (item.role === 'user') {
        currentTurn = { messages: [item] };
        turns.push(currentTurn);
      } else if (item.role === 'assistant') {
        if (!currentTurn) {
          currentTurn = { messages: [] };
          turns.push(currentTurn);
        }
        currentTurn.messages.push(item);
      }
    }

    const safeTurnCount = Math.max(1, Math.min(50, Number.isFinite(Number(requestedTurnCount)) ? Math.floor(Number(requestedTurnCount)) : 3));
    const liteShowImages = options?.liteShowImages !== false;
    if (turns.length <= safeTurnCount) {
      return {
        liteRaw: raw,
        summary: {
          ok: true,
          skipped: true,
          skipReason: 'below_lite_turn_threshold',
          strategy: 'short_conversation_noop',
          requestedTurnCount: safeTurnCount,
          displayTargetTurnCount: safeTurnCount,
          totalTurnCount: turns.length,
          retainedTurnCount: turns.length,
          retainedTurnRange: turns.length ? {
            firstTurnNumber: 1,
            lastTurnNumber: turns.length,
            totalTurnCount: turns.length
          } : null,
          pathNodeCount: pathIds.length,
          selectedMessageNodeCount: pathIds.length,
          renderedMessageNodeCount: pathIds.length,
          liteShowImages,
          syntheticImagePlaceholderCount: 0,
          syntheticImagePlaceholders: [],
          before: analyzeConversationLikeJson(raw),
          after: analyzeConversationLikeJson(raw)
        }
      };
    }
    const renderAnchorTargetExtraTurnCount = 2;
    const backendRetainedTurnCount = Math.min(turns.length, safeTurnCount + renderAnchorTargetExtraTurnCount);
    const retainedTurns = turns.slice(Math.max(0, turns.length - backendRetainedTurnCount));
    const selectedSet = new Set();
    for (const turn of retainedTurns) {
      for (const item of turn.messages || []) selectedSet.add(item.id);
    }
    const orderedSelectedNodeIds = pathIds.filter((id) => selectedSet.has(id));
    if (!orderedSelectedNodeIds.length) throw new Error('No message node was selected for Lite display.');

    const retainedUserNodeIds = retainedTurns
      .map((turn) => (turn.messages || []).find((item) => item.role === 'user')?.id)
      .filter(Boolean);
    const retainedUserNodeIdSet = new Set(retainedUserNodeIds);
    const userOnlyTurnIds = new Set(retainedTurns
      .filter((turn) => {
        const roles = new Set((turn.messages || []).map((item) => item.role));
        return roles.has('user') && !roles.has('assistant');
      })
      .map((turn) => (turn.messages || []).find((item) => item.role === 'user')?.id)
      .filter(Boolean));
    const syntheticPlaceholderNodeById = new Map();
    const syntheticPlaceholderDiagnostics = [];
    const imageDisplayDiagnostics = [];
    const renderNodeIds = [];
    const renderNodeIdSet = new Set();
    const appendRenderNodeId = (nodeId) => {
      if (!nodeId || renderNodeIdSet.has(nodeId)) return false;
      if (!raw?.mapping?.[nodeId] && !syntheticPlaceholderNodeById.has(nodeId)) return false;
      renderNodeIds.push(nodeId);
      renderNodeIdSet.add(nodeId);
      return true;
    };
    for (const id of orderedSelectedNodeIds) {
      appendRenderNodeId(id);
      if (!userOnlyTurnIds.has(id)) continue;
      const sourceSignal = findLiteImageSignalAfterUser(raw, pathIds, id, retainedUserNodeIdSet);
      if (!sourceSignal) continue;
      if (liteShowImages) {
        const sourceIndex = pathIds.indexOf(id);
        const signalIndex = pathIds.indexOf(sourceSignal.nodeId);
        const imagePathNodeIds = signalIndex > sourceIndex
          ? pathIds.slice(sourceIndex + 1, signalIndex + 1)
          : [sourceSignal.nodeId].filter(Boolean);
        const addedPathNodeIds = [];
        for (const imagePathNodeId of imagePathNodeIds) {
          if (appendRenderNodeId(imagePathNodeId)) addedPathNodeIds.push(imagePathNodeId);
        }
        if (addedPathNodeIds.length > 0) {
          imageDisplayDiagnostics.push({
            sourceUserNodeId: id,
            ...sourceSignal,
            addedPathNodeCount: addedPathNodeIds.length,
            addedPathNodeIds
          });
        } else {
          const syntheticNode = createSyntheticLiteImagePlaceholderNode(id, sourceSignal, syntheticPlaceholderNodeById.size + 1);
          syntheticPlaceholderNodeById.set(syntheticNode.id, syntheticNode);
          syntheticPlaceholderDiagnostics.push({ id: syntheticNode.id, sourceUserNodeId: id, fallbackReason: 'lite_show_images_no_image_path_nodes_added', ...sourceSignal });
          appendRenderNodeId(syntheticNode.id);
        }
        continue;
      }
      const syntheticNode = createSyntheticLiteImagePlaceholderNode(id, sourceSignal, syntheticPlaceholderNodeById.size + 1);
      syntheticPlaceholderNodeById.set(syntheticNode.id, syntheticNode);
      syntheticPlaceholderDiagnostics.push({ id: syntheticNode.id, sourceUserNodeId: id, ...sourceSignal });
      appendRenderNodeId(syntheticNode.id);
    }

    const liteMapping = {};
    const rootClone = JSON.parse(JSON.stringify(root));
    rootClone.children = [];
    rootClone.parent = null;
    liteMapping[root.id] = rootClone;
    const chain = [root.id];

    for (const id of renderNodeIds) {
      const original = syntheticPlaceholderNodeById.get(id) || raw.mapping[id];
      if (!original) continue;
      const clone = JSON.parse(JSON.stringify(original));
      if (!liteShowImages && !syntheticPlaceholderNodeById.has(id)) applyLiteImagePlaceholderToMessage(clone?.message);
      clone.children = [];
      liteMapping[id] = clone;
      chain.push(id);
    }

    for (let i = 0; i < chain.length; i += 1) {
      const id = chain[i];
      const prev = chain[i - 1] || null;
      const next = chain[i + 1] || null;
      if (!liteMapping[id]) continue;
      liteMapping[id].parent = prev;
      liteMapping[id].children = next ? [next] : [];
    }

    const liteRaw = JSON.parse(JSON.stringify(raw));
    liteRaw.mapping = liteMapping;
    liteRaw.current_node = chain[chain.length - 1] || raw.current_node || null;
    const liteSummary = {
      ok: true,
      strategy: 'reparent_latest_path_recent_turns_experimental',
      requestedTurnCount: safeTurnCount,
      displayTargetTurnCount: safeTurnCount,
      backendRetainedTurnCount,
      renderAnchorTargetExtraTurnCount,
      renderAnchorExtraTurnCount: Math.max(0, retainedTurns.length - safeTurnCount),
      totalTurnCount: turns.length,
      retainedTurnCount: retainedTurns.length,
      retainedTurnRange: retainedTurns.length ? {
        firstTurnNumber: turns.length - retainedTurns.length + 1,
        lastTurnNumber: turns.length,
        totalTurnCount: turns.length
      } : null,
      pathNodeCount: pathIds.length,
      selectedMessageNodeCount: orderedSelectedNodeIds.length,
      renderedMessageNodeCount: Math.max(0, chain.length - 1),
      liteShowImages,
      liteImageDisplayNodeCount: imageDisplayDiagnostics.length,
      liteImageDisplayNodes: imageDisplayDiagnostics,
      syntheticImagePlaceholderCount: syntheticPlaceholderDiagnostics.length,
      syntheticImagePlaceholders: syntheticPlaceholderDiagnostics
    };

    return {
      liteRaw,
      summary: {
        ...liteSummary,
        simulatedChainNodeCount: chain.length,
        before: analyzeConversationLikeJson(raw),
        after: analyzeConversationLikeJson(liteRaw)
      }
    };
  }

  function getPublicLiteDisplayState() {
    const config = normalizeLiteDisplayConfig(state.liteDisplayConfig || defaultLiteDisplayConfig());
    const conversationIdSync = getConversationIdSyncDiagnostic();
    return {
      enabled: config.enabled,
      conversationId: config.conversationId,
      turnCount: config.turnCount,
      baseTurnCount: config.baseTurnCount,
      turnCountOverride: config.turnCountOverride,
      turnCountOverrideConversationId: config.turnCountOverrideConversationId,
      updatedAt: config.updatedAt,
      updatedAtIso: config.updatedAtIso,
      defaultOn: Boolean(config.defaultOn),
      captureMode: Boolean(config.captureMode),
      historySearchBypass: Boolean(config.historySearchBypass),
      configSource: config.configSource || null,
      isCaptureUrl: getArcaiaCaptureMode().enabled,
      backendRewriteEnabled: Boolean(config.backendRewriteEnabled),
      backendRewriteExperiment: Boolean(config.backendRewriteExperiment),
      liteShowImages: config.liteShowImages !== false,
      fullLoadOnce: Boolean(config.fullLoadOnce),
      fullLoadConversationId: config.fullLoadConversationId || null,
      fullLoadExpiresAt: config.fullLoadExpiresAt || null,
      extensionEnabled: isMainExtensionEnabled(),
      rewriteCount: state.liteDisplayRewriteCount || 0,
      liteDisplayRewriteCount: state.liteDisplayRewriteCount || 0,
      lastRewrite: state.liteDisplayLastRewrite || null,
      liteDisplayLastRewrite: state.liteDisplayLastRewrite || null,
      messageTimestampIndexSummary: state.messageTimestampIndex ? {
        ok: Boolean(state.messageTimestampIndex.ok),
        conversationId: state.messageTimestampIndex.conversationId || null,
        messageCount: state.messageTimestampIndex.messageCount || 0,
        updatedAtIso: state.messageTimestampIndex.updatedAtIso || null,
        updateCount: state.messageTimestampIndexUpdateCount || 0
      } : null,
      storageKey: LITE_STORAGE_KEY,
      pageConversationId: conversationIdSync.currentConversationId,
      conversationIdMismatch: conversationIdSync.mismatch,
      conversationIdWarning: conversationIdSync.warning,
      note: config.backendRewriteEnabled
        ? 'Backend rewrite ON: 通常ページの /backend-api/conversation response rewrite を有効化し、描画対象payloadを縮小しています。'
        : '通常ページの /backend-api/conversation response rewrite はOFFです。既存conversation fetchからmessage timestamp indexを抽出します。'
    };
  }

  function setLiteDisplayConfig(config) {
    const previous = getPublicLiteDisplayState();
    const capture = getArcaiaCaptureMode();
    let normalized;
    let storageCleared = false;
    let storageWritten = false;

    if (capture.enabled) {
      normalized = normalizeLiteDisplayConfig({});
      state.liteDisplayConfig = normalized;
      return { ...getPublicLiteDisplayState(), previous, ignoredWrite: true, reason: 'capture_mode_does_not_persist_lite_config' };
    }

    if (config?.resetStorageBeforeSet || config?.replaceExisting) {
      storageCleared = clearLiteDisplayConfigFromStorage();
    }

    const base = config?.replaceExisting ? defaultLiteDisplayConfig() : (state.liteDisplayConfig || defaultLiteDisplayConfig());
    const merged = { ...base, ...(config || {}) };
    const hasExplicitTurnCount = Object.prototype.hasOwnProperty.call(config || {}, 'turnCount');
    const hasExplicitBaseTurnCount = Object.prototype.hasOwnProperty.call(config || {}, 'baseTurnCount');
    const hasExplicitTurnCountOverride = Object.prototype.hasOwnProperty.call(config || {}, 'turnCountOverride')
      || Object.prototype.hasOwnProperty.call(config || {}, 'turnCountOverrideConversationId');
    if (hasExplicitTurnCount && !hasExplicitBaseTurnCount && !hasExplicitTurnCountOverride) {
      merged.baseTurnCount = config.turnCount;
    }
    if (config?.clearTurnCountOverride) {
      merged.turnCountOverride = null;
      merged.turnCountOverrideConversationId = null;
    }
    const hasExplicitEnabled = Object.prototype.hasOwnProperty.call(config || {}, 'enabled');
    if (config?.clearFullLoadMode) {
      merged.fullLoadOnce = false;
      merged.fullLoadConversationId = null;
      merged.fullLoadExpiresAt = null;
      merged.fullLoadRequestedAt = null;
    }
    if (hasExplicitEnabled && merged.enabled === false) {
      merged.userDisabled = true;
      merged.configSource = 'popup_disable';
    } else if (hasExplicitEnabled && merged.enabled === true) {
      merged.userDisabled = false;
    }
    if (merged.enabled !== false && !merged.conversationId) merged.conversationId = extractConversationIdFromCurrentUrl();
    normalized = normalizeLiteDisplayConfig(merged);
    normalized.updatedAt = Date.now();
    normalized.updatedAtIso = nowIso(normalized.updatedAt);
    normalized.configSource = merged.configSource || (config?.replaceExisting ? 'popup_replace' : 'popup_merge');
    if (!normalized.enabled) normalized.conversationId = null;
    state.liteDisplayConfig = normalized;
    writeLiteDisplayConfigToStorage(normalized);
    storageWritten = true;
    const result = { ...getPublicLiteDisplayState(), previous, appliedPayload: config || {}, storageCleared, storageWritten };
    emitMainEvent('lite_config_set_runtime', {
      requestedEnabled: config?.enabled,
      hasExplicitEnabled,
      resultingEnabled: result.enabled,
      userDisabled: result.userDisabled,
      configSource: result.configSource,
      conversationId: result.conversationId,
      turnCount: result.turnCount,
      baseTurnCount: result.baseTurnCount,
      turnCountOverride: result.turnCountOverride,
      turnCountOverrideConversationId: result.turnCountOverrideConversationId,
      backendRewriteEnabled: Boolean(result.backendRewriteEnabled),
      backendRewriteExperiment: Boolean(result.backendRewriteExperiment),
      liteShowImages: result.liteShowImages !== false
    });
    return result;
  }

  function getLiteDisplayInternalDiagnostic() {
    const capture = getArcaiaCaptureMode();
    const conversationIdSync = getConversationIdSyncDiagnostic();
    const normalizedConfig = normalizeLiteDisplayConfig(state.liteDisplayConfig || defaultLiteDisplayConfig());
    return {
      ok: true,
      appVersion: APP_VERSION,
      url: window.location.href,
      isTopWindow: window.top === window,
      historySearchBypass: Boolean(normalizedConfig.historySearchBypass),
      explicitDiagnostic: true,
      captureMode: capture,
      storageKey: LITE_STORAGE_KEY,
      rawStorage: readLiteDisplayRawStorageForDebug(),
      stateLiteDisplayConfig: state.liteDisplayConfig || null,
      publicLiteDisplay: getPublicLiteDisplayState(),
      currentConversationId: conversationIdSync.currentConversationId,
      conversationIdMismatch: conversationIdSync.mismatch,
      conversationIdWarning: conversationIdSync.warning,
      backendRewriteEnabled: Boolean(normalizedConfig.backendRewriteEnabled),
      backendRewriteExperiment: Boolean(normalizedConfig.backendRewriteExperiment),
      rewriteCount: state.liteDisplayRewriteCount || 0,
      liteDisplayRewriteCount: state.liteDisplayRewriteCount || 0,
      lastRewrite: state.liteDisplayLastRewrite || null,
      liteDisplayLastRewrite: state.liteDisplayLastRewrite || null,
      messageTimestampIndex: state.messageTimestampIndex || null,
      messageTimestampIndexSummary: state.messageTimestampIndex ? {
        ok: Boolean(state.messageTimestampIndex.ok),
        conversationId: state.messageTimestampIndex.conversationId || null,
        messageCount: state.messageTimestampIndex.messageCount || 0,
        updatedAtIso: state.messageTimestampIndex.updatedAtIso || null
      } : null,
      messageTimestampIndexUpdateCount: state.messageTimestampIndexUpdateCount || 0
    };
  }

  function isConversationJsonFetchResponse(method, url, response) {
    if (String(method || 'GET').toUpperCase() !== 'GET') return false;
    if (!response || !response.ok || typeof response.clone !== 'function') return false;
    if (!extractConversationIdFromConversationDetailUrl(url)) return false;
    const contentType = response.headers?.get?.('content-type') || '';
    return contentType.includes('application/json') || contentType === '';
  }

  function shouldProcessConversationFetchResponse(method, url, response) {
    if (isConversationJsonFetchResponse(method, url, response)) return true;
    return false;
  }

  function shouldApplyLiteDisplayToFetch(url, method, response) {
    if (!isMainExtensionEnabled()) return false;
    const config = normalizeLiteDisplayConfig(state.liteDisplayConfig || defaultLiteDisplayConfig());
    if (config.historySearchBypass) return false;
    if (!config.enabled) return false;
    if (!isConversationJsonFetchResponse(method, url, response)) return false;
    const conversationId = extractConversationIdFromConversationDetailUrl(url);
    if (!conversationId) return false;
    if (config.fullLoadOnce && config.fullLoadConversationId === conversationId && Number(config.fullLoadExpiresAt || 0) > Date.now()) {
      state.liteDisplayConfig = {
        ...config,
        fullLoadOnce: false,
        fullLoadConsumedAt: Date.now(),
        configSource: 'full_load_once_consumed'
      };
      writeLiteDisplayConfigToStorage(state.liteDisplayConfig);
      state.liteDisplayLastRewrite = {
        ok: true,
        skipped: true,
        reason: 'full_load_once',
        at: Date.now(),
        atIso: nowIso(),
        url: safeUrlInfo(url)
      };
      return false;
    }
    if (config.conversationId && conversationId !== config.conversationId) return false;
    // document_start時点でconversationIdが未確定でも、最初のconversation_detail fetchで確定させる。
    if (!config.conversationId) {
      state.liteDisplayConfig = { ...config, conversationId, configSource: config.configSource || 'default_on_first_fetch' };
      writeLiteDisplayConfigToStorage(state.liteDisplayConfig);
    }
    if (!config.backendRewriteEnabled) {
      state.liteDisplayLastRewrite = {
        ok: true,
        skipped: true,
        reason: 'backend_rewrite_disabled',
        at: Date.now(),
        atIso: nowIso(),
        url: safeUrlInfo(url),
        note: 'backendRewriteEnabled=falseのためconversation JSON rewriteをスキップしました。'
      };
      return false;
    }
    return true;
  }

  async function maybeRewriteFetchResponseForLiteDisplay(method, url, response) {
    const startedAt = Date.now();
    let text = null;
    let raw = null;
    const conversationFetch = shouldProcessConversationFetchResponse(method, url, response);
    if (conversationFetch) {
      try {
        text = await response.clone().text();
        raw = JSON.parse(text);
        observeMessageTimestampIndexFromConversation(raw, url, 'conversation_fetch_response');
        observeCurrentConversationModelConfig(raw, url, 'conversation_fetch_response');
      } catch (error) {
        state.messageTimestampIndex = {
          ok: false,
          appVersion: APP_VERSION,
          source: 'main_world_existing_conversation_fetch',
          updatedAt: Date.now(),
          updatedAtIso: nowIso(),
          conversationId: extractConversationIdFromConversationDetailUrl(url),
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
    if (!shouldApplyLiteDisplayToFetch(url, method, response)) return response;
    try {
      const config = normalizeLiteDisplayConfig(state.liteDisplayConfig || {});
      if (!text || !raw) {
        text = await response.clone().text();
        raw = JSON.parse(text);
        observeMessageTimestampIndexFromConversation(raw, url, 'conversation_fetch_response_before_rewrite');
        observeCurrentConversationModelConfig(raw, url, 'conversation_fetch_response_before_rewrite');
      }
      const { liteRaw, summary } = buildLiteRawForPage(raw, config.turnCount, { liteShowImages: config.liteShowImages !== false });
      if (summary?.skipped) {
        state.liteDisplayLastRewrite = {
          ok: true,
          skipped: true,
          reason: summary.skipReason || 'lite_rewrite_skipped',
          at: Date.now(),
          atIso: nowIso(),
          url: safeUrlInfo(url),
          elapsedMs: Date.now() - startedAt,
          summary
        };
        return response;
      }
      const rewrittenText = JSON.stringify(liteRaw);
      const headers = new Headers(response.headers || undefined);
      try { headers.delete('content-length'); } catch {}
      if (!headers.get('content-type')) headers.set('content-type', 'application/json');
      const beforeBytes = new TextEncoder().encode(text).length;
      const afterBytes = new TextEncoder().encode(rewrittenText).length;
      state.liteDisplayRewriteCount = (state.liteDisplayRewriteCount || 0) + 1;
      state.liteDisplayLastRewrite = {
        ok: true,
        at: Date.now(),
        atIso: nowIso(),
        url: safeUrlInfo(url),
        elapsedMs: Date.now() - startedAt,
        beforeBytes,
        afterBytes,
        bytesReductionPct: beforeBytes ? Number(((1 - afterBytes / beforeBytes) * 100).toFixed(2)) : null,
        summary
      };
      emitMainEvent('lite_rewrite_success', {
        conversationId: extractConversationIdFromConversationDetailUrl(url),
        beforeBytes,
        afterBytes,
        bytesReductionPct: state.liteDisplayLastRewrite.bytesReductionPct,
        retainedTurnCount: summary?.retainedTurnCount || null,
        totalTurnCount: summary?.totalTurnCount || null,
        turnCount: config.turnCount,
        url: safeUrlInfo(url)
      });
      return new Response(rewrittenText, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      state.liteDisplayLastRewrite = {
        ok: false,
        at: Date.now(),
        atIso: nowIso(),
        url: safeUrlInfo(url),
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      };
      emitMainEvent('lite_rewrite_failure', {
        conversationId: extractConversationIdFromConversationDetailUrl(url),
        error: state.liteDisplayLastRewrite.error,
        url: safeUrlInfo(url)
      });
      return response;
    }
  }

  function recordResponseProbe(kind, method, url, responseMeta, textOrJson) {
    if (!isConversationHistoryUrl(url)) return;
    const at = Date.now();
    const text = typeof textOrJson === 'string' ? textOrJson : null;
    const json = text ? maybeParseJsonText(text) : (textOrJson && typeof textOrJson === 'object' ? textOrJson : null);
    const approxBytes = text ? new TextEncoder().encode(text).length : null;
    const urlInfo = safeUrlInfo(url);
    const analysis = json ? analyzeConversationLikeJson(json) : null;
    pushLimited(state.responseProbes, {
      at,
      atIso: nowIso(at),
      kind,
      method: method || 'GET',
      url: urlInfo,
      response: responseMeta || {},
      approxBodyBytes: approxBytes,
      parsedJson: Boolean(json),
      historyShape: analysis,
      note: 'Response body was inspected for aggregate metadata only. Full message text is not stored in this probe log.'
    });
  }

  function isHistoryProbeArmed() {
    return Date.now() < (state.historyProbeArmedUntil || 0);
  }

  function armHistoryProbe(durationMs = 20000) {
    state.historyProbeArmedUntil = Math.max(state.historyProbeArmedUntil || 0, Date.now() + durationMs);
  }

  function inspectFetchResponseAsync(kind, method, url, response) {
    try {
      if (!isHistoryProbeArmed()) return;
      if (!isConversationHistoryUrl(url) || !response || typeof response.clone !== 'function') return;
      const responseMeta = {
        status: response.status,
        ok: response.ok,
        redirected: response.redirected,
        type: response.type,
        contentType: response.headers?.get?.('content-type') || null,
        contentLength: response.headers?.get?.('content-length') || null
      };
      response.clone().text()
        .then((text) => recordResponseProbe(kind, method, url, responseMeta, text))
        .catch((error) => recordResponseProbe(kind, method, url, { ...responseMeta, probeError: error instanceof Error ? error.message : String(error) }, null));
    } catch {}
  }

  function inspectXhrResponseAsync(xhr) {
    try {
      if (!isHistoryProbeArmed()) return;
      const url = xhr.__aice_probe_url;
      if (!isConversationHistoryUrl(url)) return;
      const contentType = typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('content-type') : null;
      const contentLength = typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('content-length') : null;
      const responseMeta = {
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        contentType,
        contentLength,
        responseType: xhr.responseType || ''
      };
      let body = null;
      if (!xhr.responseType || xhr.responseType === 'text') body = xhr.responseText;
      else if (xhr.responseType === 'json') body = xhr.response;
      recordResponseProbe('xhr_response', xhr.__aice_probe_method, url, responseMeta, body);
    } catch (error) {
      try {
        recordResponseProbe('xhr_response', xhr.__aice_probe_method, xhr.__aice_probe_url, { probeError: error instanceof Error ? error.message : String(error) }, null);
      } catch {}
    }
  }

  function rememberObservation(kind, method, url, headersLike) {
    if (!shouldObserve(url)) return;

    const at = Date.now();
    const headers = collectHeaders(headersLike);
    const authorization = getHeaderCaseInsensitive(headers, 'authorization');
    const extraHeaders = extractExtraHeaders(headers);

    if (url && String(url).includes(TARGET_PATH)) {
      if (authorization) state.authorization = authorization;
      if (Object.keys(extraHeaders).length > 0) {
        state.extraHeaders = { ...state.extraHeaders, ...extraHeaders };
      }
      state.updatedAt = at;
    }

  }

  function publicSnapshot() {
    return {
      ok: true,
      appVersion: APP_VERSION,
      mainWorldHook: {
        installed: state.installed,
        installedAt: state.installedAt,
        installedAtIso: nowIso(state.installedAt),
        protocolSource: MAIN_PROTOCOL_SOURCE,
        runtimeActive: Boolean(state.runtimeActive),
        fetchHooked: state.fetchHooked,
        xhrHooked: state.xhrHooked,
        historyHooked: state.historyHooked,
        hasAuthorization: Boolean(state.authorization),
        updatedAt: state.updatedAt,
        updatedAtIso: state.updatedAt ? nowIso(state.updatedAt) : null,
        liteDisplay: getPublicLiteDisplayState()
      }
    };
  }

  let liteConversationSyncPopstateHandler = null;
  let liteConversationSyncHashchangeHandler = null;

  function handleMainWorldNavigation(reason = 'navigation', { force = false } = {}) {
    if (!isMainExtensionEnabled()) return { changed: false, skipped: true, reason: 'extension_disabled' };
    const previousPageUrl = state.observedPageUrl || null;
    const previousConversationId = state.observedPageConversationId || null;
    const pageUrl = window.location.href;
    const conversationId = extractConversationIdFromCurrentUrl();
    const urlChanged = previousPageUrl !== pageUrl;
    const conversationChanged = previousConversationId !== conversationId;
    state.observedPageUrl = pageUrl;
    state.observedPageConversationId = conversationId;
    const syncResult = syncLiteDisplayConversationId(reason);
    if (force || urlChanged || conversationChanged) {
      emitMainEvent('page_navigation', {
        reason,
        previousPageUrl,
        pageUrl,
        previousConversationId,
        conversationId,
        urlChanged,
        conversationChanged,
        liteDisplayChanged: Boolean(syncResult?.changed),
        conversationIdMismatch: Boolean(syncResult?.mismatch),
        conversationIdWarning: syncResult?.warning || null
      });
    }
    return { ...syncResult, urlChanged, conversationChanged, pageUrl, conversationId };
  }

  function installMainWorldHistoryHooks() {
    try {
      const methods = [
        ['pushState', 'originalHistoryPushState', 'historyPushStateWrapper'],
        ['replaceState', 'originalHistoryReplaceState', 'historyReplaceStateWrapper']
      ];
      let installedCount = 0;
      for (const [methodName, originalKey, wrapperKey] of methods) {
        const current = window.history?.[methodName];
        if (current === state[wrapperKey]) {
          installedCount += 1;
          continue;
        }
        const original = current;
        if (typeof original !== 'function') continue;
        state[originalKey] = original;
        const wrapped = function arcaiaMainWorldHistoryHook(...args) {
          const result = original.apply(this, args);
          handleMainWorldNavigation(`history_${methodName}`);
          return result;
        };
        try {
          Object.defineProperty(wrapped, '__arcaiaMainWorldHistoryWrapped', { value: true });
          Object.defineProperty(wrapped, '__arcaiaMainWorldHistoryOriginal', { value: original });
        } catch {}
        state[wrapperKey] = wrapped;
        window.history[methodName] = wrapped;
        if (window.history?.[methodName] === state[wrapperKey]) installedCount += 1;
      }
      state.historyHooked = installedCount === methods.length;
      return state.historyHooked;
    } catch {
      state.historyHooked = false;
      return false;
    }
  }

  function uninstallMainWorldHistoryHooks() {
    const methods = [
      ['pushState', 'originalHistoryPushState', 'historyPushStateWrapper'],
      ['replaceState', 'originalHistoryReplaceState', 'historyReplaceStateWrapper']
    ];
    for (const [methodName, originalKey, wrapperKey] of methods) {
      try {
        if (window.history?.[methodName] === state[wrapperKey] && typeof state[originalKey] === 'function') {
          window.history[methodName] = state[originalKey];
        }
      } catch {}
      state[originalKey] = null;
      state[wrapperKey] = null;
    }
    state.historyHooked = false;
  }

  function startMainWorldRuntime(reason = 'startup') {
    if (state.runtimeActive || !isMainExtensionEnabled()) return;
    state.runtimeActive = true;
    installNetworkHooks();
    installMainWorldHistoryHooks();
    liteConversationSyncPopstateHandler = () => handleMainWorldNavigation('popstate');
    liteConversationSyncHashchangeHandler = () => handleMainWorldNavigation('hashchange');
    window.addEventListener('popstate', liteConversationSyncPopstateHandler);
    window.addEventListener('hashchange', liteConversationSyncHashchangeHandler);
    handleMainWorldNavigation(reason, { force: true });
  }

  function stopMainWorldRuntime(reason = 'extension_disabled') {
    if (liteConversationSyncPopstateHandler) window.removeEventListener('popstate', liteConversationSyncPopstateHandler);
    if (liteConversationSyncHashchangeHandler) window.removeEventListener('hashchange', liteConversationSyncHashchangeHandler);
    liteConversationSyncPopstateHandler = null;
    liteConversationSyncHashchangeHandler = null;
    uninstallMainWorldHistoryHooks();
    uninstallNetworkHooks();
    state.runtimeActive = false;
    state.runtimeStoppedReason = reason;
    state.runtimeStoppedAt = Date.now();
  }

  state.stopMainWorldRuntime = stopMainWorldRuntime;
  state.publicSnapshot = publicSnapshot;
  if (state.extensionEnabled) startMainWorldRuntime('startup');

  function installNetworkHooks() {
    try {
      if (!state.fetchHooked) state.originalFetch = window.fetch;
      if (typeof state.originalFetch === 'function' && !state.fetchHooked) {
        window.fetch = function patchedFetch(input, init) {
          let url = null;
          let method = 'GET';
          let observedRequest = false;
          try {
            url = toAbsoluteUrl(input);
            method = init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET');
            observedRequest = shouldObserve(url);
            if (!observedRequest) return state.originalFetch.apply(this, arguments);
            const requestHeaders = (typeof Request !== 'undefined' && input instanceof Request) ? input.headers : null;
            const initHeaders = init && init.headers ? init.headers : null;
            rememberObservation('fetch', method, url, mergeHeaderSources(requestHeaders, initHeaders));
          } catch {}
          const fetchPromise = state.originalFetch.apply(this, arguments);
          if (!observedRequest) return fetchPromise;
          try {
            return Promise.resolve(fetchPromise).then(async (response) => {
              if (!isMainExtensionEnabled()) return response;
              try {
                inspectFetchResponseAsync('fetch_response', method, url, response);
              } catch {}
              try {
                if (url && shouldProcessConversationFetchResponse(method, url, response)) {
                  return await maybeRewriteFetchResponseForLiteDisplay(method, url, response);
                }
              } catch {}
              return response;
            });
          } catch {
            return fetchPromise;
          }
        };
        state.fetchHooked = true;
      }
    } catch {}

    try {
      if (!state.xhrHooked) {
        state.originalXHROpen = XMLHttpRequest.prototype.open;
        state.originalXHRSend = XMLHttpRequest.prototype.send;
        state.originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
      }
      if (state.xhrHooked) return;

      XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
        try {
          this.__aice_probe_method = method || 'GET';
          this.__aice_probe_url = toAbsoluteUrl(url);
          this.__aice_probe_observed = shouldObserve(this.__aice_probe_url);
          this.__aice_probe_headers = this.__aice_probe_observed ? {} : null;
        } catch {}
        return state.originalXHROpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
        try {
          if (!this.__aice_probe_observed) return state.originalXHRSetRequestHeader.apply(this, arguments);
          if (!this.__aice_probe_headers) this.__aice_probe_headers = {};
          this.__aice_probe_headers[name] = value;
        } catch {}
        return state.originalXHRSetRequestHeader.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function patchedSend() {
        try {
          if (!this.__aice_probe_observed) return state.originalXHRSend.apply(this, arguments);
          rememberObservation('xhr', this.__aice_probe_method, this.__aice_probe_url, this.__aice_probe_headers || {});
          if (isHistoryProbeArmed() && isConversationHistoryUrl(this.__aice_probe_url)) {
            this.addEventListener('loadend', () => {
              if (!isMainExtensionEnabled()) return;
              inspectXhrResponseAsync(this);
            }, { once: true });
          }
        } catch {}
        return state.originalXHRSend.apply(this, arguments);
      };
      state.xhrHooked = true;
    } catch {}
  }

  function uninstallNetworkHooks() {
    try {
      if (state.fetchHooked && typeof state.originalFetch === 'function') window.fetch = state.originalFetch;
    } catch {}
    try {
      if (state.xhrHooked && state.originalXHROpen) XMLHttpRequest.prototype.open = state.originalXHROpen;
      if (state.xhrHooked && state.originalXHRSend) XMLHttpRequest.prototype.send = state.originalXHRSend;
      if (state.xhrHooked && state.originalXHRSetRequestHeader) XMLHttpRequest.prototype.setRequestHeader = state.originalXHRSetRequestHeader;
    } catch {}
    state.fetchHooked = false;
    state.xhrHooked = false;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== CONTENT_PROTOCOL_SOURCE) return;

    if (data.type === 'GET_CHATGPT_AUTH') {
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'CHATGPT_AUTH_RESULT',
        requestId: data.requestId,
        payload: {
          authorization: state.authorization,
          extraHeaders: state.extraHeaders,
          updatedAt: state.updatedAt,
          seenUrlCount: state.observations.length,
          lastSeenUrl: state.observations.length ? state.observations[state.observations.length - 1].url.hrefRedacted : null,
          debug: publicSnapshot()
        }
      }, '*');
      return;
    }

    if (data.type === 'ARM_HISTORY_FETCH_PROBE') {
      armHistoryProbe(Number(data.durationMs) || 20000);
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'HISTORY_FETCH_PROBE_ARMED',
        requestId: data.requestId,
        payload: publicSnapshot()
      }, '*');
      return;
    }

    if (data.type === 'SYNC_PAGE_CONVERSATION') {
      const historyHooksReady = installMainWorldHistoryHooks();
      const syncResult = handleMainWorldNavigation(data.payload?.reason || 'content_sync');
      const requestedConversationId = String(data.payload?.conversationId || '').trim();
      const conversationModelConfig = getConversationModelConfigForContent(requestedConversationId);
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'PAGE_CONVERSATION_SYNC_RESULT',
        requestId: data.requestId,
        payload: {
          ok: true,
          appVersion: APP_VERSION,
          ...syncResult,
          historyHooksReady,
          conversationModelConfig: conversationModelConfig || null,
          conversationIdMismatch: Boolean(syncResult.mismatch),
          conversationIdWarning: syncResult.warning || null,
          liteDisplay: getPublicLiteDisplayState()
        }
      }, '*');
      return;
    }

    if (data.type === 'SET_LITE_DISPLAY_CONFIG') {
      const liteDisplay = setLiteDisplayConfig(data.payload || {});
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'LITE_DISPLAY_CONFIG_SET',
        requestId: data.requestId,
        payload: { ok: true, appVersion: APP_VERSION, liteDisplay, mainWorldHook: publicSnapshot().mainWorldHook }
      }, '*');
      return;
    }

    if (data.type === 'GET_LITE_DISPLAY_CONFIG') {
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'LITE_DISPLAY_CONFIG_RESULT',
        requestId: data.requestId,
        payload: { ok: true, appVersion: APP_VERSION, liteDisplay: getPublicLiteDisplayState(), mainWorldHook: publicSnapshot().mainWorldHook }
      }, '*');
      return;
    }

    if (data.type === 'GET_MESSAGE_TIMESTAMP_INDEX') {
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'MESSAGE_TIMESTAMP_INDEX_RESULT',
        requestId: data.requestId,
        payload: getMessageTimestampIndexForContent(data.payload?.conversationId || null)
      }, '*');
      return;
    }

    if (data.type === 'RESET_LITE_DISPLAY_CONFIG') {
      const storageCleared = clearLiteDisplayConfigFromStorage();
      state.liteDisplayConfig = defaultLiteDisplayConfig();
      state.liteDisplayRewriteCount = 0;
      state.liteDisplayLastRewrite = null;
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'LITE_DISPLAY_CONFIG_RESET',
        requestId: data.requestId,
        payload: { ok: true, appVersion: APP_VERSION, storageCleared, liteDisplay: getPublicLiteDisplayState(), mainWorldHook: publicSnapshot().mainWorldHook }
      }, '*');
      return;
    }

    if (data.type === 'GET_LITE_DISPLAY_INTERNAL_DIAGNOSTIC') {
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'LITE_DISPLAY_INTERNAL_DIAGNOSTIC_RESULT',
        requestId: data.requestId,
        payload: getLiteDisplayInternalDiagnostic()
      }, '*');
      return;
    }

    if (data.type === 'BUILD_LITE_REWRITE_DIAGNOSTIC') {
      const raw = data.payload?.raw || null;
      const turnCount = data.payload?.turnCount || data.payload?.requestedTurnCount || NATIVE_LITE_TURN_COUNT;
      const context = data.payload?.context || {};
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'LITE_REWRITE_DIAGNOSTIC_RESULT',
        requestId: data.requestId,
        payload: buildFreshLiteRewriteDiagnostic(raw, turnCount, context)
      }, '*');
      return;
    }

    if (data.type === 'SET_EXTENSION_ENABLED') {
      state.extensionEnabled = Boolean(data.payload?.enabled);
      writeExtensionEnabledToStorage(state.extensionEnabled);
      if (state.extensionEnabled) startMainWorldRuntime(data.payload?.reason || 'extension_enabled');
      else stopMainWorldRuntime(data.payload?.reason || 'extension_disabled');
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'EXTENSION_ENABLED_SET_RESULT',
        requestId: data.requestId,
        payload: {
          ok: true,
          appVersion: APP_VERSION,
          extensionEnabled: state.extensionEnabled,
          runtimeActive: Boolean(state.runtimeActive),
          fetchHooked: Boolean(state.fetchHooked),
          xhrHooked: Boolean(state.xhrHooked),
          historyHooked: Boolean(state.historyHooked),
          liteDisplay: getPublicLiteDisplayState()
        }
      }, '*');
      return;
    }

    if (data.type === 'REQUEST_FULL_LOAD_ONCE') {
      const conversationId = data.payload?.conversationId || extractConversationIdFromCurrentUrl();
      const expiresMs = Math.max(10000, Math.min(300000, Number(data.payload?.expiresMs || 90000)));
      const now = Date.now();
      const liteDisplay = setLiteDisplayConfig({
        enabled: true,
        conversationId,
        fullLoadOnce: true,
        fullLoadConversationId: conversationId,
        fullLoadRequestedAt: now,
        fullLoadExpiresAt: now + expiresMs,
        userDisabled: false,
        configSource: 'full_load_once_requested',
        requestedBy: data.payload?.reason || 'load_full'
      });
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'FULL_LOAD_ONCE_RESULT',
        requestId: data.requestId,
        payload: { ok: true, appVersion: APP_VERSION, conversationId, expiresAt: now + expiresMs, liteDisplay, mainWorldHook: publicSnapshot().mainWorldHook }
      }, '*');
      return;
    }

  });

  window.postMessage({
    source: MAIN_PROTOCOL_SOURCE,
    type: 'MAIN_INSTALLED',
    payload: publicSnapshot()
  }, '*');
})();
