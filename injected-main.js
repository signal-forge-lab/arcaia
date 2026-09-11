(() => {
  'use strict';

  const APP_VERSION = '0.1.371';
  const MAIN_PROTOCOL_SOURCE = 'aice-probe-main-v159';
  const CONTENT_PROTOCOL_SOURCE = 'aice-probe-content-v159';
  const GLOBAL_KEY = '__AICE_PROBE_MAIN_STATE_V40__';
  const LEGACY_GLOBAL_KEYS = ['__AICE_PROBE_MAIN_STATE__', '__AICE_PROBE_MAIN_STATE_V36__', '__AICE_PROBE_MAIN_STATE_V37__', '__AICE_PROBE_MAIN_STATE_V38__', '__AICE_PROBE_MAIN_STATE_V39__'];
  const LITE_STORAGE_KEY = '__AICE_LITE_DISPLAY_CONFIG__';
  const EXTENSION_ENABLED_STORAGE_KEY = 'arcaia_extension_enabled_v1';
  const HEADER_PREFIXES = ['chatgpt-', 'oai-'];
  const TARGET_PATH = '/backend-api/';
  const MAX_CONVERSATION_DERIVED_STATE_CACHE_ENTRIES = 4;
  const MAX_TURN_ANCHORS_PER_CONVERSATION = 12;
  const NATIVE_LITE_TURN_COUNT = 3;
  const CONFIGURED_LITE_TURN_COUNT_MAX = 10;
  const RECENT_VIEW_EXPANDED_TURN_COUNT_MAX = 50;
  const CAPTURE_TURN_COUNT_MAX = 80;
  const BACKEND_REWRITE_DEFAULT_ENABLED = true;
  const BACKEND_REWRITE_CAPTURE_ENABLED = true;
  const TOOL_HISTORY_PAYLOAD_PRESERVE_LATEST_USER_TURNS = 2;
  const LITE_IMAGE_PLACEHOLDER_TEXT = [
    '🖼️ この回答は画像出力です。',
    'Recent Viewでは画像本体は表示されません。',
    '通常表示で確認してください。'
  ].join('\n');
  const LITE_FILE_ATTACHMENT_PLACEHOLDER_TEXT = '[添付ファイル]';

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
        toolHistoryCompaction: false,
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
        toolHistoryCompaction: false,
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
      toolHistoryCompaction: false,
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
        toolHistoryCompaction: false,
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
      toolHistoryCompaction: Boolean(config?.toolHistoryCompaction === true),
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
    extensionEnabled: readExtensionEnabledFromStorage(),
    liteDisplayConfig: readLiteDisplayConfigFromStorage(),
    liteDisplayRewriteCount: 0,
    liteDisplayLastRewrite: null,
    toolHistoryPayloadRewriteCount: 0,
    toolHistoryPayloadLastRewrite: null,
    toolHistorySummaryIndex: null,
    toolHistorySummaryIndexUpdateCount: 0,
    toolHistorySummaryIndexesByConversation: createBoundedConversationCache(),
    messageTimestampIndex: null,
    messageTimestampIndexUpdateCount: 0,
    messageTimestampIndexesByConversation: createBoundedConversationCache(),
    turnPageSnapshotsByConversation: createBoundedConversationCache(),
    absoluteTurnIndexesByConversation: createBoundedConversationCache(),
    projectSidebarIndex: null,
    turnPageSnapshotRevision: 0,
    turnCounterGeneration: 0,
    turnCounterAbortController: null,
    conversationModelConfigsByConversation: createBoundedConversationCache(),
    readOnlyConversationModelsByConversation: createBoundedConversationCache(2),
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

  function getChangedMessageTimestampIds(previousIndex, nextIndex) {
    if (!previousIndex || previousIndex.conversationId !== nextIndex?.conversationId) return [];
    const changed = [];
    for (const [messageId, nextItem] of Object.entries(nextIndex?.byMessageId || {})) {
      const previousItem = previousIndex.byMessageId?.[messageId];
      if (!previousItem
        || previousItem.iso !== nextItem.iso
        || previousItem.updateTimeIso !== nextItem.updateTimeIso
        || previousItem.status !== nextItem.status) {
        changed.push(messageId);
      }
    }
    return changed;
  }

  function observeMessageTimestampIndexFromConversation(raw, url = '', reason = 'conversation_fetch') {
    try {
      observeTurnPageSnapshotFromConversation(raw, url);
      const index = buildMessageTimestampIndexFromConversation(raw, url);
      const previousIndex = index.conversationId
        ? state.messageTimestampIndexesByConversation.get(index.conversationId)
        : state.messageTimestampIndex;
      const changedMessageIds = getChangedMessageTimestampIds(previousIndex, index);
      state.messageTimestampIndex = index;
      state.messageTimestampIndexesByConversation.set(index.conversationId, index);
      state.messageTimestampIndexUpdateCount = (state.messageTimestampIndexUpdateCount || 0) + 1;
      emitMainEvent('message_timestamp_index_updated', {
        reason,
        conversationId: index.conversationId || null,
        messageCount: index.messageCount || 0,
        changedMessageIds,
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

  function isToolHistoryInvocationMessage(message) {
    if (!message || message.author?.role !== 'assistant') return false;
    const recipient = String(message.recipient || '').trim();
    return Boolean(recipient && recipient !== 'all');
  }

  function isToolHistorySummaryTargetMessage(message) {
    if (!message || message.author?.role !== 'assistant') return false;
    const recipient = String(message.recipient || 'all').trim() || 'all';
    if (recipient !== 'all') return false;
    if (message.content?.content_type !== 'text') return false;
    return message.end_turn === true || message.metadata?.is_complete === true;
  }

  function buildToolHistorySummaryIndexFromConversation(raw, url = '') {
    if (!raw?.mapping || typeof raw.mapping !== 'object') return null;
    const conversationId = raw.conversation_id || extractConversationIdFromConversationDetailUrl(url) || extractConversationIdFromCurrentUrl();
    if (!conversationId) return null;
    const root = findRootNode(raw);
    if (!root?.id) return null;
    const reachableIds = collectReachableNodeIds(raw, root);
    const latestLeaf = findLatestLeafNodeForLite(raw, reachableIds);
    if (!latestLeaf?.id) return null;
    const pathIds = buildPathFromLeaf(raw, root, latestLeaf);
    const byAssistantMessageId = {};
    let currentToolCount = 0;
    let currentSummaryTargetId = null;
    let currentTurnStarted = false;
    let totalToolInvocations = 0;
    let summarizedTurnCount = 0;

    const flushTurn = () => {
      if (currentToolCount > 0 && currentSummaryTargetId) {
        byAssistantMessageId[currentSummaryTargetId] = {
          assistantMessageId: currentSummaryTargetId,
          toolCount: currentToolCount
        };
        summarizedTurnCount += 1;
      }
      currentToolCount = 0;
      currentSummaryTargetId = null;
    };

    for (const nodeId of pathIds) {
      const message = raw.mapping?.[nodeId]?.message;
      if (!message) continue;
      if (message.author?.role === 'user') {
        if (currentTurnStarted) flushTurn();
        currentTurnStarted = true;
        continue;
      }
      if (!currentTurnStarted) continue;
      if (isToolHistoryInvocationMessage(message)) {
        currentToolCount += 1;
        totalToolInvocations += 1;
      }
      if (isToolHistorySummaryTargetMessage(message)) {
        currentSummaryTargetId = message.id || nodeId;
      }
    }
    if (currentTurnStarted) flushTurn();

    return {
      ok: true,
      appVersion: APP_VERSION,
      source: 'main_world_existing_conversation_fetch',
      conversationId,
      updatedAt: Date.now(),
      updatedAtIso: nowIso(),
      summarizedTurnCount,
      totalToolInvocations,
      byAssistantMessageId
    };
  }

  function observeToolHistorySummaryIndexFromConversation(raw, url = '', reason = 'conversation_fetch') {
    try {
      const index = buildToolHistorySummaryIndexFromConversation(raw, url);
      if (!index) return null;
      state.toolHistorySummaryIndex = index;
      state.toolHistorySummaryIndexesByConversation.set(index.conversationId, index);
      state.toolHistorySummaryIndexUpdateCount = (state.toolHistorySummaryIndexUpdateCount || 0) + 1;
      emitMainEvent('tool_history_summary_index_updated', {
        reason,
        conversationId: index.conversationId,
        summarizedTurnCount: index.summarizedTurnCount,
        totalToolInvocations: index.totalToolInvocations,
        updateCount: state.toolHistorySummaryIndexUpdateCount,
        toolHistorySummaryIndex: index
      });
      return index;
    } catch {
      return null;
    }
  }

  function getToolHistorySummaryIndexForContent(requestedConversationId = null) {
    const conversationId = String(requestedConversationId || '').trim();
    return conversationId
      ? state.toolHistorySummaryIndexesByConversation.get(conversationId)
      : state.toolHistorySummaryIndex;
  }

  function isTurnCounterUserMessage(message) {
    return Boolean(message && message.author?.role === 'user' && isTimestampVisibleMessage(message));
  }

  function buildTurnPageSnapshot(raw, url = '') {
    if (!raw?.mapping || typeof raw.mapping !== 'object') return null;
    const conversationId = raw.conversation_id || extractConversationIdFromConversationDetailUrl(url) || extractConversationIdFromCurrentUrl();
    if (!conversationId) return null;
    const root = findRootNode(raw);
    const reachableIds = root ? collectReachableNodeIds(raw, root) : new Set();
    const leaf = root ? findLatestLeafNodeForLite(raw, reachableIds) : null;
    const pathIds = root && leaf ? buildPathFromLeaf(raw, root, leaf) : [];
    const byMessageId = {};
    const byNodeId = {};
    const userMessageIds = [];
    let localTurnNumber = 0;
    for (const nodeId of pathIds) {
      const message = raw.mapping?.[nodeId]?.message;
      if (!message || !isTimestampVisibleMessage(message)) continue;
      if (isTurnCounterUserMessage(message)) {
        localTurnNumber += 1;
        if (message.id) userMessageIds.push(message.id);
      }
      if (message.author?.role !== 'user' && message.author?.role !== 'assistant') continue;
      const assignment = { localTurnNumber };
      byNodeId[nodeId] = assignment;
      if (message.id) byMessageId[message.id] = assignment;
    }
    state.turnPageSnapshotRevision = Number(state.turnPageSnapshotRevision || 0) + 1;
    return {
      conversationId,
      revision: state.turnPageSnapshotRevision,
      hasPreviousPage: raw?.page_info?.has_previous_page === true,
      startCursor: typeof raw?.page_info?.start_cursor === 'string' ? raw.page_info.start_cursor : null,
      localTurnCount: localTurnNumber,
      userMessageIds,
      byMessageId,
      byNodeId
    };
  }

  function observeTurnPageSnapshotFromConversation(raw, url = '') {
    const snapshot = buildTurnPageSnapshot(raw, url);
    if (snapshot?.conversationId) state.turnPageSnapshotsByConversation.set(snapshot.conversationId, snapshot);
    return snapshot;
  }

  function cancelAbsoluteTurnCounter() {
    state.turnCounterGeneration = Number(state.turnCounterGeneration || 0) + 1;
    try { state.turnCounterAbortController?.abort?.(); } catch {}
    state.turnCounterAbortController = null;
  }

  function normalizeTurnAnchorCacheForMain(value, conversationId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const expectedConversationId = String(conversationId || '').trim();
    const cachedConversationId = String(value.conversationId || expectedConversationId).trim();
    if (!expectedConversationId || cachedConversationId !== expectedConversationId) return null;
    const totalTurnCount = Math.floor(Number(value.totalTurnCount));
    if (!Number.isInteger(totalTurnCount) || totalTurnCount < 1) return null;
    const anchors = [];
    const seen = new Set();
    for (const rawAnchor of Array.isArray(value.anchors) ? value.anchors : []) {
      const messageId = String(rawAnchor?.messageId || '').trim();
      const turnNumber = Math.floor(Number(rawAnchor?.turnNumber));
      if (!messageId || seen.has(messageId) || !Number.isInteger(turnNumber) || turnNumber < 1 || turnNumber > totalTurnCount) continue;
      seen.add(messageId);
      anchors.push({ messageId, turnNumber });
    }
    if (!anchors.length) return null;
    return {
      conversationId: expectedConversationId,
      totalTurnCount,
      anchors: anchors.slice(-MAX_TURN_ANCHORS_PER_CONVERSATION)
    };
  }

  function buildAbsoluteTurnIndexFromSnapshot(snapshot, olderTurnCount = 0) {
    const older = Math.max(0, Math.floor(Number(olderTurnCount) || 0));
    const localTurnCount = Math.max(0, Math.floor(Number(snapshot?.localTurnCount) || 0));
    const byMessageId = {};
    const byNodeId = {};
    const assign = (source, target) => {
      for (const [id, value] of Object.entries(source || {})) {
        const local = Math.floor(Number(value?.localTurnNumber || 0));
        if (local > 0) target[id] = older + local;
      }
    };
    assign(snapshot?.byMessageId, byMessageId);
    assign(snapshot?.byNodeId, byNodeId);
    return {
      conversationId: snapshot?.conversationId || null,
      revision: snapshot?.revision || 0,
      totalTurnCount: older + localTurnCount,
      olderTurnCount: older,
      localTurnCount,
      startCursor: snapshot?.startCursor || null,
      hasPreviousPage: snapshot?.hasPreviousPage === true,
      byMessageId,
      byNodeId
    };
  }

  function buildTurnAnchorCacheFromAbsoluteIndex(snapshot, index) {
    const anchors = [];
    for (const messageId of Array.isArray(snapshot?.userMessageIds) ? snapshot.userMessageIds : []) {
      const turnNumber = Math.floor(Number(index?.byMessageId?.[messageId] || 0));
      if (messageId && turnNumber > 0) anchors.push({ messageId, turnNumber });
    }
    if (!anchors.length || !index?.conversationId || !Number.isInteger(Number(index?.totalTurnCount))) return null;
    return {
      conversationId: index.conversationId,
      totalTurnCount: Number(index.totalTurnCount),
      anchors: anchors.slice(-MAX_TURN_ANCHORS_PER_CONVERSATION),
      updatedAt: Date.now()
    };
  }

  function resolveAbsoluteTurnIndexFromSnapshot(snapshot, anchorCache = null) {
    if (!snapshot?.conversationId) return { ok: false, error: 'absolute_turn_snapshot_unavailable' };
    let olderTurnCount = 0;
    let matchedAnchorCount = 0;
    let source = 'complete_snapshot';
    if (snapshot.hasPreviousPage) {
      const normalizedCache = normalizeTurnAnchorCacheForMain(anchorCache, snapshot.conversationId);
      if (!normalizedCache) return { ok: false, error: 'absolute_turn_anchor_miss' };
      const anchorByMessageId = new Map(normalizedCache.anchors.map((anchor) => [anchor.messageId, anchor.turnNumber]));
      const offsets = [];
      for (const messageId of Array.isArray(snapshot.userMessageIds) ? snapshot.userMessageIds : []) {
        const absoluteTurn = Number(anchorByMessageId.get(messageId) || 0);
        const localTurn = Number(snapshot.byMessageId?.[messageId]?.localTurnNumber || 0);
        if (absoluteTurn > 0 && localTurn > 0) offsets.push(absoluteTurn - localTurn);
      }
      if (!offsets.length) return { ok: false, error: 'absolute_turn_anchor_miss' };
      olderTurnCount = offsets[0];
      if (olderTurnCount < 0 || offsets.some((offset) => offset !== olderTurnCount)) {
        return { ok: false, error: 'absolute_turn_anchor_inconsistent' };
      }
      matchedAnchorCount = offsets.length;
      source = 'anchor_cache';
    }
    const index = buildAbsoluteTurnIndexFromSnapshot(snapshot, olderTurnCount);
    return {
      ok: true,
      index,
      anchorCache: buildTurnAnchorCacheFromAbsoluteIndex(snapshot, index),
      source,
      matchedAnchorCount
    };
  }

  async function getAbsoluteTurnIndexForContent(requestedConversationId, anchorCache = null, allowHistoryFetch = true) {
    const conversationId = String(requestedConversationId || '').trim();
    if (!conversationId || conversationId !== extractConversationIdFromCurrentUrl()) {
      return { ok: false, appVersion: APP_VERSION, error: 'absolute_turn_snapshot_unavailable' };
    }
    const snapshot = state.turnPageSnapshotsByConversation.get(conversationId);
    if (!snapshot) return { ok: false, appVersion: APP_VERSION, error: 'absolute_turn_snapshot_unavailable' };
    const cached = state.absoluteTurnIndexesByConversation.get(conversationId);
    if (cached?.revision === snapshot.revision) {
      return {
        ok: true,
        appVersion: APP_VERSION,
        index: cached,
        anchorCache: buildTurnAnchorCacheFromAbsoluteIndex(snapshot, cached),
        cached: true,
        historyFetchAttempted: false
      };
    }
    const resolved = resolveAbsoluteTurnIndexFromSnapshot(snapshot, anchorCache);
    if (resolved.ok) {
      state.absoluteTurnIndexesByConversation.set(conversationId, resolved.index);
      return { ...resolved, appVersion: APP_VERSION, cached: false, historyFetchAttempted: false };
    }
    if (!snapshot.hasPreviousPage || allowHistoryFetch === false) {
      return { ok: false, appVersion: APP_VERSION, error: resolved.error, historyFetchAttempted: false };
    }
    const rebuilt = await getReadOnlyConversationModelForContent(conversationId, 'all', true);
    if (!rebuilt?.ok || conversationId !== extractConversationIdFromCurrentUrl()) {
      return {
        ok: false,
        appVersion: APP_VERSION,
        error: rebuilt?.error || 'absolute_turn_history_rebuild_failed',
        historyFetchAttempted: true
      };
    }
    const rebuiltSnapshot = state.turnPageSnapshotsByConversation.get(conversationId);
    const rebuiltResolved = resolveAbsoluteTurnIndexFromSnapshot(rebuiltSnapshot, null);
    if (!rebuiltResolved.ok || rebuiltSnapshot?.hasPreviousPage) {
      return {
        ok: false,
        appVersion: APP_VERSION,
        error: rebuiltResolved.error || 'absolute_turn_history_rebuild_incomplete',
        historyFetchAttempted: true
      };
    }
    state.absoluteTurnIndexesByConversation.set(conversationId, rebuiltResolved.index);
    return {
      ...rebuiltResolved,
      appVersion: APP_VERSION,
      cached: false,
      source: 'history_rebuild',
      historyFetchAttempted: true,
      fallbackReason: resolved.error
    };
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
    if (/\/backend-api\/conversations?\/[^/?#]+$/.test(pathname)) return 'conversation_detail';
    if (/\/backend-api\/conversations\/[^/?#]+\/messages$/.test(pathname)) return 'conversation_messages_page';
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


  function extractConversationIdFromConversationDetailUrl(url) {
    try {
      const u = new URL(url, window.location.origin);
      const match = u.pathname.match(/\/backend-api\/conversations?\/([^/?#]+)$/);
      return match ? match[1] : null;
    } catch {
      const match = String(url || '').match(/\/backend-api\/conversations?\/([^/?#]+)$/);
      return match ? match[1] : null;
    }
  }

  function normalizeConversationPayloadForArcaia(raw) {
    if (raw?.mapping && typeof raw.mapping === 'object' && !Array.isArray(raw.mapping)) {
      return { raw, sourceFormat: 'mapping' };
    }
    if (!Array.isArray(raw?.messages)) return { raw, sourceFormat: 'unknown' };

    const mapping = {};
    const orderedIds = [];
    for (const message of raw.messages) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
      const id = String(message.id || '').trim();
      if (!id || mapping[id]) continue;
      mapping[id] = { id, message, parent: null, children: [] };
      orderedIds.push(id);
    }

    if (!orderedIds.length) return { raw, sourceFormat: 'messages' };
    for (let index = 0; index < orderedIds.length; index += 1) {
      const id = orderedIds[index];
      const declaredParentId = String(mapping[id].message?.metadata?.parent_id || '').trim();
      const parentId = declaredParentId && declaredParentId !== id && mapping[declaredParentId]
        ? declaredParentId
        : index > 0 ? orderedIds[index - 1] : null;
      mapping[id].parent = parentId;
      if (parentId && !mapping[parentId].children.includes(id)) mapping[parentId].children.push(id);
    }

    const lastMessageId = [...raw.messages].reverse().find((message) => message?.id && mapping[message.id])?.id || null;
    const currentNode = typeof raw.current_node === 'string' && mapping[raw.current_node]
      ? raw.current_node
      : lastMessageId;
    const { messages: _messages, ...conversationFields } = raw;
    return {
      raw: { ...conversationFields, mapping, current_node: currentNode },
      sourceFormat: 'messages'
    };
  }

  function restoreConversationPayloadShape(originalRaw, canonicalRaw, sourceFormat) {
    if (sourceFormat !== 'messages') return canonicalRaw;
    const root = findRootNode(canonicalRaw);
    const reachableIds = collectReachableNodeIds(canonicalRaw, root);
    const leaf = findLatestLeafNodeForLite(canonicalRaw, reachableIds);
    const pathIds = buildPathFromLeaf(canonicalRaw, root, leaf);
    const messageNodes = pathIds
      .map((id) => canonicalRaw?.mapping?.[id])
      .filter((node) => node?.message && typeof node.message === 'object');
    const messages = messageNodes.map((node, index) => ({
      ...node.message,
      metadata: {
        ...(node.message.metadata || {}),
        parent_id: index > 0 ? messageNodes[index - 1].id : null
      }
    }));
    const pageInfo = originalRaw?.page_info && typeof originalRaw.page_info === 'object'
      ? {
          ...originalRaw.page_info,
          has_previous_page: false,
          start_cursor: null
        }
      : originalRaw?.page_info;
    return {
      ...originalRaw,
      current_node: canonicalRaw.current_node || originalRaw.current_node || null,
      messages,
      ...(pageInfo === undefined ? {} : { page_info: pageInfo })
    };
  }

  function restoreToolCompactedPayloadShape(originalRaw, canonicalRaw, sourceFormat) {
    if (sourceFormat !== 'messages') return canonicalRaw;
    const compactedById = canonicalRaw?.mapping && typeof canonicalRaw.mapping === 'object'
      ? canonicalRaw.mapping
      : {};
    return {
      ...originalRaw,
      messages: Array.isArray(originalRaw?.messages)
        ? originalRaw.messages.map((message) => {
            const id = String(message?.id || '').trim();
            const compacted = id ? compactedById?.[id]?.message : null;
            return compacted && typeof compacted === 'object' ? compacted : message;
          })
        : originalRaw?.messages
    };
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

  function isLiteFileAttachmentLikeObject(value) {
    if (!value || typeof value !== 'object') return false;
    const contentType = String(value.content_type || value.type || value.mime_type || '').toLowerCase();
    const fileLikeContentType = contentType === 'file'
      || contentType.startsWith('file_')
      || contentType.startsWith('file-')
      || contentType.includes('attachment')
      || contentType.includes('document')
      || contentType.includes('pdf')
      || contentType.includes('spreadsheet')
      || contentType.includes('presentation')
      || contentType.includes('archive');
    if (fileLikeContentType) return true;
    if (value.file_id || value.file_name || value.filename || value.upload_id) return true;
    if (typeof value.asset_pointer === 'string') {
      const pointer = value.asset_pointer.toLowerCase();
      if (pointer.startsWith('file-service://') || pointer.startsWith('sediment://')) return true;
    }
    if (Array.isArray(value.attachments) && value.attachments.length > 0) return true;
    if (Array.isArray(value.files) && value.files.length > 0) return true;
    return false;
  }

  function hasLiteFileAttachmentLikeContent(value, depth = 0) {
    if (!value || depth > 5) return false;
    if (Array.isArray(value)) return value.some((item) => hasLiteFileAttachmentLikeContent(item, depth + 1));
    if (typeof value !== 'object') return false;
    if (isLiteFileAttachmentLikeObject(value)) return true;
    return Object.values(value).some((item) => hasLiteFileAttachmentLikeContent(item, depth + 1));
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
    if (hasLiteFileAttachmentLikeContent(part)) return LITE_FILE_ATTACHMENT_PLACEHOLDER_TEXT;
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
    if (hasLiteFileAttachmentLikeContent(content) || hasLiteFileAttachmentLikeContent(message?.metadata)) return LITE_FILE_ATTACHMENT_PLACEHOLDER_TEXT;
    return '';
  }

  function rendererTimestampIso(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    const date = Number.isFinite(number)
      ? new Date(number > 1000000000000 ? number : number * 1000)
      : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function rendererMessageText(message) {
    const content = message?.content || {};
    const contentType = String(content.content_type || '').toLowerCase();
    if (contentType !== 'text' && contentType !== 'multimodal_text') return '';
    return (Array.isArray(content.parts) ? content.parts : [])
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.content_type === 'text' && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  function rendererSafeHttpUrl(value, allowBackendRelative = false) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (allowBackendRelative && /^\/backend-api\/(?:files(?:\/|$)|estuary\/content(?:\?|$))/i.test(raw)) {
      return raw;
    }
    if (!/^https?:\/\//i.test(raw)) return null;
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function rendererResourceName(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const withoutQuery = raw.split(/[?#]/, 1)[0];
    const candidate = withoutQuery.split(/[\\/]/).filter(Boolean).pop() || '';
    if (!candidate) return null;
    try { return decodeURIComponent(candidate).slice(0, 240); } catch { return candidate.slice(0, 240); }
  }

  function rendererFileIdFromPointer(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const withoutQuery = raw.split(/[?#]/, 1)[0];
    const candidate = withoutQuery.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/').filter(Boolean).pop() || '';
    return /^[a-z0-9][a-z0-9._-]{2,199}$/i.test(candidate) ? candidate : null;
  }

  function rendererSandboxPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const withoutScheme = raw.replace(/^sandbox:/i, '');
    const encodedPath = withoutScheme.split(/[?#]/, 1)[0];
    let path;
    try { path = decodeURIComponent(encodedPath); } catch { path = encodedPath; }
    if (!path.startsWith('/mnt/data/') || path.includes('\0') || path.split('/').includes('..')) return null;
    return path.slice(0, 2048);
  }

  function collectRendererResources(value, path = '$', depth = 0, out = []) {
    if (!value || typeof value !== 'object' || depth > 7 || out.length >= 80) return out;
    if (Array.isArray(value)) {
      for (let index = 0; index < Math.min(value.length, 80); index += 1) {
        collectRendererResources(value[index], `${path}[${index}]`, depth + 1, out);
      }
      return out;
    }
    const pathLower = String(path).toLowerCase();
    const pointer = typeof value.asset_pointer === 'string' ? value.asset_pointer : null;
    const explicitFileId = value.file_id || value.fileId || value.upload_id || value.uploadId || null;
    const fileId = rendererFileIdFromPointer(explicitFileId || pointer);
    const mimeType = String(value.mime_type || value.mimeType || '').toLowerCase();
    const contentType = String(value.content_type || value.type || '').toLowerCase();
    const name = rendererResourceName(
      value.file_name || value.filename || (pathLower.includes('attachment') ? value.name : null) || null
    );
    const url = rendererSafeHttpUrl(value.download_url || value.image_url || value.url || null, true);
    const excludedVisualPath = /(citation|search_result|source|favicon|thumbnail)/.test(pathLower);
    const imageLike = !excludedVisualPath && Boolean(
      mimeType.startsWith('image/')
      || contentType.includes('image')
      || (pointer && (pathLower.includes('image') || Number(value.width) > 0 || Number(value.height) > 0))
    );
    const attachmentLike = Boolean(
      pointer
      || fileId
      || name
      || mimeType
      || contentType.includes('file')
      || contentType.includes('attachment')
      || pathLower.includes('attachment')
    );
    if (!excludedVisualPath && attachmentLike) {
      out.push({
        kind: imageLike ? 'image' : 'attachment',
        isImage: imageLike,
        assetPointer: pointer,
        fileId,
        name: name ? String(name) : null,
        mimeType: mimeType || null,
        width: Number.isFinite(Number(value.width)) ? Number(value.width) : null,
        height: Number.isFinite(Number(value.height)) ? Number(value.height) : null,
        url
      });
    }
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object') {
        collectRendererResources(child, `${path}.${key}`, depth + 1, out);
      }
    }
    return out;
  }

  function collectRendererCitations(value, path = '$', depth = 0, out = []) {
    if (!value || typeof value !== 'object' || depth > 7 || out.length >= 80) return out;
    if (Array.isArray(value)) {
      for (let index = 0; index < Math.min(value.length, 80); index += 1) {
        collectRendererCitations(value[index], `${path}[${index}]`, depth + 1, out);
      }
      return out;
    }
    const pathLower = String(path).toLowerCase();
    if (/(citation|source|search_result|content_reference)/.test(pathLower)) {
      const url = rendererSafeHttpUrl(value.url || value.href || value.link || null);
      if (url) {
        let domain = null;
        try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {}
        out.push({
          url,
          title: String(value.title || value.name || value.text || domain || '出典').slice(0, 240),
          domain
        });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object') {
        collectRendererCitations(child, `${path}.${key}`, depth + 1, out);
      }
    }
    return out;
  }

  function dedupeRendererItems(items, keyBuilder) {
    const seen = new Set();
    const result = [];
    for (const item of items || []) {
      const key = keyBuilder(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  function normalizeRendererMessage(message, resources = [], citations = [], fallbackMessageId = null) {
    return {
      messageId: message?.id ? String(message.id) : (fallbackMessageId ? String(fallbackMessageId) : null),
      text: rendererMessageText(message),
      createdAtIso: rendererTimestampIso(message?.create_time || message?.update_time),
      resources: dedupeRendererItems(resources, (item) => (
        item?.assetPointer || item?.fileId || item?.url || `${item?.name || ''}|${item?.mimeType || ''}`
      )),
      citations: dedupeRendererItems(citations, (item) => item?.url)
    };
  }

  function buildReadOnlyConversationModel(raw, url = '') {
    if (!raw?.mapping || typeof raw.mapping !== 'object') throw new Error('conversation mapping is missing.');
    const root = findRootNode(raw);
    if (!root?.id) throw new Error('root node could not be detected.');
    const reachableIds = collectReachableNodeIds(raw, root);
    const leaf = findLatestLeafNodeForLite(raw, reachableIds);
    if (!leaf?.id) throw new Error('latest leaf node could not be detected.');
    const pathIds = buildPathFromLeaf(raw, root, leaf);
    const turns = [];
    let currentTurn = null;
    let turnNumber = 0;
    for (const nodeId of pathIds) {
      const message = raw.mapping?.[nodeId]?.message;
      if (!message) continue;
      const role = message.author?.role || null;
      const contentType = String(message.content?.content_type || '').toLowerCase();
      const resources = collectRendererResources({ content: message.content, metadata: message.metadata });
      const citations = collectRendererCitations({ content: message.content, metadata: message.metadata });
      const visuallyHidden = isVisuallyHiddenMessage(message);
      const userVisible = !visuallyHidden
        && role === 'user'
        && (contentType === 'text' || contentType === 'multimodal_text');
      const assistantVisible = !visuallyHidden
        && role === 'assistant'
        && contentType === 'text'
        && message.end_turn === true
        && (!message.recipient || message.recipient === 'all');
      if (userVisible) {
        turnNumber += 1;
        currentTurn = {
          turnNumber,
          user: normalizeRendererMessage(message, resources, [], nodeId),
          assistant: null,
          pendingAssistantResources: [],
          pendingAssistantCitations: []
        };
        turns.push(currentTurn);
        continue;
      }
      if (!currentTurn) continue;
      if (role !== 'system') {
        currentTurn.pendingAssistantResources.push(...resources);
        currentTurn.pendingAssistantCitations.push(...citations);
      }
      if (assistantVisible) {
        currentTurn.assistant = normalizeRendererMessage(
          message,
          currentTurn.pendingAssistantResources,
          currentTurn.pendingAssistantCitations,
          nodeId
        );
      }
    }
    for (const turn of turns) {
      if (!turn.assistant && (turn.pendingAssistantResources.length || turn.pendingAssistantCitations.length)) {
        turn.assistant = normalizeRendererMessage(
          null,
          turn.pendingAssistantResources,
          turn.pendingAssistantCitations
        );
      }
      delete turn.pendingAssistantResources;
      delete turn.pendingAssistantCitations;
    }
    return {
      ok: true,
      appVersion: APP_VERSION,
      conversationId: raw.conversation_id || extractConversationIdFromConversationDetailUrl(url) || null,
      observedAt: Date.now(),
      totalTurnCount: turns.length,
      historyComplete: raw?.page_info?.has_previous_page !== true,
      turns
    };
  }

  function observeReadOnlyConversationModel(raw, url = '') {
    const model = buildReadOnlyConversationModel(raw, url);
    if (!model.conversationId) throw new Error('conversation id is missing.');
    state.readOnlyConversationModelsByConversation.set(model.conversationId, model);
    return model;
  }

  async function getReadOnlyConversationModelForContent(requestedConversationId, requestedTurnCount = 'all', forceRefresh = false) {
    const conversationId = String(requestedConversationId || '').trim();
    const all = requestedTurnCount === 'all';
    let model = state.readOnlyConversationModelsByConversation.get(conversationId);
    const needsFetch = Boolean(forceRefresh)
      || !model
      || model.conversationId !== conversationId
      || (all && model.historyComplete === false);
    if (needsFetch) {
      if (
        !conversationId
        || conversationId !== extractConversationIdFromCurrentUrl()
        || !state.fetchHooked
        || typeof state.originalFetch !== 'function'
      ) {
        return { ok: false, appVersion: APP_VERSION, error: 'read_only_conversation_model_unavailable' };
      }
      try {
        const headers = new Headers(state.extraHeaders || {});
        if (state.authorization) headers.set('authorization', state.authorization);
        const fetchJson = async (url) => {
          const response = await Function.prototype.call.call(state.originalFetch, window, url, {
            method: 'GET',
            credentials: 'include',
            headers
          });
          if (!response?.ok) throw new Error('read_only_history_fetch_failed');
          return response.json();
        };
        const detailUrl = `/backend-api/conversations/${encodeURIComponent(conversationId)}`;
        const initialRaw = await fetchJson(detailUrl);
        let completeRaw = initialRaw;
        if (all && Array.isArray(initialRaw?.messages) && initialRaw?.page_info?.has_previous_page === true) {
          const chunks = [initialRaw.messages];
          const seenCursors = new Set();
          let pageInfo = initialRaw.page_info;
          let pageCount = 0;
          while (pageInfo?.has_previous_page === true) {
            const cursor = typeof pageInfo.start_cursor === 'string' ? pageInfo.start_cursor : '';
            if (!cursor || seenCursors.has(cursor)) throw new Error('read_only_history_pagination_cursor_invalid');
            if (pageCount >= 500) throw new Error('read_only_history_pagination_limit');
            seenCursors.add(cursor);
            const pageUrl = `/backend-api/conversations/${encodeURIComponent(conversationId)}/messages?before=${encodeURIComponent(cursor)}&include_has_versions=true&num_turns=20`;
            const pageRaw = await fetchJson(pageUrl);
            if (!Array.isArray(pageRaw?.messages)) throw new Error('read_only_history_page_messages_missing');
            chunks.unshift(pageRaw.messages);
            pageInfo = pageRaw.page_info || null;
            pageCount += 1;
          }
          const seenMessageIds = new Set();
          const messages = [];
          for (const chunk of chunks) {
            for (const message of chunk) {
              if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
              const id = String(message.id || '').trim();
              if (id && seenMessageIds.has(id)) continue;
              if (id) seenMessageIds.add(id);
              messages.push(message);
            }
          }
          completeRaw = {
            ...initialRaw,
            messages,
            page_info: {
              ...(initialRaw.page_info || {}),
              ...(pageInfo || {}),
              has_previous_page: false
            }
          };
        }
        const normalizedPayload = normalizeConversationPayloadForArcaia(completeRaw);
        if (forceRefresh) observeTurnPageSnapshotFromConversation(normalizedPayload.raw, detailUrl);
        model = observeReadOnlyConversationModel(normalizedPayload.raw, detailUrl);
        if (all && model.historyComplete === false) {
          return { ok: false, appVersion: APP_VERSION, error: 'read_only_history_incomplete' };
        }
      } catch (error) {
        return {
          ok: false,
          appVersion: APP_VERSION,
          error: String(error?.message || 'read_only_conversation_model_unavailable').slice(0, 120)
        };
      }
      if (!model || model.conversationId !== conversationId) {
        return { ok: false, appVersion: APP_VERSION, error: 'read_only_conversation_model_unavailable' };
      }
    }
    const safeTurnCount = all
      ? model.totalTurnCount
      : Math.max(1, Math.min(50, Math.floor(Number(requestedTurnCount) || 1)));
    const turns = model.turns.slice(Math.max(0, model.turns.length - safeTurnCount));
    return {
      ok: true,
      appVersion: APP_VERSION,
      model: {
        ...model,
        turns,
        visibleTurnCount: turns.length,
        firstVisibleTurnNumber: turns[0]?.turnNumber || null
      }
    };
  }

  function findRendererAssetDownloadUrl(value, depth = 0) {
    if (!value || depth > 5) return null;
    if (typeof value === 'string') return rendererSafeHttpUrl(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = findRendererAssetDownloadUrl(item, depth + 1);
        if (result) return result;
      }
      return null;
    }
    if (typeof value !== 'object') return null;
    for (const key of ['download_url', 'signed_url', 'image_url', 'url']) {
      const result = rendererSafeHttpUrl(value[key], true);
      if (result) return result;
    }
    for (const child of Object.values(value)) {
      const result = findRendererAssetDownloadUrl(child, depth + 1);
      if (result) return result;
    }
    return null;
  }

  function isRendererAssetResponseTypeAllowed(contentType, expectImage = false) {
    if (!expectImage) return true;
    const normalized = String(contentType || '').toLowerCase().split(';', 1)[0].trim();
    return !normalized
      || normalized.startsWith('image/')
      || normalized === 'application/octet-stream'
      || normalized === 'binary/octet-stream';
  }

  async function fetchRendererAssetBlob(url, headers = null, depth = 0, expectImage = false) {
    if (depth > 3) return null;
    const fetchImpl = state.originalFetch || window.fetch;
    if (typeof fetchImpl !== 'function') return null;
    const response = await fetchImpl.call(window, url, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      headers: headers || undefined
    });
    if (!response?.ok) return null;
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType.includes('json')) {
      const payload = await response.json();
      const signedUrl = findRendererAssetDownloadUrl(payload);
      const nextHeaders = signedUrl?.startsWith('/backend-api/files') ? headers : null;
      return signedUrl ? fetchRendererAssetBlob(signedUrl, nextHeaders, depth + 1, expectImage) : null;
    }
    if (!isRendererAssetResponseTypeAllowed(contentType, expectImage)) return null;
    const blob = await response.blob();
    if (!blob || blob.size <= 0 || blob.size > 25 * 1024 * 1024) return null;
    return blob;
  }

  async function resolveReadOnlyRendererAsset(payload) {
    payload = payload || {};
    const conversationId = String(payload.conversationId || '').trim().slice(0, 240);
    const messageId = String(payload.messageId || '').trim().slice(0, 240);
    const sandboxPath = rendererSandboxPath(payload.sandboxPath);
    const fileId = rendererFileIdFromPointer(payload.fileId || payload.assetPointer);
    const directUrl = rendererSafeHttpUrl(payload.url, true);
    const expectImage = payload.isImage === true || String(payload.mimeType || '').toLowerCase().startsWith('image/');
    const candidates = [];
    if (conversationId && messageId && sandboxPath) {
      candidates.push(
        `/backend-api/conversation/${encodeURIComponent(conversationId)}/interpreter/download?message_id=${encodeURIComponent(messageId)}&sandbox_path=${encodeURIComponent(sandboxPath)}`
      );
    }
    if (directUrl) candidates.push(directUrl);
    if (fileId) {
      candidates.push(
        `/backend-api/files/download/${encodeURIComponent(fileId)}`,
        `/backend-api/files/${encodeURIComponent(fileId)}/download`,
        `/backend-api/files/${encodeURIComponent(fileId)}`
      );
    }
    const headers = new Headers();
    if (state.authorization) headers.set('authorization', state.authorization);
    for (const candidate of [...new Set(candidates)]) {
      try {
        const blob = await fetchRendererAssetBlob(candidate, candidate.startsWith('/') ? headers : null, 0, expectImage);
        if (blob) {
          return {
            ok: true,
            appVersion: APP_VERSION,
            blob,
            mimeType: blob.type || payload.mimeType || null
          };
        }
      } catch {}
    }
    return { ok: false, appVersion: APP_VERSION, error: 'read_only_renderer_asset_unavailable' };
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
      (role === 'user' || text)
    );
    return { id: nodeId, role, keep };
  }

  function isCompletedHistoricalToolMessage(message) {
    if (!message || message?.author?.role !== 'tool') return false;
    const status = String(message.status || '').toLowerCase();
    return status === 'finished_successfully'
      || status === 'finished'
      || status === 'complete'
      || status === 'completed';
  }

  function compactHistoricalToolPayload(raw, options) {
    options = options && typeof options === 'object' ? options : {};
    if (!raw || typeof raw !== 'object' || !raw.mapping || typeof raw.mapping !== 'object') {
      return {
        compactRaw: raw,
        summary: { ok: false, changed: false, reason: 'conversation_mapping_missing' }
      };
    }
    const root = findRootNode(raw);
    if (!root?.id) {
      return {
        compactRaw: raw,
        summary: { ok: false, changed: false, reason: 'conversation_root_missing' }
      };
    }
    const reachableIds = collectReachableNodeIds(raw, root);
    const latestLeaf = findLatestLeafNodeForLite(raw, reachableIds);
    if (!latestLeaf?.id) {
      return {
        compactRaw: raw,
        summary: { ok: false, changed: false, reason: 'conversation_leaf_missing' }
      };
    }
    const pathIds = buildPathFromLeaf(raw, root, latestLeaf);
    const preserveLatestUserTurnsRaw = Number(options?.preserveLatestUserTurns);
    const preserveLatestUserTurns = Number.isFinite(preserveLatestUserTurnsRaw)
      ? Math.max(1, Math.min(10, Math.floor(preserveLatestUserTurnsRaw)))
      : TOOL_HISTORY_PAYLOAD_PRESERVE_LATEST_USER_TURNS;
    const totalUserTurns = pathIds.reduce((count, nodeId) => {
      return count + (raw?.mapping?.[nodeId]?.message?.author?.role === 'user' ? 1 : 0);
    }, 0);
    const compactThroughTurn = Math.max(0, totalUserTurns - preserveLatestUserTurns);
    if (compactThroughTurn <= 0) {
      return {
        compactRaw: raw,
        summary: {
          ok: true,
          changed: false,
          reason: 'no_historical_turns',
          preserveLatestUserTurns,
          totalUserTurns,
          compactThroughTurn,
          historicalToolMessageCount: 0,
          compactedToolMessageCount: 0,
          clearedSearchResultGroupCount: 0,
          clearedInlineCotCount: 0,
          beforeToolBytes: 0,
          afterToolBytes: 0
        }
      };
    }

    const compactRaw = JSON.parse(JSON.stringify(raw));
    let currentTurn = 0;
    let historicalToolMessageCount = 0;
    let compactedToolMessageCount = 0;
    let clearedSearchResultGroupCount = 0;
    let clearedInlineCotCount = 0;
    let beforeToolBytes = 0;
    let afterToolBytes = 0;

    for (const nodeId of pathIds) {
      const originalMessage = raw?.mapping?.[nodeId]?.message;
      if (originalMessage?.author?.role === 'user') currentTurn += 1;
      if (currentTurn <= 0 || currentTurn > compactThroughTurn) continue;
      if (!isCompletedHistoricalToolMessage(originalMessage)) continue;
      historicalToolMessageCount += 1;

      const compactMessage = compactRaw?.mapping?.[nodeId]?.message;
      if (!compactMessage || typeof compactMessage !== 'object') continue;
      let changed = false;
      try { beforeToolBytes += JSON.stringify(compactMessage).length; } catch {}
      const metadata = compactMessage.metadata && typeof compactMessage.metadata === 'object'
        ? compactMessage.metadata
        : null;
      if (metadata) {
        if (Array.isArray(metadata.search_result_groups) && metadata.search_result_groups.length > 0) {
          clearedSearchResultGroupCount += metadata.search_result_groups.length;
          metadata.search_result_groups = [];
          changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(metadata, 'inline_cot_expandable_content')
          && metadata.inline_cot_expandable_content != null) {
          delete metadata.inline_cot_expandable_content;
          clearedInlineCotCount += 1;
          changed = true;
        }
      }
      if (changed) compactedToolMessageCount += 1;
      try { afterToolBytes += JSON.stringify(compactMessage).length; } catch {}
    }

    return {
      compactRaw,
      summary: {
        ok: true,
        changed: compactedToolMessageCount > 0,
        reason: compactedToolMessageCount > 0 ? 'historical_tool_payload_compacted' : 'no_heavy_historical_tool_payload',
        preserveLatestUserTurns,
        totalUserTurns,
        compactThroughTurn,
        historicalToolMessageCount,
        compactedToolMessageCount,
        clearedSearchResultGroupCount,
        clearedInlineCotCount,
        beforeToolBytes,
        afterToolBytes,
        toolBytesReductionPct: beforeToolBytes
          ? Number(((1 - afterToolBytes / beforeToolBytes) * 100).toFixed(2))
          : 0
      }
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
          syntheticImagePlaceholders: []
        }
      };
    }
    const requestedRenderAnchorExtraTurnCount = Number(options?.renderAnchorExtraTurnCount);
    const renderAnchorTargetExtraTurnCount = Number.isFinite(requestedRenderAnchorExtraTurnCount)
      ? Math.max(0, Math.min(2, Math.floor(requestedRenderAnchorExtraTurnCount)))
      : 2;
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
      if (!retainedUserNodeIdSet.has(id)) continue;
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
        if (renderNodeIdSet.has(sourceSignal.nodeId)) {
          imageDisplayDiagnostics.push({
            sourceUserNodeId: id,
            ...sourceSignal,
            addedPathNodeCount: addedPathNodeIds.length,
            addedPathNodeIds,
            sourceSignalAlreadyRetained: addedPathNodeIds.length === 0
          });
        } else {
          const syntheticNode = createSyntheticLiteImagePlaceholderNode(id, sourceSignal, syntheticPlaceholderNodeById.size + 1);
          syntheticPlaceholderNodeById.set(syntheticNode.id, syntheticNode);
          syntheticPlaceholderDiagnostics.push({ id: syntheticNode.id, sourceUserNodeId: id, fallbackReason: 'lite_show_images_no_image_path_nodes_added', ...sourceSignal });
          appendRenderNodeId(syntheticNode.id);
        }
        continue;
      }
      if (selectedSet.has(sourceSignal.nodeId)) continue;
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
        simulatedChainNodeCount: chain.length
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
      toolHistoryCompaction: Boolean(config.toolHistoryCompaction),
      liteShowImages: config.liteShowImages !== false,
      fullLoadOnce: Boolean(config.fullLoadOnce),
      fullLoadConversationId: config.fullLoadConversationId || null,
      fullLoadExpiresAt: config.fullLoadExpiresAt || null,
      extensionEnabled: isMainExtensionEnabled(),
      rewriteCount: state.liteDisplayRewriteCount || 0,
      liteDisplayRewriteCount: state.liteDisplayRewriteCount || 0,
      lastRewrite: state.liteDisplayLastRewrite || null,
      liteDisplayLastRewrite: state.liteDisplayLastRewrite || null,
      toolHistoryPayloadRewriteCount: state.toolHistoryPayloadRewriteCount || 0,
      toolHistoryPayloadLastRewrite: state.toolHistoryPayloadLastRewrite || null,
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
      toolHistoryCompaction: Boolean(result.toolHistoryCompaction),
      liteShowImages: result.liteShowImages !== false
    });
    return result;
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

  function shouldSuppressNativeRecentViewHistoryFetch(method, url) {
    if (String(method || 'GET').toUpperCase() !== 'GET' || !url || !isMainExtensionEnabled()) return false;
    let conversationId = null;
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin !== window.location.origin || !parsed.searchParams.has('before')) return false;
      const match = parsed.pathname.match(/\/backend-api\/conversations\/([^/?#]+)\/messages$/);
      if (!match) return false;
      conversationId = decodeURIComponent(match[1]);
    } catch {
      return false;
    }

    const config = normalizeLiteDisplayConfig(state.liteDisplayConfig || defaultLiteDisplayConfig());
    if (!config.enabled || config.historySearchBypass) return false;
    if (config.fullLoadOnce
      && config.fullLoadConversationId === conversationId
      && Number(config.fullLoadExpiresAt || 0) > Date.now()) return false;

    const currentConversationId = extractConversationIdFromCurrentUrl();
    if (!currentConversationId || conversationId !== currentConversationId) return false;
    if (config.conversationId && conversationId !== config.conversationId) return false;
    return true;
  }

  function createSuppressedNativeRecentViewHistoryResponse() {
    return new Response(JSON.stringify({
      messages: [],
      page_info: {
        has_previous_page: false,
        start_cursor: null,
        has_next_page: false,
        end_cursor: null
      }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  function isProjectSidebarJsonFetchResponse(method, url, response) {
    if (String(method || 'GET').toUpperCase() !== 'GET' || !response?.ok || typeof response.clone !== 'function') return false;
    try { return new URL(url, window.location.origin).pathname === '/backend-api/gizmos/snorlax/sidebar'; } catch { return false; }
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

  function shouldApplyToolHistoryCompactionToFetch(url, method, response) {
    if (!isMainExtensionEnabled()) return false;
    const config = normalizeLiteDisplayConfig(state.liteDisplayConfig || defaultLiteDisplayConfig());
    if (!config.toolHistoryCompaction || config.historySearchBypass) return false;
    if (!isConversationJsonFetchResponse(method, url, response)) return false;
    const conversationId = extractConversationIdFromConversationDetailUrl(url);
    const currentConversationId = extractConversationIdFromCurrentUrl();
    if (!conversationId || !currentConversationId || conversationId !== currentConversationId) return false;
    return true;
  }

  function buildProjectSidebarIndex(raw) {
    const projects = [];
    for (const item of Array.isArray(raw?.items) ? raw.items : []) {
      const project = item?.gizmo?.gizmo;
      const id = String(project?.id || '').trim();
      const name = String(project?.display?.name || '').trim();
      if (!id.startsWith('g-p-') || !name) continue;
      projects.push({ id, name });
    }
    return { ok: true, appVersion: APP_VERSION, updatedAt: Date.now(), projects };
  }

  async function observeProjectSidebarIndexFromResponse(response) {
    const raw = await response.clone().json();
    const index = buildProjectSidebarIndex(raw);
    state.projectSidebarIndex = index;
    emitMainEvent('project_sidebar_index_updated', { projectCount: index.projects.length });
    return index;
  }

  function getProjectSidebarIndexForContent() {
    return { ok: true, appVersion: APP_VERSION, projectSidebarIndex: state.projectSidebarIndex || null };
  }

  async function maybeRewriteFetchResponseForLiteDisplay(method, url, response) {
    const startedAt = Date.now();
    let text = null;
    let raw = null;
    let arcaiaRaw = null;
    let sourceFormat = 'unknown';
    const conversationFetch = shouldProcessConversationFetchResponse(method, url, response);
    if (conversationFetch) {
      try {
        text = await response.clone().text();
        raw = JSON.parse(text);
        const normalizedPayload = normalizeConversationPayloadForArcaia(raw);
        arcaiaRaw = normalizedPayload.raw;
        sourceFormat = normalizedPayload.sourceFormat;
        observeMessageTimestampIndexFromConversation(arcaiaRaw, url, 'conversation_fetch_response');
        observeToolHistorySummaryIndexFromConversation(arcaiaRaw, url, 'conversation_fetch_response');
        observeCurrentConversationModelConfig(arcaiaRaw, url, 'conversation_fetch_response');
        try { observeReadOnlyConversationModel(arcaiaRaw, url); } catch {}
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
    const applyLiteRewrite = shouldApplyLiteDisplayToFetch(url, method, response);
    const applyToolHistoryCompaction = shouldApplyToolHistoryCompactionToFetch(url, method, response);
    if (!applyLiteRewrite && !applyToolHistoryCompaction) return response;
    try {
      const config = normalizeLiteDisplayConfig(state.liteDisplayConfig || {});
      if (!text || !raw || !arcaiaRaw) {
        text = await response.clone().text();
        raw = JSON.parse(text);
        const normalizedPayload = normalizeConversationPayloadForArcaia(raw);
        arcaiaRaw = normalizedPayload.raw;
        sourceFormat = normalizedPayload.sourceFormat;
        observeMessageTimestampIndexFromConversation(arcaiaRaw, url, 'conversation_fetch_response_before_rewrite');
        observeToolHistorySummaryIndexFromConversation(arcaiaRaw, url, 'conversation_fetch_response_before_rewrite');
        observeCurrentConversationModelConfig(arcaiaRaw, url, 'conversation_fetch_response_before_rewrite');
        try { observeReadOnlyConversationModel(arcaiaRaw, url); } catch {}
      }
      let rewrittenCanonical = arcaiaRaw;
      let liteSummary = null;
      let liteChanged = false;
      if (applyLiteRewrite) {
        const liteResult = buildLiteRawForPage(arcaiaRaw, config.turnCount, {
          liteShowImages: config.liteShowImages !== false,
          renderAnchorExtraTurnCount: sourceFormat === 'messages' ? 0 : 2
        });
        liteSummary = liteResult.summary || null;
        if (!liteSummary?.skipped) {
          rewrittenCanonical = liteResult.liteRaw;
          liteChanged = true;
        }
      }

      let toolSummary = null;
      if (applyToolHistoryCompaction) {
        const toolResult = compactHistoricalToolPayload(rewrittenCanonical, {
          preserveLatestUserTurns: TOOL_HISTORY_PAYLOAD_PRESERVE_LATEST_USER_TURNS
        });
        toolSummary = toolResult.summary || null;
        if (toolSummary?.changed) rewrittenCanonical = toolResult.compactRaw;
      }

      if (applyLiteRewrite && !liteChanged) {
        state.liteDisplayLastRewrite = {
          ok: true,
          skipped: true,
          reason: liteSummary?.skipReason || 'lite_rewrite_skipped',
          at: Date.now(),
          atIso: nowIso(),
          url: safeUrlInfo(url),
          elapsedMs: Date.now() - startedAt,
          summary: liteSummary
        };
      }

      if (applyToolHistoryCompaction) {
        state.toolHistoryPayloadLastRewrite = {
          ok: Boolean(toolSummary?.ok !== false),
          changed: Boolean(toolSummary?.changed),
          at: Date.now(),
          atIso: nowIso(),
          url: safeUrlInfo(url),
          elapsedMs: Date.now() - startedAt,
          summary: toolSummary
        };
      }

      const toolChanged = Boolean(toolSummary?.changed);
      if (!liteChanged && !toolChanged) return response;

      const rewrittenPayload = liteChanged
        ? restoreConversationPayloadShape(raw, rewrittenCanonical, sourceFormat)
        : restoreToolCompactedPayloadShape(raw, rewrittenCanonical, sourceFormat);
      const rewrittenText = JSON.stringify(rewrittenPayload);
      const headers = new Headers(response.headers || undefined);
      try { headers.delete('content-length'); } catch {}
      if (!headers.get('content-type')) headers.set('content-type', 'application/json');
      const beforeBytes = new TextEncoder().encode(text).length;
      const afterBytes = new TextEncoder().encode(rewrittenText).length;
      if (liteChanged) {
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
          summary: liteSummary,
          toolHistoryCompaction: toolSummary
        };
        emitMainEvent('lite_rewrite_success', {
          conversationId: extractConversationIdFromConversationDetailUrl(url),
          beforeBytes,
          afterBytes,
          bytesReductionPct: state.liteDisplayLastRewrite.bytesReductionPct,
          retainedTurnCount: liteSummary?.retainedTurnCount || null,
          totalTurnCount: liteSummary?.totalTurnCount || null,
          turnCount: config.turnCount,
          url: safeUrlInfo(url)
        });
      }
      if (toolChanged) {
        state.toolHistoryPayloadRewriteCount = (state.toolHistoryPayloadRewriteCount || 0) + 1;
        state.toolHistoryPayloadLastRewrite = {
          ok: true,
          changed: true,
          at: Date.now(),
          atIso: nowIso(),
          url: safeUrlInfo(url),
          elapsedMs: Date.now() - startedAt,
          beforeBytes,
          afterBytes,
          bytesReductionPct: beforeBytes ? Number(((1 - afterBytes / beforeBytes) * 100).toFixed(2)) : null,
          summary: toolSummary
        };
        emitMainEvent('tool_history_payload_compaction_success', {
          conversationId: extractConversationIdFromConversationDetailUrl(url),
          compactedToolMessageCount: toolSummary?.compactedToolMessageCount || 0,
          clearedSearchResultGroupCount: toolSummary?.clearedSearchResultGroupCount || 0,
          clearedInlineCotCount: toolSummary?.clearedInlineCotCount || 0,
          toolBytesReductionPct: toolSummary?.toolBytesReductionPct || 0,
          url: safeUrlInfo(url)
        });
      }
      return new Response(rewrittenText, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      if (applyLiteRewrite) {
        state.liteDisplayLastRewrite = {
          ok: false,
          at: Date.now(),
          atIso: nowIso(),
          url: safeUrlInfo(url),
          elapsedMs: Date.now() - startedAt,
          error: errorText
        };
        emitMainEvent('lite_rewrite_failure', {
          conversationId: extractConversationIdFromConversationDetailUrl(url),
          error: errorText,
          url: safeUrlInfo(url)
        });
      }
      if (applyToolHistoryCompaction) {
        state.toolHistoryPayloadLastRewrite = {
          ok: false,
          changed: false,
          at: Date.now(),
          atIso: nowIso(),
          url: safeUrlInfo(url),
          elapsedMs: Date.now() - startedAt,
          error: errorText
        };
        emitMainEvent('tool_history_payload_compaction_failure', {
          conversationId: extractConversationIdFromConversationDetailUrl(url),
          error: errorText,
          url: safeUrlInfo(url)
        });
      }
      return response;
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
    if (conversationChanged) cancelAbsoluteTurnCounter();
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
    cancelAbsoluteTurnCounter();
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
            if (shouldSuppressNativeRecentViewHistoryFetch(method, url)) {
              return Promise.resolve(createSuppressedNativeRecentViewHistoryResponse());
            }
          } catch {}
          const fetchPromise = state.originalFetch.apply(this, arguments);
          if (!observedRequest) return fetchPromise;
          try {
            return Promise.resolve(fetchPromise).then(async (response) => {
              if (!isMainExtensionEnabled()) return response;
              try {
                if (url && isProjectSidebarJsonFetchResponse(method, url, response)) {
                  try { await observeProjectSidebarIndexFromResponse(response); } catch {}
                }
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
          debug: publicSnapshot()
        }
      }, '*');
      return;
    }

    if (data.type === 'SYNC_PAGE_CONVERSATION') {
      const historyHooksReady = installMainWorldHistoryHooks();
      const syncResult = handleMainWorldNavigation(data.payload?.reason || 'content_sync');
      const requestedConversationId = String(data.payload?.conversationId || '').trim();
      const conversationModelConfig = getConversationModelConfigForContent(requestedConversationId);
      const toolHistorySummaryIndex = getToolHistorySummaryIndexForContent(requestedConversationId);
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
          toolHistorySummaryIndex: toolHistorySummaryIndex || null,
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

    if (data.type === 'GET_PROJECT_SIDEBAR_INDEX') {
      window.postMessage({
        source: MAIN_PROTOCOL_SOURCE,
        type: 'PROJECT_SIDEBAR_INDEX_RESULT',
        requestId: data.requestId,
        payload: getProjectSidebarIndexForContent()
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

    if (data.type === 'GET_ABSOLUTE_TURN_INDEX') {
      getAbsoluteTurnIndexForContent(
        data.payload?.conversationId || extractConversationIdFromCurrentUrl(),
        data.payload?.anchorCache || null,
        data.payload?.allowHistoryFetch !== false
      )
        .then((payload) => window.postMessage({
          source: MAIN_PROTOCOL_SOURCE,
          type: 'ABSOLUTE_TURN_INDEX_RESULT',
          requestId: data.requestId,
          payload
        }, '*'))
        .catch(() => window.postMessage({
          source: MAIN_PROTOCOL_SOURCE,
          type: 'ABSOLUTE_TURN_INDEX_RESULT',
          requestId: data.requestId,
          payload: { ok: false, appVersion: APP_VERSION, error: 'absolute_turn_failed' }
        }, '*'));
      return;
    }

    if (data.type === 'CANCEL_ABSOLUTE_TURN_INDEX') {
      cancelAbsoluteTurnCounter();
      return;
    }

    if (data.type === 'GET_READ_ONLY_CONVERSATION_MODEL') {
      getReadOnlyConversationModelForContent(
        data.payload?.conversationId || extractConversationIdFromCurrentUrl(),
        data.payload?.requestedTurnCount ?? 'all'
      ).then((payload) => {
        window.postMessage({
          source: MAIN_PROTOCOL_SOURCE,
          type: 'READ_ONLY_CONVERSATION_MODEL_RESULT',
          requestId: data.requestId,
          payload
        }, '*');
      }).catch(() => {
        window.postMessage({
          source: MAIN_PROTOCOL_SOURCE,
          type: 'READ_ONLY_CONVERSATION_MODEL_RESULT',
          requestId: data.requestId,
          payload: { ok: false, appVersion: APP_VERSION, error: 'read_only_conversation_model_unavailable' }
        }, '*');
      });
      return;
    }

    if (data.type === 'RESOLVE_READ_ONLY_RENDERER_ASSET') {
      resolveReadOnlyRendererAsset(data.payload || {})
        .then((payload) => {
          window.postMessage({
            source: MAIN_PROTOCOL_SOURCE,
            type: 'READ_ONLY_RENDERER_ASSET_RESULT',
            requestId: data.requestId,
            payload
          }, '*');
        })
        .catch(() => {
          window.postMessage({
            source: MAIN_PROTOCOL_SOURCE,
            type: 'READ_ONLY_RENDERER_ASSET_RESULT',
            requestId: data.requestId,
            payload: { ok: false, appVersion: APP_VERSION, error: 'read_only_renderer_asset_failed' }
          }, '*');
        });
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
        clearTurnCountOverride: true,
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
