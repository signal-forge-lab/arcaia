(() => {
  'use strict';

  const APP_VERSION = '0.1.275';
  const MAIN_PROTOCOL_SOURCE = 'aice-probe-main-v159';
  const CONTENT_PROTOCOL_SOURCE = 'aice-probe-content-v159';
  const MAIN_SCRIPT_BASE_ID = 'aice-probe-injected-main-script';
  const MAIN_SCRIPT_ID = `${MAIN_SCRIPT_BASE_ID}-${APP_VERSION.replace(/\./g, '-')}`;
  const CONTENT_READY_KEY = '__AICE_PROBE_CONTENT_READY__';
  const CONTENT_VERSION_KEY = '__AICE_PROBE_CONTENT_VERSION__';
  const ENSURE_MAIN_KEY = '__AICE_PROBE_ENSURE_MAIN_SCRIPT__';
  const EXTENSION_ENABLED_STORAGE_KEY = 'arcaia_extension_enabled_v1';
  const LITE_SHOW_IMAGES_STORAGE_KEY = 'arcaia_lite_show_images_v1';
  const LITE_TURN_COUNT_STORAGE_KEY = 'arcaia_lite_turn_count_v1';
  const ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY = 'arcaia_assistant_completion_sound_enabled_v1';
  const ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY = 'arcaia_assistant_completion_sound_id_v1';
  const ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY = 'arcaia_assistant_completion_sound_volume_v1';
  const DEFAULT_ASSISTANT_COMPLETION_SOUND_ID = 'classic_chime';
  const DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME = 0.153;
  const ASSISTANT_COMPLETION_SOUND_REFERENCE_UI_PERCENT = 50;
  const DEFAULT_LITE_TURN_COUNT = 3;
  const RECENT_VIEW_EXPANSION_STEP = 10;
  const RECENT_VIEW_EXPANDED_TURN_COUNT_MAX = 50;
  const MAX_ASSISTANT_COMPLETION_SOUND_VOLUME = DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME / (ASSISTANT_COMPLETION_SOUND_REFERENCE_UI_PERCENT / 100);
  const OPERATION_MODE_STORAGE_KEY = 'arcaia_operation_mode_v1';
  const FEATURE_SETTINGS_STORAGE_KEY = 'arcaia_feature_settings_v1';
  const MAIN_LITE_STORAGE_KEY = '__AICE_LITE_DISPLAY_CONFIG__';
  const VALID_OPERATION_MODES = new Set(['normal', 'off']);
  const UI_SETTINGS_SCHEMA_VERSION = 2;
  const DEFAULT_FEATURE_SETTINGS = Object.freeze({
    liteView: true,
    liteImages: true,
    messageTimestamps: true,
    modelDecoration: true,
    blockCollapser: true,
    ctrlEnterSend: true,
    loadingTitle: true,
    completionSound: false,
    pinnedSort: true,
    pinnedIcons: true,
    turnMarkdownButtons: true,
    headerMarkdownButton: true
  });
  let extensionEnabled = true;
  let liteShowImagesEnabled = true;
  let liteTurnCount = DEFAULT_LITE_TURN_COUNT;
  let assistantCompletionSoundEnabled = false;
  let assistantCompletionSoundId = DEFAULT_ASSISTANT_COMPLETION_SOUND_ID;
  let assistantCompletionSoundVolume = DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME;
  let operationMode = 'normal';
  let featureSettings = { ...DEFAULT_FEATURE_SETTINGS };
  let currentUiSettingsFingerprint = null;
  let arcaiaPageUiStarted = false;

  if (window[CONTENT_READY_KEY] && window[CONTENT_VERSION_KEY] === APP_VERSION) {
    try { window[ENSURE_MAIN_KEY]?.(); } catch {}
    return;
  }
  let pinnedSortEarlyObserver = null;
  let pinnedSortGateReleaseTimer = null;

  window[CONTENT_READY_KEY] = true;
  window[CONTENT_VERSION_KEY] = APP_VERSION;

  function normalizeFeatureSettings(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const next = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_FEATURE_SETTINGS)) {
      next[key] = typeof source[key] === 'boolean' ? source[key] : defaultValue;
    }
    return next;
  }

  function normalizeAssistantCompletionSoundVolume(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME;
    return Math.max(0, Math.min(MAX_ASSISTANT_COMPLETION_SOUND_VOLUME, parsed));
  }

  function normalizeLiteTurnCount(value) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(1, Math.min(10, parsed)) : DEFAULT_LITE_TURN_COUNT;
  }

  function getConfiguredLiteTurnCount() {
    return normalizeLiteTurnCount(liteTurnCount);
  }

  function isArcaiaNormalMode() {
    return operationMode === 'normal';
  }

  function isArcaiaRuntimeEnabled() {
    return operationMode !== 'off';
  }

  function isArcaiaFeatureEnabled(featureKey) {
    return isArcaiaNormalMode() && featureSettings?.[featureKey] !== false;
  }

  function hasPinnedSortEarlySavedOrder() {
    try {
      const raw = window.localStorage?.getItem?.('arcaia.sidebarPinnedSorter.v1');
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed?.order) && parsed.order.filter(Boolean).length > 1) return true;
      return Object.values(parsed?.orders || {}).some((ids) => Array.isArray(ids) && ids.filter(Boolean).length > 1);
    } catch {
      return false;
    }
  }

  function injectPinnedSortEarlyGateStyle() {
    if (document.getElementById('arcaia-pinned-sort-early-gate-style')) return;
    const style = document.createElement('style');
    style.id = 'arcaia-pinned-sort-early-gate-style';
    style.textContent = `
      html[data-arcaia-pinned-sort-gate="true"]:not([data-arcaia-pinned-sort-ready="true"])
        #stage-slideover-sidebar nav a[data-sidebar-item="true"][href*="/c/"] {
        visibility: hidden !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function releasePinnedSortGate(reason = 'released') {
    const root = document.documentElement;
    try {
      root.setAttribute('data-arcaia-pinned-sort-ready', 'true');
      root.removeAttribute('data-arcaia-pinned-sort-gate');
      root.setAttribute('data-arcaia-pinned-sort-ready-reason', reason);
    } catch {}
    if (pinnedSortGateReleaseTimer) {
      clearTimeout(pinnedSortGateReleaseTimer);
      pinnedSortGateReleaseTimer = null;
    }
    try { pinnedSortEarlyObserver?.disconnect?.(); } catch {}
    pinnedSortEarlyObserver = null;
  }

  function nodeContainsPinnedSortEarlyTarget(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const selector = '#stage-slideover-sidebar, nav[aria-label="チャット履歴"], nav[aria-label="Chat history"], .group\\/sidebar-expando-section, a[data-sidebar-item="true"][href*="/c/"]';
    if (node.matches?.(selector)) return true;
    return Boolean(node.querySelector?.(selector));
  }

  function isPinnedSortEarlyRelevantMutation(mutations) {
    return Array.from(mutations || []).some((mutation) => {
      return Array.from(mutation.addedNodes || []).some(nodeContainsPinnedSortEarlyTarget);
    });
  }

  function queuePinnedSortEarlyScan(reason = 'early') {
    const run = () => {
      try { scanPinnedSortUi(reason); } catch {}
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function startPinnedSortEarlyGate() {
    if (!isArcaiaFeatureEnabled('pinnedSort')) {
      releasePinnedSortGate('pinned_sort_feature_disabled');
      return;
    }
    if (!hasPinnedSortEarlySavedOrder()) {
      releasePinnedSortGate('no_saved_order');
      return;
    }
    injectPinnedSortEarlyGateStyle();
    const root = document.documentElement;
    root.setAttribute('data-arcaia-pinned-sort-gate', 'true');
    root.removeAttribute('data-arcaia-pinned-sort-ready');
    pinnedSortGateReleaseTimer = setTimeout(() => releasePinnedSortGate('fail_safe_timeout'), 1800);
    const target = document.documentElement || document;
    pinnedSortEarlyObserver = new MutationObserver((mutations) => {
      if (isPinnedSortEarlyRelevantMutation(mutations)) queuePinnedSortEarlyScan('early_mutation');
    });
    pinnedSortEarlyObserver.observe(target, { childList: true, subtree: true });
    queuePinnedSortEarlyScan('early_start');
  }

  function nowIso(ts = Date.now()) {
    return new Date(ts).toISOString();
  }

  function redactSnapshotUrl(value) {
    return String(value || '')
      .replace(/\/(c|g|gg|share)\/([a-f0-9-]+)/ig, '/$1/<conversationId>')
      .replace(/([?&](?:token|access_token|authorization|auth|key|session|code|state)=)[^&]+/ig, '$1…')
      .replace(/([?&]arcaia_(?:capture_request|soft_refresh|reason)=)[^&]+/ig, '$1…');
  }

  function injectMainScript() {
    try {
      const staleScripts = Array.from(document.querySelectorAll(`script[id^="${MAIN_SCRIPT_BASE_ID}"]`));
      for (const item of staleScripts) {
        if (item.id !== MAIN_SCRIPT_ID || item.dataset.aiceProbe !== APP_VERSION) {
          try { item.remove(); } catch {}
        }
      }
      if (document.getElementById(MAIN_SCRIPT_ID)) return { injected: false, reason: 'script-element-already-present-current-version' };

      const src = chrome.runtime.getURL('injected-main.js');
      const script = document.createElement('script');
      script.id = MAIN_SCRIPT_ID;
      script.src = `${src}?v=${encodeURIComponent(APP_VERSION)}&t=${Date.now()}`;
      script.async = false;
      script.dataset.aiceProbe = APP_VERSION;

      const parent = document.documentElement || document.head || document.body;
      if (!parent) return { injected: false, reason: 'no-dom-parent-yet' };

      script.onload = () => {
        try { script.remove(); } catch {}
      };
      parent.appendChild(script);
      return { injected: true, reason: 'script-tag-appended-versioned' };
    } catch (error) {
      return { injected: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  window[ENSURE_MAIN_KEY] = injectMainScript;
  let initialInjection = { injected: false, reason: 'pending_ui_settings_sync' };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const FULL_LOAD_MODE_STORAGE_KEY = 'arcaia_full_load_mode_v1';
  const RECENT_VIEW_EXPANSION_STORAGE_KEY = 'arcaia_recent_view_expansion_v1';

  function readRecentViewExpansionFromStorage() {
    try {
      const raw = window.sessionStorage?.getItem?.(RECENT_VIEW_EXPANSION_STORAGE_KEY);
      if (!raw) return { conversationId: null, turnCount: null, requestedAt: null };
      const parsed = JSON.parse(raw);
      const turnCount = Math.max(
        DEFAULT_LITE_TURN_COUNT,
        Math.min(RECENT_VIEW_EXPANDED_TURN_COUNT_MAX, Math.floor(Number(parsed?.turnCount || 0)))
      );
      if (parsed?.appVersion !== APP_VERSION || !parsed?.conversationId || !Number.isFinite(turnCount)) {
        window.sessionStorage?.removeItem?.(RECENT_VIEW_EXPANSION_STORAGE_KEY);
        return { conversationId: null, turnCount: null, requestedAt: null };
      }
      return {
        conversationId: String(parsed.conversationId),
        turnCount,
        requestedAt: Number(parsed.requestedAt || Date.now())
      };
    } catch {
      return { conversationId: null, turnCount: null, requestedAt: null };
    }
  }

  function writeRecentViewExpansionToStorage(state) {
    try {
      if (state?.conversationId && Number.isFinite(Number(state?.turnCount))) {
        window.sessionStorage?.setItem?.(RECENT_VIEW_EXPANSION_STORAGE_KEY, JSON.stringify({
          appVersion: APP_VERSION,
          conversationId: state.conversationId,
          turnCount: Math.max(
            DEFAULT_LITE_TURN_COUNT,
            Math.min(RECENT_VIEW_EXPANDED_TURN_COUNT_MAX, Math.floor(Number(state.turnCount)))
          ),
          requestedAt: Number(state.requestedAt || Date.now())
        }));
      } else {
        window.sessionStorage?.removeItem?.(RECENT_VIEW_EXPANSION_STORAGE_KEY);
      }
    } catch {}
  }

  function readFullLoadModeFromStorage() {
    try {
      const raw = window.sessionStorage?.getItem?.(FULL_LOAD_MODE_STORAGE_KEY);
      if (!raw) return { active: false, conversationId: null, requestedAt: null, reason: null };
      const parsed = JSON.parse(raw);
      const currentConversationId = extractConversationIdFromUrl();
      if (parsed?.appVersion !== APP_VERSION || !parsed?.active || !parsed?.conversationId || parsed.conversationId !== currentConversationId) {
        window.sessionStorage?.removeItem?.(FULL_LOAD_MODE_STORAGE_KEY);
        return { active: false, conversationId: null, requestedAt: null, reason: null };
      }
      return {
        active: true,
        conversationId: parsed.conversationId,
        requestedAt: Number(parsed.requestedAt || Date.now()),
        reason: parsed.reason || 'stored_full_load_mode'
      };
    } catch {
      return { active: false, conversationId: null, requestedAt: null, reason: null };
    }
  }

  function writeFullLoadModeToStorage(state) {
    try {
      if (state?.active && state?.conversationId) {
        window.sessionStorage?.setItem?.(FULL_LOAD_MODE_STORAGE_KEY, JSON.stringify({ ...state, appVersion: APP_VERSION }));
      } else {
        window.sessionStorage?.removeItem?.(FULL_LOAD_MODE_STORAGE_KEY);
      }
    } catch {}
  }

  let fullLoadModeState = readFullLoadModeFromStorage();
  let recentViewExpansionState = readRecentViewExpansionFromStorage();
  let recentViewRefreshState = {
    active: false,
    conversationId: null,
    mode: null,
    requestedTurnCount: null,
    startedAt: null,
    sourceContentRoot: null,
    sourceRoutePath: null
  };
  const recentViewRefreshConditionSignals = new Set();

  function signalRecentViewRefreshConditions() {
    for (const signal of Array.from(recentViewRefreshConditionSignals)) {
      try { signal(); } catch {}
    }
  }

  function getContentFailedTraceSummary(extra = {}) {
    return {
      appVersion: APP_VERSION,
      traceEnabled: false,
      traceCount: 0,
      lastEvent: null,
      recent: [],
      note: '汎用Debugトレースは削除済みです。必要な調査は専用probeを使用します。',
      ...extra
    };
  }


  function isArcaiaExtensionEnabled() {
    return isArcaiaNormalMode();
  }

  function cleanupArcaiaPageUiForDisabled(reason = 'extension_disabled') {
    try { clearRecentViewExpansionState(); } catch {}
    try {
      fullLoadModeState = { active: false, conversationId: null, requestedAt: null, reason };
      writeFullLoadModeToStorage(fullLoadModeState);
    } catch {}
    try { stopAssistantLoadingFaviconMonitor(reason); } catch {}
    try { stopPageConversationMonitor(); } catch {}
    try { stopRollingLiteUi(); } catch {}
    try { stopMessageTimestampUi(); } catch {}
    try { stopTurnExportUi(); } catch {}
    try { stopHeaderMarkdownButtonUi(); } catch {}
    try { stopPinnedSortUi(reason); } catch {}
    try { stopCtrlEnterSendUi(); } catch {}
    try { window.__ARCAIA_MODEL_SELECTOR_UI__?.cleanup?.(reason); } catch {}
    try { removeAssistantLoadingFaviconLink(); } catch {}
    try {
      assistantGenerationActive = false;
      assistantCompletionSignaledForCurrentGeneration = false;
      assistantCompletionLatched = false;
      assistantCompletionLastReason = null;
      assistantCompletionLastKey = null;
      assistantCompletedInactiveTitlePending = false;
      clearAssistantActivityTitlePrefix();
    } catch {}
    try { document.documentElement?.removeAttribute?.('data-arcaia-assistant-loading-title'); } catch {}
    try { document.getElementById(LITE_BAR_ID)?.remove?.(); } catch {}
    try { removeRecentViewHistoryControls(); } catch {}
    try { removeRecentViewLoadingOverlay(); } catch {}
    try { removeRecentViewFailureNotice(); } catch {}
    try { setPromptTocHiddenActive(false); } catch {}
    try {
      for (const el of Array.from(document.querySelectorAll(`[${ROLLING_HIDE_ATTR}="true"]`))) {
        const originalDisplay = el.getAttribute?.(ROLLING_ORIGINAL_DISPLAY_ATTR);
        if (originalDisplay != null) el.style.display = originalDisplay;
        else el.style.removeProperty?.('display');
        el.removeAttribute?.(ROLLING_HIDE_ATTR);
        el.removeAttribute?.(ROLLING_ORIGINAL_DISPLAY_ATTR);
        el.removeAttribute?.(ROLLING_PRUNE_MODE_ATTR);
      }
    } catch {}
    try {
      for (const badge of Array.from(document.querySelectorAll(`[${MESSAGE_TIME_BADGE_ATTR}="true"]`))) badge.remove();
      for (const container of Array.from(document.querySelectorAll(`[${MESSAGE_TIME_APPLIED_ATTR}="true"]`))) container.removeAttribute?.(MESSAGE_TIME_APPLIED_ATTR);
    } catch {}
    try { for (const button of Array.from(document.querySelectorAll(`[${TURN_EXPORT_BUTTON_ATTR}]`))) button.remove(); } catch {}
    try { cleanupCodeBlockCollapserUi(); } catch {}
    try { stopConversationDomObserver(); } catch {}
    try { releasePinnedSortGate(`extension_disabled:${reason}`); } catch {}
    arcaiaPageUiStarted = false;
    return { ok: true, appVersion: APP_VERSION, action: 'cleanup_extension_disabled', enabled: false, reason };
  }

  function getUiSettingsSnapshot() {
    return {
      schemaVersion: UI_SETTINGS_SCHEMA_VERSION,
      operationMode: operationMode === 'off' ? 'off' : 'normal',
      featureSettings: normalizeFeatureSettings(featureSettings),
      liteTurnCount: normalizeLiteTurnCount(liteTurnCount),
      assistantCompletionSoundId: isValidAssistantCompletionSoundId(assistantCompletionSoundId)
        ? assistantCompletionSoundId
        : DEFAULT_ASSISTANT_COMPLETION_SOUND_ID,
      assistantCompletionSoundVolume: normalizeAssistantCompletionSoundVolume(assistantCompletionSoundVolume)
    };
  }

  function getUiSettingsFingerprint(snapshot = getUiSettingsSnapshot()) {
    return JSON.stringify({
      schemaVersion: snapshot.schemaVersion,
      operationMode: snapshot.operationMode,
      featureSettings: snapshot.featureSettings,
      liteTurnCount: snapshot.liteTurnCount,
      assistantCompletionSoundId: snapshot.assistantCompletionSoundId,
      assistantCompletionSoundVolume: snapshot.assistantCompletionSoundVolume
    });
  }

  function getUiSettingsStatus() {
    const snapshot = getUiSettingsSnapshot();
    return {
      ok: true,
      appVersion: APP_VERSION,
      action: 'ui_settings_status',
      settingsFingerprint: currentUiSettingsFingerprint || getUiSettingsFingerprint(snapshot),
      settings: snapshot
    };
  }

  function getChangedFeatureKeys(previousFeatures, nextFeatures) {
    return Object.keys(DEFAULT_FEATURE_SETTINGS).filter((key) => previousFeatures?.[key] !== nextFeatures?.[key]);
  }

  function removeMessageTimestampArtifacts() {
    try {
      for (const badge of Array.from(document.querySelectorAll(`[${MESSAGE_TIME_BADGE_ATTR}="true"]`))) badge.remove();
      for (const container of Array.from(document.querySelectorAll(`[${MESSAGE_TIME_APPLIED_ATTR}="true"]`))) {
        container.removeAttribute?.(MESSAGE_TIME_APPLIED_ATTR);
      }
    } catch {}
  }

  function restoreRollingLiteHiddenContainers() {
    try {
      for (const el of Array.from(document.querySelectorAll(`[${ROLLING_HIDE_ATTR}="true"]`))) {
        const originalDisplay = el.getAttribute?.(ROLLING_ORIGINAL_DISPLAY_ATTR);
        if (originalDisplay != null) el.style.display = originalDisplay;
        else el.style.removeProperty?.('display');
        el.removeAttribute?.(ROLLING_HIDE_ATTR);
        el.removeAttribute?.(ROLLING_ORIGINAL_DISPLAY_ATTR);
        el.removeAttribute?.(ROLLING_PRUNE_MODE_ATTR);
      }
    } catch {}
  }

  function syncConversationDomObserverForFeatures() {
    const needed = Boolean(
      featureSettings.blockCollapser
      || featureSettings.turnMarkdownButtons
      || featureSettings.messageTimestamps
      || featureSettings.liteView
    );
    if (needed && isArcaiaExtensionEnabled()) startConversationDomObserver();
    else stopConversationDomObserver();
  }

  async function applyUiSettingsDiff(previous, next, changedFeatureKeys, reason) {
    const modeChanged = previous.operationMode !== next.operationMode;
    if (modeChanged) {
      try { await postToMainAndWait('SET_EXTENSION_ENABLED', 'EXTENSION_ENABLED_SET_RESULT', 1500, { enabled: next.operationMode !== 'off', reason }); } catch {}
      if (next.operationMode === 'off') {
        cleanupArcaiaPageUiForDisabled(`ui_settings:${reason}`);
        try { await runLiteDisplayDisable({ requestedBy: reason, commandId: reason }); } catch {}
      } else if (window.top === window) {
        if (featureSettings.liteView) {
          try {
            await setMainWorldLiteDisplayConfig({
              enabled: true,
              turnCount: liteTurnCount,
              liteShowImages: liteShowImagesEnabled,
              clearFullLoadMode: true,
              requestedBy: reason,
              configSource: 'runtime_reenabled'
            }, 1800);
          } catch {}
        }
        startArcaiaPageUi();
      }
      return { modeChanged: true, changedSubsystems: ['runtime'] };
    }

    if (next.operationMode === 'off') {
      return { modeChanged: false, changedSubsystems: [] };
    }

    const changedSubsystems = new Set();
    const featureChanged = (key) => changedFeatureKeys.includes(key);

    if (featureChanged('ctrlEnterSend')) {
      changedSubsystems.add('composer_input');
      if (featureSettings.ctrlEnterSend) startCtrlEnterSendUi();
      else stopCtrlEnterSendUi();
    }

    if (featureChanged('modelDecoration')) {
      changedSubsystems.add('model_decoration');
      if (featureSettings.modelDecoration) {
        try { window.__ARCAIA_MODEL_SELECTOR_UI__?.start?.(); } catch {}
      } else {
        try { window.__ARCAIA_MODEL_SELECTOR_UI__?.cleanup?.('feature_disabled'); } catch {}
      }
    }

    if (featureChanged('blockCollapser')) {
      changedSubsystems.add('block_collapser');
      if (featureSettings.blockCollapser) startCodeBlockCollapserUi();
      else cleanupCodeBlockCollapserUi();
    }

    const assistantMonitorKeys = ['loadingTitle', 'completionSound', 'liteView'];
    if (assistantMonitorKeys.some(featureChanged)) {
      changedSubsystems.add('assistant_monitor');
      const shouldRun = assistantMonitorKeys.some((key) => featureSettings[key] !== false);
      stopAssistantLoadingFaviconMonitor('assistant_features_changed');
      if (shouldRun) startAssistantLoadingFaviconMonitor();
    }

    if (featureChanged('pinnedSort') || featureChanged('pinnedIcons')) {
      changedSubsystems.add('sidebar');
      stopPinnedSortUi('feature_settings_changed');
      if (featureSettings.pinnedSort || featureSettings.pinnedIcons) {
        if (featureSettings.pinnedSort) startPinnedSortEarlyGate();
        else releasePinnedSortGate('pinned_sort_feature_disabled');
        startPinnedSortUi();
      } else {
        releasePinnedSortGate('pinned_features_disabled');
      }
    }

    if (featureChanged('turnMarkdownButtons')) {
      changedSubsystems.add('turn_markdown');
      if (featureSettings.turnMarkdownButtons) startTurnExportUi();
      else stopTurnExportUi();
    }

    if (featureChanged('headerMarkdownButton')) {
      changedSubsystems.add('header_markdown');
      if (featureSettings.headerMarkdownButton) startHeaderMarkdownButtonUi();
      else stopHeaderMarkdownButtonUi();
    }

    if (featureChanged('messageTimestamps')) {
      changedSubsystems.add('timestamps');
      if (featureSettings.messageTimestamps) startMessageTimestampUi();
      else {
        stopMessageTimestampUi();
        removeMessageTimestampArtifacts();
      }
    }

    const liteSettingsChanged = featureChanged('liteView')
      || featureChanged('liteImages')
      || previous.liteTurnCount !== next.liteTurnCount;
    if (liteSettingsChanged) {
      changedSubsystems.add('recent_view');
      if (featureSettings.liteView) {
        startRollingLiteUi();
        try {
          await setMainWorldLiteDisplayConfig({
            enabled: true,
            turnCount: liteTurnCount,
            liteShowImages: liteShowImagesEnabled,
            requestedBy: reason,
            configSource: 'popup_ui_settings_diff'
          }, 1800);
        } catch {}
        scheduleRollingLiteApply('ui_settings_diff');
      } else {
        clearRecentViewExpansionState();
        fullLoadModeState = { active: false, conversationId: null, requestedAt: null, reason: 'lite_view_disabled' };
        writeFullLoadModeToStorage(fullLoadModeState);
        stopRollingLiteUi();
        restoreRollingLiteHiddenContainers();
        try { await runLiteDisplayDisable({ requestedBy: reason, commandId: reason }); } catch {}
      }
    }

    if (previous.assistantCompletionSoundId !== next.assistantCompletionSoundId
      || previous.assistantCompletionSoundVolume !== next.assistantCompletionSoundVolume) {
      changedSubsystems.add('completion_sound');
    }

    syncConversationDomObserverForFeatures();
    return { modeChanged: false, changedSubsystems: Array.from(changedSubsystems) };
  }

  async function syncUiSettingsFromStorage() {
    let data = {};
    try {
      data = await chrome.storage.local.get([
        OPERATION_MODE_STORAGE_KEY,
        FEATURE_SETTINGS_STORAGE_KEY,
        EXTENSION_ENABLED_STORAGE_KEY,
        LITE_SHOW_IMAGES_STORAGE_KEY,
        ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY,
        ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY,
        ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY,
        LITE_TURN_COUNT_STORAGE_KEY
      ]);
    } catch {}
    const storedMode = data?.[OPERATION_MODE_STORAGE_KEY];
    operationMode = storedMode === 'off' || data?.[EXTENSION_ENABLED_STORAGE_KEY] === false ? 'off' : 'normal';
    const storedFeatures = data?.[FEATURE_SETTINGS_STORAGE_KEY];
    featureSettings = normalizeFeatureSettings({
      ...storedFeatures,
      ...(storedFeatures && typeof storedFeatures.liteImages === 'boolean'
        ? {}
        : { liteImages: data?.[LITE_SHOW_IMAGES_STORAGE_KEY] !== false }),
      ...(storedFeatures && typeof storedFeatures.completionSound === 'boolean'
        ? {}
        : { completionSound: data?.[ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY] === true })
    });
    liteShowImagesEnabled = Boolean(featureSettings.liteImages);
    liteTurnCount = normalizeLiteTurnCount(data?.[LITE_TURN_COUNT_STORAGE_KEY]);
    assistantCompletionSoundEnabled = Boolean(featureSettings.completionSound);
    assistantCompletionSoundId = isValidAssistantCompletionSoundId(data?.[ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY])
      ? data[ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY]
      : DEFAULT_ASSISTANT_COMPLETION_SOUND_ID;
    assistantCompletionSoundVolume = normalizeAssistantCompletionSoundVolume(data?.[ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY]);
    extensionEnabled = isArcaiaRuntimeEnabled();
    currentUiSettingsFingerprint = getUiSettingsFingerprint();
    return getUiSettingsSnapshot();
  }

  function primeMainWorldStorageForUiSettings() {
    try { window.sessionStorage?.removeItem?.('arcaia_debug_mode_enabled_v1'); } catch {}
    try { window.sessionStorage?.setItem?.(EXTENSION_ENABLED_STORAGE_KEY, isArcaiaRuntimeEnabled() ? 'true' : 'false'); } catch {}
    if (isArcaiaNormalMode() && featureSettings.liteView !== false) return;
    try {
      const raw = window.sessionStorage?.getItem?.(MAIN_LITE_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      window.sessionStorage?.setItem?.(MAIN_LITE_STORAGE_KEY, JSON.stringify({
        ...parsed,
        enabled: false,
        userDisabled: operationMode === 'off',
        configSource: 'feature_lite_disabled_bootstrap',
        updatedAt: Date.now(),
        updatedAtIso: nowIso()
      }));
    } catch {}
  }

  async function setUiSettings(payload = {}, reason = 'manual') {
    const previous = getUiSettingsSnapshot();
    const nextMode = payload?.operationMode === 'off' ? 'off' : 'normal';
    const nextFeatures = normalizeFeatureSettings(payload?.featureSettings || featureSettings);
    const nextLiteTurnCount = normalizeLiteTurnCount(
      Object.prototype.hasOwnProperty.call(payload || {}, 'liteTurnCount') ? payload.liteTurnCount : liteTurnCount
    );
    const nextSoundId = isValidAssistantCompletionSoundId(payload?.assistantCompletionSoundId)
      ? payload.assistantCompletionSoundId
      : assistantCompletionSoundId;
    const nextSoundVolume = normalizeAssistantCompletionSoundVolume(
      Object.prototype.hasOwnProperty.call(payload || {}, 'assistantCompletionSoundVolume')
        ? payload.assistantCompletionSoundVolume
        : assistantCompletionSoundVolume
    );
    const next = {
      schemaVersion: UI_SETTINGS_SCHEMA_VERSION,
      operationMode: nextMode,
      featureSettings: nextFeatures,
      liteTurnCount: nextLiteTurnCount,
      assistantCompletionSoundId: nextSoundId,
      assistantCompletionSoundVolume: nextSoundVolume
    };
    const nextFingerprint = getUiSettingsFingerprint(next);
    if (nextFingerprint === (currentUiSettingsFingerprint || getUiSettingsFingerprint(previous))) {
      return {
        ok: true,
        appVersion: APP_VERSION,
        action: 'set_ui_settings',
        skipped: true,
        reason: 'settings_unchanged',
        settingsFingerprint: nextFingerprint,
        changedFeatureKeys: [],
        changedSubsystems: []
      };
    }

    operationMode = next.operationMode;
    featureSettings = next.featureSettings;
    liteTurnCount = next.liteTurnCount;
    assistantCompletionSoundId = next.assistantCompletionSoundId;
    assistantCompletionSoundVolume = next.assistantCompletionSoundVolume;
    extensionEnabled = isArcaiaRuntimeEnabled();
    liteShowImagesEnabled = Boolean(featureSettings.liteImages);
    assistantCompletionSoundEnabled = Boolean(featureSettings.completionSound);
    const changedFeatureKeys = getChangedFeatureKeys(previous.featureSettings, next.featureSettings);
    try {
      await chrome.storage.local.set({
        [OPERATION_MODE_STORAGE_KEY]: operationMode,
        [FEATURE_SETTINGS_STORAGE_KEY]: featureSettings,
        [EXTENSION_ENABLED_STORAGE_KEY]: extensionEnabled,
        [LITE_SHOW_IMAGES_STORAGE_KEY]: liteShowImagesEnabled,
        [LITE_TURN_COUNT_STORAGE_KEY]: liteTurnCount,
        [ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY]: assistantCompletionSoundEnabled,
        [ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY]: assistantCompletionSoundId,
        [ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY]: assistantCompletionSoundVolume
      });
    } catch {}
    primeMainWorldStorageForUiSettings();
    const applied = await applyUiSettingsDiff(previous, next, changedFeatureKeys, reason);
    currentUiSettingsFingerprint = nextFingerprint;
    return {
      ok: true,
      appVersion: APP_VERSION,
      action: 'set_ui_settings',
      operationMode,
      featureSettings,
      liteTurnCount,
      assistantCompletionSoundId,
      assistantCompletionSoundVolume,
      settingsFingerprint: nextFingerprint,
      changedFeatureKeys,
      changedSubsystems: applied.changedSubsystems,
      modeChanged: applied.modeChanged,
      reason
    };
  }

  async function setExtensionEnabled(enabled, reason = 'manual') {
    return setUiSettings({
      operationMode: enabled ? 'normal' : 'off',
      featureSettings
    }, reason);
  }

  async function syncExtensionEnabledFromStorage() {
    extensionEnabled = isArcaiaRuntimeEnabled();
    try { await postToMainAndWait('SET_EXTENSION_ENABLED', 'EXTENSION_ENABLED_SET_RESULT', 1500, { enabled: extensionEnabled, reason: 'content_init_storage_sync' }); } catch {}
    return extensionEnabled;
  }

  async function setLiteShowImagesEnabled(enabled, reason = 'manual') {
    liteShowImagesEnabled = Boolean(enabled);
    featureSettings = normalizeFeatureSettings({ ...featureSettings, liteImages: liteShowImagesEnabled });
    try {
      await chrome.storage.local.set({
        [LITE_SHOW_IMAGES_STORAGE_KEY]: liteShowImagesEnabled,
        [FEATURE_SETTINGS_STORAGE_KEY]: featureSettings
      });
    } catch {}
    let liteDisplay = null;
    try {
      const result = await setMainWorldLiteDisplayConfig({
        turnCount: getConfiguredLiteTurnCount(),
        liteShowImages: liteShowImagesEnabled,
        requestedBy: reason,
        configSource: 'lite_image_display_option'
      }, 2500);
      liteDisplay = result?.liteDisplay || result?.mainWorldHook?.liteDisplay || result || null;
    } catch {}
    return { ok: true, appVersion: APP_VERSION, action: 'set_lite_image_display', liteShowImages: liteShowImagesEnabled, liteDisplay, reason };
  }

  async function syncLiteShowImagesFromStorage() {
    let storedEnabled = true;
    try {
      const data = await chrome.storage.local.get(LITE_SHOW_IMAGES_STORAGE_KEY);
      storedEnabled = data && data[LITE_SHOW_IMAGES_STORAGE_KEY] === false ? false : true;
    } catch {
      storedEnabled = true;
    }
    liteShowImagesEnabled = storedEnabled;
    try {
      await setMainWorldLiteDisplayConfig({
        turnCount: getConfiguredLiteTurnCount(),
        liteShowImages: liteShowImagesEnabled,
        requestedBy: 'content_init_storage_sync',
        configSource: 'lite_image_display_storage_sync'
      }, 1800);
    } catch {}
    return liteShowImagesEnabled;
  }

  function isValidAssistantCompletionSoundId(soundId) {
    const id = String(soundId || '');
    return Boolean(id && ASSISTANT_COMPLETION_SOUND_PRESETS[id]);
  }

  async function setAssistantCompletionSoundEnabled(enabled, reason = 'manual') {
    assistantCompletionSoundEnabled = Boolean(enabled);
    featureSettings = normalizeFeatureSettings({ ...featureSettings, completionSound: assistantCompletionSoundEnabled });
    try {
      await chrome.storage.local.set({
        [ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY]: assistantCompletionSoundEnabled,
        [FEATURE_SETTINGS_STORAGE_KEY]: featureSettings
      });
    } catch {}
    updateAssistantCompletionSoundState({ lastReason: reason, lastError: null });
    return {
      ok: true,
      appVersion: APP_VERSION,
      action: 'set_assistant_completion_sound',
      enabled: assistantCompletionSoundEnabled,
      soundId: assistantCompletionSoundId,
      volume: assistantCompletionSoundVolume,
      soundState: assistantCompletionSoundState,
      reason
    };
  }

  async function syncAssistantCompletionSoundFromStorage() {
    let storedEnabled = false;
    let storedSoundId = assistantCompletionSoundId;
    let storedVolume = assistantCompletionSoundVolume;
    try {
      const data = await chrome.storage.local.get([
        ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY,
        ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY,
        ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY
      ]);
      storedEnabled = Boolean(data && data[ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY] === true);
      if (isValidAssistantCompletionSoundId(data?.[ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY])) storedSoundId = data[ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY];
      storedVolume = normalizeAssistantCompletionSoundVolume(data?.[ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY]);
    } catch {
      storedEnabled = false;
      storedSoundId = assistantCompletionSoundId;
      storedVolume = assistantCompletionSoundVolume;
    }
    assistantCompletionSoundEnabled = storedEnabled;
    assistantCompletionSoundId = storedSoundId;
    assistantCompletionSoundVolume = storedVolume;
    updateAssistantCompletionSoundState({ lastReason: 'content_init_storage_sync', lastError: null });
    return { enabled: assistantCompletionSoundEnabled, soundId: assistantCompletionSoundId, volume: assistantCompletionSoundVolume };
  }

  async function syncStartupSettingsFromStorage() {
    await syncUiSettingsFromStorage();
    primeMainWorldStorageForUiSettings();
    initialInjection = injectMainScript();
    await sleep(40);
    await syncExtensionEnabledFromStorage();
    updateAssistantCompletionSoundState({ lastReason: 'content_init_storage_sync', lastError: null });
  }

  function trimLargeForDebug(value, depth = 0) {
    if (depth > 6) return '[MaxDepth]';
    if (value == null) return value;
    if (typeof value === 'string') {
      return value.length > 12000 ? `${value.slice(0, 12000)}...[truncated ${value.length - 12000} chars]` : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      const recent = value.slice(-80);
      const out = recent.map((v) => trimLargeForDebug(v, depth + 1));
      if (value.length > 80) out.unshift(`[truncated first ${value.length - 80} items; showing latest 80]`);
      return out;
    }
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value).slice(0, 80)) {
        if (k === 'html' && typeof v === 'string') {
          out[k] = v ? `[omitted html ${v.length} chars]` : '';
        } else if (k === 'rawConversation') {
          out[k] = '[omitted rawConversation]';
        } else {
          out[k] = trimLargeForDebug(v, depth + 1);
        }
      }
      return out;
    }
    return String(value);
  }

  function tryExtractConversationIdFromUrl(url = '') {
    const patterns = [
      /\/c\/([a-f0-9-]+)/i,
      /\/g\/([a-f0-9-]+)/i,
      /\/gg\/([a-f0-9-]+)/i,
      /\/share\/([a-f0-9-]+)/i
    ];
    for (const pattern of patterns) {
      const match = String(url || '').match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  function extractConversationIdFromUrl(url = window.location.href) {
    const conversationId = tryExtractConversationIdFromUrl(url);
    if (conversationId) return conversationId;
    throw new Error('URLからChatGPTのconversationIdを取得できませんでした。/c/<id> の会話ページで実行してください。');
  }

  function extractConversationIdFromMessageOrUrl(message = {}) {
    const candidates = [
      message?.conversationId,
      message?.tabUrl,
      window.location.href,
      document.location?.href,
      document.referrer
    ];
    for (const candidate of candidates) {
      const id = tryExtractConversationIdFromUrl(candidate);
      if (id) return id;
    }
    throw new Error('URLからChatGPTのconversationIdを取得できませんでした。/c/<id> の会話ページで実行してください。');
  }

  function getCookieValue(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function postToMainAndWait(requestType, responseType, timeoutMs = 3000, payload = {}) {
    injectMainScript();
    const requestId = `aice-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(null);
      }, timeoutMs);

      function onMessage(event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== MAIN_PROTOCOL_SOURCE) return;
        if (data.type !== responseType || data.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(data.payload || null);
      }

      window.addEventListener('message', onMessage);
      window.postMessage({
        source: CONTENT_PROTOCOL_SOURCE,
        type: requestType,
        requestId,
        payload
      }, '*');
    });
  }

  window.addEventListener('message', (event) => {
    try {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== MAIN_PROTOCOL_SOURCE || data.type !== 'AICE_MAIN_EVENT') return;
      const mainEventType = data.eventType || data.payload?.event || null;
      if (mainEventType === 'message_timestamp_index_updated') {
        const currentConversationId = tryExtractConversationIdFromUrl(window.location.href);
        const eventConversationId = data.payload?.conversationId || null;
        if (currentConversationId && eventConversationId === currentConversationId) {
          scheduleRefreshMessageTimestampIndex('main_event_message_timestamp_index_updated');
        }
      }
      if (mainEventType === 'page_navigation') {
        const navigationReason = data.payload?.reason || 'navigation';
        markConversationDependentDomSyncPending(`main_world_${navigationReason}`);
        handleAssistantPageNavigationIntent(navigationReason);
        try {
          window.__ARCAIA_MODEL_SELECTOR_UI__?.resetForNavigation?.({
            reason: navigationReason
          });
        } catch {}
        scheduleConversationDependentStateSync(`main_world_${navigationReason}`);
      }
      if (mainEventType === 'current_conversation_model_config') {
        const currentConversationId = tryExtractConversationIdFromUrl(window.location.href);
        const eventConversationId = data.payload?.conversationId || null;
        if (currentConversationId && eventConversationId === currentConversationId) {
          try {
            window.__ARCAIA_MODEL_SELECTOR_UI__?.applyConversationModelConfig?.(
              data.payload || {},
              data.payload?.reason || 'main_world_conversation_response'
            );
          } catch {}
          handleConversationDependentDomSignal('current_conversation_model_config');
        }
      }
    } catch {}
  });

  function requestMainAuth(timeoutMs = 3000) {
    return postToMainAndWait('GET_CHATGPT_AUTH', 'CHATGPT_AUTH_RESULT', timeoutMs);
  }


  function setMainWorldLiteDisplayConfig(config, timeoutMs = 2500) {
    clearLiteDisplayMainCache('set_lite_display_config');
    return postToMainAndWait('SET_LITE_DISPLAY_CONFIG', 'LITE_DISPLAY_CONFIG_SET', timeoutMs, config || {})
      .then((result) => {
        clearLiteDisplayMainCache('set_lite_display_config_result');
        return result;
      });
  }


  function requestMainWorldFullLoadOnce(payload = {}, timeoutMs = 2500) {
    return postToMainAndWait('REQUEST_FULL_LOAD_ONCE', 'FULL_LOAD_ONCE_RESULT', timeoutMs, payload || {});
  }

  function syncMainWorldConversation(timeoutMs = 1800, reason = 'content_sync') {
    return postToMainAndWait('SYNC_PAGE_CONVERSATION', 'PAGE_CONVERSATION_SYNC_RESULT', timeoutMs, {
      pageUrl: window.location.href,
      conversationId: tryExtractConversationIdFromUrl(window.location.href),
      reason
    });
  }

  function getMainWorldLiteDisplayStatus(timeoutMs = 2500) {
    return postToMainAndWait('GET_LITE_DISPLAY_CONFIG', 'LITE_DISPLAY_CONFIG_RESULT', timeoutMs);
  }

  function getMainWorldMessageTimestampIndex(timeoutMs = 2500, conversationId = tryExtractConversationIdFromUrl(window.location.href)) {
    return postToMainAndWait('GET_MESSAGE_TIMESTAMP_INDEX', 'MESSAGE_TIMESTAMP_INDEX_RESULT', timeoutMs, {
      conversationId
    });
  }

  function resetMainWorldLiteDisplayConfig(timeoutMs = 2500) {
    clearLiteDisplayMainCache('reset_lite_display_config');
    return postToMainAndWait('RESET_LITE_DISPLAY_CONFIG', 'LITE_DISPLAY_CONFIG_RESET', timeoutMs)
      .then((result) => {
        clearLiteDisplayMainCache('reset_lite_display_config_result');
        return result;
      });
  }

  function getMainWorldLiteDisplayInternalDiagnostic(timeoutMs = 2500) {
    return postToMainAndWait('GET_LITE_DISPLAY_INTERNAL_DIAGNOSTIC', 'LITE_DISPLAY_INTERNAL_DIAGNOSTIC_RESULT', timeoutMs);
  }

  function requestMainWorldFreshLiteRewriteDiagnostic(raw, payload = {}, timeoutMs = 8000) {
    return postToMainAndWait('BUILD_LITE_REWRITE_DIAGNOSTIC', 'LITE_REWRITE_DIAGNOSTIC_RESULT', timeoutMs, {
      raw,
      requestedTurnCount: payload.requestedTurnCount || payload.turnCount || NATIVE_LITE_TURN_COUNT,
      context: payload.context || {}
    });
  }

  async function tryGetAccessTokenFromSession() {
    try {
      const response = await fetch('/api/auth/session?unstable_client=true', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return { ok: false, status: response.status, authorization: null };
      const json = await response.json();
      return json && json.accessToken
        ? { ok: true, status: response.status, authorization: `Bearer ${json.accessToken}` }
        : { ok: false, status: response.status, authorization: null };
    } catch (error) {
      return { ok: false, status: null, authorization: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function redactAuthDebug(auth) {
    if (!auth) return null;
    return {
      hasAuthorization: Boolean(auth.authorization),
      extraHeaderKeys: Object.keys(auth.extraHeaders || {}).sort(),
      updatedAt: auth.updatedAt || null,
      seenUrlCount: auth.seenUrlCount || 0,
      lastSeenUrl: auth.lastSeenUrl || null,
      mainWorldDebug: auth.debug || null
    };
  }

  async function getAuthForInternalApi() {
    let mainAuth = await requestMainAuth(2000);

    if (!mainAuth || !mainAuth.authorization) {
      await sleep(500);
      mainAuth = await requestMainAuth(2500);
    }

    const sessionResult = mainAuth?.authorization ? { ok: false, authorization: null, skipped: true } : await tryGetAccessTokenFromSession();
    const authorization = mainAuth?.authorization || sessionResult.authorization;
    const oaiDeviceId = getCookieValue('oai-did');

    if (!authorization) {
      throw new Error('Authorizationを取得できませんでした。先に「通信ログ取得」を押して /backend-api/ が観測されているか確認し、ChatGPTページをリロードして再実行してください。');
    }

    return {
      authorization,
      oaiDeviceId,
      extraHeaders: mainAuth?.extraHeaders || {},
      debug: {
        fromMainWorldHook: Boolean(mainAuth?.authorization),
        fromSessionEndpoint: Boolean(sessionResult.authorization),
        sessionEndpoint: {
          attempted: !sessionResult.skipped,
          ok: Boolean(sessionResult.ok),
          status: sessionResult.status || null,
          error: sessionResult.error || null
        },
        hasOaiDeviceIdCookie: Boolean(oaiDeviceId),
        mainAuth: redactAuthDebug(mainAuth)
      }
    };
  }

  async function fetchChatGPTConversationCookieOnly(conversationId) {
    return fetch(`/backend-api/conversation/${conversationId}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
  }

  async function readResponseBody(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return response.json();
    return response.text();
  }

  async function fetchChatGPTConversationRaw(conversationId) {
    const attempts = [];

    try {
      const cookieOnlyResponse = await fetchChatGPTConversationCookieOnly(conversationId);
      const cookieOnlyBody = await readResponseBody(cookieOnlyResponse.clone ? cookieOnlyResponse.clone() : cookieOnlyResponse);
      attempts.push({ strategy: 'cookie_only', status: cookieOnlyResponse.status, ok: cookieOnlyResponse.ok });
      if (cookieOnlyResponse.ok) {
        return {
          raw: cookieOnlyBody,
          authDebug: {
            strategySucceeded: 'cookie_only',
            attempts,
            note: 'Authorization hook was not required for this request.'
          }
        };
      }
    } catch (error) {
      attempts.push({ strategy: 'cookie_only', ok: false, error: error instanceof Error ? error.message : String(error) });
    }

    const auth = await getAuthForInternalApi();
    const headers = {
      Accept: 'application/json',
      ...auth.extraHeaders,
      Authorization: auth.authorization
    };
    if (auth.oaiDeviceId) headers['oai-device-id'] = auth.oaiDeviceId;

    const response = await fetch(`/backend-api/conversation/${conversationId}`, {
      method: 'GET',
      credentials: 'include',
      headers
    });

    const body = await readResponseBody(response);
    attempts.push({
      strategy: auth.debug.fromMainWorldHook ? 'main_world_hook' : 'session_endpoint',
      status: response.status,
      ok: response.ok
    });

    if (!response.ok) {
      const detail = typeof body === 'string' ? body.slice(0, 1000) : JSON.stringify(body).slice(0, 1000);
      throw new Error(`ChatGPT内部API取得に失敗しました: HTTP ${response.status} ${response.statusText}\n${detail}`);
    }

    return {
      raw: body,
      authDebug: {
        ...auth.debug,
        strategySucceeded: auth.debug.fromMainWorldHook ? 'main_world_hook' : 'session_endpoint',
        attempts
      }
    };
  }

  function findRootNode(raw) {
    if (raw?.mapping?.['client-created-root']) return raw.mapping['client-created-root'];
    for (const node of Object.values(raw?.mapping || {})) {
      if (node && node.parent === null) return node;
    }
    return null;
  }

  function collectReachableNodeIds(raw, root) {
    const ids = new Set();
    const stack = [root?.id].filter(Boolean);
    while (stack.length) {
      const id = stack.pop();
      if (!id || ids.has(id)) continue;
      ids.add(id);
      const node = raw.mapping?.[id];
      const children = Array.isArray(node?.children) ? node.children : [];
      for (const child of children) stack.push(child);
    }
    return ids;
  }

  function getLeafNodes(raw, reachableIds) {
    const leaves = [];
    for (const id of reachableIds) {
      const node = raw.mapping?.[id];
      if (!node) continue;
      const children = Array.isArray(node.children) ? node.children.filter((childId) => reachableIds.has(childId)) : [];
      if (children.length === 0) leaves.push(node);
    }
    return leaves;
  }

  function findLatestLeafNode(raw, reachableIds) {
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
      const node = raw.mapping?.[id];
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

  function normalizePartToText(part) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (part.content_type === 'text' && typeof part.text === 'string') return part.text;
    if (part.content_type === 'image_asset_pointer') return '[image_asset_pointer]';
    if (part.asset_pointer) return `[asset_pointer: ${part.asset_pointer}]`;
    return '';
  }


  function collectNonTextSignalsFromValue(value, path = '', out = []) {
    if (value == null || out.length > 80) return out;
    if (typeof value === 'string') {
      const lowered = value.toLowerCase();
      if (lowered.startsWith('sediment://') || lowered.startsWith('file-service://')) {
        out.push({ type: 'asset_pointer', path, value: value.slice(0, 120) });
      }
      return out;
    }
    if (typeof value !== 'object') return out;

    if (Array.isArray(value)) {
      value.forEach((item, index) => collectNonTextSignalsFromValue(item, `${path}[${index}]`, out));
      return out;
    }

    const contentType = String(value.content_type || value.type || value.mime_type || '').toLowerCase();
    const keyNames = Object.keys(value || {});
    if (contentType.includes('image')) out.push({ type: 'image_content_type', path, value: contentType });
    if (contentType.startsWith('image/')) out.push({ type: 'image_mime_type', path, value: contentType });
    if (contentType.includes('video') || contentType.startsWith('video/')) out.push({ type: 'video_content_type', path, value: contentType });
    if (value.asset_pointer) out.push({ type: 'asset_pointer_key', path: `${path}.asset_pointer`, value: String(value.asset_pointer).slice(0, 120) });
    if (value.image_url || value.url?.includes?.('image')) out.push({ type: 'image_url_key', path });
    if (value.width && value.height && (value.asset_pointer || value.metadata?.generation || value.metadata?.dalle)) out.push({ type: 'image_dimensions_with_generation_metadata', path, value: `${value.width}x${value.height}` });
    if (value.metadata?.generation || value.metadata?.dalle) out.push({ type: 'image_generation_metadata', path });

    for (const key of keyNames) {
      const loweredKey = key.toLowerCase();
      if (loweredKey.includes('image') || loweredKey.includes('dalle') || loweredKey.includes('asset_pointer')) {
        out.push({ type: 'image_like_key', path: path ? `${path}.${key}` : key });
      }
      if (loweredKey.includes('video')) out.push({ type: 'video_like_key', path: path ? `${path}.${key}` : key });
      collectNonTextSignalsFromValue(value[key], path ? `${path}.${key}` : key, out);
    }
    return out;
  }

  function detectNonTextResponse(message) {
    if (!message) {
      return {
        type: null,
        hasImageLikeContent: false,
        hasVideoLikeContent: false,
        imageCount: 0,
        videoCount: 0,
        confidence: 'none',
        reasons: []
      };
    }

    const signals = [];
    collectNonTextSignalsFromValue(message.content, 'content', signals);
    collectNonTextSignalsFromValue(message.metadata, 'metadata', signals);

    const imageSignals = signals.filter((signal) => String(signal.type || '').includes('image') || String(signal.path || '').toLowerCase().includes('image') || String(signal.value || '').toLowerCase().includes('image'));
    const videoSignals = signals.filter((signal) => String(signal.type || '').includes('video') || String(signal.path || '').toLowerCase().includes('video') || String(signal.value || '').toLowerCase().includes('video'));
    const imagePartCount = (Array.isArray(message.content?.parts) ? message.content.parts : []).filter((part) => {
      if (!part || typeof part !== 'object') return false;
      const ct = String(part.content_type || part.mime_type || '').toLowerCase();
      return ct.includes('image') || Boolean(part.metadata?.generation || part.metadata?.dalle);
    }).length;
    const videoPartCount = (Array.isArray(message.content?.parts) ? message.content.parts : []).filter((part) => {
      if (!part || typeof part !== 'object') return false;
      const ct = String(part.content_type || part.mime_type || '').toLowerCase();
      return ct.includes('video');
    }).length;

    let type = null;
    if (imageSignals.length || imagePartCount) type = 'image';
    else if (videoSignals.length || videoPartCount) type = 'video';

    const highConfidence = imagePartCount > 0 || videoPartCount > 0 || signals.some((signal) => ['image_content_type', 'image_generation_metadata', 'image_dimensions_with_generation_metadata', 'video_content_type'].includes(signal.type));
    return {
      type,
      hasImageLikeContent: type === 'image',
      hasVideoLikeContent: type === 'video',
      imageCount: imagePartCount,
      videoCount: videoPartCount,
      confidence: type ? (highConfidence ? 'high' : 'medium') : 'none',
      reasons: signals.slice(0, 40).map((signal) => {
        const suffix = signal.value ? `=${signal.value}` : '';
        return `${signal.type}:${signal.path}${suffix}`;
      })
    };
  }

  function extractTextContents(content) {
    if (!content) return [];
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const texts = [];
    if (content.content_type === 'text' || content.content_type === 'multimodal_text') {
      for (const part of parts) {
        const text = normalizePartToText(part).trim();
        if (text) texts.push(text);
      }
    }
    return texts;
  }

  function makeTextPreview(text, max = 240) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
  }


  function normalizeTimestampToDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value > 1000000000000 ? value : value * 1000;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (/^\d+(\.\d+)?$/.test(trimmed)) {
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric)) return normalizeTimestampToDate(numeric);
      }
      const date = new Date(trimmed);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  function normalizeTimestampToIso(value) {
    const date = normalizeTimestampToDate(value);
    return date ? date.toISOString() : null;
  }

  function pickFirstValidTimestamp(candidates) {
    for (const candidate of candidates || []) {
      const date = normalizeTimestampToDate(candidate?.value ?? candidate);
      if (!date) continue;
      return {
        value: candidate?.value ?? candidate,
        iso: date.toISOString(),
        source: candidate?.source || null
      };
    }
    return { value: null, iso: null, source: null };
  }

  function getMessageCreateTimestampCandidate(message) {
    const metadata = message?.metadata || {};
    return pickFirstValidTimestamp([
      { source: 'message.create_time', value: message?.create_time },
      { source: 'message.create_time_ms', value: message?.create_time_ms },
      { source: 'message.created_at', value: message?.created_at },
      { source: 'message.createdAt', value: message?.createdAt },
      { source: 'message.timestamp', value: message?.timestamp },
      { source: 'metadata.create_time', value: metadata.create_time },
      { source: 'metadata.createTime', value: metadata.createTime },
      { source: 'metadata.created_at', value: metadata.created_at },
      { source: 'metadata.createdAt', value: metadata.createdAt },
      { source: 'metadata.timestamp', value: metadata.timestamp },
      { source: 'metadata.message_create_time', value: metadata.message_create_time },
      { source: 'metadata.message_created_at', value: metadata.message_created_at },
      { source: 'metadata.sent_at', value: metadata.sent_at },
      { source: 'metadata.received_at', value: metadata.received_at }
    ]);
  }

  function getMessageUpdateTimestampCandidate(message) {
    const metadata = message?.metadata || {};
    return pickFirstValidTimestamp([
      { source: 'message.update_time', value: message?.update_time },
      { source: 'message.update_time_ms', value: message?.update_time_ms },
      { source: 'message.updated_at', value: message?.updated_at },
      { source: 'message.updatedAt', value: message?.updatedAt },
      { source: 'metadata.update_time', value: metadata.update_time },
      { source: 'metadata.updateTime', value: metadata.updateTime },
      { source: 'metadata.updated_at', value: metadata.updated_at },
      { source: 'metadata.updatedAt', value: metadata.updatedAt },
      { source: 'metadata.finish_time', value: metadata.finish_time }
    ]);
  }

  function classifyPathMessage(raw, nodeId, indexInPath) {
    const node = raw.mapping?.[nodeId];
    const message = node?.message;
    const role = message?.author?.role || null;
    const contentType = message?.content?.content_type || null;
    const texts = extractTextContents(message?.content);
    const text = texts.join('\n\n').trim();
    const nonText = detectNonTextResponse(message);
    const isHidden = message ? isVisuallyHiddenMessage(message) : false;
    const isTextConversationMessage = Boolean(
      message &&
      !isHidden &&
      (role === 'user' || role === 'assistant') &&
      !(role === 'assistant' && message.recipient && message.recipient !== 'all') &&
      text
    );
    const hasStrongImageSignal = nonText.type === 'image' && (nonText.imageCount > 0 || nonText.confidence === 'high');
    const isImageResponseCarrier = Boolean(
      message &&
      !isHidden &&
      hasStrongImageSignal &&
      (
        (role === 'tool' && (!message.recipient || message.recipient === 'all')) ||
        (role === 'assistant' && (!message.recipient || message.recipient === 'all') && !text)
      )
    );
    const excludeReasons = [];

    if (!message) {
      excludeReasons.push('no_message');
    } else if (!isTextConversationMessage && !isImageResponseCarrier) {
      if (isHidden) excludeReasons.push('visually_hidden');
      if (role !== 'user' && role !== 'assistant') excludeReasons.push(`unsupported_role:${role || 'null'}`);
      if (role === 'assistant' && message.recipient && message.recipient !== 'all') excludeReasons.push(`non_all_recipient:${message.recipient}`);
      if (!text) excludeReasons.push('empty_text_or_non_text_content');
      if (nonText.type) excludeReasons.push(`non_text_response_type:${nonText.type}`);
    }

    const included = isTextConversationMessage || isImageResponseCarrier;
    const includedKind = isImageResponseCarrier ? 'image_response' : (isTextConversationMessage ? 'text' : null);
    const normalizedRole = isImageResponseCarrier ? 'assistant' : role;
    return {
      indexInPath,
      nodeId,
      parent: node?.parent || null,
      childCount: Array.isArray(node?.children) ? node.children.length : 0,
      hasMessage: Boolean(message),
      messageId: message?.id || null,
      role,
      normalizedRole,
      sourceRole: role,
      authorName: message?.author?.name || null,
      recipient: message?.recipient || null,
      contentType,
      textLength: includedKind === 'image_response' ? 0 : text.length,
      textPreview: includedKind === 'image_response' ? '[image response]' : makeTextPreview(text),
      nonTextResponseType: nonText.type,
      hasImageLikeContent: nonText.hasImageLikeContent,
      hasVideoLikeContent: nonText.hasVideoLikeContent,
      imageCount: nonText.imageCount,
      nonTextConfidence: nonText.confidence,
      nonTextDetectionReasons: nonText.reasons,
      includedKind,
      create_time: getMessageCreateTimestampCandidate(message).value,
      create_time_iso: getMessageCreateTimestampCandidate(message).iso,
      create_time_source: getMessageCreateTimestampCandidate(message).source,
      update_time: getMessageUpdateTimestampCandidate(message).value,
      update_time_iso: getMessageUpdateTimestampCandidate(message).iso,
      update_time_source: getMessageUpdateTimestampCandidate(message).source,
      model_slug: message?.metadata?.model_slug || message?.metadata?.default_model_slug || raw.default_model_slug || null,
      status: message?.status || null,
      metadataKeys: Object.keys(message?.metadata || {}).sort().slice(0, 80),
      included,
      excludeReasons
    };
  }

  function buildMappingStats(raw) {
    const nodes = Object.values(raw?.mapping || {});
    const stats = {
      nodeCount: nodes.length,
      nodesWithMessage: 0,
      roleCountsAllMapping: {},
      contentTypeCountsAllMapping: {},
      hiddenMessageCount: 0,
      emptyTextCandidateCount: 0,
      leafCountAllMapping: 0
    };

    for (const node of nodes) {
      if (!Array.isArray(node?.children) || node.children.length === 0) stats.leafCountAllMapping += 1;
      const message = node?.message;
      if (!message) continue;
      stats.nodesWithMessage += 1;
      const role = message.author?.role || 'unknown';
      const contentType = message.content?.content_type || 'unknown';
      stats.roleCountsAllMapping[role] = (stats.roleCountsAllMapping[role] || 0) + 1;
      stats.contentTypeCountsAllMapping[contentType] = (stats.contentTypeCountsAllMapping[contentType] || 0) + 1;
      if (isVisuallyHiddenMessage(message)) stats.hiddenMessageCount += 1;
      if (extractTextContents(message.content).join('\n\n').trim().length === 0) stats.emptyTextCandidateCount += 1;
    }
    return stats;
  }


  function incCount(obj, key) {
    const normalizedKey = key == null || key === '' ? '(empty)' : String(key);
    obj[normalizedKey] = (obj[normalizedKey] || 0) + 1;
  }

  function countBy(items, getKey) {
    const counts = {};
    for (const item of items || []) incCount(counts, getKey(item));
    return counts;
  }

  function countExcludeReasons(candidates) {
    const counts = {};
    for (const candidate of candidates || []) {
      const reasons = Array.isArray(candidate.excludeReasons) ? candidate.excludeReasons : [];
      if (reasons.length === 0) incCount(counts, '(included)');
      for (const reason of reasons) incCount(counts, reason);
    }
    return counts;
  }

  function buildPathCandidateStats(pathCandidates) {
    const items = Array.isArray(pathCandidates) ? pathCandidates : [];
    return {
      total: items.length,
      included: items.filter((item) => item.included).length,
      excluded: items.filter((item) => !item.included).length,
      roleCounts: countBy(items, (item) => item.role || 'no_role'),
      contentTypeCounts: countBy(items, (item) => item.contentType || 'no_content_type'),
      statusCounts: countBy(items, (item) => item.status || 'no_status'),
      recipientCounts: countBy(items, (item) => item.recipient || 'no_recipient'),
      excludeReasonCounts: countExcludeReasons(items)
    };
  }

  function buildIncludedMessageStats(messages) {
    const items = Array.isArray(messages) ? messages : [];
    return {
      total: items.length,
      roleCounts: countBy(items, (item) => item.role),
      contentTypeCounts: countBy(items, (item) => item.content_type),
      statusCounts: countBy(items, (item) => item.status),
      modelSlugCounts: countBy(items, (item) => item.model_slug),
      nonTextResponseTypeCounts: countBy(items, (item) => item.nonTextResponseType || 'text'),
      imageLikeMessageCount: items.filter((item) => item.hasImageLikeContent).length,
      totalTextLength: items.reduce((sum, item) => sum + (item.textLength || 0), 0),
      maxTextLength: items.reduce((max, item) => Math.max(max, item.textLength || 0), 0),
      minTextLength: items.length ? items.reduce((min, item) => Math.min(min, item.textLength || 0), Infinity) : 0
    };
  }

  function buildSequenceDiagnostics(messages) {
    const items = Array.isArray(messages) ? messages : [];
    const runs = [];
    let current = null;
    for (const msg of items) {
      if (!current || current.role !== msg.role) {
        current = {
          role: msg.role,
          startIndex: msg.index,
          endIndex: msg.index,
          count: 1,
          totalTextLength: msg.textLength || 0
        };
        runs.push(current);
      } else {
        current.endIndex = msg.index;
        current.count += 1;
        current.totalTextLength += msg.textLength || 0;
      }
    }

    return {
      runCount: runs.length,
      runs,
      consecutiveSameRoleRuns: runs.filter((run) => run.count > 1),
      hasConsecutiveAssistantRuns: runs.some((run) => run.role === 'assistant' && run.count > 1),
      hasConsecutiveUserRuns: runs.some((run) => run.role === 'user' && run.count > 1)
    };
  }

  function summarizeMessageForExport(message, segmentKind = 'message') {
    return {
      index: message.index,
      id: message.id,
      message_id: message.message_id,
      role: message.role,
      sourceRole: message.sourceRole || message.role,
      text: message.text,
      textLength: message.textLength || 0,
      textPreview: message.textPreview || makeTextPreview(message.text || '', 320),
      nonTextResponseType: message.nonTextResponseType || null,
      hasImageLikeContent: Boolean(message.hasImageLikeContent),
      imageCount: message.imageCount || 0,
      nonTextConfidence: message.nonTextConfidence || 'none',
      nonTextDetectionReasons: message.nonTextDetectionReasons || [],
      content_type: message.content_type,
      status: message.status,
      model_slug: message.model_slug,
      create_time: message.create_time,
      create_time_iso: message.create_time_iso,
      create_time_source: message.create_time_source || null,
      update_time: message.update_time || null,
      update_time_iso: message.update_time_iso || null,
      update_time_source: message.update_time_source || null,
      segmentKind
    };
  }

  function buildConversationTurns(messages) {
    const turns = [];
    let current = null;

    function startTurn(msg) {
      current = {
        turnIndex: turns.length,
        startMessageIndex: msg.index,
        endMessageIndex: msg.index,
        userMessageCount: msg.role === 'user' ? 1 : 0,
        assistantMessageCount: msg.role === 'assistant' ? 1 : 0,
        messageIndexes: [msg.index],
        totalTextLength: msg.textLength || 0,
        messages: [summarizeMessageForExport(msg)],
        userPreview: msg.role === 'user' ? msg.textPreview : '',
        assistantPreview: msg.role === 'assistant' ? msg.textPreview : '',
        assistantCombinedPreview: msg.role === 'assistant' ? msg.textPreview : '',
        hasAssistant: msg.role === 'assistant',
        hasUser: msg.role === 'user'
      };
      turns.push(current);
    }

    for (const msg of messages || []) {
      if (msg.role === 'user' || !current) {
        startTurn(msg);
      } else {
        current.endMessageIndex = msg.index;
        current.messageIndexes.push(msg.index);
        current.messages.push(summarizeMessageForExport(msg));
        current.totalTextLength += msg.textLength || 0;
        if (msg.role === 'assistant') {
          current.assistantMessageCount += 1;
          current.hasAssistant = true;
          if (!current.assistantPreview) current.assistantPreview = msg.textPreview;
        } else if (msg.role === 'user') {
          current.userMessageCount += 1;
          current.hasUser = true;
          if (!current.userPreview) current.userPreview = msg.textPreview;
        }
      }
    }

    for (const turn of turns) {
      turn.userMessages = turn.messages.filter((msg) => msg.role === 'user');
      turn.assistantMessages = turn.messages.filter((msg) => msg.role === 'assistant');

      turn.userMessages.forEach((msg, i) => {
        msg.segmentKind = turn.userMessages.length > 1 ? `user_segment_${i + 1}_of_${turn.userMessages.length}` : 'user';
      });

      turn.assistantMessages.forEach((msg, i) => {
        if (turn.assistantMessages.length <= 1) {
          msg.segmentKind = 'assistant';
        } else if (i === turn.assistantMessages.length - 1) {
          msg.segmentKind = 'assistant_final_candidate';
        } else {
          msg.segmentKind = 'assistant_intermediate';
        }
      });

      const assistantCombined = turn.assistantMessages.map((msg) => msg.text || '').filter(Boolean).join('\n\n');
      const userCombined = turn.userMessages.map((msg) => msg.text || '').filter(Boolean).join('\n\n');
      turn.userCombinedTextLength = userCombined.length;
      turn.assistantCombinedTextLength = assistantCombined.length;
      turn.userCombinedPreview = makeTextPreview(userCombined, 420);
      turn.assistantCombinedPreview = makeTextPreview(assistantCombined, 420);

      turn.warningFlags = [];
      if (!turn.hasUser) turn.warningFlags.push('starts_without_user_message');
      if (!turn.hasAssistant) turn.warningFlags.push('no_assistant_response_after_user');
      if (turn.assistantMessageCount > 1) turn.warningFlags.push('multiple_assistant_messages_for_one_user_turn');
      if (turn.userMessageCount > 1) turn.warningFlags.push('multiple_user_messages_in_one_turn');
    }

    return turns;
  }

  function classifyExportDecision(message) {
    const reasons = [];
    if (!message) reasons.push('missing_message');
    if (message?.nonTextResponseType === 'image') {
      if (message.status && message.status !== 'finished_successfully') reasons.push(`status:${message.status}`);
      if (message.role !== 'assistant') reasons.push(`unsupported_role:${message.role || 'unknown'}`);
      return {
        includeByDefault: reasons.length === 0,
        reasons
      };
    }
    if (!message || !message.text) reasons.push('empty_text');
    if (message && message.content_type !== 'text' && message.content_type !== 'multimodal_text') reasons.push(`non_text_content_type:${message.content_type || 'unknown'}`);
    if (message && message.status && message.status !== 'finished_successfully') reasons.push(`status:${message.status}`);
    if (message && message.role !== 'user' && message.role !== 'assistant') reasons.push(`unsupported_role:${message.role || 'unknown'}`);
    return {
      includeByDefault: reasons.length === 0,
      reasons
    };
  }

  function buildExportCandidates(messages) {
    const result = [];
    for (const msg of messages || []) {
      const decision = classifyExportDecision(msg);
      result.push({
        exportIndex: result.length,
        sourceMessageIndex: msg.index,
        id: msg.id,
        message_id: msg.message_id,
        role: msg.role,
        sourceRole: msg.sourceRole || msg.role,
        text: msg.text,
        textLength: msg.textLength,
        textPreview: msg.textPreview,
        nonTextResponseType: msg.nonTextResponseType || null,
        hasImageLikeContent: Boolean(msg.hasImageLikeContent),
        imageCount: msg.imageCount || 0,
        nonTextConfidence: msg.nonTextConfidence || 'none',
        nonTextDetectionReasons: msg.nonTextDetectionReasons || [],
        content_type: msg.content_type,
        status: msg.status,
        model_slug: msg.model_slug,
        create_time: msg.create_time,
        create_time_iso: msg.create_time_iso,
        create_time_source: msg.create_time_source || null,
        update_time: msg.update_time || null,
        update_time_iso: msg.update_time_iso || null,
        update_time_source: msg.update_time_source || null,
        includeByDefault: decision.includeByDefault,
        decisionReasons: decision.reasons
      });
    }
    return result;
  }

  function getContentMarkdown() {
    const markdown = window.ArcaiaContentMarkdown;
    if (!markdown || typeof markdown.sanitizeMarkdownText !== 'function' || typeof markdown.renderMarkdownMessageBody !== 'function') {
      throw new Error('Arcaia content markdown helper is not loaded.');
    }
    return markdown;
  }

  function sanitizeMarkdownText(text) {
    return getContentMarkdown().sanitizeMarkdownText(text);
  }

  function buildNonTextMarkdownBody(msg, roleLabel) {
    return getContentMarkdown().buildNonTextMarkdownBody(msg, roleLabel);
  }

  function renderMarkdownMessageBody(msg, roleLabel) {
    return getContentMarkdown().renderMarkdownMessageBody(msg, roleLabel);
  }

  function pickMarkdownUserMessages(turn) {
    return getContentMarkdown().pickMarkdownUserMessages(turn);
  }

  function pickFinalAssistantMessageForMarkdown(turn) {
    return getContentMarkdown().pickFinalAssistantMessageForMarkdown(turn);
  }

  function buildMarkdownHeaderLines(options) {
    return getContentMarkdown().buildMarkdownHeaderLines(options);
  }

  function buildMarkdownTurnHeading(turnIndex, totalTurnCount) {
    return getContentMarkdown().buildMarkdownTurnHeading(turnIndex, totalTurnCount);
  }

  function buildMarkdownRoleHeading(roleLabel, index, total) {
    return getContentMarkdown().buildMarkdownRoleHeading(roleLabel, index, total);
  }

  function buildMarkdownMessageMetadataLines(msg, roleLabel) {
    return getContentMarkdown().buildMarkdownMessageMetadataLines(msg, roleLabel);
  }

  function buildMarkdownDraft(title, url, conversationId, turns) {
    const lines = [];
    lines.push(...buildMarkdownHeaderLines({
      title,
      url,
      conversationId,
      exportMode: 'turn_final_assistant_candidate_only',
      appVersion: APP_VERSION,
      generatedAt: nowIso()
    }));

    const totalTurnCount = (turns || []).length;
    for (const turn of turns || []) {
      lines.push(buildMarkdownTurnHeading(turn.turnIndex, totalTurnCount));
      lines.push('');

      if (turn.userMessages && turn.userMessages.length) {
        for (const [i, msg] of turn.userMessages.entries()) {
          lines.push(buildMarkdownRoleHeading('User', i, turn.userMessages.length));
          lines.push(...buildMarkdownMessageMetadataLines(msg, 'user'));
          lines.push('');
          lines.push(renderMarkdownMessageBody(msg, 'user'));
          lines.push('');
        }
      } else {
        lines.push('### User');
        lines.push('');
        lines.push('_No user text message captured._');
        lines.push('');
      }

      const assistantMessage = pickFinalAssistantMessageForMarkdown(turn);
      if (assistantMessage) {
        lines.push('### Assistant');
        lines.push(...buildMarkdownMessageMetadataLines(assistantMessage, 'assistant'));
        lines.push('');
        lines.push(renderMarkdownMessageBody(assistantMessage, 'assistant'));
        lines.push('');
      } else {
        lines.push('### Assistant');
        lines.push('');
        lines.push('_No assistant text message captured._');
        lines.push('');
      }
    }

    return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  }


  function buildSingleTurnMarkdownDraft(title, url, conversationId, turn, totalTurnCount) {
    const lines = [];
    const safeTotal = totalTurnCount || 1;
    lines.push(...buildMarkdownHeaderLines({
      title,
      url,
      conversationId,
      exportMode: 'single_turn',
      appVersion: APP_VERSION,
      generatedAt: nowIso()
    }));

    if (!turn) {
      lines.push(buildMarkdownTurnHeading(null, safeTotal));
      lines.push('');
      lines.push('_Turn data could not be resolved._');
      return lines.join('\n').trim() + '\n';
    }

    lines.push(buildMarkdownTurnHeading(turn.turnIndex, safeTotal));
    lines.push('');

    if (turn.userMessages && turn.userMessages.length) {
      for (const [i, msg] of turn.userMessages.entries()) {
        lines.push(buildMarkdownRoleHeading('User', i, turn.userMessages.length));
        lines.push(...buildMarkdownMessageMetadataLines(msg, 'user'));
        lines.push('');
        lines.push(renderMarkdownMessageBody(msg, 'user'));
        lines.push('');
      }
    } else {
      lines.push('### User');
      lines.push('');
      lines.push('_No user text message captured._');
      lines.push('');
    }

    const assistantMessage = pickFinalAssistantMessageForMarkdown(turn);
    if (assistantMessage) {
      lines.push('### Assistant');
      lines.push(...buildMarkdownMessageMetadataLines(assistantMessage, 'assistant'));
      lines.push('');
      lines.push(renderMarkdownMessageBody(assistantMessage, 'assistant'));
      lines.push('');
    } else {
      lines.push('### Assistant');
      lines.push('');
      lines.push('_No assistant text message captured._');
      lines.push('');
    }

    return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  }

  function getContentFilename() {
    const filename = window.ArcaiaContentFilename;
    if (!filename || typeof filename.makeSafeFileName !== 'function' || typeof filename.makeBaseExportName !== 'function') {
      throw new Error('Arcaia content filename helper is not loaded.');
    }
    return filename;
  }

  function makeSafeFileName(input) {
    return getContentFilename().makeSafeFileName(input);
  }

  function formatDateTimeForFile(inputDate) {
    return getContentFilename().formatDateTimeForFile(inputDate, normalizeTimestampToDate);
  }

  function pickLatestAssistantDateFromTurn(turn) {
    return getContentFilename().pickLatestAssistantDateFromTurn(turn);
  }

  function pickLatestAssistantDateFromResult(result) {
    return getContentFilename().pickLatestAssistantDateFromResult(result);
  }

  function makeBaseExportName(result) {
    return getContentFilename().makeBaseExportName(result, normalizeTimestampToDate);
  }

  function makeSingleTurnExportName(result, turn) {
    return getContentFilename().makeSingleTurnExportName(result, turn, normalizeTimestampToDate);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadText(filename, text, mimeType = 'text/plain;charset=utf-8') {
    downloadBlob(filename, new Blob([String(text || '')], { type: mimeType }));
  }

  function buildExportPlan(messages, turns, context = {}) {
    const sequence = (messages || []).map((msg) => summarizeMessageForExport(msg, msg.role));
    const turnBlocks = (turns || []).map((turn) => ({
      turnIndex: turn.turnIndex,
      startMessageIndex: turn.startMessageIndex,
      endMessageIndex: turn.endMessageIndex,
      messageIndexes: turn.messageIndexes,
      userMessageCount: turn.userMessageCount,
      assistantMessageCount: turn.assistantMessageCount,
      warningFlags: turn.warningFlags || [],
      userMessages: turn.userMessages || [],
      assistantMessages: turn.assistantMessages || [],
      userCombinedTextLength: turn.userCombinedTextLength || 0,
      assistantCombinedTextLength: turn.assistantCombinedTextLength || 0,
      userCombinedPreview: turn.userCombinedPreview || '',
      assistantCombinedPreview: turn.assistantCombinedPreview || ''
    }));

    const markdownDraft = buildMarkdownDraft(context.title, context.url, context.conversationId, turnBlocks);
    const turnsWithIntermediateAssistant = turnBlocks.filter((turn) => turn.assistantMessageCount > 1).length;
    const turnsWithoutAssistant = turnBlocks.filter((turn) => !turn.assistantMessageCount).length;

    return {
      defaultMode: 'turn_final_assistant_candidate_only',
      availableModes: [
        'raw_sequence_all_text_messages',
        'turn_merged_all_segments',
        'turn_final_assistant_candidate_only',
        'single_turn'
      ],
      recommendation: {
        mode: 'turn_final_assistant_candidate_only',
        reason: 'Intermediate assistant candidates are treated as process output and are excluded from Markdown. Only the final assistant message for each turn is exported.'
      },
      sequenceMessageCount: sequence.length,
      turnBlockCount: turnBlocks.length,
      turnsWithIntermediateAssistant,
      turnsWithoutAssistant,
      markdownDraftTextLength: markdownDraft.length,
      sequence,
      turnBlocks,
      markdownDraft
    };
  }

  function normalizeMessagesWithDebug(raw) {
    const root = findRootNode(raw);
    if (!root) {
      return {
        messages: [],
        debug: {
          error: 'root_not_found',
          mappingStats: buildMappingStats(raw)
        }
      };
    }

    const reachable = collectReachableNodeIds(raw, root);
    const leaves = getLeafNodes(raw, reachable);
    const latestLeaf = findLatestLeafNode(raw, reachable);
    const path = buildPathFromLeaf(raw, root, latestLeaf);
    const pathCandidates = path.map((nodeId, index) => classifyPathMessage(raw, nodeId, index));

    const messages = [];
    for (const candidate of pathCandidates) {
      if (!candidate.included) continue;
      const node = raw.mapping?.[candidate.nodeId];
      const message = node?.message;
      const rawText = extractTextContents(message.content).join('\n\n').trim();
      const isImageResponse = candidate.includedKind === 'image_response';
      const text = isImageResponse ? '' : rawText;
      messages.push({
        index: messages.length,
        id: node.id,
        message_id: message.id || null,
        role: candidate.normalizedRole || candidate.role,
        sourceRole: candidate.sourceRole || candidate.role,
        sourceAuthorName: candidate.authorName || null,
        text,
        textLength: text.length,
        textPreview: isImageResponse ? '[image response]' : makeTextPreview(text, 320),
        nonTextResponseType: isImageResponse ? 'image' : null,
        hasImageLikeContent: Boolean(isImageResponse),
        hasVideoLikeContent: Boolean(isImageResponse ? false : candidate.hasVideoLikeContent),
        imageCount: candidate.imageCount || 0,
        nonTextConfidence: candidate.nonTextConfidence || 'none',
        nonTextDetectionReasons: candidate.nonTextDetectionReasons || [],
        create_time: candidate.create_time,
        create_time_iso: candidate.create_time_iso,
        create_time_source: candidate.create_time_source || null,
        update_time: candidate.update_time,
        update_time_iso: candidate.update_time_iso || null,
        update_time_source: candidate.update_time_source || null,
        model_slug: candidate.model_slug,
        content_type: candidate.contentType,
        status: candidate.status
      });
    }

    const excludedPathCandidates = pathCandidates.filter((candidate) => !candidate.included);
    const includedStats = buildIncludedMessageStats(messages);
    const sequenceDiagnostics = buildSequenceDiagnostics(messages);
    const turns = buildConversationTurns(messages);
    const exportCandidates = buildExportCandidates(messages);
    return {
      messages,
      exportCandidates,
      turns,
      debug: {
        branch: {
          rootNodeId: root.id || null,
          latestLeafNodeId: latestLeaf?.id || null,
          latestLeafCreateTime: latestLeaf?.message?.create_time || null,
          latestLeafCreateTimeIso: getMessageCreateTimestampCandidate(latestLeaf?.message).iso,
          reachableNodeCount: reachable.size,
          leafCountReachable: leaves.length,
          selectedPathLength: path.length,
          selectedPathNodeIds: path
        },
        mappingStats: buildMappingStats(raw),
        pathCandidateStats: buildPathCandidateStats(pathCandidates),
        includedMessageStats: includedStats,
        nonTextResponseStats: {
          imageLikePathCandidateCount: pathCandidates.filter((candidate) => candidate.hasImageLikeContent).length,
          includedImageResponseCount: messages.filter((msg) => msg.nonTextResponseType === 'image').length,
          imageResponseMessageIds: messages.filter((msg) => msg.nonTextResponseType === 'image').map((msg) => msg.message_id)
        },
        sequenceDiagnostics,
        turnStats: {
          turnCount: turns.length,
          turnsWithMultipleAssistantMessages: turns.filter((turn) => turn.assistantMessageCount > 1).length,
          turnsWithoutAssistant: turns.filter((turn) => !turn.hasAssistant).length,
          turnsStartingWithoutUser: turns.filter((turn) => !turn.hasUser).length
        },
        exportCandidateStats: {
          total: exportCandidates.length,
          includeByDefault: exportCandidates.filter((candidate) => candidate.includeByDefault).length,
          excludedByDefault: exportCandidates.filter((candidate) => !candidate.includeByDefault).length
        },
        pathCandidateCount: pathCandidates.length,
        includedPathMessageCount: messages.length,
        excludedPathCandidateCount: excludedPathCandidates.length,
        pathCandidates,
        excludedPathCandidates
      }
    };
  }

  function buildProbeResult(raw, conversationId, authDebug, includeRaw = false) {
    const normalized = normalizeMessagesWithDebug(raw);
    const messages = normalized.messages;
    const exportCandidates = normalized.exportCandidates || [];
    const turns = normalized.turns || [];
    const exportPlan = buildExportPlan(messages, turns, {
      title: raw.title || '',
      url: window.location.href,
      conversationId
    });
    return {
      ok: true,
      appVersion: APP_VERSION,
      extractedAt: nowIso(),
      source: 'chatgpt-internal-api',
      url: window.location.href,
      conversationId,
      title: raw.title || '',
      rawConversationId: raw.conversation_id || null,
      defaultModelSlug: raw.default_model_slug || null,
      mappingNodeCount: raw.mapping ? Object.keys(raw.mapping).length : 0,
      messageCount: messages.length,
      exportCandidateCount: exportCandidates.length,
      turnCount: turns.length,
      exportPlanMode: exportPlan.defaultMode,
      markdownDraftTextLength: exportPlan.markdownDraftTextLength,
      roles: messages.reduce((acc, msg) => {
        acc[msg.role] = (acc[msg.role] || 0) + 1;
        return acc;
      }, {}),
      authDebug,
      extractionDebug: normalized.debug,
      messages,
      exportCandidates,
      turns,
      exportPlan,
      ...(includeRaw ? { rawConversation: raw } : {})
    };
  }

  function sanitizeUrlCandidate(url) {
    if (url == null) return null;
    let value = String(url || '').trim();
    if (!value) return null;
    value = value.replace(/&amp;/g, '&');
    value = value.replace(/[\s)\]}>.,;]+$/g, '');
    value = value.replace(/^[({\[<]+/g, '');
    if (!/^https?:\/\//i.test(value)) return null;
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      return parsed.href;
    } catch {
      return null;
    }
  }

  function getUrlDomain(url) {
    try { return new URL(url).hostname; } catch { return null; }
  }

  function extractUrlsFromString(value) {
    const text = String(value || '');
    const matches = [];
    const re = /https?:\/\/[^\s"'<>`\\)\]]+/gi;
    let match;
    while ((match = re.exec(text))) {
      const url = sanitizeUrlCandidate(match[0]);
      if (url && !matches.includes(url)) matches.push(url);
      if (matches.length >= 40) break;
    }
    return matches;
  }

  function makePathKind(path = '') {
    const lower = String(path || '').toLowerCase();
    if (/citation|citations|cite|source|sources|attribution|reference|references|webpage|web_page|search_result|searchresult/.test(lower)) return 'citation_or_source_like';
    if (/metadata/.test(lower)) return 'metadata';
    if (/content/.test(lower)) return 'content';
    if (/url|href|link|uri|domain/.test(lower)) return 'url_key_like';
    return 'generic_url_value';
  }

  function collectUrlLikeValues(value, path = '$', out = [], context = {}, depth = 0, seen = new WeakSet()) {
    if (out.length >= 280 || depth > 9 || value == null) return out;
    if (typeof value === 'string') {
      const urls = extractUrlsFromString(value);
      for (const url of urls) {
        if (out.length >= 280) break;
        out.push({
          source: context.source || 'unknown',
          messageId: context.messageId || null,
          nodeId: context.nodeId || null,
          role: context.role || null,
          path,
          pathKind: makePathKind(path),
          key: path.split('.').pop() || null,
          url,
          domain: getUrlDomain(url),
          valuePreview: makeTextPreview(value, 260)
        });
      }
      return out;
    }
    if (typeof value !== 'object') return out;
    if (seen.has(value)) return out;
    seen.add(value);
    if (Array.isArray(value)) {
      const limit = Math.min(value.length, 100);
      for (let i = 0; i < limit; i++) collectUrlLikeValues(value[i], `${path}[${i}]`, out, context, depth + 1, seen);
      if (value.length > limit && out.length < 280) out.push({ source: context.source || 'unknown', messageId: context.messageId || null, nodeId: context.nodeId || null, role: context.role || null, path: `${path}[${limit}...]`, pathKind: 'truncated_array', key: null, url: null, domain: null, valuePreview: `[truncated ${value.length - limit} items]` });
      return out;
    }
    const entries = Object.entries(value);
    const limit = Math.min(entries.length, 140);
    for (let i = 0; i < limit; i++) {
      const [key, child] = entries[i];
      if (key === 'html' || key === 'rawConversation') continue;
      const childPath = path ? `${path}.${key}` : key;
      collectUrlLikeValues(child, childPath, out, context, depth + 1, seen);
    }
    return out;
  }

  function collectCitationReferenceTokensFromText(text) {
    const src = String(text || '');
    const tokens = [];
    const patterns = [
      /[^]{1,240}/g,
      /turn\d+(?:search|news|view|file|forecast|sports|finance|image|product)?\d+/gi,
      /【\d+†[^】]{0,120}】/g
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(src))) {
        const token = match[0];
        if (!tokens.includes(token)) tokens.push(token);
        if (tokens.length >= 40) return tokens;
      }
    }
    return tokens;
  }

  function buildApiUrlMetadataDiagnostics(raw) {
    const mapping = raw?.mapping || {};
    const urlMatches = [];
    const tokenMessages = [];
    let messageCount = 0;
    let messagesWithUrlMatches = 0;
    for (const [nodeId, node] of Object.entries(mapping)) {
      const message = node?.message;
      if (!message) continue;
      messageCount += 1;
      const role = message?.author?.role || null;
      const messageId = message?.id || null;
      const before = urlMatches.length;
      collectUrlLikeValues(message.metadata, `mapping.${nodeId}.message.metadata`, urlMatches, { source: 'api_message_metadata', messageId, nodeId, role });
      collectUrlLikeValues(message.content, `mapping.${nodeId}.message.content`, urlMatches, { source: 'api_message_content', messageId, nodeId, role });
      collectUrlLikeValues(message.author, `mapping.${nodeId}.message.author`, urlMatches, { source: 'api_message_author', messageId, nodeId, role });
      if (urlMatches.length > before) messagesWithUrlMatches += 1;
      const text = extractTextContents(message.content).join('\n\n');
      const tokens = collectCitationReferenceTokensFromText(text);
      if (tokens.length) {
        tokenMessages.push({
          nodeId,
          messageId,
          role,
          tokenCount: tokens.length,
          tokens: tokens.slice(0, 12),
          textPreview: makeTextPreview(text, 360)
        });
      }
    }
    const topLevelMatches = [];
    const topLevelShallow = { ...raw };
    delete topLevelShallow.mapping;
    collectUrlLikeValues(topLevelShallow, 'conversation', topLevelMatches, { source: 'api_conversation_top_level' });
    const allMatches = [...urlMatches, ...topLevelMatches];
    const byDomain = {};
    const byPathKind = {};
    const bySource = {};
    for (const item of allMatches) {
      if (item.domain) byDomain[item.domain] = (byDomain[item.domain] || 0) + 1;
      if (item.pathKind) byPathKind[item.pathKind] = (byPathKind[item.pathKind] || 0) + 1;
      if (item.source) bySource[item.source] = (bySource[item.source] || 0) + 1;
    }
    const citationLikeMatches = allMatches.filter((item) => item.pathKind === 'citation_or_source_like' || item.pathKind === 'metadata' || /citation|source|webpage|reference|attribution|search/i.test(item.path || ''));
    return {
      ok: true,
      action: 'api_url_metadata_diagnostics',
      conversationId: raw?.conversation_id || null,
      title: raw?.title || null,
      mappingNodeCount: Object.keys(mapping).length,
      messageCount,
      totalUrlMatchCount: allMatches.filter((item) => item.url).length,
      messageUrlMatchCount: urlMatches.filter((item) => item.url).length,
      topLevelUrlMatchCount: topLevelMatches.filter((item) => item.url).length,
      citationLikeUrlMatchCount: citationLikeMatches.filter((item) => item.url).length,
      messagesWithUrlMatches,
      messagesWithReferenceTokens: tokenMessages.length,
      byDomain,
      byPathKind,
      bySource,
      citationLikeMatches: citationLikeMatches.filter((item) => item.url).slice(0, 80),
      urlMatches: allMatches.filter((item) => item.url).slice(0, 120),
      referenceTokenMessages: tokenMessages.slice(0, 40),
      note: 'API JSON内のURL候補をmetadata/content等から再帰的に探索した結果です。DOM citation pillのURLと突合するため、path/source/messageIdを含めています。'
    };
  }

  function countByValues(values) {
    const counts = {};
    for (const value of values || []) {
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

  function classifyChatGPTEndpoint(pathOrUrl) {
    let pathname = String(pathOrUrl || '');
    try { pathname = new URL(pathOrUrl, window.location.origin).pathname; } catch {}
    if (/\/backend-api\/conversation\/[^/?#]+$/.test(pathname)) return 'conversation_detail';
    if (pathname === '/backend-api/conversations') return 'conversation_list';
    if (/\/backend-api\/files\/download\//.test(pathname)) return 'file_download';
    if (/\/backend-api\//.test(pathname)) return 'other_backend_api';
    return 'other';
  }

  function walkForPaginationLikeKeys(value, path = '', out = [], depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6 || out.length > 180) return out;
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 10); i += 1) {
        walkForPaginationLikeKeys(value[i], `${path}[]`, out, depth + 1);
      }
      return out;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      const lower = key.toLowerCase();
      if (isPaginationLikeKey(key)) {
        out.push({ path: childPath, key, valueType: child == null ? 'null' : Array.isArray(child) ? 'array' : typeof child });
      }
      walkForPaginationLikeKeys(child, childPath, out, depth + 1);
    }
    return out;
  }

  function buildHistoryProbeFromRaw(raw, context = {}) {
    const mapping = raw?.mapping && typeof raw.mapping === 'object' ? raw.mapping : null;
    const nodes = mapping ? Object.values(mapping) : [];
    const messages = nodes.map((node) => node?.message).filter(Boolean);
    const roles = messages.map((message) => message?.author?.role || 'unknown');
    const contentTypes = messages.map((message) => message?.content?.content_type || 'unknown');
    const statuses = messages.map((message) => message?.status || 'unknown');
    const childCounts = nodes.map((node) => Array.isArray(node?.children) ? node.children.length : 0);
    const leafNodeCount = childCounts.filter((count) => count === 0).length;
    const paginationLikeKeyPaths = walkForPaginationLikeKeys(raw).slice(0, 120);
    const approxJsonBytes = (() => {
      try { return new TextEncoder().encode(JSON.stringify(raw)).length; } catch { return null; }
    })();
    const hasConversationLimitSignal = paginationLikeKeyPaths.some((item) => /limit|cursor|pagination|before|after|offset|has_more|end_cursor|start_cursor|page_token|continuation/i.test(item.key));

    return {
      ok: true,
      appVersion: APP_VERSION,
      probeType: 'history_fetch_probe',
      probedAt: nowIso(),
      note: '本文はこのprobe結果には保存しません。件数・サイズ・キー構造だけを集計します。',
      source: 'active_internal_api_fetch',
      conversationId: context.conversationId || raw?.conversation_id || null,
      url: window.location.href,
      title: raw?.title || '',
      request: {
        endpointPath: context.endpointPath || null,
        endpointKind: classifyChatGPTEndpoint(context.endpointPath || ''),
        method: 'GET',
        queryParamKeys: [],
        modifiedRequest: false
      },
      responseShape: {
        approxJsonBytes,
        topLevelKeys: raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw).sort().slice(0, 100) : [],
        hasMapping: Boolean(mapping),
        mappingNodeCount: nodes.length,
        messageNodeCount: messages.length,
        leafNodeCount,
        roleCounts: countByValues(roles),
        contentTypeCounts: countByValues(contentTypes),
        statusCounts: countByValues(statuses),
        hasTitle: Boolean(raw?.title),
        hasConversationId: Boolean(raw?.conversation_id),
        defaultModelSlug: raw?.default_model_slug || null,
        paginationLikeKeyCount: paginationLikeKeyPaths.length,
        paginationLikeKeyPaths
      },
      initialReadinessForServerSideLimitTest: {
        hasObviousPaginationOrLimitKeys: hasConversationLimitSignal,
        suggestedNextStep: hasConversationLimitSignal
          ? '候補キーを精査し、別fetchでlimit/cursor系パラメータが効くか試す。'
          : 'このレスポンス形状だけでは、サーバー側で直近N件だけ取得できる明確な手掛かりはまだありません。次は実通信ログのURL/query/body差分も確認します。'
      },
      authDebug: context.authDebug || null,
      mainWorldObservedFetchProbe: context.mainWorldProbe || null
    };
  }


  function summarizeConversationLikeRaw(raw) {
    const mapping = raw?.mapping && typeof raw.mapping === 'object' ? raw.mapping : null;
    const nodes = mapping ? Object.values(mapping) : [];
    const messages = nodes.map((node) => node?.message).filter(Boolean);
    const roles = messages.map((message) => message?.author?.role || 'unknown');
    const contentTypes = messages.map((message) => message?.content?.content_type || 'unknown');
    const statuses = messages.map((message) => message?.status || 'unknown');
    const childCounts = nodes.map((node) => Array.isArray(node?.children) ? node.children.length : 0);
    const paginationLikeKeyPaths = walkForPaginationLikeKeys(raw).slice(0, 80);
    const approxJsonBytes = (() => {
      try { return new TextEncoder().encode(JSON.stringify(raw)).length; } catch { return null; }
    })();
    return {
      approxJsonBytes,
      hasMapping: Boolean(mapping),
      mappingNodeCount: nodes.length,
      messageNodeCount: messages.length,
      leafNodeCount: childCounts.filter((count) => count === 0).length,
      roleCounts: countByValues(roles),
      contentTypeCounts: countByValues(contentTypes),
      statusCounts: countByValues(statuses),
      hasTitle: Boolean(raw?.title),
      hasConversationId: Boolean(raw?.conversation_id),
      defaultModelSlug: raw?.default_model_slug || null,
      currentNode: raw?.current_node || null,
      paginationLikeKeyCount: paginationLikeKeyPaths.length,
      paginationLikeKeyPaths
    };
  }

  function buildConversationFetchHeaders(auth) {
    const headers = {
      Accept: 'application/json',
      ...(auth?.extraHeaders || {}),
      Authorization: auth?.authorization || ''
    };
    if (auth?.oaiDeviceId) headers['oai-device-id'] = auth.oaiDeviceId;
    return headers;
  }

  function queryParamsToObject(params) {
    const out = {};
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') out[key] = String(value);
    }
    return out;
  }

  function buildRecentLimitCandidateParams(turnCount, messageLimit) {
    return [
      { name: 'limit', description: 'limit=messageLimit', params: { limit: messageLimit } },
      { name: 'offset_limit', description: 'offset=0&limit=messageLimit', params: { offset: 0, limit: messageLimit } },
      { name: 'message_limit', description: 'message_limit=messageLimit', params: { message_limit: messageLimit } },
      { name: 'turn_limit', description: 'turn_limit=turnCount', params: { turn_limit: turnCount } },
      { name: 'last_n', description: 'last_n=turnCount', params: { last_n: turnCount } }
    ];
  }

  async function fetchConversationVariantSummary(conversationId, params, auth) {
    const queryParams = queryParamsToObject(params);
    const url = new URL(`/backend-api/conversation/${conversationId}`, window.location.origin);
    for (const [key, value] of Object.entries(queryParams)) url.searchParams.set(key, value);
    const startedAt = performance.now();
    const response = await fetch(`${url.pathname}${url.search}`, {
      method: 'GET',
      credentials: 'include',
      headers: buildConversationFetchHeaders(auth)
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const contentType = response.headers.get('content-type') || '';
    let parsedJson = false;
    let shape = null;
    let approxTextBytes = null;
    let errorPreview = null;
    try {
      if (contentType.includes('application/json')) {
        const body = await response.json();
        parsedJson = true;
        shape = summarizeConversationLikeRaw(body);
      } else {
        const text = await response.text();
        approxTextBytes = new TextEncoder().encode(text).length;
        errorPreview = text.slice(0, 500);
        try {
          const body = JSON.parse(text);
          parsedJson = true;
          shape = summarizeConversationLikeRaw(body);
        } catch {}
      }
    } catch (error) {
      errorPreview = error instanceof Error ? error.message : String(error);
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      elapsedMs,
      endpointPath: url.pathname,
      endpointKind: classifyChatGPTEndpoint(url.pathname),
      queryParamKeys: Object.keys(queryParams).sort(),
      queryParams,
      modifiedRequest: Object.keys(queryParams).length > 0,
      contentType,
      parsedJson,
      approxTextBytes,
      shape,
      errorPreview
    };
  }

  function compareVariantToBaseline(variant, baseline) {
    const baseShape = baseline?.shape || {};
    const shape = variant?.shape || {};
    const bytesRatio = baseShape.approxJsonBytes && shape.approxJsonBytes ? shape.approxJsonBytes / baseShape.approxJsonBytes : null;
    const mappingRatio = baseShape.mappingNodeCount && shape.mappingNodeCount ? shape.mappingNodeCount / baseShape.mappingNodeCount : null;
    const messageRatio = baseShape.messageNodeCount && shape.messageNodeCount ? shape.messageNodeCount / baseShape.messageNodeCount : null;
    const mappingReduced = Number.isFinite(mappingRatio) ? mappingRatio < 0.8 : false;
    const bytesReduced = Number.isFinite(bytesRatio) ? bytesRatio < 0.8 : false;
    const messageReduced = Number.isFinite(messageRatio) ? messageRatio < 0.8 : false;
    return {
      bytesRatio: bytesRatio == null ? null : Number(bytesRatio.toFixed(4)),
      mappingRatio: mappingRatio == null ? null : Number(mappingRatio.toFixed(4)),
      messageRatio: messageRatio == null ? null : Number(messageRatio.toFixed(4)),
      mappingReduced,
      bytesReduced,
      messageReduced,
      looksEffective: Boolean(variant?.ok && variant?.parsedJson && (mappingReduced || messageReduced) && bytesReduced)
    };
  }

  async function runRecentLimitFetchTest(message = {}) {
    const conversationId = extractConversationIdFromMessageOrUrl(message);
    const turnCountRaw = Number(message.turnCount || 3);
    const turnCount = Math.max(1, Math.min(20, Number.isFinite(turnCountRaw) ? Math.floor(turnCountRaw) : 3));
    const messageLimit = turnCount * 2;
    const auth = await getAuthForInternalApi();

    const baseline = await fetchConversationVariantSummary(conversationId, {}, auth);
    const candidates = [];
    for (const candidate of buildRecentLimitCandidateParams(turnCount, messageLimit)) {
      const result = await fetchConversationVariantSummary(conversationId, candidate.params, auth);
      candidates.push({
        name: candidate.name,
        description: candidate.description,
        request: {
          endpointPath: result.endpointPath,
          endpointKind: result.endpointKind,
          method: 'GET',
          queryParamKeys: result.queryParamKeys,
          queryParams: result.queryParams,
          modifiedRequest: result.modifiedRequest
        },
        response: {
          ok: result.ok,
          status: result.status,
          statusText: result.statusText,
          elapsedMs: result.elapsedMs,
          contentType: result.contentType,
          parsedJson: result.parsedJson,
          approxTextBytes: result.approxTextBytes,
          errorPreview: result.errorPreview
        },
        shape: result.shape,
        comparisonToBaseline: compareVariantToBaseline(result, baseline)
      });
    }
    const effectiveCandidates = candidates.filter((candidate) => candidate.comparisonToBaseline?.looksEffective);
    const bestCandidate = effectiveCandidates.length ? effectiveCandidates[0] : null;

    return {
      ok: true,
      appVersion: APP_VERSION,
      probeType: 'recent_limit_fetch_test',
      testedAt: nowIso(),
      note: '実ページの通信は改変していません。候補queryを付けた別fetchで、サーバー側の直近N件取得が可能かを比較します。本文はこの結果には保存しません。',
      conversationId,
      url: window.location.href,
      title: baseline?.shape?.hasTitle ? null : document.title,
      requestedTurnCount: turnCount,
      requestedMessageLimit: messageLimit,
      baseline: {
        request: {
          endpointPath: baseline.endpointPath,
          endpointKind: baseline.endpointKind,
          method: 'GET',
          queryParamKeys: baseline.queryParamKeys,
          modifiedRequest: baseline.modifiedRequest
        },
        response: {
          ok: baseline.ok,
          status: baseline.status,
          statusText: baseline.statusText,
          elapsedMs: baseline.elapsedMs,
          contentType: baseline.contentType,
          parsedJson: baseline.parsedJson,
          approxTextBytes: baseline.approxTextBytes,
          errorPreview: baseline.errorPreview
        },
        shape: baseline.shape
      },
      candidates,
      conclusion: {
        serverSideLimitLikely: effectiveCandidates.length > 0,
        bestCandidate: bestCandidate ? {
          name: bestCandidate.name,
          queryParams: bestCandidate.request.queryParams,
          comparisonToBaseline: bestCandidate.comparisonToBaseline
        } : null,
        explanation: effectiveCandidates.length > 0
          ? '少なくとも1つの候補でmapping/message/bytesが大きく減っています。サーバー側取得制限として使える可能性があります。'
          : '今回の候補queryでは、会話本文レスポンスのmapping/message/bytesは有意に減りませんでした。サーバー側の直近N件取得は難しい可能性が高いです。'
      },
      authDebug: auth.debug
    };
  }


  function estimateJsonBytes(value) {
    try { return new TextEncoder().encode(JSON.stringify(value)).length; } catch { return null; }
  }

  function cloneJsonLike(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }

  function summarizeMappingObject(mapping) {
    const nodes = Object.values(mapping || {});
    const messages = nodes.map((node) => node?.message).filter(Boolean);
    const roles = messages.map((message) => message?.author?.role || 'unknown');
    const contentTypes = messages.map((message) => message?.content?.content_type || 'unknown');
    const statuses = messages.map((message) => message?.status || 'unknown');
    const childCounts = nodes.map((node) => Array.isArray(node?.children) ? node.children.length : 0);
    return {
      mappingNodeCount: nodes.length,
      messageNodeCount: messages.length,
      leafNodeCount: childCounts.filter((count) => count === 0).length,
      roleCounts: countByValues(roles),
      contentTypeCounts: countByValues(contentTypes),
      statusCounts: countByValues(statuses)
    };
  }

  function buildReparentedLiteRawForEstimate(raw, selectedNodeIds) {
    const originalMapping = raw?.mapping || {};
    const root = findRootNode(raw);
    const selected = Array.from(new Set(selectedNodeIds || [])).filter((id) => id && originalMapping[id]);
    const liteMapping = {};
    const chain = [];

    if (root?.id && originalMapping[root.id]) {
      const rootClone = cloneJsonLike(originalMapping[root.id]);
      rootClone.parent = null;
      rootClone.children = [];
      liteMapping[root.id] = rootClone;
      chain.push(root.id);
    }

    for (const id of selected) {
      if (chain.includes(id)) continue;
      const clone = cloneJsonLike(originalMapping[id]);
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

    const liteRaw = cloneJsonLike(raw || {});
    liteRaw.mapping = liteMapping;
    liteRaw.current_node = chain.length ? chain[chain.length - 1] : raw?.current_node || null;
    return { liteRaw, chain, rootNodeId: root?.id || null };
  }

  function buildLiteDisplayDryRunModel(raw, normalized, requestedTurnCount) {
    const baselineShape = summarizeConversationLikeRaw(raw);
    const allTurns = Array.isArray(normalized?.turns) ? normalized.turns : [];
    const totalTurnCount = allTurns.length;
    const safeTurnCount = Math.max(1, Math.min(50, Number.isFinite(Number(requestedTurnCount)) ? Math.floor(Number(requestedTurnCount)) : 3));
    const retainedTurns = allTurns.slice(Math.max(0, totalTurnCount - safeTurnCount));
    const selectedMessageNodeIds = [];
    for (const turn of retainedTurns) {
      for (const msg of turn.messages || []) {
        if (msg?.id) selectedMessageNodeIds.push(msg.id);
      }
    }

    const selectedSet = new Set(selectedMessageNodeIds);
    const latestPathNodeIds = normalized?.debug?.branch?.selectedPathNodeIds || [];
    const orderedSelectedNodeIds = latestPathNodeIds.filter((id) => selectedSet.has(id));
    for (const id of selectedMessageNodeIds) {
      if (!orderedSelectedNodeIds.includes(id)) orderedSelectedNodeIds.push(id);
    }

    const { liteRaw, chain, rootNodeId } = buildReparentedLiteRawForEstimate(raw, orderedSelectedNodeIds);
    const liteShapeBase = summarizeConversationLikeRaw(liteRaw);
    const liteMappingStats = summarizeMappingObject(liteRaw.mapping || {});
    const liteApproxJsonBytes = estimateJsonBytes(liteRaw);
    const baselineBytes = baselineShape.approxJsonBytes || null;
    const bytesRatio = baselineBytes && liteApproxJsonBytes ? liteApproxJsonBytes / baselineBytes : null;
    const mappingRatio = baselineShape.mappingNodeCount && liteShapeBase.mappingNodeCount ? liteShapeBase.mappingNodeCount / baselineShape.mappingNodeCount : null;
    const messageRatio = baselineShape.messageNodeCount && liteShapeBase.messageNodeCount ? liteShapeBase.messageNodeCount / baselineShape.messageNodeCount : null;

    const retainedTurnSummaries = retainedTurns.map((turn) => ({
      turnIndex: turn.turnIndex,
      turnNumber: turn.turnIndex + 1,
      messageCount: Array.isArray(turn.messages) ? turn.messages.length : 0,
      userMessageCount: turn.userMessageCount || 0,
      assistantMessageCount: turn.assistantMessageCount || 0,
      imageLikeMessageCount: (turn.messages || []).filter((msg) => msg.hasImageLikeContent || msg.nonTextResponseType === 'image').length,
      warningFlags: turn.warningFlags || [],
      messageNodeIds: (turn.messages || []).map((msg) => msg.id).filter(Boolean)
    }));

    const reduction = {
      approxJsonBytesBefore: baselineShape.approxJsonBytes,
      approxJsonBytesAfter: liteApproxJsonBytes,
      approxJsonBytesRemoved: baselineShape.approxJsonBytes != null && liteApproxJsonBytes != null ? baselineShape.approxJsonBytes - liteApproxJsonBytes : null,
      bytesRatio: bytesRatio == null ? null : Number(bytesRatio.toFixed(4)),
      bytesReductionPct: bytesRatio == null ? null : Number(((1 - bytesRatio) * 100).toFixed(2)),
      mappingNodeCountBefore: baselineShape.mappingNodeCount,
      mappingNodeCountAfter: liteShapeBase.mappingNodeCount,
      mappingNodeCountRemoved: baselineShape.mappingNodeCount - liteShapeBase.mappingNodeCount,
      mappingRatio: mappingRatio == null ? null : Number(mappingRatio.toFixed(4)),
      messageNodeCountBefore: baselineShape.messageNodeCount,
      messageNodeCountAfter: liteShapeBase.messageNodeCount,
      messageNodeCountRemoved: baselineShape.messageNodeCount - liteShapeBase.messageNodeCount,
      messageRatio: messageRatio == null ? null : Number(messageRatio.toFixed(4))
    };

    const maybeUseful = Boolean(
      retainedTurns.length > 0 &&
      Number.isFinite(reduction.bytesReductionPct) &&
      reduction.bytesReductionPct >= 50 &&
      liteShapeBase.messageNodeCount > 0
    );

    return {
      strategy: 'reparent_latest_path_recent_turns_dry_run',
      requestedTurnCount: safeTurnCount,
      totalTurnCount,
      retainedTurnCount: retainedTurns.length,
      retainedTurnRange: retainedTurns.length ? {
        firstTurnNumber: retainedTurns[0].turnIndex + 1,
        lastTurnNumber: retainedTurns[retainedTurns.length - 1].turnIndex + 1,
        totalTurnCount
      } : null,
      rootNodeId,
      originalCurrentNode: raw?.current_node || null,
      simulatedCurrentNode: liteRaw.current_node || null,
      selectedMessageNodeCount: selectedMessageNodeIds.length,
      selectedMappingNodeCount: orderedSelectedNodeIds.length,
      simulatedChainNodeCount: chain.length,
      retainedTurnSummaries,
      baselineShape,
      liteShape: {
        ...liteShapeBase,
        approxJsonBytes: liteApproxJsonBytes,
        mappingStats: liteMappingStats
      },
      reduction,
      experimentalReadiness: {
        maybeUseful,
        safeToAutoEnable: false,
        reason: maybeUseful
          ? 'Dry Run上は大きな削減が見込めます。新規DOM blockは公式timestamp未取得を前提にdom_first_observed_atを表示し、候補日時の羅列UIは削除しています。'
          : 'Dry Run上の削減率または保持メッセージ数が不十分です。実ページ改変へ進む前に結果を確認してください。'
      },
      warnings: [
        'dry_run_only_no_page_modification',
        'simulated_mapping_is_reparented_and_may_not_match_chatgpt_internal_expectations',
        'response_body_is_not_included_in_this_report'
      ]
    };
  }

  async function runLiteDisplayDryRun(message = {}) {
    const conversationId = extractConversationIdFromMessageOrUrl(message);
    const turnCountRaw = Number(message.turnCount || 3);
    const turnCount = Math.max(1, Math.min(50, Number.isFinite(turnCountRaw) ? Math.floor(turnCountRaw) : 3));
    const { raw, authDebug } = await fetchChatGPTConversationRaw(conversationId);
    const normalized = normalizeMessagesWithDebug(raw);
    const dryRun = buildLiteDisplayDryRunModel(raw, normalized, turnCount);
    return {
      ok: true,
      appVersion: APP_VERSION,
      probeType: 'lite_display_dry_run',
      testedAt: nowIso(),
      note: '実ページの通信・表示は改変していません。現在の会話JSONを直近N turnだけに削る場合の推定サイズ/件数を計算します。本文はこの結果には保存しません。',
      conversationId,
      url: window.location.href,
      title: raw?.title || document.title || null,
      requestedTurnCount: turnCount,
      normalizedPath: {
        selectedPathLength: normalized?.debug?.branch?.selectedPathLength || 0,
        includedMessageCount: normalized?.messages?.length || 0,
        turnCount: normalized?.turns?.length || 0,
        latestLeafNodeId: normalized?.debug?.branch?.latestLeafNodeId || null
      },
      dryRun,
      conclusion: {
        clientSideLiteModeWorthTrying: Boolean(dryRun.experimentalReadiness?.maybeUseful),
        serverSideLimitStillNotProven: true,
        recommendedNextStep: dryRun.experimentalReadiness?.maybeUseful
          ? '通常ページのBackend JSON rewriteはデフォルトONです。rewrite有効時はスクロール安定化のためDOM pruneとinterval集計を抑制します。新規DOM blockは公式timestamp未取得を前提にdom_first_observed_atを表示します。全履歴が必要な場合はfullLoadOnceで次のconversation responseをそのまま通します。'
          : 'Dry Run結果の削減率を確認し、効果が薄い場合はRecent View改変を見送ります。'
      },
      authDebug
    };
  }


  async function runLiteDisplayEnable(message = {}) {
    const conversationId = extractConversationIdFromMessageOrUrl(message);
    const turnCount = normalizeLiteTurnCount(message?.turnCount ?? getConfiguredLiteTurnCount());
    liteTurnCount = turnCount;
    if (typeof message?.liteShowImages === 'boolean') liteShowImagesEnabled = message.liteShowImages;
    const payload = {
      enabled: true,
      conversationId,
      turnCount,
      replaceExisting: true,
      resetStorageBeforeSet: true,
      liteShowImages: liteShowImagesEnabled,
      requestedBy: message?.requestedBy || 'popup_lite_on',
      commandId: message?.commandId || null
    };
    const result = await setMainWorldLiteDisplayConfig(payload, 3000);
    const lite = result?.liteDisplay || result?.mainWorldHook?.liteDisplay || result || null;
    if (!lite) {
      throw new Error('Recent View Experimentalのmain-world hookが応答しませんでした。拡張更新後にChatGPTページを再読み込みしてから再実行してください。');
    }
    return {
      ok: true,
      appVersion: APP_VERSION,
      action: 'lite_display_experimental_enable',
      appliedAt: nowIso(),
      note: '新規DOM blockは公式timestamp未取得を前提にdom_first_observed_atを表示します。',
      frame: { isTopFrame: window.top === window, href: window.location.href },
      conversationId,
      requestedTurnCount: turnCount,
      liteDisplay: lite
    };
  }

  async function runLiteDisplayDisable(message = {}) {
    const payload = {
      enabled: false,
      userDisabled: true,
      replaceExisting: true,
      resetStorageBeforeSet: true,
      requestedBy: message?.requestedBy || 'popup_lite_off',
      commandId: message?.commandId || null
    };
    const result = await setMainWorldLiteDisplayConfig(payload, 3000);
    const lite = result?.liteDisplay || result?.mainWorldHook?.liteDisplay || result || null;
    if (!lite) {
      throw new Error('Recent View Experimentalのmain-world hookが応答しませんでした。拡張更新後にChatGPTページを再読み込みしてから再実行してください。');
    }
    return {
      ok: true,
      appVersion: APP_VERSION,
      action: 'lite_display_experimental_disable',
      appliedAt: nowIso(),
      note: 'Recent View Experimentalを無効化しました。必要に応じて対象会話ページを再読み込みしてください。',
      frame: { isTopFrame: window.top === window, href: window.location.href },
      liteDisplay: lite
    };
  }

  async function runLiteDisplayStatus() {
    const result = await getMainWorldLiteDisplayStatus(3000);
    if (!result?.liteDisplay && !result?.mainWorldHook?.liteDisplay) {
      throw new Error('Recent View Experimentalのmain-world hookが応答しませんでした。拡張更新後にChatGPTページを再読み込みしてから再実行してください。');
    }
    return {
      ok: true,
      appVersion: APP_VERSION,
      action: 'lite_display_experimental_status',
      checkedAt: nowIso(),
      url: window.location.href,
      frame: { isTopFrame: window.top === window, href: window.location.href },
      liteDisplay: result?.liteDisplay || result?.mainWorldHook?.liteDisplay || result || null,
      rollingLite: getRollingLiteDomState()
    };
  }

  async function getStatus() {
    let modelSelectorUiStatus = null;
    try {
      modelSelectorUiStatus = window.__ARCAIA_MODEL_SELECTOR_UI__?.getLightweightStatus?.()
        || window.__ARCAIA_MODEL_SELECTOR_UI__?.getStatus?.()
        || {
        ok: false,
        apiPresent: Boolean(window.__ARCAIA_MODEL_SELECTOR_UI__),
        reason: 'lightweight_status_unavailable'
      };
    } catch (error) {
      modelSelectorUiStatus = {
        ok: false,
        apiPresent: Boolean(window.__ARCAIA_MODEL_SELECTOR_UI__),
        error: error instanceof Error ? error.message : String(error)
      };
    }
    return {
      ok: true,
      appVersion: APP_VERSION,
      contentScript: {
        installed: true,
        url: window.location.href,
        readyAt: nowIso(),
        initialInjection,
        operationMode,
        runtimeEnabled: isArcaiaRuntimeEnabled(),
        normalModeEnabled: isArcaiaNormalMode(),
        featureSettings,
        modelSelectorUiStatus
      },
      mainWorld: {
        scriptInjected: Boolean(initialInjection?.injected || document.getElementById(MAIN_SCRIPT_ID)),
        protocolSource: MAIN_PROTOCOL_SOURCE
      }
    };
  }

  async function extractChatGPTInternal(includeRaw = false) {
    const conversationId = extractConversationIdFromUrl();
    const { raw, authDebug } = await fetchChatGPTConversationRaw(conversationId);
    return buildProbeResult(raw, conversationId, authDebug, includeRaw);
  }



  const MESSAGE_TIME_BADGE_ATTR = 'data-arcaia-message-time-badge';
  const MESSAGE_TIME_APPLIED_ATTR = 'data-arcaia-message-time-applied';
  const MESSAGE_TIME_PROVISIONAL_ATTR = 'data-arcaia-timestamp-provisional';
  const MESSAGE_TIME_DOM_KEY_ATTR = 'data-arcaia-message-time-dom-key';
  const MESSAGE_TIME_INITIAL_DOM_ATTR = 'data-arcaia-message-time-initial-dom';
  const MESSAGE_TIME_MUTATION_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
  let messageTimeUiStarted = false;
  let messageTimeApplyQueued = false;
  let messageTimePendingApplyReason = null;
  let messageTimeRefreshQueued = false;
  let messageTimeRefreshInFlight = false;
  let messageTimePendingRefreshReason = null;
  let messageTimeDomKeyCounter = 0;
  let messageTimeState = {
    appVersion: APP_VERSION,
    enabled: true,
    disabledReason: null,
    conversationId: null,
    indexLoaded: false,
    loading: false,
    lastLoadAt: null,
    lastLoadAtIso: null,
    lastApplyAt: null,
    lastApplyAtIso: null,
    indexedMessageCount: 0,
    appliedBadgeCount: 0,
    missingIdCount: 0,
    missingTimestampCount: 0,
    lastError: null,
    authDebug: null,
    byMessageId: {},
    byNodeId: {},
    roleOrder: [],
    provisionalByDomKey: {},
    provisionalCount: 0,
    replacedProvisionalCount: 0,
    deferredAssistantCount: 0,
    removedDeferredAssistantBadgeCount: 0,
    initialDomAwaitingAuthoritativeIndex: true,
    initialDomMarkedCount: 0,
    skippedInitialExistingCount: 0
  };

  function resetMessageTimeStateForConversation(conversationId = null) {
    for (const badge of document.querySelectorAll(`[${MESSAGE_TIME_BADGE_ATTR}="true"]`)) {
      try { badge.remove(); } catch {}
    }
    for (const container of document.querySelectorAll(`[${MESSAGE_TIME_APPLIED_ATTR}="true"]`)) {
      container.removeAttribute(MESSAGE_TIME_APPLIED_ATTR);
    }
    for (const roleEl of document.querySelectorAll(`[${MESSAGE_TIME_DOM_KEY_ATTR}]`)) {
      try { roleEl.removeAttribute(MESSAGE_TIME_DOM_KEY_ATTR); } catch {}
    }
    for (const roleEl of document.querySelectorAll(`[${MESSAGE_TIME_INITIAL_DOM_ATTR}]`)) {
      try { roleEl.removeAttribute(MESSAGE_TIME_INITIAL_DOM_ATTR); } catch {}
    }
    messageTimeDomKeyCounter = 0;
    messageTimeState = {
      appVersion: APP_VERSION,
      enabled: true,
      disabledReason: null,
      conversationId,
      indexLoaded: false,
      loading: false,
      lastLoadAt: null,
      lastLoadAtIso: null,
      lastApplyAt: null,
      lastApplyAtIso: null,
      indexedMessageCount: 0,
      appliedBadgeCount: 0,
      missingIdCount: 0,
      missingTimestampCount: 0,
      lastError: null,
      authDebug: null,
      byMessageId: {},
      byNodeId: {},
      roleOrder: [],
      provisionalByDomKey: {},
      provisionalCount: 0,
      replacedProvisionalCount: 0,
      deferredAssistantCount: 0,
      removedDeferredAssistantBadgeCount: 0,
      initialDomAwaitingAuthoritativeIndex: true,
      initialDomMarkedCount: 0,
      skippedInitialExistingCount: 0
    };
  }

  function formatJstDateTimeParts(iso) {
    const date = normalizeTimestampToDate(iso);
    if (!date) return null;
    const parts = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(date).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    return {
      date: `${parts.year}/${parts.month}/${parts.day}`,
      shortDate: `${parts.month}/${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
      compact: `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`,
      full: `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second} JST`,
      filenameLike: `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`
    };
  }

  function normalizeTimestampIndexItemForDisplay(item) {
    if (!item) return null;
    const iso = item.iso || item.createTimeIso || item.updateTimeIso || null;
    const parts = formatJstDateTimeParts(iso);
    return {
      ...item,
      iso,
      displayTime: item.provisional ? (parts?.compact || parts?.time || item.displayTime || null) : (item.displayTime || parts?.compact || parts?.time || null),
      displayDate: item.provisional ? (parts?.date || item.displayDate || null) : (item.displayDate || parts?.date || null),
      fullDisplay: item.provisional ? (parts?.full || item.fullDisplay || null) : (item.fullDisplay || parts?.full || null),
      displayTimezone: item.displayTimezone || 'Asia/Tokyo',
      kind: item.kind || (item.role === 'user' ? 'sent' : 'received')
    };
  }
  function pickMessageDisplayTimestamp(message, role) {
    const create = getMessageCreateTimestampCandidate(message);
    const update = getMessageUpdateTimestampCandidate(message);
    const metadata = message?.metadata || {};
    const finish = pickFirstValidTimestamp([
      { source: 'metadata.finished_at', value: metadata.finished_at },
      { source: 'metadata.finish_time', value: metadata.finish_time },
      { source: 'metadata.completed_at', value: metadata.completed_at },
      { source: 'metadata.complete_time', value: metadata.complete_time },
      { source: 'metadata.end_time', value: metadata.end_time },
      { source: 'message.end_time', value: message?.end_time }
    ]);
    if (role === 'assistant') {
      if (finish.iso) return { ...finish, kind: 'received_or_completed' };
      if (update.iso) return { ...update, kind: 'updated' };
      if (create.iso) return { ...create, kind: 'created' };
    }
    if (create.iso) return { ...create, kind: role === 'user' ? 'sent' : 'created' };
    if (update.iso) return { ...update, kind: 'updated' };
    if (finish.iso) return { ...finish, kind: 'received_or_completed' };
    return { value: null, iso: null, source: null, kind: null };
  }

  function buildMessageTimestampIndex(raw) {
    const byMessageId = {};
    const byNodeId = {};
    const roleOrder = [];
    const normalized = normalizeMessagesWithDebug(raw);
    const messages = Array.isArray(normalized?.messages) ? normalized.messages : [];
    for (const msg of messages) {
      const id = msg.message_id || msg.id;
      if (!id) continue;
      const iso = msg.role === 'assistant' ? (msg.update_time_iso || msg.create_time_iso) : (msg.create_time_iso || msg.update_time_iso);
      const source = msg.role === 'assistant' ? (msg.update_time_source || msg.create_time_source) : (msg.create_time_source || msg.update_time_source);
      const parts = formatJstDateTimeParts(iso);
      const item = {
        messageId: id,
        id: msg.id || null,
        role: msg.role,
        iso: iso || null,
        source: source || null,
        kind: msg.role === 'user' ? 'sent' : 'received',
        displayTime: parts?.compact || parts?.time || null,
        displayDate: parts?.date || null,
        fullDisplay: parts?.full || null,
        textPreview: msg.textPreview || null
      };
      byMessageId[id] = item;
      byNodeId[msg.id || id] = item;
      roleOrder.push(item);
    }

    // normalizeMessagesWithDebug deliberately filters some internal messages. Add a raw mapping pass so DOM IDs can still resolve.
    const mapping = raw?.mapping || {};
    for (const [nodeId, node] of Object.entries(mapping)) {
      const message = node?.message;
      if (!message) continue;
      const role = message?.author?.role || null;
      if (role !== 'user' && role !== 'assistant') continue;
      const id = message.id || nodeId;
      if (byMessageId[id] || byNodeId[nodeId]) continue;
      const picked = pickMessageDisplayTimestamp(message, role);
      const parts = formatJstDateTimeParts(picked.iso);
      const item = {
        messageId: id,
        id: nodeId,
        role,
        iso: picked.iso,
        source: picked.source,
        kind: role === 'user' ? 'sent' : 'received',
        displayTime: parts?.compact || parts?.time || null,
        displayDate: parts?.date || null,
        fullDisplay: parts?.full || null,
        textPreview: makeTextPreview(extractTextContents(message.content).join('\n\n'), 220)
      };
      byMessageId[id] = item;
      byNodeId[nodeId] = item;
    }
    return { byMessageId, byNodeId, roleOrder };
  }

  function getMessageIdFromRoleElement(roleEl) {
    if (!roleEl) return null;
    return roleEl.getAttribute?.('data-message-id')
      || roleEl.closest?.('[data-message-id]')?.getAttribute?.('data-message-id')
      || roleEl.querySelector?.('[data-message-id]')?.getAttribute?.('data-message-id')
      || null;
  }

  function getMessageTimeDomKey(roleEl, role, ordinal) {
    const safeRole = role === 'user' || role === 'assistant' ? role : 'unknown';
    const safeOrdinal = Number.isFinite(ordinal) ? ordinal : 0;
    const existing = roleEl?.getAttribute?.(MESSAGE_TIME_DOM_KEY_ATTR);
    if (existing) return existing;
    const id = getMessageIdFromRoleElement(roleEl);
    const key = id
      ? `${safeRole}:message:${id}`
      : (() => {
          const turnEl = roleEl?.closest?.(MESSAGE_SECTION_SELECTOR);
          const turnKey = turnEl?.getAttribute?.('data-testid') || turnEl?.id || '';
          if (turnKey) return `${safeRole}:turn:${turnKey}:ordinal:${safeOrdinal}`;
          messageTimeDomKeyCounter += 1;
          return `${safeRole}:dom:${messageTimeDomKeyCounter}:ordinal:${safeOrdinal}`;
        })();
    try { roleEl?.setAttribute?.(MESSAGE_TIME_DOM_KEY_ATTR, key); } catch {}
    return key;
  }

  function getOrCreateProvisionalTimestampInfo(roleEl, role, ordinal) {
    const domKey = getMessageTimeDomKey(roleEl, role, ordinal);
    const existing = messageTimeState.provisionalByDomKey?.[domKey];
    if (existing) return existing;
    const observedAt = Date.now();
    const iso = nowIso(observedAt);
    const parts = formatJstDateTimeParts(iso);
    const id = getMessageIdFromRoleElement(roleEl);
    const item = {
      messageId: id || null,
      id: domKey,
      domKey,
      role,
      ordinal,
      iso,
      source: 'dom_first_observed_at',
      kind: role === 'user' ? 'sent' : 'received',
      observedAt,
      observedAtIso: iso,
      observedAtJst: parts?.full || null,
      displayTime: parts?.compact || parts?.time || null,
      displayDate: parts?.date || null,
      fullDisplay: parts?.full || null,
      displayTimezone: 'Asia/Tokyo',
      provisional: true
    };
    const provisionalByDomKey = {
      ...(messageTimeState.provisionalByDomKey || {}),
      [domKey]: item
    };
    messageTimeState = {
      ...messageTimeState,
      provisionalByDomKey,
      provisionalCount: Object.keys(provisionalByDomKey).length
    };
    return item;
  }

  function getRoleNodesForTimestampBadges() {
    return Array.from(document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'))
      .filter((el) => el && el.isConnected && !el.closest?.(`#${LITE_BAR_ID}`));
  }

  function isMessageTimeAwaitingAuthoritativeIndex() {
    return !messageTimeState.indexLoaded
      && Boolean(messageTimeState.initialDomAwaitingAuthoritativeIndex);
  }

  function markInitialMessageTimeRoleNodes(roleNodes, reason = 'initial_dom_snapshot') {
    if (!Array.isArray(roleNodes) || !roleNodes.length) return 0;
    let marked = 0;
    for (const roleEl of roleNodes) {
      if (!roleEl?.isConnected) continue;
      if (roleEl.hasAttribute?.(MESSAGE_TIME_INITIAL_DOM_ATTR)) continue;
      try {
        roleEl.setAttribute(MESSAGE_TIME_INITIAL_DOM_ATTR, 'true');
        roleEl.setAttribute('data-arcaia-message-time-initial-dom-reason', reason);
        marked += 1;
      } catch {}
    }
    if (marked) {
      messageTimeState = {
        ...messageTimeState,
        initialDomMarkedCount: Number(messageTimeState.initialDomMarkedCount || 0) + marked
      };
    }
    return marked;
  }

  function isInitialMessageTimeRoleNode(roleEl) {
    return Boolean(roleEl?.getAttribute?.(MESSAGE_TIME_INITIAL_DOM_ATTR) === 'true');
  }


  async function refreshMessageTimestampIndex(reason = 'manual') {
    const conversationId = tryExtractConversationIdFromUrl(window.location.href);
    messageTimeState = {
      ...messageTimeState,
      enabled: true,
      conversationId,
      loading: true,
      lastApplyReason: reason,
      lastError: null
    };
    try {
      const result = await getMainWorldMessageTimestampIndex(1800, conversationId);
      const activeConversationId = tryExtractConversationIdFromUrl(window.location.href);
      if (activeConversationId !== conversationId) {
        return messageTimeState;
      }
      const index = result?.messageTimestampIndex || result?.index || null;
      const sameConversation = !index || Boolean(conversationId && index.conversationId === conversationId);
      if (!result?.ok || !index || !sameConversation) {
        messageTimeState = {
          ...messageTimeState,
          loading: false,
          indexLoaded: false,
          disabledReason: sameConversation ? 'message_timestamp_index_not_available_yet' : 'message_timestamp_index_conversation_mismatch',
          lastLoadAt: Date.now(),
          lastLoadAtIso: nowIso(),
          indexedMessageCount: 0,
          byMessageId: {},
          byNodeId: {},
          roleOrder: []
        };
        scheduleApplyMessageTimestamps(`index_unavailable:${reason}`);
        return messageTimeState;
      }
      messageTimeState = {
        ...messageTimeState,
        enabled: true,
        disabledReason: null,
        loading: false,
        indexLoaded: true,
        initialDomAwaitingAuthoritativeIndex: false,
        conversationId: index.conversationId || conversationId,
        lastLoadAt: Date.now(),
        lastLoadAtIso: nowIso(),
        indexedMessageCount: Number(index.messageCount || index.indexedMessageCount || 0),
        byMessageId: index.byMessageId || {},
        byNodeId: index.byNodeId || {},
        roleOrder: Array.isArray(index.roleOrder) ? index.roleOrder : [],
        source: index.source || 'main_world_existing_conversation_fetch'
      };
      scheduleApplyMessageTimestamps(`index_refreshed:${reason}`);
      return messageTimeState;
    } catch (error) {
      messageTimeState = {
        ...messageTimeState,
        loading: false,
        indexLoaded: false,
        disabledReason: 'message_timestamp_index_refresh_failed',
        lastError: error instanceof Error ? error.message : String(error)
      };
      scheduleApplyMessageTimestamps(`index_refresh_failed:${reason}`);
      return messageTimeState;
    }
  }

  function findTimestampInfoForRoleNode(roleEl, role, ordinal) {
    const id = getMessageIdFromRoleElement(roleEl);
    const domKey = getMessageTimeDomKey(roleEl, role, ordinal);
    if (id && messageTimeState.byMessageId?.[id]) return { item: messageTimeState.byMessageId[id], match: 'message_id', id, domKey };
    if (id && messageTimeState.byNodeId?.[id]) return { item: messageTimeState.byNodeId[id], match: 'node_id', id, domKey };
    if (isInitialMessageTimeRoleNode(roleEl)) {
      return { item: null, match: id ? 'initial_existing_dom_waiting_for_index_id' : 'initial_existing_dom_waiting_for_index_no_id', id, domKey };
    }
    const item = getOrCreateProvisionalTimestampInfo(roleEl, role, ordinal);
    return { item, match: id ? 'provisional_missing_index_for_id' : 'provisional_missing_dom_id', id, domKey: item.domKey || domKey };
  }

  function getMessageTimeBadgeContainer(roleEl) {
    if (!roleEl) return null;
    const roleContainer = roleEl.matches?.('[data-message-author-role]') ? roleEl : roleEl.closest?.('[data-message-author-role]');
    if (roleContainer?.isConnected) return roleContainer;
    const messageIdContainer = roleEl.closest?.('[data-message-id]');
    if (messageIdContainer?.isConnected) return messageIdContainer;
    return roleEl;
  }

  function removeMessageTimeBadge(roleEl, reason = 'remove') {
    const container = getMessageTimeBadgeContainer(roleEl);
    const badge = container?.querySelector?.(`[${MESSAGE_TIME_BADGE_ATTR}="true"]`);
    if (!badge) return false;
    try { badge.remove(); } catch {}
    try { container?.removeAttribute?.(MESSAGE_TIME_APPLIED_ATTR); } catch {}
    try { container?.setAttribute?.('data-arcaia-message-time-skip-reason', reason); } catch {}
    return true;
  }




  function ensureMessageTimeBadge(roleEl, role, info) {
    const displayItem = normalizeTimestampIndexItemForDisplay(info?.item);
    if (!roleEl || !displayItem?.displayTime) return false;
    const container = getMessageTimeBadgeContainer(roleEl);
    if (!container || !container.isConnected) return false;
    let badge = container.querySelector?.(`[${MESSAGE_TIME_BADGE_ATTR}="true"]`);
    const wasProvisional = badge?.getAttribute?.(MESSAGE_TIME_PROVISIONAL_ATTR) === 'true';
    if (!badge) {
      badge = document.createElement('div');
      badge.setAttribute(MESSAGE_TIME_BADGE_ATTR, 'true');
      badge.className = `arcaia-message-time-badge arcaia-message-time-${role}`;
      badge.setAttribute('aria-label', 'Arcaia message timestamp');
      try { container.appendChild(badge); } catch { roleEl.insertAdjacentElement('afterend', badge); }
    }
    const isProvisional = Boolean(displayItem.provisional);
    if (wasProvisional && !isProvisional) {
      messageTimeState.replacedProvisionalCount = Number(messageTimeState.replacedProvisionalCount || 0) + 1;
    }
    const label = displayItem.displayTime;
    badge.textContent = label;
    badge.title = `${displayItem.fullDisplay || displayItem.iso || label}\nsource: ${displayItem.source || 'unknown'}\nmatch: ${info.match}${info.id ? `\nmessage_id: ${info.id}` : ''}${info.domKey ? `\ndom_key: ${info.domKey}` : ''}${isProvisional ? '\nprovisional: true' : ''}`;
    badge.dataset.arcaiaMessageId = info.id || info.domKey || displayItem.messageId || '';
    badge.dataset.arcaiaTimestampIso = displayItem.iso || '';
    badge.dataset.arcaiaTimestampSource = displayItem.source || '';
    badge.setAttribute(MESSAGE_TIME_PROVISIONAL_ATTR, isProvisional ? 'true' : 'false');
    badge.classList?.toggle('arcaia-message-time-provisional', isProvisional);
    container.removeAttribute?.('data-arcaia-message-time-skip-reason');
    container.setAttribute(MESSAGE_TIME_APPLIED_ATTR, 'true');
    return true;
  }

  function shouldDeferAssistantTimestampForGeneration(roleEl, role, latestAssistantRoleEl, generationDetector) {
    return role === 'assistant'
      && Boolean(generationDetector?.generating)
      && Boolean(latestAssistantRoleEl)
      && roleEl === latestAssistantRoleEl;
  }

  async function applyMessageTimestampBadges(reason = 'manual') {
    const startedAt = Date.now();
    const roleNodes = getRoleNodesForTimestampBadges();
    const initialDomAwaitingAuthoritativeIndex = isMessageTimeAwaitingAuthoritativeIndex();
    // Do not mark newly added live DOM during apply. Initial-history protection is limited
    // to explicit startup / conversation-change snapshots so new chats can receive provisional timestamps.
    const initialDomMarkedThisApply = 0;
    const generationDetector = isLikelyChatGPTGenerating();
    const latestUserIndex = roleNodes.reduce((latest, el, index) => el?.getAttribute?.('data-message-author-role') === 'user' ? index : latest, -1);
    const latestAssistantIndex = roleNodes.reduce((latest, el, index) => el?.getAttribute?.('data-message-author-role') === 'assistant' ? index : latest, -1);
    const latestAssistantRoleEl = generationDetector.generating && latestAssistantIndex > latestUserIndex
      ? roleNodes[latestAssistantIndex] || null
      : null;
    const roleOrdinal = { user: 0, assistant: 0 };
    let appliedBadgeCount = 0;
    let deferredAssistantCount = 0;
    let removedDeferredAssistantBadgeCount = 0;
    let missingIdCount = 0;
    let missingTimestampCount = 0;
    let skippedInitialExistingCount = 0;
    for (const roleEl of roleNodes) {
      const role = roleEl.getAttribute?.('data-message-author-role');
      if (role !== 'user' && role !== 'assistant') continue;
      const ordinal = roleOrdinal[role] || 0;
      roleOrdinal[role] = ordinal + 1;
      if (shouldDeferAssistantTimestampForGeneration(roleEl, role, latestAssistantRoleEl, generationDetector)) {
        deferredAssistantCount += 1;
        if (removeMessageTimeBadge(roleEl, 'assistant_generating_pending_completion')) removedDeferredAssistantBadgeCount += 1;
        continue;
      }
      const info = findTimestampInfoForRoleNode(roleEl, role, ordinal);
      const displayItem = normalizeTimestampIndexItemForDisplay(info.item);
      if (!info.id) missingIdCount += 1;
      if (!displayItem?.displayTime) missingTimestampCount += 1;
      if (String(info.match || '').startsWith('initial_existing_dom_waiting_for_index')) skippedInitialExistingCount += 1;
      if (ensureMessageTimeBadge(roleEl, role, info)) appliedBadgeCount += 1;
    }

    messageTimeState = {
      ...messageTimeState,
      enabled: true,
      disabledReason: messageTimeState.indexLoaded ? null : 'message_timestamp_index_pending_using_provisional',
      lastApplyAt: startedAt,
      lastApplyAtIso: nowIso(startedAt),
      lastApplyReason: reason,
      appliedBadgeCount,
      missingIdCount,
      missingTimestampCount,
      provisionalCount: Object.keys(messageTimeState.provisionalByDomKey || {}).length,
      replacedProvisionalCount: Number(messageTimeState.replacedProvisionalCount || 0),
      deferredAssistantCount,
      removedDeferredAssistantBadgeCount,
      initialDomAwaitingAuthoritativeIndex,
      initialDomMarkedThisApply,
      initialDomMarkedCount: Number(messageTimeState.initialDomMarkedCount || 0),
      skippedInitialExistingCount,
      generationDetector: {
        generating: Boolean(generationDetector?.generating)
      }
    };
    return messageTimeState;
  }

  function scheduleApplyMessageTimestamps(reason = 'mutation') {
    if (!isArcaiaExtensionEnabled() || !messageTimeUiStarted || !isArcaiaFeatureEnabled('messageTimestamps')) return messageTimeState;
    messageTimePendingApplyReason = String(reason || 'mutation');
    if (messageTimeApplyQueued) return messageTimeState;
    messageTimeApplyQueued = true;
    queueMicrotask(() => {
      messageTimeApplyQueued = false;
      if (!messageTimeUiStarted || !isArcaiaExtensionEnabled() || !isArcaiaFeatureEnabled('messageTimestamps')) return;
      const applyReason = messageTimePendingApplyReason || reason;
      messageTimePendingApplyReason = null;
      applyMessageTimestampBadges(applyReason).catch(() => {});
    });
    return messageTimeState;
  }

  function flushMessageTimestampIndexRefresh() {
    messageTimeRefreshQueued = false;
    if (!messageTimeUiStarted || !isArcaiaExtensionEnabled() || !isArcaiaFeatureEnabled('messageTimestamps')) return;
    if (messageTimeRefreshInFlight) return;
    const refreshReason = messageTimePendingRefreshReason || 'dom_event';
    messageTimePendingRefreshReason = null;
    messageTimeRefreshInFlight = true;
    refreshMessageTimestampIndex(refreshReason).catch(() => {}).finally(() => {
      messageTimeRefreshInFlight = false;
      if (messageTimePendingRefreshReason && !messageTimeRefreshQueued) {
        messageTimeRefreshQueued = true;
        queueMicrotask(flushMessageTimestampIndexRefresh);
      }
    });
  }

  function scheduleRefreshMessageTimestampIndex(reason = 'dom_event') {
    if (!isArcaiaExtensionEnabled() || !messageTimeUiStarted || !isArcaiaFeatureEnabled('messageTimestamps')) return messageTimeState;
    messageTimePendingRefreshReason = String(reason || 'dom_event');
    if (messageTimeRefreshQueued || messageTimeRefreshInFlight) return messageTimeState;
    messageTimeRefreshQueued = true;
    queueMicrotask(flushMessageTimestampIndexRefresh);
    return messageTimeState;
  }

  function nodeContainsMessageTimestampDom(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.matches?.(MESSAGE_TIME_MUTATION_SELECTOR)) return true;
    return Boolean(node.querySelector?.(MESSAGE_TIME_MUTATION_SELECTOR));
  }

  function classifyMessageTimestampMutation(mutations) {
    let sawMessageDom = false;
    let sawTurnCopyButton = false;
    for (const mutation of mutations || []) {
      if (mutation.type === 'attributes' && nodeContainsMessageTimestampDom(mutation.target)) {
        sawMessageDom = true;
      }
      for (const node of Array.from(mutation.addedNodes || [])) {
        if (nodeContainsTurnCopyButton(node)) {
          sawTurnCopyButton = true;
        }
        if (nodeContainsMessageTimestampDom(node)) {
          sawMessageDom = true;
        }
      }
    }
    return sawTurnCopyButton ? 'assistant_toolbar_ready' : (sawMessageDom ? 'message_dom_mutation' : null);
  }

  function handleMessageTimestampMutations(mutations) {
    const reason = classifyMessageTimestampMutation(mutations);
    if (reason) scheduleApplyMessageTimestamps(reason);
  }

  function startMessageTimestampUi() {
    if (!isArcaiaExtensionEnabled() || messageTimeUiStarted) return;
    messageTimeUiStarted = true;
    installLiteDisplayStyles();
    startConversationDomObserver();
    resetMessageTimeStateForConversation(tryExtractConversationIdFromUrl(window.location.href));
    markInitialMessageTimeRoleNodes(getRoleNodesForTimestampBadges(), 'startup_initial_dom_snapshot');
    scheduleRefreshMessageTimestampIndex('startup_existing_conversation_fetch_index');
    scheduleApplyMessageTimestamps('startup_dom_first_observation');
  }

  function stopMessageTimestampUi() {
    messageTimeUiStarted = false;
    messageTimeApplyQueued = false;
    messageTimePendingApplyReason = null;
    messageTimeRefreshQueued = false;
    messageTimePendingRefreshReason = null;
  }




  const LITE_BAR_ID = 'arcaia-lite-display-bar';
  const LITE_STYLE_ID = 'arcaia-lite-display-style';
  const RECENT_VIEW_HISTORY_CONTROLS_ID = 'arcaia-recent-view-history-controls';
  const RECENT_VIEW_LOADING_OVERLAY_ID = 'arcaia-recent-view-loading-overlay';
  const RECENT_VIEW_FAILURE_NOTICE_ID = 'arcaia-recent-view-failure-notice';
  const ROLLING_HIDE_ATTR = 'data-arcaia-lite-rolling-hidden';
  const ROLLING_ORIGINAL_DISPLAY_ATTR = 'data-arcaia-lite-original-display';
  const ROLLING_PRUNE_MODE_ATTR = 'data-arcaia-lite-prune-mode';
  const NATIVE_LITE_TURN_COUNT = 3;
  const MESSAGE_SECTION_SELECTOR = 'section[data-testid^="conversation-turn-"]';
  const LITE_GROUPING_ROLE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
  const PROMPT_TOC_BUTTON_SELECTOR = 'button[aria-label^="Prompt "]';
  const PROMPT_TOC_HIDE_ROOT_ATTR = 'data-arcaia-prompt-toc-hidden';
  const LITE_GROUPING_STRATEGY = 'latest_user_started_turns_hard_prune_v1';
  const LITE_RETAIN_MODE = 'latest_user_started_turns_hard_prune';
  const LEGACY_RESTORED_HISTORY_ID = 'arcaia-lite-restored-history';
  const LEGACY_NATIVE_SNAPSHOT_IFRAME_ID = 'arcaia-native-snapshot-hidden-iframe';
  let conversationDomContentObserver = null;
  let conversationDomStableAnchorObserver = null;
  let conversationDomObservedContentRoot = null;
  let conversationDomObservedStableAnchor = null;
  let conversationDomObserverStarted = false;
  let rollingLiteUiStarted = false;
  let rollingLiteApplyQueued = false;
  let rollingLiteApplyInFlight = false;
  let recentViewFailureNoticeTimer = null;
  let rollingLitePendingApplyReason = null;
  let rollingLiteRolelessSectionState = new WeakMap();
  let rollingLiteState = {
    appVersion: APP_VERSION,
    conversationId: tryExtractConversationIdFromUrl(window.location.href),
    enabled: null,
    applyCount: 0,
    lastApply: null,
    lastError: null,
    lastSkipReason: null,
    hiddenContainerCount: 0,
    hiddenSectionCount: 0,
    arcaiaHiddenSectionCount: 0,
    visibleTurnCount: 0,
    detectedTurnCount: 0,
    retainedTurnCount: 0,
    messageSectionCount: 0,
    roleNodeCount: 0,
    userSectionCount: 0,
    assistantSectionCount: 0,
    retainedGroupCount: 0,
    retainedSectionCount: 0,
    meaningfulSectionCount: 0,
    retainedMeaningfulSectionCount: 0,
    emptySectionCount: 0,
    retainedEmptySectionCount: 0,
    targetRetainedSectionCount: NATIVE_LITE_TURN_COUNT,
    liteRetainMode: LITE_RETAIN_MODE,
    prunedSectionCount: 0,
    duplicateSectionCount: 0,
    consecutiveUserCount: 0,
    consecutiveAssistantCount: 0,
    assistantOnlyGroupCount: 0,
    fallbackUsed: false,
    fallbackReason: null,
    liteGroupingStrategy: LITE_GROUPING_STRATEGY,
    retainedTurnRange: null,
    turnCountSetting: null,
    promptTocPrune: null,
    lastContentRefresh: null
  };

  function resetRollingLiteStateForConversation(conversationId = null) {
    rollingLiteState = {
      appVersion: APP_VERSION,
      conversationId,
      enabled: null,
      applyCount: 0,
      lastApply: null,
      lastError: null,
      lastSkipReason: null,
      hiddenContainerCount: 0,
      hiddenSectionCount: 0,
      arcaiaHiddenSectionCount: 0,
      removedContainerCount: 0,
      visibleTurnCount: 0,
      detectedTurnCount: 0,
      retainedTurnCount: 0,
      messageSectionCount: 0,
      roleNodeCount: 0,
      userSectionCount: 0,
      assistantSectionCount: 0,
      retainedGroupCount: 0,
      retainedSectionCount: 0,
      meaningfulSectionCount: 0,
      retainedMeaningfulSectionCount: 0,
      emptySectionCount: 0,
      retainedEmptySectionCount: 0,
      targetRetainedSectionCount: NATIVE_LITE_TURN_COUNT,
      liteRetainMode: LITE_RETAIN_MODE,
      prunedSectionCount: 0,
      duplicateSectionCount: 0,
      consecutiveUserCount: 0,
      consecutiveAssistantCount: 0,
      assistantOnlyGroupCount: 0,
      fallbackUsed: false,
      fallbackReason: null,
      liteGroupingStrategy: LITE_GROUPING_STRATEGY,
      retainedTurnRange: null,
      turnCountSetting: NATIVE_LITE_TURN_COUNT,
      promptTocPrune: null,
      lastGenerationDetector: null,
      lastContentRefresh: null
    };
  }

  function getRollingLiteMain() {
    return document.querySelector('main#main') || document.querySelector('main') || null;
  }

  function getTopLevelRollingLiteMessageSections(root = document) {
    return Array.from(root.querySelectorAll?.(MESSAGE_SECTION_SELECTOR) || []).filter((section) => {
      const parentSection = section.parentElement?.closest?.(MESSAGE_SECTION_SELECTOR);
      return !parentSection;
    });
  }

  function findNearestCommonRollingLiteAncestor(elements = []) {
    const candidates = elements.filter((element) => element instanceof Element && element.isConnected);
    if (!candidates.length) return null;
    let ancestor = candidates[0];
    while (ancestor && !candidates.every((element) => ancestor === element || ancestor.contains(element))) {
      ancestor = ancestor.parentElement;
    }
    return ancestor instanceof Element ? ancestor : null;
  }

  function findRollingLiteContentRoot(root = document) {
    const sections = getTopLevelRollingLiteMessageSections(root);
    if (!sections.length) return null;
    return findNearestCommonRollingLiteAncestor(
      sections.map((section) => section.parentElement || section)
    );
  }

  function findRollingLiteStableAnchor(contentRoot = null) {
    const main = getRollingLiteMain();
    if (!main) return null;
    if (contentRoot instanceof Element && main.contains(contentRoot)) {
      let directChild = contentRoot;
      while (directChild?.parentElement && directChild.parentElement !== main) {
        directChild = directChild.parentElement;
      }
      return directChild?.parentElement === main && directChild.getAttribute('role') === 'presentation'
        ? directChild
        : null;
    }
    const directCandidates = Array.from(main.children || []).filter(
      (element) => element.getAttribute?.('role') === 'presentation'
    );
    return directCandidates.length === 1 ? directCandidates[0] : null;
  }

  function getEffectiveLiteTurnCount(conversationId = tryExtractConversationIdFromUrl(window.location.href)) {
    if (
      conversationId
      && recentViewExpansionState?.conversationId === conversationId
      && Number.isFinite(Number(recentViewExpansionState?.turnCount))
    ) {
      return Math.max(
        getConfiguredLiteTurnCount(),
        Math.min(RECENT_VIEW_EXPANDED_TURN_COUNT_MAX, Math.floor(Number(recentViewExpansionState.turnCount)))
      );
    }
    return getConfiguredLiteTurnCount();
  }

  function setRecentViewExpansionState(conversationId, turnCount) {
    recentViewExpansionState = {
      conversationId: conversationId || null,
      turnCount: conversationId
        ? Math.max(
          getConfiguredLiteTurnCount(),
          Math.min(RECENT_VIEW_EXPANDED_TURN_COUNT_MAX, Math.floor(Number(turnCount)))
        )
        : null,
      requestedAt: conversationId ? Date.now() : null
    };
    writeRecentViewExpansionToStorage(recentViewExpansionState);
    return { ...recentViewExpansionState };
  }

  function clearRecentViewExpansionState() {
    return setRecentViewExpansionState(null, null);
  }

  function setPromptTocHiddenActive(active) {
    try {
      const root = document.documentElement;
      if (!root) return false;
      if (active) root.setAttribute(PROMPT_TOC_HIDE_ROOT_ATTR, 'true');
      else root.removeAttribute(PROMPT_TOC_HIDE_ROOT_ATTR);
      return true;
    } catch {
      return false;
    }
  }

  function installLiteDisplayStyles() {
    if (document.getElementById(LITE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = LITE_STYLE_ID;
    style.textContent = `
      #${LITE_BAR_ID} {
        position: sticky !important;
        top: 0 !important;
        z-index: 2147483000 !important;
        margin: 8px auto !important;
        max-width: min(920px, calc(100vw - 32px)) !important;
        box-sizing: border-box !important;
        display: flex !important;
        flex-wrap: wrap !important;
        align-items: center !important;
        gap: 6px !important;
        padding: 7px 9px !important;
        border: 1px solid rgba(80, 100, 120, 0.28) !important;
        border-radius: 10px !important;
        background: color-mix(in srgb, Canvas 90%, Highlight 10%) !important;
        color: CanvasText !important;
        font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        box-shadow: 0 4px 18px rgba(0,0,0,0.08) !important;
      }
      #${LITE_BAR_ID}[hidden] { display: none !important; }
      ${MESSAGE_SECTION_SELECTOR}[${ROLLING_HIDE_ATTR}="true"] { display: none !important; }
      :root[${PROMPT_TOC_HIDE_ROOT_ATTR}="true"] ${PROMPT_TOC_BUTTON_SELECTOR} {
        display: none !important;
      }
      .arcaia-message-time-badge {
        display: inline-block !important;
        width: fit-content !important;
        max-width: 100% !important;
        margin: 4px 0 0 !important;
        padding: 1px 6px !important;
        border-radius: 999px !important;
        opacity: 0.62 !important;
        font: 11px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        color: CanvasText !important;
        background: color-mix(in srgb, CanvasText 7%, transparent) !important;
        pointer-events: none !important;
      }
      .arcaia-message-time-badge.arcaia-message-time-provisional {
        opacity: 0.46 !important;
      }
      .arcaia-message-time-user,
      .arcaia-message-time-assistant {
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
      #${LITE_BAR_ID} .arcaia-lite-label { font-weight: 700 !important; margin-right: 2px !important; }
      #${LITE_BAR_ID} .arcaia-lite-note { opacity: 0.76 !important; }
      #${LITE_BAR_ID} button {
        border: 1px solid rgba(80, 100, 120, 0.28) !important;
        border-radius: 8px !important;
        background: color-mix(in srgb, CanvasText 7%, Canvas) !important;
        color: CanvasText !important;
        padding: 4px 8px !important;
        font: 12px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        cursor: pointer !important;
      }
      #${LITE_BAR_ID} button:hover { background: color-mix(in srgb, Highlight 14%, Canvas) !important; }
      #${LITE_BAR_ID} button[disabled] { cursor: wait !important; opacity: 0.55 !important; }
      #${RECENT_VIEW_HISTORY_CONTROLS_ID} {
        width: 100% !important;
        box-sizing: border-box !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        flex-wrap: wrap !important;
        gap: 6px !important;
        padding: 14px 12px 18px !important;
        color: color-mix(in srgb, CanvasText 68%, transparent) !important;
        font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }
      #${RECENT_VIEW_HISTORY_CONTROLS_ID} .arcaia-recent-view-history-label {
        margin-right: 2px !important;
      }
      #${RECENT_VIEW_HISTORY_CONTROLS_ID} button {
        appearance: none !important;
        border: 0 !important;
        padding: 2px 3px !important;
        background: transparent !important;
        color: color-mix(in srgb, LinkText 82%, CanvasText) !important;
        font: inherit !important;
        text-decoration: underline !important;
        text-underline-offset: 2px !important;
        cursor: pointer !important;
      }
      #${RECENT_VIEW_HISTORY_CONTROLS_ID} button:hover {
        color: LinkText !important;
      }
      #${RECENT_VIEW_HISTORY_CONTROLS_ID} button[disabled] {
        cursor: wait !important;
        opacity: 0.5 !important;
      }
      #${RECENT_VIEW_LOADING_OVERLAY_ID} {
        position: fixed !important;
        z-index: 2147483200 !important;
        display: grid !important;
        place-items: center !important;
        box-sizing: border-box !important;
        background: color-mix(in srgb, Canvas 84%, transparent) !important;
        backdrop-filter: blur(2px) !important;
        color: CanvasText !important;
        pointer-events: auto !important;
      }
      #${RECENT_VIEW_LOADING_OVERLAY_ID} .arcaia-recent-view-loading-message {
        padding: 9px 13px !important;
        border: 1px solid color-mix(in srgb, CanvasText 16%, transparent) !important;
        border-radius: 10px !important;
        background: color-mix(in srgb, Canvas 94%, CanvasText 6%) !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12) !important;
        font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }
      #${RECENT_VIEW_FAILURE_NOTICE_ID} {
        width: min(760px, calc(100% - 24px)) !important;
        box-sizing: border-box !important;
        margin: 10px auto 14px !important;
        padding: 9px 12px !important;
        border: 1px solid color-mix(in srgb, #a98b5b 36%, CanvasText 10%) !important;
        border-radius: 9px !important;
        background: color-mix(in srgb, Canvas 91%, #a98b5b 9%) !important;
        color: color-mix(in srgb, CanvasText 88%, #a98b5b 12%) !important;
        font: 12px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        text-align: center !important;
      }
      #${RECENT_VIEW_FAILURE_NOTICE_ID}[data-position="fixed"] {
        position: fixed !important;
        top: 72px !important;
        left: 50% !important;
        z-index: 2147483250 !important;
        transform: translateX(-50%) !important;
        margin: 0 !important;
        width: min(760px, calc(100vw - 32px)) !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getRollingLiteDomState() {
    return { ...rollingLiteState };
  }

  const LITE_DISPLAY_MAIN_CACHE_TTL_MS = 1500;
  let liteDisplayMainCache = { at: 0, conversationId: null, lite: null };

  function clearLiteDisplayMainCache(reason = 'clear') {
    liteDisplayMainCache = { at: 0, conversationId: null, lite: null, reason };
  }

  function shouldBypassLiteDisplayMainCache(reason = '') {
    const r = String(reason || '');
    return /manual|bar_|popup|toolbar|conversation_changed|url_changed|full|relite|off|reset/.test(r);
  }

  async function readCurrentLiteDisplayFromMain(timeoutMs = 1500, options = {}) {
    const reason = String(options?.reason || '');
    const conversationId = options?.conversationId || tryExtractConversationIdFromUrl(window.location.href);
    const now = Date.now();
    if (!options?.force && !shouldBypassLiteDisplayMainCache(reason)) {
      const cacheFresh = liteDisplayMainCache.lite
        && liteDisplayMainCache.conversationId === conversationId
        && now - Number(liteDisplayMainCache.at || 0) <= LITE_DISPLAY_MAIN_CACHE_TTL_MS;
      if (cacheFresh) return liteDisplayMainCache.lite;
    }
    const result = await getMainWorldLiteDisplayStatus(timeoutMs);
    const lite = result?.liteDisplay || result?.mainWorldHook?.liteDisplay || null;
    liteDisplayMainCache = { at: Date.now(), conversationId, lite, reason };
    return lite;
  }

  function getRecentViewRewriteSummary(lite, conversationId = tryExtractConversationIdFromUrl(window.location.href)) {
    const lastRewrite = lite?.liteDisplayLastRewrite || lite?.lastRewrite || null;
    const pathname = String(lastRewrite?.url?.pathname || '');
    const matchedConversationId = pathname.match(/\/backend-api\/conversation\/([^/?#]+)/)?.[1] || null;
    if (matchedConversationId && conversationId && matchedConversationId !== conversationId) return null;
    return lastRewrite?.summary || null;
  }

  function getFirstVisibleRecentViewSection() {
    return getTopLevelRollingLiteMessageSections(document).find((section) => (
      section?.isConnected
      && section.getAttribute(ROLLING_HIDE_ATTR) !== 'true'
      && section.style.display !== 'none'
    )) || null;
  }

  function removeRecentViewHistoryControls() {
    try { document.getElementById(RECENT_VIEW_HISTORY_CONTROLS_ID)?.remove?.(); } catch {}
  }

  function removeRecentViewFailureNotice() {
    if (recentViewFailureNoticeTimer) {
      clearTimeout(recentViewFailureNoticeTimer);
      recentViewFailureNoticeTimer = null;
    }
    try { document.getElementById(RECENT_VIEW_FAILURE_NOTICE_ID)?.remove?.(); } catch {}
  }

  function showRecentViewFailureNotice(message) {
    installLiteDisplayStyles();
    removeRecentViewFailureNotice();
    const notice = document.createElement('div');
    notice.id = RECENT_VIEW_FAILURE_NOTICE_ID;
    notice.setAttribute('role', 'alert');
    notice.setAttribute('aria-live', 'assertive');
    notice.textContent = String(message || '以前の履歴を表示できませんでした。');
    const firstVisibleSection = getFirstVisibleRecentViewSection();
    if (firstVisibleSection?.parentElement) {
      notice.dataset.position = 'conversation';
      firstVisibleSection.insertAdjacentElement('beforebegin', notice);
    } else {
      notice.dataset.position = 'fixed';
      (document.body || document.documentElement).appendChild(notice);
    }
    recentViewFailureNoticeTimer = setTimeout(() => {
      recentViewFailureNoticeTimer = null;
      try { notice.remove(); } catch {}
    }, 7000);
    return notice;
  }

  function showRecentViewHistoryActionFailure(conversationId) {
    const originalConversationVisible = Boolean(
      conversationId
      && tryExtractConversationIdFromUrl(window.location.href) === conversationId
    );
    return showRecentViewFailureNotice(
      originalConversationVisible
        ? '以前の履歴を表示できませんでした。元の会話を表示しています。'
        : '以前の履歴を表示できませんでした。左サイドバーから元の会話を開いてください。'
    );
  }

  function updateRecentViewHistoryControls(lite, summary = {}) {
    removeRecentViewHistoryControls();
    const conversationId = tryExtractConversationIdFromUrl(window.location.href);
    if (
      !conversationId
      || !lite?.enabled
      || !isArcaiaFeatureEnabled('liteView')
      || fullLoadModeState.active
      || recentViewRefreshState.active
      || isHistorySearchNavigationUrl()
    ) return null;

    const firstVisibleSection = getFirstVisibleRecentViewSection();
    if (!firstVisibleSection?.parentElement) return null;
    const targetTurnCount = getEffectiveLiteTurnCount(conversationId);
    const rewriteSummary = getRecentViewRewriteSummary(lite, conversationId);
    const totalTurnCountRaw = Number(rewriteSummary?.totalTurnCount);
    const totalTurnCount = Number.isFinite(totalTurnCountRaw) && totalTurnCountRaw > 0
      ? Math.floor(totalTurnCountRaw)
      : null;
    if (totalTurnCount == null) return null;
    const remainingTurnCount = Math.max(0, totalTurnCount - targetTurnCount);
    if (remainingTurnCount === 0) return null;
    const increment = targetTurnCount < RECENT_VIEW_EXPANDED_TURN_COUNT_MAX
      ? Math.min(RECENT_VIEW_EXPANSION_STEP, remainingTurnCount)
      : 0;

    const controls = document.createElement('div');
    controls.id = RECENT_VIEW_HISTORY_CONTROLS_ID;
    controls.setAttribute('role', 'navigation');
    controls.setAttribute('aria-label', 'Recent Viewの以前の履歴');
    controls.dataset.conversationId = conversationId;
    controls.dataset.currentTurnCount = String(targetTurnCount);
    controls.dataset.increment = String(increment);
    if (totalTurnCount != null) controls.dataset.totalTurnCount = String(totalTurnCount);

    const label = document.createElement('span');
    label.className = 'arcaia-recent-view-history-label';
    label.textContent = `以前の履歴（残り${remainingTurnCount}件）:`;
    controls.appendChild(label);

    if (increment > 0) {
      const expandButton = document.createElement('button');
      expandButton.type = 'button';
      expandButton.dataset.action = 'expand';
      expandButton.textContent = `さらに${increment}件表示`;
      controls.appendChild(expandButton);

      const separator = document.createElement('span');
      separator.textContent = '・';
      separator.setAttribute('aria-hidden', 'true');
      controls.appendChild(separator);
    }

    const fullButton = document.createElement('button');
    fullButton.type = 'button';
    fullButton.dataset.action = 'full';
    fullButton.textContent = '全部表示';
    controls.appendChild(fullButton);

    controls.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
      if (!(button instanceof HTMLButtonElement) || !controls.contains(button)) return;
      event.preventDefault();
      handleRecentViewHistoryControlAction(button.dataset.action, controls).catch((error) => {
        rollingLiteState.lastError = error instanceof Error ? error.message : String(error);
      });
    });
    firstVisibleSection.insertAdjacentElement('beforebegin', controls);
    return controls;
  }

  function updateLiteBar(lite, summary = {}) {
    try { document.getElementById(LITE_BAR_ID)?.remove?.(); } catch {}
    updateRecentViewHistoryControls(lite, summary);
  }

  function getVisibleDomTurnsFromConversation() {
    return buildDomTurnsFromConversation().filter((turn) => {
      const containers = turn?.containers || [];
      return containers.some((container) => container?.isConnected && container.getAttribute(ROLLING_HIDE_ATTR) !== 'true' && container.style.display !== 'none');
    });
  }

  function clearObsoleteRestoredHistoryElements() {
    try { document.getElementById(LEGACY_RESTORED_HISTORY_ID)?.remove?.(); } catch {}
    try { document.getElementById(LEGACY_NATIVE_SNAPSHOT_IFRAME_ID)?.remove?.(); } catch {}
    try { document.documentElement?.removeAttribute?.('data-arcaia-native-snapshot-capture'); } catch {}
  }

  async function loadFullConversationInPlace(reason = 'manual_load_full', options = {}) {
    return runRecentViewSpaRoundTrip({
      mode: 'full',
      reason,
      disableLite: Boolean(options.disableLite)
    });
  }

  function getRecentViewRoutePath(value = window.location.href) {
    try { return new URL(String(value || ''), window.location.origin).pathname; }
    catch { return window.location.pathname || '/'; }
  }

  function getRecentViewAnchorRoutePath(anchor) {
    try { return new URL(anchor?.href || anchor?.getAttribute?.('href') || '', window.location.origin).pathname; }
    catch { return null; }
  }

  function findRecentViewNativeNewChatControl() {
    const direct = document.querySelector('[data-testid="create-new-chat-button"]');
    const directClickable = direct?.closest?.('a, button') || direct;
    if (directClickable instanceof HTMLElement && directClickable.isConnected) return directClickable;
    return Array.from(document.querySelectorAll('a[href], button')).find((element) => {
      if (!(element instanceof HTMLElement) || !element.isConnected || element.closest('main')) return false;
      const label = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.trim().toLowerCase();
      if (element instanceof HTMLAnchorElement && getRecentViewAnchorRoutePath(element) === '/') {
        return /new chat|新しいチャット/.test(label);
      }
      return /new chat|新しいチャット/.test(label);
    }) || null;
  }

  function isRecentViewConversationLinkForTarget(anchor, targetRoutePath, conversationId) {
    if (!(anchor instanceof HTMLAnchorElement) || !anchor.isConnected || anchor.closest('main')) return false;
    const routePath = getRecentViewAnchorRoutePath(anchor);
    if (!routePath) return false;
    if (routePath === targetRoutePath) return true;
    return Boolean(conversationId && routePath.endsWith(`/c/${conversationId}`));
  }

  function findRecentViewNativeConversationLink(targetRoutePath, conversationId) {
    return Array.from(document.querySelectorAll('a[href]')).find((anchor) => (
      isRecentViewConversationLinkForTarget(anchor, targetRoutePath, conversationId)
    )) || null;
  }

  function clickRecentViewNativeControl(control, failureCode) {
    if (!(control instanceof HTMLElement) || !control.isConnected) throw new Error(failureCode);
    control.click();
    return true;
  }

  function waitForRecentViewRefreshCondition(check, label, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let observer = null;
      let timer = null;
      const cleanup = () => {
        try { observer?.disconnect?.(); } catch {}
        observer = null;
        if (timer) clearTimeout(timer);
        timer = null;
        window.removeEventListener('message', onSignal);
        window.removeEventListener('popstate', onSignal);
        window.removeEventListener('hashchange', onSignal);
        recentViewRefreshConditionSignals.delete(onSignal);
      };
      const finish = (ok, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (ok) resolve(value);
        else reject(value);
      };
      const evaluate = () => {
        if (settled) return;
        try {
          const value = check();
          if (value) finish(true, value);
        } catch (error) {
          finish(false, error);
        }
      };
      function onSignal() {
        queueMicrotask(evaluate);
      }
      const target = document.documentElement;
      if (target instanceof Element) {
        observer = new MutationObserver(onSignal);
        observer.observe(target, { childList: true, subtree: true });
      }
      window.addEventListener('message', onSignal);
      window.addEventListener('popstate', onSignal);
      window.addEventListener('hashchange', onSignal);
      recentViewRefreshConditionSignals.add(onSignal);
      timer = setTimeout(() => finish(false, new Error(`recent_view_spa_refresh_timeout:${label}`)), timeoutMs);
      evaluate();
    });
  }

  function showRecentViewLoadingOverlay(message = '履歴を読み込み中…') {
    installLiteDisplayStyles();
    document.getElementById(RECENT_VIEW_LOADING_OVERLAY_ID)?.remove?.();
    const overlay = document.createElement('div');
    overlay.id = RECENT_VIEW_LOADING_OVERLAY_ID;
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    const label = document.createElement('div');
    label.className = 'arcaia-recent-view-loading-message';
    label.textContent = message;
    overlay.appendChild(label);
    const updateBounds = () => {
      const main = getRollingLiteMain();
      const rect = main?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) {
        overlay.style.left = `${Math.max(0, rect.left)}px`;
        overlay.style.top = `${Math.max(0, rect.top)}px`;
        overlay.style.width = `${Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left))}px`;
        overlay.style.height = `${Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top))}px`;
      } else {
        overlay.style.inset = '0';
      }
    };
    overlay.__arcaiaUpdateBounds = updateBounds;
    window.addEventListener('resize', updateBounds);
    (document.body || document.documentElement).appendChild(overlay);
    updateBounds();
    return overlay;
  }

  function updateRecentViewLoadingOverlay(overlay, message) {
    const label = overlay?.querySelector?.('.arcaia-recent-view-loading-message');
    if (label) label.textContent = message;
  }

  function removeRecentViewLoadingOverlay(overlay = document.getElementById(RECENT_VIEW_LOADING_OVERLAY_ID)) {
    if (!overlay) return;
    try { window.removeEventListener('resize', overlay.__arcaiaUpdateBounds); } catch {}
    try { overlay.remove(); } catch {}
  }

  function findRecentViewScrollContainer(section) {
    let current = section?.parentElement || null;
    while (current && current !== document.body && current !== document.documentElement) {
      try {
        const style = window.getComputedStyle(current);
        if (/auto|scroll/.test(style.overflowY || '') && current.scrollHeight > current.clientHeight + 4) return current;
      } catch {}
      current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function captureRecentViewScrollAnchor() {
    const section = getFirstVisibleRecentViewSection();
    if (!section) return null;
    return {
      messageId: getSectionMessageId(section),
      dataTestId: section.getAttribute('data-testid') || null,
      viewportTop: section.getBoundingClientRect().top,
      scrollContainer: findRecentViewScrollContainer(section)
    };
  }

  function findRecentViewScrollAnchorSection(anchor) {
    if (!anchor) return null;
    return getTopLevelRollingLiteMessageSections(document).find((section) => {
      if (anchor.messageId && getSectionMessageId(section) === anchor.messageId) return true;
      return Boolean(anchor.dataTestId && section.getAttribute('data-testid') === anchor.dataTestId);
    }) || null;
  }

  async function restoreRecentViewScrollAnchor(anchor) {
    if (!anchor) return false;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const section = findRecentViewScrollAnchorSection(anchor);
    if (!section) return false;
    const delta = section.getBoundingClientRect().top - Number(anchor.viewportTop || 0);
    if (!Number.isFinite(delta) || Math.abs(delta) < 1) return true;
    const scrollContainer = anchor.scrollContainer?.isConnected
      ? anchor.scrollContainer
      : findRecentViewScrollContainer(section);
    if (scrollContainer === document.scrollingElement || scrollContainer === document.documentElement || scrollContainer === document.body) {
      window.scrollBy(0, delta);
    } else {
      scrollContainer.scrollTop += delta;
    }
    return true;
  }

  async function resetRecentViewMainWorldOverride(reason = 'recent_view_override_reset') {
    return setMainWorldLiteDisplayConfig({
      turnCount: getConfiguredLiteTurnCount(),
      clearTurnCountOverride: true,
      clearFullLoadMode: true,
      requestedBy: reason
    }, 3000);
  }

  async function runRecentViewSpaRoundTrip({ mode, requestedTurnCount = null, reason = 'recent_view_history_action', disableLite = false } = {}) {
    if (recentViewRefreshState.active) throw new Error('recent_view_spa_refresh_already_active');
    const conversationId = tryExtractConversationIdFromUrl(window.location.href);
    if (!conversationId) throw new Error('conversation_id_not_found');
    if (mode !== 'expand' && mode !== 'full') throw new Error('recent_view_spa_refresh_mode_invalid');
    const targetRoutePath = getRecentViewRoutePath();
    const sourceContentRoot = findRollingLiteContentRoot();
    const sourceConversationLink = findRecentViewNativeConversationLink(targetRoutePath, conversationId);
    const newChatControl = findRecentViewNativeNewChatControl();
    if (!newChatControl) throw new Error('recent_view_native_new_chat_control_not_found');
    const scrollAnchor = captureRecentViewScrollAnchor();
    const previousExpansionState = { ...recentViewExpansionState };
    const previousFullLoadModeState = { ...fullLoadModeState };
    const overlay = showRecentViewLoadingOverlay(mode === 'full' ? '全履歴を読み込み中…' : '以前の履歴を読み込み中…');
    let mainWorldResult = null;

    recentViewRefreshState = {
      active: true,
      conversationId,
      mode,
      requestedTurnCount: mode === 'expand' ? requestedTurnCount : null,
      startedAt: Date.now(),
      sourceContentRoot,
      sourceRoutePath: targetRoutePath
    };
    removeRecentViewHistoryControls();

    try {
      clickRecentViewNativeControl(newChatControl, 'recent_view_native_new_chat_control_disconnected');
      await waitForRecentViewRefreshCondition(() => (
        !tryExtractConversationIdFromUrl(window.location.href)
        && !findRollingLiteContentRoot()
        && observedPageConversationId == null
        && !pageConversationSyncInFlight
      ), 'new_chat_ready', 15000);

      if (mode === 'expand') {
        const targetTurnCount = Math.max(
          getConfiguredLiteTurnCount(),
          Math.min(RECENT_VIEW_EXPANDED_TURN_COUNT_MAX, Math.floor(Number(requestedTurnCount)))
        );
        if (!Number.isFinite(targetTurnCount)) throw new Error('recent_view_requested_turn_count_invalid');
        setRecentViewExpansionState(conversationId, targetTurnCount);
        fullLoadModeState = { active: false, conversationId: null, requestedAt: null, reason: 'recent_view_expand' };
        writeFullLoadModeToStorage(fullLoadModeState);
        mainWorldResult = await setMainWorldLiteDisplayConfig({
          enabled: true,
          turnCountOverride: targetTurnCount,
          turnCountOverrideConversationId: conversationId,
          clearFullLoadMode: true,
          requestedBy: reason
        }, 3000);
      } else {
        clearRecentViewExpansionState();
        await resetRecentViewMainWorldOverride('recent_view_full_reset_override');
        fullLoadModeState = { active: true, conversationId, requestedAt: Date.now(), reason };
        writeFullLoadModeToStorage(fullLoadModeState);
        mainWorldResult = await requestMainWorldFullLoadOnce({
          conversationId,
          expiresMs: 90000,
          reason
        }, 3000);
      }
      if (!mainWorldResult) throw new Error('recent_view_main_world_config_no_response');

      updateRecentViewLoadingOverlay(overlay, mode === 'full' ? '全履歴を描画中…' : '以前の履歴を描画中…');
      const targetLink = sourceConversationLink?.isConnected
        && isRecentViewConversationLinkForTarget(sourceConversationLink, targetRoutePath, conversationId)
        ? sourceConversationLink
        : findRecentViewNativeConversationLink(targetRoutePath, conversationId);
      if (!targetLink) throw new Error('recent_view_native_conversation_link_not_found');
      clickRecentViewNativeControl(targetLink, 'recent_view_native_conversation_link_disconnected');

      const reboundContentRoot = await waitForRecentViewRefreshCondition(() => {
        if (tryExtractConversationIdFromUrl(window.location.href) !== conversationId) return null;
        if (observedPageConversationId !== conversationId || pageConversationSyncInFlight) return null;
        const contentRoot = findRollingLiteContentRoot();
        if (!contentRoot || contentRoot === sourceContentRoot) return null;
        if (!getTopLevelRollingLiteMessageSections(contentRoot).length) return null;
        return contentRoot;
      }, 'conversation_content_root_rebound', 30000);

      clearLiteDisplayMainCache('recent_view_spa_round_trip_complete');
      refreshConversationDomObserverBindings('recent_view_spa_round_trip_complete');
      syncHeaderMarkdownButtonUi('recent_view_spa_round_trip_complete');
      await applyRollingLiteDom('recent_view_spa_round_trip_complete');
      await restoreRecentViewScrollAnchor(scrollAnchor);
      const refresh = {
        ok: true,
        appVersion: APP_VERSION,
        action: 'content_refresh',
        strategy: 'native_new_chat_round_trip',
        reason,
        mode,
        conversationId,
        requestedTurnCount: mode === 'expand' ? getEffectiveLiteTurnCount(conversationId) : 'all',
        contentRootReplaced: reboundContentRoot !== sourceContentRoot,
        disableLite
      };
      rollingLiteState = {
        ...rollingLiteState,
        lastContentRefresh: refresh,
        lastSkipReason: mode === 'full' ? 'full_load_mode_active' : rollingLiteState.lastSkipReason
      };
      return {
        ok: true,
        appVersion: APP_VERSION,
        action: mode === 'full' ? 'load_full_conversation_in_place' : 'expand_recent_view_in_place',
        conversationId,
        reason,
        mainWorldResult,
        refresh
      };
    } catch (error) {
      recentViewExpansionState = previousExpansionState;
      writeRecentViewExpansionToStorage(recentViewExpansionState);
      fullLoadModeState = previousFullLoadModeState;
      writeFullLoadModeToStorage(fullLoadModeState);
      await setMainWorldLiteDisplayConfig({
        turnCount: getConfiguredLiteTurnCount(),
        turnCountOverride: previousExpansionState?.turnCount || null,
        turnCountOverrideConversationId: previousExpansionState?.conversationId || null,
        clearTurnCountOverride: !previousExpansionState?.conversationId,
        clearFullLoadMode: true,
        requestedBy: 'recent_view_spa_round_trip_rollback'
      }, 3000).catch(() => null);
      if (tryExtractConversationIdFromUrl(window.location.href) !== conversationId) {
        const recoveryLink = sourceConversationLink?.isConnected
          && isRecentViewConversationLinkForTarget(sourceConversationLink, targetRoutePath, conversationId)
          ? sourceConversationLink
          : findRecentViewNativeConversationLink(targetRoutePath, conversationId);
        if (recoveryLink) {
          try {
            clickRecentViewNativeControl(recoveryLink, 'recent_view_recovery_conversation_link_disconnected');
            await waitForRecentViewRefreshCondition(() => (
              tryExtractConversationIdFromUrl(window.location.href) === conversationId
              && Boolean(findRollingLiteContentRoot())
            ), 'rollback_return_to_conversation', 15000);
          } catch {}
        }
      }
      throw error;
    } finally {
      recentViewRefreshState = {
        active: false,
        conversationId: null,
        mode: null,
        requestedTurnCount: null,
        startedAt: null,
        sourceContentRoot: null,
        sourceRoutePath: null
      };
      removeRecentViewLoadingOverlay(overlay);
      if (tryExtractConversationIdFromUrl(window.location.href) === conversationId) {
        scheduleRollingLiteApply('recent_view_spa_round_trip_finalized');
      }
    }
  }

  async function handleRecentViewHistoryControlAction(action, controls) {
    if (!controls?.isConnected) return null;
    const conversationId = controls.dataset.conversationId || tryExtractConversationIdFromUrl(window.location.href);
    for (const button of controls.querySelectorAll('button')) button.disabled = true;
    try {
      if (action === 'full') {
        return await loadFullConversationInPlace('recent_view_history_full', { disableLite: true });
      }
      if (action !== 'expand') throw new Error('recent_view_history_action_invalid');
      const currentTurnCount = Math.max(
        getConfiguredLiteTurnCount(),
        Math.floor(Number(controls.dataset.currentTurnCount || getEffectiveLiteTurnCount()))
      );
      const increment = Math.max(1, Math.floor(Number(controls.dataset.increment || RECENT_VIEW_EXPANSION_STEP)));
      const totalTurnCountRaw = Number(controls.dataset.totalTurnCount);
      const totalTurnCount = Number.isFinite(totalTurnCountRaw) && totalTurnCountRaw > 0
        ? Math.floor(totalTurnCountRaw)
        : RECENT_VIEW_EXPANDED_TURN_COUNT_MAX;
      const requestedTurnCount = Math.min(
        RECENT_VIEW_EXPANDED_TURN_COUNT_MAX,
        totalTurnCount,
        currentTurnCount + increment
      );
      return await runRecentViewSpaRoundTrip({
        mode: 'expand',
        requestedTurnCount,
        reason: 'recent_view_history_expand'
      });
    } catch (error) {
      rollingLiteState.lastError = error instanceof Error ? error.message : String(error);
      showRecentViewHistoryActionFailure(conversationId);
      return {
        ok: false,
        appVersion: APP_VERSION,
        action: 'recent_view_history_action_failed',
        conversationId,
        requestedAction: action,
        error: rollingLiteState.lastError
      };
    } finally {
      if (controls?.isConnected) {
        for (const button of controls.querySelectorAll('button')) button.disabled = false;
      }
    }
  }

  function getLiteMessageContainer(roleElement) {
    if (!roleElement) return null;
    const candidates = [
      roleElement.closest(MESSAGE_SECTION_SELECTOR),
      roleElement.closest('article'),
      roleElement.closest('[data-message-id]'),
      roleElement.closest('[data-message-author-role]')
    ].filter(Boolean);
    return candidates[0] || roleElement;
  }

  function isTopLevelMessageSection(section) {
    if (!section?.matches?.(MESSAGE_SECTION_SELECTOR)) return false;
    const parentSection = section.parentElement?.closest?.(MESSAGE_SECTION_SELECTOR);
    return !parentSection;
  }

  function getSectionOwnedRoleNodes(section) {
    if (!section?.querySelectorAll) return [];
    return Array.from(section.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'))
      .filter((node) => node?.isConnected && node.closest?.(MESSAGE_SECTION_SELECTOR) === section);
  }

  function getSectionMessageId(section) {
    if (!section) return null;
    const own = section.getAttribute?.('data-message-id');
    if (own) return own;
    const node = Array.from(section.querySelectorAll?.('[data-message-id]') || [])
      .find((candidate) => candidate.closest?.(MESSAGE_SECTION_SELECTOR) === section);
    return node?.getAttribute?.('data-message-id') || null;
  }

  function collectMessageSectionModel(root = document) {
    const queryRoot = root?.querySelectorAll ? root : document;
    const physicalRecords = Array.from(queryRoot.querySelectorAll(MESSAGE_SECTION_SELECTOR))
      .filter((section) => section?.isConnected && !section.closest?.(`#${LITE_BAR_ID}`) && isTopLevelMessageSection(section))
      .map((section, domIndex) => {
        const roleNodes = getSectionOwnedRoleNodes(section);
        const roles = roleNodes.map((node) => node.getAttribute('data-message-author-role')).filter(Boolean);
        const role = roles[0] === 'user' || roles[0] === 'assistant' ? roles[0] : null;
        const messageId = getSectionMessageId(section);
        const dataTestId = section.getAttribute?.('data-testid') || null;
        const stableKey = messageId ? `message:${messageId}` : (dataTestId ? `testid:${dataTestId}` : null);
        const trimmedTextLength = String(section.textContent || '').trim().length;
        const meaningful = trimmedTextLength > 0 || roleNodes.length > 0;
        return {
          section,
          domIndex,
          role,
          roles,
          roleNodeCount: roleNodes.length,
          messageId,
          dataTestId,
          stableKey,
          trimmedTextLength,
          meaningful,
          duplicate: false,
          duplicateOfDomIndex: null,
          groupIndex: null,
          retained: false,
          hiddenPlanned: false,
          groupKind: null
        };
      });

    const lastIndexByStableKey = new Map();
    physicalRecords.forEach((record, index) => {
      if (record.stableKey) lastIndexByStableKey.set(record.stableKey, index);
    });
    physicalRecords.forEach((record, index) => {
      if (!record.stableKey) return;
      const canonicalIndex = lastIndexByStableKey.get(record.stableKey);
      if (canonicalIndex !== index) {
        record.duplicate = true;
        record.duplicateOfDomIndex = physicalRecords[canonicalIndex]?.domIndex ?? null;
      }
    });

    // v0.1.60: diagnostics group every top-level conversation-turn section, while Lite
    // retention itself uses DOM-ordered user-started groups so native Lite keeps 3 turns.
    // sections that currently expose a data-message-author-role node. ChatGPT often keeps
    // roleless section shells/chunks in DOM; leaving them out made older content remain visible.
    const records = physicalRecords.filter((record) => !record.duplicate);
    const roleRecords = records.filter((record) => record.role === 'user' || record.role === 'assistant');
    const roleSequence = roleRecords.map((record) => record.role).filter(Boolean);
    let consecutiveUserCount = 0;
    let consecutiveAssistantCount = 0;
    for (let i = 1; i < roleSequence.length; i += 1) {
      if (roleSequence[i] === 'user' && roleSequence[i - 1] === 'user') consecutiveUserCount += 1;
      if (roleSequence[i] === 'assistant' && roleSequence[i - 1] === 'assistant') consecutiveAssistantCount += 1;
    }

    return {
      physicalRecords,
      records,
      roleRecords,
      messageSectionCount: physicalRecords.length,
      canonicalSectionCount: records.length,
      rolelessSectionCount: records.filter((record) => !record.role).length,
      meaningfulSectionCount: records.filter((record) => record.meaningful).length,
      emptySectionCount: records.filter((record) => !record.meaningful).length,
      roleNodeCount: physicalRecords.reduce((sum, record) => sum + record.roleNodeCount, 0),
      userSectionCount: roleRecords.filter((record) => record.role === 'user').length,
      assistantSectionCount: roleRecords.filter((record) => record.role === 'assistant').length,
      duplicateSectionCount: physicalRecords.filter((record) => record.duplicate).length,
      consecutiveUserCount,
      consecutiveAssistantCount
    };
  }

  function buildUserStartedGroupsFromSectionRecords(records = []) {
    const groups = [];
    let current = null;
    for (const record of records) {
      if (record.duplicate) continue;
      if (record.role === 'user') {
        current = {
          kind: 'user_started',
          records: [record],
          hasUser: true,
          hasAssistant: false,
          hasRoleless: false
        };
        groups.push(current);
        continue;
      }
      if (!current) {
        current = {
          kind: record.role === 'assistant' ? 'assistant_only_fallback' : 'roleless_prefix_fallback',
          records: [],
          hasUser: false,
          hasAssistant: false,
          hasRoleless: false
        };
        groups.push(current);
      }
      current.records.push(record);
      if (record.role === 'assistant') current.hasAssistant = true;
      if (!record.role) current.hasRoleless = true;
    }
    groups.forEach((group, index) => {
      group.groupIndex = index;
      for (const record of group.records) {
        record.groupIndex = index;
        record.groupKind = group.kind;
      }
    });
    return groups.filter((group) => group.records.length > 0);
  }

  function buildLiteGroupingPlan(root = document, retainTurnCount = NATIVE_LITE_TURN_COUNT, generating = false) {
    const model = collectMessageSectionModel(root);
    const groups = buildUserStartedGroupsFromSectionRecords(model.records);
    const userStartedGroups = groups.filter((group) => group.kind === 'user_started');
    const meaningfulRecords = model.records.filter((record) => record.meaningful);
    const emptyRecords = model.records.filter((record) => !record.meaningful);
    const retainedSections = new Set();
    const retainedUserStartedGroups = userStartedGroups.slice(-retainTurnCount);
    let fallbackUsed = false;
    let fallbackReason = null;

    if (retainedUserStartedGroups.length) {
      for (const group of retainedUserStartedGroups) {
        for (const record of group.records || []) {
          if (record.meaningful) retainedSections.add(record.section);
        }
      }
      if (userStartedGroups.length < retainTurnCount) {
        fallbackUsed = true;
        fallbackReason = 'fewer_than_target_user_started_turns';
      }
    } else {
      for (const record of meaningfulRecords.slice(-retainTurnCount)) retainedSections.add(record.section);
      fallbackUsed = true;
      fallbackReason = meaningfulRecords.length
        ? 'no_user_started_turns_fallback_to_latest_meaningful_sections'
        : (model.records.length ? 'no_meaningful_sections' : 'no_message_sections');
    }

    const latestAssistant = [...model.roleRecords].reverse().find((record) => record.role === 'assistant');
    if (latestAssistant && !retainedSections.has(latestAssistant.section)) {
      retainedSections.add(latestAssistant.section);
      fallbackUsed = true;
      fallbackReason = fallbackReason
        ? `${fallbackReason}+latest_assistant_protected`
        : 'latest_assistant_protected_outside_window';
    }

    const latestRecord = model.records[model.records.length - 1] || null;
    if (generating && latestRecord && !latestRecord.meaningful && !retainedSections.has(latestRecord.section)) {
      retainedSections.add(latestRecord.section);
      fallbackUsed = true;
      fallbackReason = fallbackReason
        ? `${fallbackReason}+generating_latest_empty_shell_protected`
        : 'generating_latest_empty_shell_protected';
    }
    if (generating) {
      const maxRetainedSectionsDuringGeneration = Math.max(1, retainTurnCount * 2 + 1);
      if (retainedSections.size > maxRetainedSectionsDuringGeneration) {
        const removable = model.records.filter((record) =>
          retainedSections.has(record.section)
          && record !== latestAssistant
          && record !== latestRecord
        );
        while (retainedSections.size > maxRetainedSectionsDuringGeneration && removable.length) {
          retainedSections.delete(removable.shift().section);
        }
        fallbackReason = fallbackReason
          ? `${fallbackReason}+generation_retention_capped`
          : 'generation_retention_capped';
      }
    }

    const hiddenSections = new Set();
    for (const record of model.physicalRecords) {
      const shouldHide = record.duplicate || !retainedSections.has(record.section);
      record.retained = !shouldHide;
      record.hiddenPlanned = shouldHide;
      if (shouldHide) hiddenSections.add(record.section);
    }
    const retainedGroups = groups.filter((group) => group.records.some((record) => retainedSections.has(record.section)));

    return {
      strategy: LITE_GROUPING_STRATEGY,
      liteRetainMode: LITE_RETAIN_MODE,
      targetRetainedTurnCount: retainTurnCount,
      targetRetainedSectionCount: retainTurnCount * 2,
      model,
      groups,
      userStartedGroups,
      retainedUserStartedGroups,
      retainedGroups,
      meaningfulRecords,
      emptyRecords,
      retainedSections,
      hiddenSections,
      fallbackUsed,
      fallbackReason,
      assistantOnlyGroupCount: groups.filter((group) => group.kind === 'assistant_only_fallback').length,
      rolelessPrefixGroupCount: groups.filter((group) => group.kind === 'roleless_prefix_fallback').length,
      latestAssistant
    };
  }

  function shouldNoopLiteForShortConversation(plan, retainTurnCount = NATIVE_LITE_TURN_COUNT) {
    const hiddenCount = Number(plan?.hiddenSections?.size || 0);
    if (hiddenCount > 0) return false;
    const userStartedCount = Array.isArray(plan?.userStartedGroups) ? plan.userStartedGroups.length : 0;
    const groupCount = Array.isArray(plan?.groups) ? plan.groups.length : 0;
    const effectiveTurnCount = userStartedCount || groupCount;
    if (effectiveTurnCount <= 0) return false;
    return effectiveTurnCount <= retainTurnCount;
  }

  function buildDomTurnsFromConversation(root = document) {
    const plan = buildLiteGroupingPlan(root, NATIVE_LITE_TURN_COUNT, false);
    return plan.groups.map((group) => ({
      containers: group.records.map((record) => record.section),
      hasUser: group.hasUser,
      hasAssistant: group.hasAssistant,
      kind: group.kind
    }));
  }

  function getLiteGroupingDiagnostics(plan, reconcileResult = null) {
    const physicalRecords = plan?.model?.physicalRecords || [];
    const retainedRecords = physicalRecords
      .filter((record) => plan.retainedSections.has(record.section) && !record.duplicate);
    const hiddenRecords = physicalRecords
      .filter((record) => plan.hiddenSections.has(record.section));
    const rolelessRecords = physicalRecords.filter((record) => !record.role && !record.duplicate);
    const hiddenRolelessRecords = hiddenRecords.filter((record) => !record.role && !record.duplicate);
    const retainedRolelessRecords = retainedRecords.filter((record) => !record.role && !record.duplicate);
    const meaningfulRecords = physicalRecords.filter((record) => record.meaningful && !record.duplicate);
    const retainedMeaningfulRecords = retainedRecords.filter((record) => record.meaningful);
    const emptyRecords = physicalRecords.filter((record) => !record.meaningful && !record.duplicate);
    const retainedEmptyRecords = retainedRecords.filter((record) => !record.meaningful);
    return {
      liteRetainMode: plan?.liteRetainMode || LITE_RETAIN_MODE,
      targetRetainedTurnCount: plan?.targetRetainedTurnCount || NATIVE_LITE_TURN_COUNT,
      targetRetainedSectionCount: plan?.targetRetainedSectionCount || NATIVE_LITE_TURN_COUNT * 2,
      liteGroupingStrategy: plan?.strategy || LITE_GROUPING_STRATEGY,
      messageSectionCount: plan?.model?.messageSectionCount || 0,
      canonicalSectionCount: plan?.model?.canonicalSectionCount || 0,
      roleNodeCount: plan?.model?.roleNodeCount || 0,
      userSectionCount: plan?.model?.userSectionCount || 0,
      assistantSectionCount: plan?.model?.assistantSectionCount || 0,
      rolelessSectionCount: rolelessRecords.length,
      retainedGroupCount: plan?.retainedGroups?.length || 0,
      retainedUserStartedTurnCount: plan?.retainedUserStartedGroups?.length || 0,
      meaningfulSectionCount: meaningfulRecords.length,
      retainedMeaningfulSectionCount: retainedMeaningfulRecords.length,
      retainedSectionCount: retainedRecords.length,
      emptySectionCount: emptyRecords.length,
      retainedEmptySectionCount: retainedEmptyRecords.length,
      retainedRolelessSectionCount: retainedRolelessRecords.length,
      hiddenSectionCount: hiddenRecords.length,
      hiddenRolelessSectionCount: hiddenRolelessRecords.length,
      prunedSectionCount: reconcileResult?.prunedSectionCount ?? reconcileResult?.removedSectionCount ?? 0,
      arcaiaHiddenSectionCount: reconcileResult?.arcaiaHiddenSectionCount
        ?? document.querySelectorAll(`${MESSAGE_SECTION_SELECTOR}[${ROLLING_HIDE_ATTR}="true"]`).length,
      duplicateSectionCount: plan?.model?.duplicateSectionCount || 0,
      consecutiveUserCount: plan?.model?.consecutiveUserCount || 0,
      consecutiveAssistantCount: plan?.model?.consecutiveAssistantCount || 0,
      assistantOnlyGroupCount: plan?.assistantOnlyGroupCount || 0,
      rolelessPrefixGroupCount: plan?.rolelessPrefixGroupCount || 0,
      fallbackUsed: Boolean(plan?.fallbackUsed),
      fallbackReason: plan?.fallbackReason || null
    };
  }

  function unhideRollingLiteContainers() {
    // Default Lite uses CSS hide instead of hard delete when backend rewrite is unavailable.
    // This keeps ChatGPT-owned message sections in the DOM so React can reconcile them safely.
    const hidden = Array.from(document.querySelectorAll(
      `[${ROLLING_HIDE_ATTR}="true"], [${ROLLING_PRUNE_MODE_ATTR}="css_hide"], [${ROLLING_ORIGINAL_DISPLAY_ATTR}]`
    ));
    for (const el of hidden) {
      unhideRollingLiteContainer(el);
    }
  }

  function unhideRollingLiteContainer(el) {
    if (!el) return false;
    const original = el.getAttribute?.(ROLLING_ORIGINAL_DISPLAY_ATTR);
    if (el.style) el.style.display = original || '';
    el.removeAttribute?.(ROLLING_HIDE_ATTR);
    el.removeAttribute?.(ROLLING_ORIGINAL_DISPLAY_ATTR);
    el.removeAttribute?.(ROLLING_PRUNE_MODE_ATTR);
    return true;
  }

  function hideRollingLiteContainer(el) {
    if (!el || !el.isConnected || el.id === LITE_BAR_ID || !isTopLevelMessageSection(el)) return false;
    try {
      const originalDisplay = el.getAttribute?.(ROLLING_ORIGINAL_DISPLAY_ATTR);
      if (originalDisplay == null) el.setAttribute?.(ROLLING_ORIGINAL_DISPLAY_ATTR, el.style?.display || '');
      el.setAttribute?.(ROLLING_HIDE_ATTR, 'true');
      el.setAttribute?.(ROLLING_PRUNE_MODE_ATTR, 'css_hide');
      if (el.style) el.style.display = 'none';
      return true;
    } catch {}
    return false;
  }

  function reconcileRollingLiteSections(plan) {
    const desiredHidden = plan?.hiddenSections || new Set();
    const currentSections = new Set((plan?.model?.physicalRecords || []).map((record) => record.section));
    const previouslyHidden = Array.from(document.querySelectorAll(
      `[${ROLLING_HIDE_ATTR}="true"], [${ROLLING_PRUNE_MODE_ATTR}="css_hide"], [${ROLLING_ORIGINAL_DISPLAY_ATTR}]`
    ));
    let staleHiddenCleanupCount = 0;
    let newlyHiddenSectionCount = 0;
    let newlyUnhiddenSectionCount = 0;
    let removedSectionCount = 0;

    for (const element of previouslyHidden) {
      if (!currentSections.has(element) || !desiredHidden.has(element)) {
        if (unhideRollingLiteContainer(element)) {
          staleHiddenCleanupCount += 1;
          newlyUnhiddenSectionCount += 1;
        }
      }
    }

    for (const record of plan?.model?.physicalRecords || []) {
      const section = record.section;
      if (desiredHidden.has(section)) {
        if (hideRollingLiteContainer(section)) {
          newlyHiddenSectionCount += 1;
        }
      } else if (
        section.getAttribute?.(ROLLING_HIDE_ATTR) === 'true'
        || section.getAttribute?.(ROLLING_PRUNE_MODE_ATTR) === 'css_hide'
        || section.hasAttribute?.(ROLLING_ORIGINAL_DISPLAY_ATTR)
      ) {
        if (unhideRollingLiteContainer(section)) newlyUnhiddenSectionCount += 1;
      }
    }

    return {
      newlyHiddenSectionCount,
      newlyUnhiddenSectionCount,
      staleHiddenCleanupCount,
      removedSectionCount,
      prunedSectionCount: removedSectionCount,
      arcaiaHiddenSectionCount: document.querySelectorAll(`${MESSAGE_SECTION_SELECTOR}[${ROLLING_HIDE_ATTR}="true"]`).length,
      allArcaiaHiddenElementCount: document.querySelectorAll(`[${ROLLING_HIDE_ATTR}="true"]`).length
    };
  }

  const ASSISTANT_LOADING_STREAM_ROOT_SELECTOR = '[data-scroll-root]';
  const ASSISTANT_LOADING_STREAM_ACTIVE_ATTR = 'data-stream-active';
  const ASSISTANT_STREAMING_RESPONSE_STATUS_SELECTOR = '[data-streaming-response-status]';

  function hasLatestAssistantStreamingResponseStatus(root = document) {
    const queryRoot = root?.querySelectorAll ? root : document;
    const assistantTurns = Array.from(queryRoot.querySelectorAll('section[data-turn="assistant"]'));
    const latestAssistantTurn = assistantTurns.at(-1) || null;
    return Boolean(latestAssistantTurn?.querySelector?.(ASSISTANT_STREAMING_RESPONSE_STATUS_SELECTOR));
  }

  function shouldPreserveAssistantGenerationForStreamingResponseStatus(generationActive, detector) {
    return Boolean(generationActive && detector?.streamingResponseStatusPresent);
  }

  function getAssistantLoadingStreamRoot(root = document) {
    const queryRoot = root?.querySelector ? root : document;
    if (queryRoot instanceof Element && queryRoot.matches?.(ASSISTANT_LOADING_STREAM_ROOT_SELECTOR)) {
      return queryRoot;
    }
    const main = queryRoot.querySelector?.('main#main') || null;
    const mainScrollRoot = main?.closest?.(ASSISTANT_LOADING_STREAM_ROOT_SELECTOR) || null;
    return mainScrollRoot || queryRoot.querySelector?.(ASSISTANT_LOADING_STREAM_ROOT_SELECTOR) || null;
  }

  function summarizeAssistantLoadingStreamState(root = document) {
    const streamRoot = getAssistantLoadingStreamRoot(root);
    const generating = Boolean(
      streamRoot?.isConnected
      && streamRoot.hasAttribute?.(ASSISTANT_LOADING_STREAM_ACTIVE_ATTR)
    );
    const streamingResponseStatusPresent = Boolean(
      streamRoot?.isConnected
      && hasLatestAssistantStreamingResponseStatus(streamRoot)
    );
    return {
      selector: ASSISTANT_LOADING_STREAM_ROOT_SELECTOR,
      activeAttribute: ASSISTANT_LOADING_STREAM_ACTIVE_ATTR,
      streamRootExists: Boolean(streamRoot),
      streamRootConnected: Boolean(streamRoot?.isConnected),
      generating,
      streamingResponseStatusPresent,
      tag: String(streamRoot?.tagName || '').toLowerCase() || null,
      className: typeof streamRoot?.className === 'string'
        ? streamRoot.className
        : String(streamRoot?.className || '') || null,
      activeAttributeValue: generating
        ? streamRoot.getAttribute?.(ASSISTANT_LOADING_STREAM_ACTIVE_ATTR)
        : null
    };
  }

  function isLikelyChatGPTGenerating(root = document) {
    const streamState = summarizeAssistantLoadingStreamState(root);
    const candidates = [];
    if (streamState.generating) candidates.push({ source: 'scroll_root_data_stream_active' });
    const matched = candidates[0] || null;
    return {
      generating: Boolean(matched),
      matched,
      detectorDetailsOmitted: true,
      detectorDetailsOmittedReason: 'stream_root_attribute_with_latest_assistant_response_status_guard',
      streamState,
      streamingResponseStatusPresent: streamState.streamingResponseStatusPresent,
      candidates
    };
  }


  const ASSISTANT_LOADING_FAVICON_ID = 'arcaia-assistant-loading-favicon';
  const ASSISTANT_LOADING_FAVICON_SHORTCUT_ID = 'arcaia-assistant-loading-favicon-shortcut';
  const ASSISTANT_LOADING_FAVICON_ORIGINAL_REL_ATTR = 'data-arcaia-original-favicon-rel';
  const ASSISTANT_LOADING_FAVICON_ORIGINAL_HREF_ATTR = 'data-arcaia-original-favicon-href';
  const ASSISTANT_LOADING_FAVICON_ORIGINAL_TYPE_ATTR = 'data-arcaia-original-favicon-type';
  const ASSISTANT_LOADING_TITLE_FRAMES = Object.freeze([
    '|･･ ',
    '･|･ ',
    '･･| '
  ]);
  const ASSISTANT_LOADING_TITLE_PREFIX = ASSISTANT_LOADING_TITLE_FRAMES[0];
  const ASSISTANT_LOADING_TITLE_ANIMATION_INTERVAL_MS = 800;
  const ASSISTANT_COMPLETED_INACTIVE_TITLE_PREFIX = '● ';
  const ASSISTANT_TITLE_PREFIX_STRIP_LIMIT = 32;
  const ASSISTANT_COMPLETION_STOP_BUTTON_SELECTOR = [
    'button[data-testid="stop-button"]',
    'button[aria-label="回答を停止"]',
    'button[aria-label="Stop generating"]'
  ].join(', ');
  const ASSISTANT_COMPLETION_NOTIFIED_KEY_LIMIT = 200;
  const ASSISTANT_COMPLETION_SOUND_PRESETS = Object.freeze({
    classic_chime: Object.freeze({
      id: 'classic_chime',
      label: 'Classic chime',
      kind: 'offscreen_html_audio_synth',
      volume: DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME,
      routedBy: 'background_offscreen_audio'
    }),
    soft_chime: Object.freeze({
      id: 'soft_chime',
      label: 'Soft chime',
      kind: 'offscreen_html_audio_asset',
      volume: DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME,
      routedBy: 'background_offscreen_audio'
    })
  });
  let assistantLoadingStreamRootObserver = null;
  let assistantLoadingObservedStreamRoot = null;
  let assistantLoadingFaviconActive = false;
  let assistantLoadingFaviconMonitorStarted = false;
  let assistantLoadingVisibilityHandler = null;
  let assistantLoadingFocusHandler = null;
  let assistantLoadingPageShowHandler = null;
  let assistantActivityOriginalTitle = null;
  let assistantActivityTitlePrefix = '';
  let assistantLoadingTitleAnimationTimer = null;
  let assistantLoadingTitleAnimationFrameIndex = 0;
  let assistantCompletedInactiveTitlePending = false;
  let assistantGenerationActive = false;
  let assistantGenerationConversationId = null;
  let assistantGenerationStreamRoot = null;
  let assistantLoadingFaviconCheckAnimationFrame = null;
  let assistantLoadingFaviconCheckFallbackTimer = null;
  let assistantLoadingFaviconCheckSequence = 0;
  let assistantCompletionSignaledForCurrentGeneration = false;
  let assistantCompletionLatched = false;
  let assistantCompletionLastReason = null;
  let assistantCompletionLastKey = null;
  const assistantCompletionNotifiedTurnElements = new WeakSet();
  const assistantCompletionNotifiedKeys = new Set();
  let assistantCompletionSoundState = {
    enabled: false,
    soundId: assistantCompletionSoundId,
    volume: assistantCompletionSoundVolume,
    playCount: 0,
    blockedCount: 0,
    autoTriggerCount: 0,
    lastPlayAtIso: null,
    lastError: null,
    lastReason: null,
    lastRoute: null,
    lastTransitionAtIso: null,
    transitionCount: 0
  };

  function getAssistantCompletionSoundPreset(soundId = assistantCompletionSoundId) {
    return ASSISTANT_COMPLETION_SOUND_PRESETS[soundId] || ASSISTANT_COMPLETION_SOUND_PRESETS.classic_chime;
  }

  function updateAssistantCompletionSoundState(partial = {}) {
    assistantCompletionSoundState = {
      ...assistantCompletionSoundState,
      enabled: Boolean(assistantCompletionSoundEnabled),
      soundId: assistantCompletionSoundId,
      volume: assistantCompletionSoundVolume,
      ...partial
    };
    return assistantCompletionSoundState;
  }

  function sendAssistantCompletionSoundMessage(payload) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.runtime?.sendMessage) {
          resolve({ ok: false, error: 'chrome.runtime.sendMessage unavailable' });
          return;
        }
        chrome.runtime.sendMessage(payload, (response) => {
          const error = chrome.runtime.lastError;
          if (error) resolve({ ok: false, error: error.message || String(error) });
          else resolve(response || { ok: false, error: 'empty background response' });
        });
      } catch (error) {
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  async function playAssistantCompletionSound(reason = 'assistant_completed') {
    updateAssistantCompletionSoundState({ lastReason: reason, lastError: null });
    if (!assistantCompletionSoundEnabled || !isArcaiaExtensionEnabled()) return { skipped: true, reason: 'disabled' };
    const preset = getAssistantCompletionSoundPreset(assistantCompletionSoundId);
    const response = await sendAssistantCompletionSoundMessage({
      type: 'ARCAIA_PLAY_COMPLETION_SOUND',
      appVersion: APP_VERSION,
      reason,
      soundId: preset.id,
      volume: assistantCompletionSoundVolume
    });
    if (response?.ok) {
      updateAssistantCompletionSoundState({ playCount: assistantCompletionSoundState.playCount + 1, lastPlayAtIso: nowIso(), lastError: null });
      return { ok: true, soundId: preset.id, reason };
    }
    const error = response?.error || response?.reason || 'background audio playback failed';
    updateAssistantCompletionSoundState({
      blockedCount: assistantCompletionSoundState.blockedCount + 1,
      lastError: String(error),
      lastRoute: response?.route || null
    });
    return { ok: false, error: assistantCompletionSoundState.lastError };
  }

  function triggerAssistantCompletionSound(reason = 'assistant_completed') {
    updateAssistantCompletionSoundState({
      autoTriggerCount: assistantCompletionSoundState.autoTriggerCount + 1,
      lastReason: reason
    });
    void playAssistantCompletionSound(reason);
    return { ok: true, reason };
  }

  function triggerAssistantCompletionSoundOnce(reason = 'assistant_completed') {
    if (assistantCompletionSignaledForCurrentGeneration) {
      updateAssistantCompletionSoundState({ lastReason: `assistant_completion_duplicate:${reason}` });
      return { skipped: true, reason: 'duplicate_completion' };
    }
    assistantCompletionSignaledForCurrentGeneration = true;
    return triggerAssistantCompletionSound(reason);
  }

  function rememberAssistantCompletionSignal(turnElement, key) {
    if (turnElement) assistantCompletionNotifiedTurnElements.add(turnElement);
    if (key) {
      assistantCompletionNotifiedKeys.add(key);
      while (assistantCompletionNotifiedKeys.size > ASSISTANT_COMPLETION_NOTIFIED_KEY_LIMIT) {
        const oldestKey = assistantCompletionNotifiedKeys.values().next().value;
        if (!oldestKey) break;
        assistantCompletionNotifiedKeys.delete(oldestKey);
      }
    }
  }

  function handleAssistantGenerationStateChange(previousGenerating, nextGenerating, reason = 'manual') {
    if (previousGenerating === nextGenerating) return;
    updateAssistantCompletionSoundState({
      transitionCount: assistantCompletionSoundState.transitionCount + 1,
      lastTransitionAtIso: nowIso(),
      lastReason: reason
    });
  }

  function restoreLegacyAssistantLoadingFavicons() {
    const links = Array.from(document.head?.querySelectorAll?.(`[${ASSISTANT_LOADING_FAVICON_ORIGINAL_REL_ATTR}]`) || []);
    let restoredCount = 0;
    for (const link of links) {
      try {
        const rel = link.getAttribute(ASSISTANT_LOADING_FAVICON_ORIGINAL_REL_ATTR) || 'icon';
        const href = link.getAttribute(ASSISTANT_LOADING_FAVICON_ORIGINAL_HREF_ATTR) || '';
        const type = link.getAttribute(ASSISTANT_LOADING_FAVICON_ORIGINAL_TYPE_ATTR) || '';
        link.setAttribute('rel', rel);
        if (href) link.setAttribute('href', href);
        if (type) link.setAttribute('type', type);
        else link.removeAttribute('type');
        link.removeAttribute(ASSISTANT_LOADING_FAVICON_ORIGINAL_REL_ATTR);
        link.removeAttribute(ASSISTANT_LOADING_FAVICON_ORIGINAL_HREF_ATTR);
        link.removeAttribute(ASSISTANT_LOADING_FAVICON_ORIGINAL_TYPE_ATTR);
        restoredCount += 1;
      } catch {}
    }
    return restoredCount;
  }

  function removeAssistantLoadingFaviconLink() {
    try {
      for (const link of Array.from(document.querySelectorAll(`#${ASSISTANT_LOADING_FAVICON_ID}, #${ASSISTANT_LOADING_FAVICON_SHORTCUT_ID}`))) {
        link.remove();
      }
      restoreLegacyAssistantLoadingFavicons();
    } catch {}
  }

  function stripAssistantActivityTitlePrefix(title) {
    let next = String(title || '');
    for (let i = 0; i < ASSISTANT_TITLE_PREFIX_STRIP_LIMIT; i += 1) {
      const loadingPrefix = ASSISTANT_LOADING_TITLE_FRAMES.find((prefix) => next.startsWith(prefix));
      if (loadingPrefix) next = next.slice(loadingPrefix.length);
      else if (next.startsWith(ASSISTANT_COMPLETED_INACTIVE_TITLE_PREFIX)) next = next.slice(ASSISTANT_COMPLETED_INACTIVE_TITLE_PREFIX.length);
      else break;
    }
    return next;
  }

  function setAssistantActivityTitlePrefix(prefix) {
    const normalizedPrefix = String(prefix || '');
    const currentBase = stripAssistantActivityTitlePrefix(document.title || '');
    const baseTitle = assistantActivityOriginalTitle || currentBase;
    assistantActivityOriginalTitle = baseTitle;
    assistantActivityTitlePrefix = normalizedPrefix;
    try { document.title = normalizedPrefix ? `${normalizedPrefix}${baseTitle}` : baseTitle; } catch {}
    return { titlePrefix: assistantActivityTitlePrefix, baseTitle };
  }

  function clearAssistantActivityTitlePrefix() {
    const baseTitle = assistantActivityOriginalTitle || stripAssistantActivityTitlePrefix(document.title || '');
    assistantActivityOriginalTitle = null;
    assistantActivityTitlePrefix = '';
    try { document.title = baseTitle; } catch {}
    return { titlePrefix: '', baseTitle };
  }

  function getAssistantLoadingTitleFrame() {
    return ASSISTANT_LOADING_TITLE_FRAMES[
      assistantLoadingTitleAnimationFrameIndex % ASSISTANT_LOADING_TITLE_FRAMES.length
    ];
  }

  function stopAssistantLoadingTitleAnimation() {
    if (assistantLoadingTitleAnimationTimer) clearInterval(assistantLoadingTitleAnimationTimer);
    assistantLoadingTitleAnimationTimer = null;
    assistantLoadingTitleAnimationFrameIndex = 0;
  }

  function startAssistantLoadingTitleAnimation() {
    if (!isArcaiaFeatureEnabled('loadingTitle')) return false;
    if (assistantLoadingTitleAnimationTimer) return false;
    assistantLoadingTitleAnimationFrameIndex = 0;
    assistantLoadingTitleAnimationTimer = setInterval(() => {
      if (!assistantGenerationActive || !isArcaiaExtensionEnabled()) {
        stopAssistantLoadingTitleAnimation();
        return;
      }
      assistantLoadingTitleAnimationFrameIndex = (
        assistantLoadingTitleAnimationFrameIndex + 1
      ) % ASSISTANT_LOADING_TITLE_FRAMES.length;
      syncAssistantActivityTitle('loading_title_animation_tick');
    }, ASSISTANT_LOADING_TITLE_ANIMATION_INTERVAL_MS);
    return true;
  }

  function isAssistantActivityPageActive() {
    const visible = document.visibilityState === 'visible';
    let focused = true;
    try {
      if (typeof document.hasFocus === 'function') focused = document.hasFocus();
    } catch {}
    return visible && focused;
  }

  function isAssistantActivityPageInactive() {
    return !isAssistantActivityPageActive();
  }

  function syncAssistantActivityTitle(reason = 'manual') {
    removeAssistantLoadingFaviconLink();
    if (!isArcaiaFeatureEnabled('loadingTitle')) {
      assistantCompletedInactiveTitlePending = false;
      stopAssistantLoadingTitleAnimation();
      const title = clearAssistantActivityTitlePrefix();
      return { active: false, state: 'disabled', reason, ...title };
    }
    if (!assistantGenerationActive && assistantCompletedInactiveTitlePending && isAssistantActivityPageActive()) {
      assistantCompletedInactiveTitlePending = false;
    }
    if (assistantGenerationActive) {
      assistantCompletedInactiveTitlePending = false;
      const title = setAssistantActivityTitlePrefix(getAssistantLoadingTitleFrame());
      return { active: true, state: 'loading', reason, ...title };
    }
    if (assistantCompletedInactiveTitlePending && isAssistantActivityPageInactive()) {
      const title = setAssistantActivityTitlePrefix(ASSISTANT_COMPLETED_INACTIVE_TITLE_PREFIX);
      return { active: true, state: 'completed_inactive', reason, ...title };
    }
    const title = clearAssistantActivityTitlePrefix();
    return { active: false, state: 'normal', reason, ...title };
  }

  function clearCompletedInactiveTitleIfVisible(reason = 'visible') {
    if (!isAssistantActivityPageActive()) return false;
    assistantCompletedInactiveTitlePending = false;
    syncAssistantActivityTitle(reason);
    return true;
  }

  function clearAssistantGenerationIdentity() {
    assistantGenerationConversationId = null;
    assistantGenerationStreamRoot = null;
  }

  function captureAssistantGenerationIdentity(reason = 'generation_start') {
    assistantGenerationConversationId = tryExtractConversationIdFromUrl(window.location.href);
    assistantGenerationStreamRoot = getAssistantLoadingStreamRoot();
    return {
      reason,
      conversationId: assistantGenerationConversationId,
      streamRootConnected: Boolean(assistantGenerationStreamRoot?.isConnected)
    };
  }

  function canPromoteAssistantGenerationConversationId(nextConversationId) {
    if (assistantGenerationConversationId || !nextConversationId) return false;
    const currentStreamRoot = getAssistantLoadingStreamRoot();
    return Boolean(
      assistantGenerationStreamRoot
      && currentStreamRoot === assistantGenerationStreamRoot
      && currentStreamRoot?.isConnected
      && currentStreamRoot.hasAttribute?.(ASSISTANT_LOADING_STREAM_ACTIVE_ATTR)
    );
  }

  function clearPendingAssistantLoadingFaviconCheckHandles() {
    if (assistantLoadingFaviconCheckAnimationFrame !== null) {
      try { window.cancelAnimationFrame(assistantLoadingFaviconCheckAnimationFrame); } catch {}
    }
    if (assistantLoadingFaviconCheckFallbackTimer !== null) {
      clearTimeout(assistantLoadingFaviconCheckFallbackTimer);
    }
    assistantLoadingFaviconCheckAnimationFrame = null;
    assistantLoadingFaviconCheckFallbackTimer = null;
  }

  function cancelPendingAssistantLoadingFaviconCheck(reason = 'cancelled') {
    const pending = Boolean(
      assistantLoadingFaviconCheckAnimationFrame !== null
      || assistantLoadingFaviconCheckFallbackTimer !== null
    );
    assistantLoadingFaviconCheckSequence += 1;
    clearPendingAssistantLoadingFaviconCheckHandles();
    return { cancelled: pending, reason };
  }

  function flushPendingAssistantLoadingFaviconCheck(sequence, reason) {
    if (sequence !== assistantLoadingFaviconCheckSequence) {
      return { skipped: true, reason: 'stale_assistant_activity_check' };
    }
    clearPendingAssistantLoadingFaviconCheckHandles();
    return updateAssistantLoadingFavicon(reason);
  }

  function handleAssistantPageNavigationIntent(reason = 'navigation') {
    cancelPendingAssistantLoadingFaviconCheck(`page_navigation:${reason}`);
    if (!assistantGenerationActive) return { skipped: true, reason: 'generation_not_active' };
    const nextConversationId = tryExtractConversationIdFromUrl(window.location.href);
    return reconcileAssistantGenerationConversationChange(
      assistantGenerationConversationId,
      nextConversationId,
      `page_navigation:${reason}`
    );
  }

  function abandonAssistantGenerationForNavigation(reason = 'conversation_changed', nextConversationId = null) {
    if (!assistantGenerationActive) return { skipped: true, reason: 'generation_not_active' };
    cancelPendingAssistantLoadingFaviconCheck(`navigation_abandon:${reason}`);
    const previousGenerating = assistantGenerationActive;
    const previousConversationId = assistantGenerationConversationId;
    const navigationReason = `navigation_abandon:${reason}`;
    assistantGenerationActive = false;
    assistantLoadingFaviconActive = false;
    assistantCompletionSignaledForCurrentGeneration = true;
    assistantCompletionLatched = true;
    assistantCompletedInactiveTitlePending = false;
    assistantCompletionLastReason = navigationReason;
    assistantCompletionLastKey = null;
    clearAssistantGenerationIdentity();
    stopAssistantLoadingTitleAnimation();
    try { document.documentElement?.removeAttribute?.('data-arcaia-assistant-loading-title'); } catch {}
    handleAssistantGenerationStateChange(previousGenerating, false, navigationReason);
    const title = syncAssistantActivityTitle(navigationReason);
    updateAssistantCompletionSoundState({ lastReason: navigationReason });
    return {
      ok: true,
      abandoned: true,
      reason: navigationReason,
      previousConversationId,
      nextConversationId,
      title
    };
  }

  function reconcileAssistantGenerationConversationChange(
    previousConversationId,
    nextConversationId,
    reason = 'conversation_changed'
  ) {
    if (!assistantGenerationActive) return { skipped: true, reason: 'generation_not_active' };
    if (assistantGenerationConversationId === nextConversationId) {
      return { ok: true, action: 'same_conversation', conversationId: nextConversationId };
    }
    if (canPromoteAssistantGenerationConversationId(nextConversationId)) {
      assistantGenerationConversationId = nextConversationId;
      return {
        ok: true,
        action: 'promoted_new_chat_conversation_id',
        previousConversationId,
        nextConversationId
      };
    }
    return abandonAssistantGenerationForNavigation(reason, nextConversationId);
  }

  function applyAssistantLoadingFaviconState(generating, reason = 'manual') {
    if (!isArcaiaExtensionEnabled()) generating = false;
    if (assistantCompletionLatched) {
      if (generating) generating = false;
      else assistantCompletionLatched = false;
    }
    if (assistantGenerationActive) {
      const currentConversationId = tryExtractConversationIdFromUrl(window.location.href);
      if (assistantGenerationConversationId !== currentConversationId) {
        const reconciliation = reconcileAssistantGenerationConversationChange(
          assistantGenerationConversationId,
          currentConversationId,
          `generation_state:${reason}`
        );
        if (reconciliation?.abandoned) {
          return {
            changed: true,
            active: false,
            generating: false,
            navigationAbandoned: true,
            ...reconciliation
          };
        }
      }
    }
    const nextActive = Boolean(generating);
    const previousGenerating = assistantGenerationActive;
    assistantGenerationActive = nextActive;
    handleAssistantGenerationStateChange(previousGenerating, nextActive, reason);
    const previousActive = assistantLoadingFaviconActive;
    if (nextActive) {
      if (!previousGenerating) {
        assistantCompletionSignaledForCurrentGeneration = false;
        assistantCompletionLastReason = null;
        assistantCompletionLastKey = null;
        captureAssistantGenerationIdentity(reason);
        startAssistantLoadingTitleAnimation();
      }
      assistantLoadingFaviconActive = true;
      try { document.documentElement?.setAttribute?.('data-arcaia-assistant-loading-title', 'true'); } catch {}
    } else {
      stopAssistantLoadingTitleAnimation();
      if (previousGenerating) {
        triggerAssistantCompletionSoundOnce(`generation_end:${reason}`);
        if (isAssistantActivityPageInactive()) assistantCompletedInactiveTitlePending = true;
        clearAssistantGenerationIdentity();
      }
      assistantLoadingFaviconActive = false;
      try { document.documentElement?.removeAttribute?.('data-arcaia-assistant-loading-title'); } catch {}
    }
    const title = syncAssistantActivityTitle(reason);
    return {
      changed: previousActive !== assistantLoadingFaviconActive,
      active: assistantLoadingFaviconActive,
      generating: nextActive,
      title,
      reason
    };
  }

  function markAssistantCompletedFromSignal(signal, reason = 'assistant_completion_signal') {
    if (!isArcaiaExtensionEnabled()) return { skipped: true, reason: 'extension_disabled' };
    if (!isAssistantActivityPageInactive()) return { skipped: true, reason: 'page_active' };
    const turnElement = signal?.turnElement || null;
    const key = signal?.key || null;
    if (!turnElement && !key) return { skipped: true, reason: 'missing_completion_identity' };
    const alreadySignaled = key
      ? assistantCompletionNotifiedKeys.has(key)
      : Boolean(turnElement && assistantCompletionNotifiedTurnElements.has(turnElement));
    if (alreadySignaled) {
      return { skipped: true, reason: 'completion_already_signaled', key };
    }
    if (!assistantGenerationActive) return { skipped: true, reason: 'generation_not_active' };

    cancelPendingAssistantLoadingFaviconCheck(`completion_signal:${reason}`);
    const previousGenerating = assistantGenerationActive;
    rememberAssistantCompletionSignal(turnElement, key);
    assistantCompletionLatched = true;
    assistantCompletionLastReason = reason;
    assistantCompletionLastKey = key;
    clearAssistantGenerationIdentity();
    assistantGenerationActive = false;
    assistantLoadingFaviconActive = false;
    stopAssistantLoadingTitleAnimation();
    try { document.documentElement?.removeAttribute?.('data-arcaia-assistant-loading-title'); } catch {}
    handleAssistantGenerationStateChange(previousGenerating, false, reason);
    assistantCompletedInactiveTitlePending = true;
    const title = syncAssistantActivityTitle(reason);
    const sound = triggerAssistantCompletionSoundOnce(reason);
    return { ok: true, reason, key, title, sound };
  }

  function summarizeAssistantStreamMutationTransition(mutations, streamRoot) {
    const streamMutations = Array.from(mutations || []).filter((mutation) => (
      mutation.type === 'attributes'
      && mutation.attributeName === ASSISTANT_LOADING_STREAM_ACTIVE_ATTR
      && mutation.target === streamRoot
    ));
    const firstMutation = streamMutations[0] || null;
    const attributePresentAfterCallback = Boolean(
      streamRoot?.hasAttribute?.(ASSISTANT_LOADING_STREAM_ACTIVE_ATTR)
    );
    const removedThenReadded = Boolean(
      firstMutation?.oldValue !== null
      && streamMutations.slice(1).some((mutation) => mutation.oldValue === null)
      && attributePresentAfterCallback
    );
    const removedFinal = Boolean(
      streamMutations.some((mutation) => mutation.oldValue !== null)
      && !attributePresentAfterCallback
    );
    return {
      mutationCount: streamMutations.length,
      removedThenReadded,
      removedFinal,
      attributePresentAfterCallback
    };
  }

  function hasAssistantCompletionStopButton() {
    return Boolean(document.querySelector(ASSISTANT_COMPLETION_STOP_BUTTON_SELECTOR));
  }

  function updateAssistantLoadingFavicon(reason = 'manual') {
    if (window.top !== window) return { skipped: true, reason: 'not_top_frame' };
    let detector = null;
    try { detector = isLikelyChatGPTGenerating(); } catch {}
    const preserveGeneration = shouldPreserveAssistantGenerationForStreamingResponseStatus(
      assistantGenerationActive,
      detector
    );
    const state = applyAssistantLoadingFaviconState(Boolean(detector?.generating || preserveGeneration), reason);
    return {
      ok: true,
      appVersion: APP_VERSION,
      action: 'assistant_activity_title',
      detectorDetailsOmitted: true,
      ...state
    };
  }

  function scheduleAssistantLoadingFaviconCheck(reason = 'scheduled') {
    if (!isArcaiaExtensionEnabled()) return { skipped: true, reason: 'extension_disabled' };
    if (reason !== 'stream_removed_final') {
      cancelPendingAssistantLoadingFaviconCheck(`immediate_check:${reason}`);
      return updateAssistantLoadingFavicon(reason);
    }
    cancelPendingAssistantLoadingFaviconCheck('stream_completion_rescheduled');
    const sequence = assistantLoadingFaviconCheckSequence;
    assistantLoadingFaviconCheckAnimationFrame = window.requestAnimationFrame(() => {
      flushPendingAssistantLoadingFaviconCheck(sequence, reason);
    });
    assistantLoadingFaviconCheckFallbackTimer = setTimeout(() => {
      flushPendingAssistantLoadingFaviconCheck(sequence, reason);
    }, 100);
    return { scheduled: true, reason, sequence };
  }

  function isAssistantActivityFeedbackEnabled() {
    return isArcaiaFeatureEnabled('loadingTitle') || isArcaiaFeatureEnabled('completionSound');
  }

  function shouldMonitorAssistantStreamState() {
    return isAssistantActivityFeedbackEnabled() || isArcaiaFeatureEnabled('liteView');
  }

  function refreshAssistantLoadingStreamRootObserver(reason = 'refresh') {
    if (!assistantLoadingFaviconMonitorStarted) {
      return { changed: false, reason, observed: false, skipped: 'monitor_not_started' };
    }
    const streamRoot = getAssistantLoadingStreamRoot();
    if (streamRoot === assistantLoadingObservedStreamRoot) {
      return { changed: false, reason, observed: Boolean(streamRoot) };
    }
    try { assistantLoadingStreamRootObserver?.disconnect?.(); } catch {}
    assistantLoadingStreamRootObserver = null;
    assistantLoadingObservedStreamRoot = streamRoot || null;
    if (streamRoot) {
      assistantLoadingStreamRootObserver = new MutationObserver((mutations) => {
        const transition = summarizeAssistantStreamMutationTransition(mutations, streamRoot);
        if (!transition.mutationCount) return;
        if (rollingLiteUiStarted) {
          refreshConversationDomObserverBindings('stream_active_attribute_mutation');
          scheduleRollingLiteApply('stream_active_attribute_mutation');
        }
        if (!isAssistantActivityFeedbackEnabled()) return;
        scheduleAssistantLoadingFaviconCheck(
          transition.removedFinal
            ? 'stream_removed_final'
            : 'stream_root_active_attribute_mutation'
        );
        if (
          assistantGenerationActive
          && isAssistantActivityPageInactive()
          && transition.removedThenReadded
          && !hasLatestAssistantStreamingResponseStatus(streamRoot)
          && !hasAssistantCompletionStopButton()
        ) {
          markAssistantCompletedFromSignal(
            buildLatestAssistantCompletionSignal(),
            'stream_removed_readded_without_stop_button'
          );
        }
      });
      assistantLoadingStreamRootObserver.observe(streamRoot, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: [ASSISTANT_LOADING_STREAM_ACTIVE_ATTR]
      });
    }
    return { changed: true, reason, observed: Boolean(streamRoot) };
  }

  function getAssistantLoadingFaviconStatus() {
    const detector = isLikelyChatGPTGenerating();
    const update = updateAssistantLoadingFavicon('status_command');
    return {
      ok: true,
      appVersion: APP_VERSION,
      action: 'assistant_activity_title_status',
      active: assistantLoadingFaviconActive,
      titlePrefix: assistantActivityTitlePrefix,
      loadingTitlePrefix: ASSISTANT_LOADING_TITLE_PREFIX,
      loadingTitleFrames: ASSISTANT_LOADING_TITLE_FRAMES.slice(),
      loadingTitleAnimationIntervalMs: ASSISTANT_LOADING_TITLE_ANIMATION_INTERVAL_MS,
      loadingTitleAnimationActive: Boolean(assistantLoadingTitleAnimationTimer),
      loadingTitleAnimationFrameIndex: assistantLoadingTitleAnimationFrameIndex,
      completedInactiveTitlePrefix: ASSISTANT_COMPLETED_INACTIVE_TITLE_PREFIX,
      completedInactiveTitlePending: Boolean(assistantCompletedInactiveTitlePending),
      completionSignaledForCurrentGeneration: Boolean(assistantCompletionSignaledForCurrentGeneration),
      completionLatched: Boolean(assistantCompletionLatched),
      completionLastReason: assistantCompletionLastReason,
      completionLastKey: assistantCompletionLastKey,
      completionStopButtonSelector: ASSISTANT_COMPLETION_STOP_BUTTON_SELECTOR,
      pageActive: isAssistantActivityPageActive(),
      legacyFaviconLinkCount: document.querySelectorAll(`#${ASSISTANT_LOADING_FAVICON_ID}, #${ASSISTANT_LOADING_FAVICON_SHORTCUT_ID}`).length,
      legacyDisabledNativeFaviconCount: document.querySelectorAll(`[${ASSISTANT_LOADING_FAVICON_ORIGINAL_REL_ATTR}]`).length,
      streamRootObserverActive: Boolean(assistantLoadingStreamRootObserver && assistantLoadingObservedStreamRoot?.isConnected),
      streamRootSelector: ASSISTANT_LOADING_STREAM_ROOT_SELECTOR,
      streamActiveAttribute: ASSISTANT_LOADING_STREAM_ACTIVE_ATTR,
      streamRootTagName: String(assistantLoadingObservedStreamRoot?.tagName || '').toLowerCase() || null,
      assistantCompletionSound: assistantCompletionSoundState,
      detector,
      update
    };
  }

  function startAssistantLoadingFaviconMonitor() {
    if (!isArcaiaExtensionEnabled() || assistantLoadingFaviconMonitorStarted || window.top !== window) return;
    if (!shouldMonitorAssistantStreamState()) return;
    assistantLoadingFaviconMonitorStarted = true;
    refreshAssistantLoadingStreamRootObserver('startup');
    if (!isAssistantActivityFeedbackEnabled()) return;
    scheduleAssistantLoadingFaviconCheck('startup');
    const resync = (reason) => {
      refreshAssistantLoadingStreamRootObserver(reason);
      scheduleAssistantLoadingFaviconCheck(reason);
    };
    assistantLoadingVisibilityHandler = () => resync('visibilitychange');
    assistantLoadingFocusHandler = () => resync('focus');
    assistantLoadingPageShowHandler = () => resync('pageshow');
    document.addEventListener('visibilitychange', assistantLoadingVisibilityHandler);
    window.addEventListener('focus', assistantLoadingFocusHandler);
    window.addEventListener('pageshow', assistantLoadingPageShowHandler);
  }

  function stopAssistantLoadingFaviconMonitor(reason = 'stop') {
    cancelPendingAssistantLoadingFaviconCheck(`monitor_stopped:${reason}`);
    try { assistantLoadingStreamRootObserver?.disconnect?.(); } catch {}
    stopAssistantLoadingTitleAnimation();
    assistantLoadingStreamRootObserver = null;
    assistantLoadingObservedStreamRoot = null;
    if (assistantLoadingVisibilityHandler) document.removeEventListener('visibilitychange', assistantLoadingVisibilityHandler);
    if (assistantLoadingFocusHandler) window.removeEventListener('focus', assistantLoadingFocusHandler);
    if (assistantLoadingPageShowHandler) window.removeEventListener('pageshow', assistantLoadingPageShowHandler);
    assistantLoadingVisibilityHandler = null;
    assistantLoadingFocusHandler = null;
    assistantLoadingPageShowHandler = null;
    assistantLoadingFaviconMonitorStarted = false;
    assistantGenerationActive = false;
    clearAssistantGenerationIdentity();
    assistantCompletionSignaledForCurrentGeneration = false;
    assistantCompletionLatched = false;
    assistantCompletionLastReason = null;
    assistantCompletionLastKey = null;
    assistantCompletedInactiveTitlePending = false;
    assistantLoadingFaviconActive = false;
    try { document.documentElement?.removeAttribute?.('data-arcaia-assistant-loading-title'); } catch {}
    removeAssistantLoadingFaviconLink();
    clearAssistantActivityTitlePrefix();
    updateAssistantCompletionSoundState({ lastReason: `monitor_stopped:${reason}` });
  }


  function isElementActuallyVisible(el) {
    try {
      if (!el || !el.isConnected) return false;
      if (el.closest?.(`#${LITE_BAR_ID}`)) return false;
      const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
      const rect = el.getBoundingClientRect?.();
      if (rect && rect.width === 0 && rect.height === 0) return false;
      return true;
    } catch {
      return Boolean(el?.isConnected);
    }
  }

  function getRoleNodeCountsForLite(root = document) {
    const queryRoot = root?.querySelectorAll ? root : document;
    const all = Array.from(queryRoot.querySelectorAll('[data-message-author-role]'))
      .filter((el) => el && el.isConnected && !el.closest?.(`#${LITE_BAR_ID}`));
    const user = all.filter((el) => el.getAttribute('data-message-author-role') === 'user');
    const assistant = all.filter((el) => el.getAttribute('data-message-author-role') === 'assistant');
    const visible = all.filter(isElementActuallyVisible);
    return {
      all: all.length,
      user: user.length,
      assistant: assistant.length,
      visibleAll: visible.length,
      visibleUser: visible.filter((el) => el.getAttribute('data-message-author-role') === 'user').length,
      visibleAssistant: visible.filter((el) => el.getAttribute('data-message-author-role') === 'assistant').length
    };
  }

  function summarizeLiteContainerForLog(container) {
    if (!container) return null;
    let rect = null;
    try {
      const r = container.getBoundingClientRect?.();
      if (r) rect = { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) };
    } catch {}
    const roleNodes = Array.from(container.querySelectorAll?.('[data-message-author-role]') || []);
    return {
      tag: String(container.tagName || '').toLowerCase(),
      className: typeof container.className === 'string' ? container.className.split(/\s+/).filter(Boolean).slice(0, 10).join(' ') : '',
      dataTestId: container.getAttribute?.('data-testid') || null,
      messageId: container.getAttribute?.('data-message-id') || container.querySelector?.('[data-message-id]')?.getAttribute?.('data-message-id') || null,
      roleNodes: roleNodes.slice(0, 6).map((node) => ({
        role: node.getAttribute('data-message-author-role'),
        textLength: (node.textContent || '').length,
        dataMessageId: node.getAttribute?.('data-message-id') || node.querySelector?.('[data-message-id]')?.getAttribute?.('data-message-id') || null
      })),
      textLength: (container.textContent || '').length,
      isConnected: Boolean(container.isConnected),
      rect
    };
  }

  function summarizeLiteTurnForLog(turn, oneBasedIndex) {
    const containers = Array.from(turn?.containers || []);
    const roleSummary = [];
    for (const container of containers) {
      for (const node of Array.from(container.querySelectorAll?.('[data-message-author-role]') || [])) {
        roleSummary.push({ role: node.getAttribute('data-message-author-role'), textLength: (node.textContent || '').length });
      }
    }
    return {
      turnNumber: oneBasedIndex,
      containerCount: containers.length,
      hasUser: Boolean(turn?.hasUser),
      hasAssistant: Boolean(turn?.hasAssistant),
      roleSummary: roleSummary.slice(0, 8),
      textLength: containers.reduce((sum, el) => sum + ((el.textContent || '').length), 0),
      firstContainer: summarizeLiteContainerForLog(containers[0])
    };
  }


  function getContentDiagnostics() {
    const diagnostics = window.ArcaiaContentDiagnostics;
    if (!diagnostics || typeof diagnostics.simpleDiagnosticHash !== 'function') {
      throw new Error('Arcaia content diagnostics helper is not loaded.');
    }
    return diagnostics;
  }

  function simpleDiagnosticHash(text) {
    return getContentDiagnostics().simpleDiagnosticHash(text);
  }

  function getElementRectForDiagnostics(el) {
    try {
      const rect = el?.getBoundingClientRect?.();
      return getContentDiagnostics().normalizeRectForDiagnostics(rect);
    } catch {
      return null;
    }
  }

  function getElementVisibilityDiagnostics(el) {
    try {
      const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      const rect = getElementRectForDiagnostics(el);
      const ariaHiddenAncestor = Boolean(el?.closest?.('[aria-hidden="true"]'));
      const hiddenByRolling = el?.getAttribute?.(ROLLING_HIDE_ATTR) === 'true' || Boolean(el?.closest?.(`[${ROLLING_HIDE_ATTR}="true"]`));
      const display = style?.display || el?.style?.display || '';
      const visibility = style?.visibility || '';
      const opacity = style?.opacity || '';
      const rectNonZero = Boolean(rect && rect.width > 0 && rect.height > 0);
      return {
        isConnected: Boolean(el?.isConnected),
        hiddenByRolling,
        display,
        visibility,
        opacity,
        ariaHiddenAncestor,
        rectNonZero,
        visible: Boolean(el?.isConnected) && !hiddenByRolling && display !== 'none' && visibility !== 'hidden' && Number(opacity || 1) !== 0 && !ariaHiddenAncestor && rectNonZero,
        rect
      };
    } catch (error) {
      return { visible: Boolean(el?.isConnected), error: error instanceof Error ? error.message : String(error) };
    }
  }

  function getElementDiagnosticFingerprint(el) {
    if (!el) return null;
    const attrs = {};
    for (const name of ['id', 'role', 'aria-label', 'data-testid', 'data-message-author-role', 'data-message-id', 'data-section-id', 'data-turn-id']) {
      const value = el.getAttribute?.(name);
      if (value) attrs[name] = String(value).slice(0, 220);
    }
    return {
      tag: String(el.tagName || '').toLowerCase(),
      attrs,
      className: typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 14).join(' ') : '',
      textLength: (el.textContent || '').length,
      textHash: simpleDiagnosticHash(el.textContent || ''),
      visibility: getElementVisibilityDiagnostics(el)
    };
  }

  function getElementParentChainDiagnostics(el, maxDepth = 8) {
    const chain = [];
    let node = el;
    for (let depth = 0; node && depth < maxDepth; depth += 1) {
      chain.push(getElementDiagnosticFingerprint(node));
      node = node.parentElement;
    }
    return chain;
  }

  function getComputedLayoutSummary(el) {
    try {
      const style = window.getComputedStyle?.(el) || null;
      const rect = getElementRectForDiagnostics(el);
      const clientRects = Array.from(el?.getClientRects?.() || []);
      const firstClientRect = clientRects[0] ? {
        top: Math.round(clientRects[0].top),
        left: Math.round(clientRects[0].left),
        width: Math.round(clientRects[0].width),
        height: Math.round(clientRects[0].height),
        bottom: Math.round(clientRects[0].bottom),
        right: Math.round(clientRects[0].right)
      } : null;
      return {
        inlineDisplay: el?.style?.display || '',
        computedDisplay: style?.display || '',
        visibility: style?.visibility || '',
        opacity: style?.opacity || '',
        position: style?.position || '',
        contentVisibility: style?.contentVisibility || '',
        contain: style?.contain || '',
        overflow: style?.overflow || '',
        overflowY: style?.overflowY || '',
        transform: style?.transform && style.transform !== 'none' ? String(style.transform).slice(0, 220) : '',
        pointerEvents: style?.pointerEvents || '',
        rect,
        clientRectCount: clientRects.length,
        firstClientRect,
        offsetHeight: Number(el?.offsetHeight || 0),
        offsetWidth: Number(el?.offsetWidth || 0),
        clientHeight: Number(el?.clientHeight || 0),
        clientWidth: Number(el?.clientWidth || 0),
        scrollHeight: Number(el?.scrollHeight || 0),
        scrollWidth: Number(el?.scrollWidth || 0),
        scrollTop: Number(el?.scrollTop || 0),
        scrollLeft: Number(el?.scrollLeft || 0),
        maxScrollTop: Math.max(0, Number(el?.scrollHeight || 0) - Number(el?.clientHeight || 0)),
        verticalOverflowPx: Math.max(0, Number(el?.scrollHeight || 0) - Number(el?.clientHeight || 0))
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  function isRuntimeLayoutVisible(el) {
    const layout = getComputedLayoutSummary(el);
    const rect = layout?.rect;
    return Boolean(el?.isConnected)
      && el?.getAttribute?.(ROLLING_HIDE_ATTR) !== 'true'
      && layout.computedDisplay !== 'none'
      && layout.visibility !== 'hidden'
      && Number(layout.opacity || 1) !== 0
      && Boolean(rect && rect.width > 0 && rect.height > 0);
  }

  function summarizeAncestorLayoutChain(el, maxDepth = 7) {
    const out = [];
    let node = el;
    for (let depth = 0; node && depth < maxDepth; depth += 1) {
      const layout = getComputedLayoutSummary(node);
      out.push({
        depth,
        tag: String(node.tagName || '').toLowerCase(),
        id: node.id || '',
        dataTestId: node.getAttribute?.('data-testid') || null,
        role: node.getAttribute?.('role') || null,
        className: typeof node.className === 'string' ? node.className.split(/\s+/).filter(Boolean).slice(0, 10).join(' ') : '',
        layout: {
          computedDisplay: layout.computedDisplay,
          inlineDisplay: layout.inlineDisplay,
          visibility: layout.visibility,
          position: layout.position,
          overflowY: layout.overflowY,
          contentVisibility: layout.contentVisibility,
          contain: layout.contain,
          rect: layout.rect,
          offsetHeight: layout.offsetHeight,
          clientHeight: layout.clientHeight,
          scrollHeight: layout.scrollHeight
        }
      });
      node = node.parentElement;
    }
    return out;
  }

  function summarizeSectionRuntimeLayout(record) {
    const section = record?.section;
    if (!section) return null;
    const layout = getComputedLayoutSummary(section);
    const hiddenByAttr = section.getAttribute?.(ROLLING_HIDE_ATTR) === 'true';
    const runtimeVisible = isRuntimeLayoutVisible(section);
    const rect = layout?.rect;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    const intersectsViewport = Boolean(rect && rect.height > 0 && rect.width > 0 && rect.bottom >= 0 && rect.top <= viewportHeight);
    let elementFromCenter = null;
    try {
      if (rect && rect.width > 0 && rect.height > 0) {
        const x = Math.max(0, Math.min((window.innerWidth || 1) - 1, Math.round(rect.left + rect.width / 2)));
        const y = Math.max(0, Math.min((window.innerHeight || 1) - 1, Math.round(rect.top + Math.min(rect.height / 2, 24))));
        const hit = document.elementFromPoint?.(x, y);
        elementFromCenter = hit ? {
          tag: String(hit.tagName || '').toLowerCase(),
          dataTestId: hit.getAttribute?.('data-testid') || null,
          role: hit.getAttribute?.('data-message-author-role') || hit.getAttribute?.('role') || null,
          withinSection: Boolean(hit === section || section.contains?.(hit))
        } : null;
      }
    } catch {}
    return {
      domIndex: record.domIndex,
      groupIndex: record.groupIndex ?? null,
      role: record.role,
      dataTestId: record.dataTestId || null,
      messageId: record.messageId || null,
      retained: Boolean(record.retained),
      hiddenPlanned: Boolean(record.hiddenPlanned),
      hiddenByArcaiaAttr: hiddenByAttr,
      runtimeVisible,
      intersectsViewport,
      layout,
      elementFromCenter,
      ancestorLayoutChain: summarizeAncestorLayoutChain(section, 5),
      textLength: (section.textContent || '').length,
      textHash: simpleDiagnosticHash(section.textContent || '')
    };
  }

  function collectScrollContainerDiagnostics(anchor = null) {
    const candidates = [];
    const seen = new Set();
    const summarizeLiteDescendants = (el) => {
      try {
        const sections = Array.from(el?.querySelectorAll?.(MESSAGE_SECTION_SELECTOR) || []);
        const hiddenSections = sections.filter((section) => section.getAttribute?.(ROLLING_HIDE_ATTR) === 'true' || getComputedLayoutSummary(section).computedDisplay === 'none');
        const visibleSections = sections.filter((section) => isRuntimeLayoutVisible(section));
        return {
          sectionDescendantCount: sections.length,
          hiddenSectionDescendantCount: hiddenSections.length,
          visibleSectionDescendantCount: visibleSections.length,
          hiddenSectionLayoutLeakCount: hiddenSections.filter((section) => {
            const layout = getComputedLayoutSummary(section);
            return layout.computedDisplay !== 'none' || Number(layout.offsetHeight || 0) > 0 || Number(layout.clientRectCount || 0) > 0;
          }).length
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    };
    const add = (el, reason) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      const layout = getComputedLayoutSummary(el);
      const scrollish = Number(layout.scrollHeight || 0) > Number(layout.clientHeight || 0) + 8
        || ['auto', 'scroll'].includes(String(layout.overflowY || '').toLowerCase());
      candidates.push({
        reason,
        tag: String(el.tagName || '').toLowerCase(),
        id: el.id || '',
        dataTestId: el.getAttribute?.('data-testid') || null,
        role: el.getAttribute?.('role') || null,
        className: typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 14).join(' ') : '',
        scrollish,
        scrollBurdenScore: Number(layout.verticalOverflowPx || 0) + Math.max(0, Number(layout.scrollWidth || 0) - Number(layout.clientWidth || 0)),
        liteDescendants: summarizeLiteDescendants(el),
        layout: {
          computedDisplay: layout.computedDisplay,
          position: layout.position,
          overflowY: layout.overflowY,
          contentVisibility: layout.contentVisibility,
          contain: layout.contain,
          rect: layout.rect,
          offsetHeight: layout.offsetHeight,
          clientHeight: layout.clientHeight,
          scrollHeight: layout.scrollHeight,
          scrollTop: layout.scrollTop,
          maxScrollTop: layout.maxScrollTop,
          verticalOverflowPx: layout.verticalOverflowPx,
          clientWidth: layout.clientWidth,
          scrollWidth: layout.scrollWidth
        }
      });
    };
    add(document.documentElement, 'documentElement');
    add(document.body, 'body');
    for (const selector of ['main', '[role="main"]', 'div[class*="thread"]', 'div[class*="scroll"]']) {
      try {
        for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 8)) add(el, `selector:${selector}`);
      } catch {}
    }
    let node = anchor;
    for (let depth = 0; node && depth < 10; depth += 1) {
      add(node, `anchorAncestor:${depth}`);
      node = node.parentElement;
    }
    return candidates.filter((item) => item.scrollish || ['documentElement', 'body'].includes(item.reason)).slice(0, 24);
  }

  function collectLiteRuntimeLayoutDiagnostics(plan = null) {
    try {
      const records = plan?.model?.physicalRecords || collectMessageSectionModel(document).physicalRecords || [];
      const hiddenRecords = records.filter((record) => record.section?.getAttribute?.(ROLLING_HIDE_ATTR) === 'true');
      const retainedRecords = records.filter((record) => record.section?.getAttribute?.(ROLLING_HIDE_ATTR) !== 'true');
      const runtimeVisibleRecords = records.filter((record) => isRuntimeLayoutVisible(record.section));
      const computedDisplayNoneRecords = records.filter((record) => getComputedLayoutSummary(record.section).computedDisplay === 'none');
      const hiddenButLayoutRecords = hiddenRecords.filter((record) => {
        const layout = getComputedLayoutSummary(record.section);
        return layout.computedDisplay !== 'none' || Number(layout.offsetHeight || 0) > 0 || Number(layout.clientRectCount || 0) > 0;
      });
      const retainedButInvisibleRecords = retainedRecords.filter((record) => !isRuntimeLayoutVisible(record.section));
      const anchor = (runtimeVisibleRecords.at?.(-1) || retainedRecords.at?.(-1) || records.at?.(-1))?.section || null;
      const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
      const documentLayout = {
        scrollY: Math.round(window.scrollY || 0),
        innerWidth: window.innerWidth || 0,
        innerHeight: viewportHeight,
        body: getComputedLayoutSummary(document.body),
        documentElement: getComputedLayoutSummary(document.documentElement)
      };
      return {
        summary: {
          totalSectionCount: records.length,
          arcaiaHiddenAttrCount: hiddenRecords.length,
          retainedAttrCount: retainedRecords.length,
          runtimeVisibleSectionCount: runtimeVisibleRecords.length,
          computedDisplayNoneCount: computedDisplayNoneRecords.length,
          hiddenButStillHasLayoutCount: hiddenButLayoutRecords.length,
          retainedButRuntimeInvisibleCount: retainedButInvisibleRecords.length,
          viewportIntersectingSectionCount: records.filter((record) => {
            const rect = getComputedLayoutSummary(record.section)?.rect;
            return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= viewportHeight);
          }).length
        },
        documentLayout,
        scrollContainers: collectScrollContainerDiagnostics(anchor),
        runtimeVisibleSamples: runtimeVisibleRecords.slice(-12).map(summarizeSectionRuntimeLayout),
        hiddenButStillHasLayoutSamples: hiddenButLayoutRecords.slice(0, 6).concat(hiddenButLayoutRecords.length > 12 ? hiddenButLayoutRecords.slice(-6) : hiddenButLayoutRecords.slice(6)).map(summarizeSectionRuntimeLayout),
        retainedButRuntimeInvisibleSamples: retainedButInvisibleRecords.slice(-12).map(summarizeSectionRuntimeLayout),
        firstSectionSamples: records.slice(0, 6).map(summarizeSectionRuntimeLayout),
        lastSectionSamples: records.slice(-12).map(summarizeSectionRuntimeLayout)
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  function getElementDocumentOrderIndex(el, selector = '[data-message-author-role]') {
    try {
      const nodes = Array.from(document.querySelectorAll(selector));
      return nodes.indexOf(el);
    } catch {
      return -1;
    }
  }

  function summarizeRoleNodeForTurnDiagnostics(roleNode, index) {
    const role = roleNode?.getAttribute?.('data-message-author-role') || null;
    const container = getLiteMessageContainer(roleNode);
    const article = roleNode?.closest?.('article') || null;
    const turnContainer = roleNode?.closest?.('[data-testid^="conversation-turn-"]') || article || container;
    const messageIdNode = roleNode?.closest?.('[data-message-id]') || roleNode?.querySelector?.('[data-message-id]') || container?.querySelector?.('[data-message-id]') || null;
    const text = roleNode?.textContent || '';
    const containerText = container?.textContent || '';
    return {
      sequenceIndex: index,
      documentOrderIndex: getElementDocumentOrderIndex(roleNode),
      role,
      dataMessageId: messageIdNode?.getAttribute?.('data-message-id') || roleNode?.getAttribute?.('data-message-id') || null,
      roleNode: getElementDiagnosticFingerprint(roleNode),
      roleNodeParentChain: getElementParentChainDiagnostics(roleNode, 7),
      container: summarizeLiteContainerForLog(container),
      containerFingerprint: getElementDiagnosticFingerprint(container),
      turnContainerFingerprint: getElementDiagnosticFingerprint(turnContainer),
      articleFingerprint: getElementDiagnosticFingerprint(article),
      textLength: text.length,
      textHash: simpleDiagnosticHash(text),
      containerTextLength: containerText.length,
      containerTextHash: simpleDiagnosticHash(containerText),
      hasEditableDescendant: Boolean(roleNode?.querySelector?.('[contenteditable="true"], textarea, input')),
      hiddenByRolling: Boolean(container?.getAttribute?.(ROLLING_HIDE_ATTR) === 'true' || roleNode?.closest?.(`[${ROLLING_HIDE_ATTR}="true"]`)),
      preview: makeTextPreview(text, 80)
    };
  }

  function collectRoleNodeSequenceDiagnostics(root = document, limit = 80) {
    const queryRoot = root?.querySelectorAll ? root : document;
    const roleNodes = Array.from(queryRoot.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'))
      .filter((el) => el && el.isConnected && !el.closest?.(`#${LITE_BAR_ID}`));
    const entries = roleNodes.map((node, index) => summarizeRoleNodeForTurnDiagnostics(node, index));
    return {
      totalRoleNodeCount: entries.length,
      userRoleNodeCount: entries.filter((e) => e.role === 'user').length,
      assistantRoleNodeCount: entries.filter((e) => e.role === 'assistant').length,
      firstEntries: entries.slice(0, 12),
      recentEntries: entries.slice(-limit)
    };
  }

  function getTurnBoundarySummaryFromRoleEntries(entries = [], turns = []) {
    const anomalies = [];
    const consecutiveSameRole = [];
    for (let i = 1; i < entries.length; i += 1) {
      if (entries[i]?.role && entries[i]?.role === entries[i - 1]?.role) {
        const item = { index: i, role: entries[i].role, previousIndex: i - 1 };
        consecutiveSameRole.push(item);
        anomalies.push({ type: `consecutive_${entries[i].role}_roles`, ...item });
      }
    }
    const assistantBeforeFirstUser = entries.findIndex((e) => e.role === 'assistant') !== -1
      && entries.findIndex((e) => e.role === 'assistant') < entries.findIndex((e) => e.role === 'user');
    if (assistantBeforeFirstUser) anomalies.push({ type: 'assistant_before_first_user' });

    const userOnlyTurns = [];
    const assistantOnlyTurns = [];
    const multiContainerTurns = [];
    turns.forEach((turn, index) => {
      const turnNumber = index + 1;
      if (turn?.hasUser && !turn?.hasAssistant) userOnlyTurns.push(turnNumber);
      if (!turn?.hasUser && turn?.hasAssistant) assistantOnlyTurns.push(turnNumber);
      if ((turn?.containers || []).length > 2) multiContainerTurns.push({ turnNumber, containerCount: turn.containers.length });
    });
    if (userOnlyTurns.length) anomalies.push({ type: 'user_only_turns', turnNumbers: userOnlyTurns.slice(-12), count: userOnlyTurns.length });
    if (assistantOnlyTurns.length) anomalies.push({ type: 'assistant_only_turns', turnNumbers: assistantOnlyTurns.slice(-12), count: assistantOnlyTurns.length });
    if (multiContainerTurns.length) anomalies.push({ type: 'multi_container_turns', samples: multiContainerTurns.slice(-12), count: multiContainerTurns.length });

    const duplicateContainerIndexes = [];
    const seen = new Map();
    entries.forEach((entry, index) => {
      const key = entry?.container?.messageId || entry?.containerFingerprint?.textHash || `${entry?.containerFingerprint?.tag}:${entry?.containerFingerprint?.attrs?.['data-testid'] || ''}:${entry?.containerFingerprint?.textLength || 0}`;
      if (!key) return;
      if (seen.has(key)) duplicateContainerIndexes.push({ firstIndex: seen.get(key), index, role: entry.role, key: String(key).slice(0, 120) });
      else seen.set(key, index);
    });
    if (duplicateContainerIndexes.length) anomalies.push({ type: 'duplicate_container_role_entries', samples: duplicateContainerIndexes.slice(-12), count: duplicateContainerIndexes.length });

    return {
      roleNodeCount: entries.length,
      turnCount: turns.length,
      userRoleNodeCount: entries.filter((e) => e.role === 'user').length,
      assistantRoleNodeCount: entries.filter((e) => e.role === 'assistant').length,
      consecutiveSameRoleCount: consecutiveSameRole.length,
      consecutiveSameRoleSamples: consecutiveSameRole.slice(-12),
      userOnlyTurnCount: userOnlyTurns.length,
      userOnlyTurnNumbers: userOnlyTurns.slice(-12),
      assistantOnlyTurnCount: assistantOnlyTurns.length,
      assistantOnlyTurnNumbers: assistantOnlyTurns.slice(-12),
      multiContainerTurnCount: multiContainerTurns.length,
      assistantBeforeFirstUser,
      anomalyCount: anomalies.length,
      anomalies: anomalies.slice(-20)
    };
  }

  function collectTurnBoundaryDiagnostics(allTurns = null) {
    const turns = Array.isArray(allTurns) ? allTurns : buildDomTurnsFromConversation();
    const sequence = collectRoleNodeSequenceDiagnostics(document, 80);
    const entries = sequence.recentEntries || [];
    const fullRoleNodes = Array.from(document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'))
      .filter((el) => el && el.isConnected && !el.closest?.(`#${LITE_BAR_ID}`));
    const fullEntriesForSummary = fullRoleNodes.map((node, index) => summarizeRoleNodeForTurnDiagnostics(node, index));
    const summary = getTurnBoundarySummaryFromRoleEntries(fullEntriesForSummary, turns);
    return {
      appVersion: APP_VERSION,
      collectedAtIso: nowIso(),
      note: 'HTML全文ではなく、turn判定に必要なDOM要素の属性・親チェーン・順序・表示状態・短いtext hash/previewを記録します。AI回答中のフォローアップ送信でturn境界が崩れる場合は consecutive_* / user_only_turns / duplicate_container_role_entries を確認してください。',
      summary,
      roleSequence: sequence,
      currentTurnGrouping: turns.slice(-20).map((turn, index) => summarizeLiteTurnForLog(turn, Math.max(1, turns.length - Math.min(20, turns.length) + index + 1))),
      groupingAlgorithm: {
        strategy: LITE_GROUPING_STRATEGY,
        description: `${MESSAGE_SECTION_SELECTOR} のuser-started groupは診断専用です。通常Liteの保持判定はDOM順の直近3 user-started turnで行います。`,
        knownRisk: 'ChatGPTの仮想化でmessage section自体が一時的にDOMから外れる場合は検出件数が変動しますが、毎回現在DOMへreconcileします。'
      }
    };
  }

  function getTurnBoundarySummaryForSnapshot() {
    try {
      const turns = buildDomTurnsFromConversation();
      const roleNodes = Array.from(document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'))
        .filter((el) => el && el.isConnected && !el.closest?.(`#${LITE_BAR_ID}`));
      const entries = roleNodes.map((node, index) => summarizeRoleNodeForTurnDiagnostics(node, index));
      return getTurnBoundarySummaryFromRoleEntries(entries, turns);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  function getLitePruneDiagnosticSnapshot(label = 'snapshot') {
    const generationDetector = isLikelyChatGPTGenerating();
    const plan = buildLiteGroupingPlan(document, getEffectiveLiteTurnCount(), generationDetector.generating);
    const turns = plan.groups.map((group) => ({
      containers: group.records.map((record) => record.section),
      hasUser: group.hasUser,
      hasAssistant: group.hasAssistant,
      kind: group.kind
    }));
    const visibleTurns = getVisibleDomTurnsFromConversation();
    const grouping = getLiteGroupingDiagnostics(plan);
    return {
      label,
      at: Date.now(),
      atIso: nowIso(),
      documentReadyState: document.readyState,
      mainExists: Boolean(document.querySelector('main')),
      turnCount: turns.length,
      visibleTurnCount: visibleTurns.length,
      ...grouping,
      roleNodeCounts: getRoleNodeCountsForLite(),
      turnBoundarySummary: getTurnBoundarySummaryForSnapshot(),
      selectorCounts: {
        conversationRoles: document.querySelectorAll('[data-message-author-role]').length,
        userRoles: document.querySelectorAll('[data-message-author-role="user"]').length,
        assistantRoles: document.querySelectorAll('[data-message-author-role="assistant"]').length,
        sections: document.querySelectorAll('section').length,
        main: document.querySelectorAll('main').length,
        pre: document.querySelectorAll('pre').length,
        code: document.querySelectorAll('pre code').length
      },
      scroll: {
        y: Math.round(window.scrollY || 0),
        bodyScrollHeight: document.body?.scrollHeight || 0,
        documentScrollHeight: document.documentElement?.scrollHeight || 0
      },
      lastTurns: turns.slice(-8).map((turn, idx) => summarizeLiteTurnForLog(turn, Math.max(1, turns.length - Math.min(8, turns.length) + idx + 1)))
    };
  }

  function isHistorySearchNavigationUrl(value = window.location.href) {
    try {
      const url = new URL(String(value || ''), window.location.origin);
      return String(url.searchParams.get('src') || '').toLowerCase() === 'history_search';
    } catch {
      return /(?:^|[?&])src=history_search(?:&|$)/i.test(String(value || ''));
    }
  }

  async function applyRollingLiteDom(reason = 'scheduled') {
    if (!isArcaiaExtensionEnabled()) return rollingLiteState;
    const applyStartedAt = Date.now();
    try {
      const currentConversationId = tryExtractConversationIdFromUrl(window.location.href);
      if (!currentConversationId) {
        setPromptTocHiddenActive(false);
        unhideRollingLiteContainers();
        clearObsoleteRestoredHistoryElements();
        const bar = document.getElementById(LITE_BAR_ID);
        if (bar) bar.hidden = true;
        rollingLiteState = {
          ...rollingLiteState,
          enabled: false,
          conversationId: null,
          lastError: null,
          lastSkipReason: 'not_conversation_page',
          hiddenContainerCount: 0,
          hiddenSectionCount: 0,
          arcaiaHiddenSectionCount: 0,
          removedContainerCount: 0,
          visibleTurnCount: 0,
          detectedTurnCount: 0,
          retainedTurnCount: 0,
          turnCountSetting: NATIVE_LITE_TURN_COUNT
        };
        return rollingLiteState;
      }

      if (isHistorySearchNavigationUrl()) {
        setPromptTocHiddenActive(false);
        unhideRollingLiteContainers();
        clearObsoleteRestoredHistoryElements();
        const bar = document.getElementById(LITE_BAR_ID);
        if (bar) bar.hidden = true;
        rollingLiteState = {
          ...rollingLiteState,
          enabled: false,
          conversationId: currentConversationId,
          lastError: null,
          lastSkipReason: 'history_search_navigation',
          hiddenContainerCount: 0,
          hiddenSectionCount: 0,
          arcaiaHiddenSectionCount: 0,
          removedContainerCount: 0,
          turnCountSetting: 'all'
        };
        return rollingLiteState;
      }

      const lite = await readCurrentLiteDisplayFromMain(1700, { reason, conversationId: currentConversationId });
      rollingLiteState.enabled = Boolean(lite?.enabled);
      rollingLiteState.conversationId = currentConversationId;
      if (!lite?.enabled) {
        setPromptTocHiddenActive(false);
        unhideRollingLiteContainers();
        clearObsoleteRestoredHistoryElements();
        const bar = document.getElementById(LITE_BAR_ID);
        if (bar) bar.hidden = true;
        rollingLiteState.lastSkipReason = 'lite_disabled';
        rollingLiteState.hiddenContainerCount = 0;
        rollingLiteState.hiddenSectionCount = 0;
        rollingLiteState.arcaiaHiddenSectionCount = 0;
        rollingLiteState.removedContainerCount = 0;
        return rollingLiteState;
      }

      if (fullLoadModeState.active && fullLoadModeState.conversationId && fullLoadModeState.conversationId !== currentConversationId) {
        fullLoadModeState = { active: false, conversationId: null, requestedAt: null, reason: 'conversation_changed' };
        writeFullLoadModeToStorage(fullLoadModeState);
      }
      if (fullLoadModeState.active && fullLoadModeState.conversationId === currentConversationId) {
        setPromptTocHiddenActive(false);
        unhideRollingLiteContainers();
        const fullPlan = buildLiteGroupingPlan(document, NATIVE_LITE_TURN_COUNT, false);
        const turns = fullPlan.groups.map((group) => ({
          containers: group.records.map((record) => record.section),
          hasUser: group.hasUser,
          hasAssistant: group.hasAssistant,
          kind: group.kind
        }));
        const fullGroupingDiagnostics = {
          ...getLiteGroupingDiagnostics(fullPlan),
          retainedGroupCount: turns.length,
          retainedSectionCount: fullPlan.model.physicalRecords.length,
          retainedMeaningfulSectionCount: fullPlan.model.meaningfulSectionCount,
          retainedEmptySectionCount: fullPlan.model.emptySectionCount,
          hiddenSectionCount: 0,
          arcaiaHiddenSectionCount: 0,
          fallbackUsed: false,
          fallbackReason: null
        };
        const now = Date.now();
        rollingLiteState = {
          ...rollingLiteState,
          ...fullGroupingDiagnostics,
          appVersion: APP_VERSION,
          enabled: true,
          applyCount: (rollingLiteState.applyCount || 0) + 1,
          lastApply: { at: now, atIso: nowIso(now), reason, fullLoadMode: true, detectedTurnCount: turns.length, hiddenContainerCount: 0, removedContainerCount: 0, ...fullGroupingDiagnostics },
          lastError: null,
          lastSkipReason: 'full_load_mode_active',
          hiddenContainerCount: 0,
          removedContainerCount: 0,
          visibleTurnCount: turns.length,
          detectedTurnCount: turns.length,
          retainedTurnCount: fullPlan.model.physicalRecords.length,
          retainedTurnRange: fullPlan.model.physicalRecords.length ? { firstVisibleTurnNumber: 1, lastVisibleTurnNumber: fullPlan.model.physicalRecords.length, totalDetectedTurnCount: fullPlan.model.physicalRecords.length } : null,
          turnCountSetting: 'all'
        };
        updateLiteBar(lite, rollingLiteState);
        return rollingLiteState;
      }

      const reasonText = String(reason || '');
      if (lite?.backendRewriteEnabled && reasonText.includes('interval')) {
        rollingLiteState = {
          ...rollingLiteState,
          enabled: true,
          conversationId: currentConversationId,
          lastSkipReason: lite?.backendRewriteExperiment ? 'backend_rewrite_experiment_interval_noop' : 'backend_rewrite_default_interval_noop',
          pruneMode: 'backend_rewrite_skip_dom_prune',
          removedContainerCount: 0,
          hiddenContainerCount: 0,
          prunedSectionCount: 0
        };
        return rollingLiteState;
      }

      const generationDetector = isLikelyChatGPTGenerating();
      const turnCount = getEffectiveLiteTurnCount(currentConversationId);
      const plan = buildLiteGroupingPlan(document, turnCount, generationDetector.generating);
      const turns = plan.groups.map((group) => ({
        containers: group.records.map((record) => record.section),
        hasUser: group.hasUser,
        hasAssistant: group.hasAssistant,
        kind: group.kind
      }));
      if (shouldNoopLiteForShortConversation(plan, turnCount)) {
        setPromptTocHiddenActive(false);
        unhideRollingLiteContainers();
        clearObsoleteRestoredHistoryElements();
        const groupingDiagnostics = getLiteGroupingDiagnostics(plan);
        rollingLiteState = {
          ...rollingLiteState,
          ...groupingDiagnostics,
          appVersion: APP_VERSION,
          enabled: true,
          conversationId: currentConversationId,
          applyCount: (rollingLiteState.applyCount || 0) + 1,
          lastError: null,
          lastSkipReason: 'below_lite_turn_threshold',
          lastGenerationDetector: generationDetector,
          hiddenContainerCount: 0,
          newlyHiddenContainerCount: 0,
          removedContainerCount: 0,
          prunedSectionCount: 0,
          pruneMode: 'short_conversation_noop',
          visibleTurnCount: turns.length,
          detectedTurnCount: turns.length,
          retainedTurnCount: groupingDiagnostics.retainedSectionCount,
          turnCountSetting: turnCount,
          lastApply: {
            at: Date.now(),
            atIso: nowIso(),
            reason,
            skippedDomPrune: true,
            skipReason: 'below_lite_turn_threshold',
            detectedTurnCount: turns.length,
            hiddenContainerCount: 0,
            removedContainerCount: 0,
            elapsedMs: Date.now() - applyStartedAt
          }
        };
        updateLiteBar(lite, rollingLiteState);
        return rollingLiteState;
      }

      setPromptTocHiddenActive(true);
      updateLiteBar(lite);

      if (lite?.backendRewriteEnabled) {
        unhideRollingLiteContainers();
        clearObsoleteRestoredHistoryElements();
        const groupingDiagnostics = getLiteGroupingDiagnostics(plan);
        const visibleTurns = getVisibleDomTurnsFromConversation();
        const now = Date.now();
        rollingLiteState = {
          ...rollingLiteState,
          ...groupingDiagnostics,
          appVersion: APP_VERSION,
          enabled: true,
          applyCount: (rollingLiteState.applyCount || 0) + 1,
          lastApply: {
            at: now,
            atIso: nowIso(now),
            reason,
            skippedDomPrune: true,
            skipReason: lite?.backendRewriteExperiment ? 'backend_rewrite_experiment_active' : 'backend_rewrite_default_active',
            backendRewriteEnabled: true,
            backendRewriteExperiment: Boolean(lite?.backendRewriteExperiment),
            detectedTurnCount: turns.length,
            visibleTurnCount: visibleTurns.length,
            removedContainerCount: 0,
            hiddenContainerCount: 0,
            elapsedMs: Date.now() - applyStartedAt
          },
          lastError: null,
          lastSkipReason: lite?.backendRewriteExperiment ? 'backend_rewrite_experiment_active' : 'backend_rewrite_default_active',
          lastGenerationDetector: generationDetector,
          hiddenContainerCount: 0,
          newlyHiddenContainerCount: 0,
          removedContainerCount: 0,
          prunedSectionCount: 0,
          pruneMode: 'backend_rewrite_skip_dom_prune',
          visibleTurnCount: visibleTurns.length,
          detectedTurnCount: turns.length,
          retainedTurnCount: groupingDiagnostics.retainedSectionCount,
          turnCountSetting: turnCount
        };
        updateLiteBar(lite, rollingLiteState);
        return rollingLiteState;
      }

      const reconcileResult = reconcileRollingLiteSections(plan);
      const promptTocPruneResult = { action: 'css_hide_all_prompt_toc_markers' };
      const groupingDiagnostics = getLiteGroupingDiagnostics(plan, reconcileResult);
      const newlyHiddenContainerCount = reconcileResult.newlyHiddenSectionCount;
      const removedContainerCount = reconcileResult.removedSectionCount || 0;

      const afterVisibleTurns = getVisibleDomTurnsFromConversation();
      const hiddenContainerCount = groupingDiagnostics.hiddenSectionCount;
      const now = Date.now();
      const expectedRemainingTurnCount = groupingDiagnostics.retainedSectionCount;
      const reachedTarget = hiddenContainerCount === plan.hiddenSections.size || plan.hiddenSections.size === 0;
      const retainedRecords = plan.model.physicalRecords.filter((record) => record.retained && !record.duplicate);
      const retainedTurnRange = retainedRecords.length ? {
        firstVisibleTurnNumber: retainedRecords[0].domIndex + 1,
        lastVisibleTurnNumber: retainedRecords[retainedRecords.length - 1].domIndex + 1,
        totalDetectedTurnCount: plan.model.physicalRecords.length
      } : null;
      rollingLiteState = {
        ...rollingLiteState,
        ...groupingDiagnostics,
        appVersion: APP_VERSION,
        enabled: true,
        applyCount: (rollingLiteState.applyCount || 0) + 1,
        lastApply: {
          at: now,
          atIso: nowIso(now),
          reason,
          turnCountSetting: turnCount,
          detectedTurnCount: turns.length,
          afterDetectedTurnCount: turns.length,
          afterVisibleTurnCount: afterVisibleTurns.length,
          hiddenContainerCount,
          newlyHiddenContainerCount,
          newlyUnhiddenSectionCount: reconcileResult.newlyUnhiddenSectionCount,
          staleHiddenCleanupCount: reconcileResult.staleHiddenCleanupCount,
          removedContainerCount,
          prunedSectionCount: removedContainerCount,
          expectedRemainingTurnCount,
          reachedTarget,
          pruneMode: 'css_hide',
          retainedTurnRange,
          promptTocPrune: promptTocPruneResult,
          ...groupingDiagnostics,
          elapsedMs: Date.now() - applyStartedAt
        },
        lastError: null,
        lastSkipReason: null,
        lastGenerationDetector: generationDetector,
        hiddenContainerCount,
        newlyHiddenContainerCount,
        removedContainerCount,
        prunedSectionCount: removedContainerCount,
        pruneMode: 'css_hide',
        visibleTurnCount: afterVisibleTurns.length,
        detectedTurnCount: turns.length,
        beforeDetectedTurnCount: turns.length,
        retainedTurnCount: groupingDiagnostics.retainedSectionCount,
        retainedTurnRange,
        turnCountSetting: turnCount,
        promptTocPrune: promptTocPruneResult
      };
      updateLiteBar(lite, rollingLiteState);
      return rollingLiteState;
    } catch (error) {
      rollingLiteState.lastError = error instanceof Error ? error.message : String(error);
      return rollingLiteState;
    }
  }


  async function flushRollingLiteApply() {
    rollingLiteApplyQueued = false;
    if (!rollingLiteUiStarted || !isArcaiaExtensionEnabled() || rollingLiteApplyInFlight) return;
    const reason = rollingLitePendingApplyReason || 'dom_event';
    rollingLitePendingApplyReason = null;
    rollingLiteApplyInFlight = true;
    try {
      await applyRollingLiteDom(reason);
    } finally {
      rollingLiteApplyInFlight = false;
      if (rollingLiteUiStarted && isArcaiaExtensionEnabled() && rollingLitePendingApplyReason) {
        rollingLiteApplyQueued = true;
        queueMicrotask(flushRollingLiteApply);
      }
    }
  }

  function scheduleRollingLiteApply(reason = 'dom_event') {
    if (!rollingLiteUiStarted || !isArcaiaExtensionEnabled()) return;
    rollingLitePendingApplyReason = String(reason || 'dom_event');
    if (rollingLiteApplyQueued || rollingLiteApplyInFlight) return;
    rollingLiteApplyQueued = true;
    queueMicrotask(flushRollingLiteApply);
  }

  function disconnectConversationDomContentObserver() {
    try { conversationDomContentObserver?.disconnect?.(); } catch {}
    conversationDomContentObserver = null;
    conversationDomObservedContentRoot = null;
    rollingLiteRolelessSectionState = new WeakMap();
  }

  function disconnectConversationDomStableAnchorObserver() {
    try { conversationDomStableAnchorObserver?.disconnect?.(); } catch {}
    conversationDomStableAnchorObserver = null;
    conversationDomObservedStableAnchor = null;
  }

  function isRollingLiteGroupingSectionMeaningful(section) {
    return Boolean(
      section?.isConnected
      && (getSectionOwnedRoleNodes(section).length > 0 || String(section.textContent || '').trim().length > 0)
    );
  }

  function resetRollingLiteGroupingMutationState(root = null) {
    rollingLiteRolelessSectionState = new WeakMap();
    if (!root?.querySelectorAll) return;
    for (const section of getTopLevelRollingLiteMessageSections(root)) {
      if (!section?.isConnected || getSectionOwnedRoleNodes(section).length > 0) continue;
      rollingLiteRolelessSectionState.set(section, isRollingLiteGroupingSectionMeaningful(section));
    }
  }

  function mutationNodeContainsLiteGroupingStructure(node) {
    if (!node) return false;
    return Boolean(
      node.matches?.(MESSAGE_SECTION_SELECTOR)
      || node.querySelector?.(MESSAGE_SECTION_SELECTOR)
      || node.matches?.(LITE_GROUPING_ROLE_SELECTOR)
      || node.querySelector?.(LITE_GROUPING_ROLE_SELECTOR)
    );
  }

  function collectRollingLiteMutationSections(mutation, sections) {
    if (!mutation || !(sections instanceof Set)) return;
    const candidates = [mutation.target, ...(mutation.addedNodes || [])];
    for (const node of candidates) {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!element) continue;
      const closestSection = element.matches?.(MESSAGE_SECTION_SELECTOR)
        ? element
        : element.closest?.(MESSAGE_SECTION_SELECTOR);
      if (closestSection && isTopLevelMessageSection(closestSection)) sections.add(closestSection);
      for (const section of element.querySelectorAll?.(MESSAGE_SECTION_SELECTOR) || []) {
        if (isTopLevelMessageSection(section)) sections.add(section);
      }
    }
  }

  function shouldScheduleRollingLiteForMutations(mutations) {
    let groupingChanged = false;
    const touchedSections = new Set();
    for (const mutation of mutations || []) {
      if (mutation?.type === 'attributes') {
        if (mutation.attributeName === 'data-message-author-role' || mutation.attributeName === 'data-message-id') {
          groupingChanged = true;
        }
      } else if (mutation?.type === 'childList') {
        const changedNodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
        if (changedNodes.some(mutationNodeContainsLiteGroupingStructure)) groupingChanged = true;
      }
      collectRollingLiteMutationSections(mutation, touchedSections);
    }

    for (const section of touchedSections) {
      if (!section?.isConnected) continue;
      if (getSectionOwnedRoleNodes(section).length > 0) {
        rollingLiteRolelessSectionState.delete(section);
        continue;
      }
      const nextMeaningful = isRollingLiteGroupingSectionMeaningful(section);
      const previousMeaningful = rollingLiteRolelessSectionState.get(section);
      if (previousMeaningful !== undefined && previousMeaningful !== nextMeaningful) groupingChanged = true;
      rollingLiteRolelessSectionState.set(section, nextMeaningful);
    }
    return groupingChanged;
  }

  function handleConversationDomMutations(mutations) {
    if (!conversationDomObserverStarted || !isArcaiaExtensionEnabled()) return;
    handleConversationDependentDomSignal('conversation_dom_mutation');
    if (codeBlockCollapserUiStarted && isArcaiaFeatureEnabled('blockCollapser')) {
      const roots = collectBlockCollapserMutationRoots(mutations);
      if (roots.size > 0) {
        const hasAttributeCandidate = mutations.some(isCodeBlockCollapserAttributeMutation);
        processBlockCollapserMutationRoots(roots, hasAttributeCandidate ? 'block_candidate_attribute_changed' : 'block_candidate_child_added');
      }
    }
    if (turnExportUiStarted && isArcaiaFeatureEnabled('turnMarkdownButtons')) handleTurnExportMutations(mutations);
    if (messageTimeUiStarted && isArcaiaFeatureEnabled('messageTimestamps')) handleMessageTimestampMutations(mutations);
    if (rollingLiteUiStarted && shouldScheduleRollingLiteForMutations(mutations)) {
      scheduleRollingLiteApply('conversation_grouping_mutation');
    }
  }

  function reconcileConversationDomFeatures(root, reason = 'content_root_ready') {
    if (!(root instanceof Element) || !isArcaiaExtensionEnabled()) return;
    if (codeBlockCollapserUiStarted && isArcaiaFeatureEnabled('blockCollapser')) scanCodeBlocksForCollapse(root);
    if (turnExportUiStarted && isArcaiaFeatureEnabled('turnMarkdownButtons')) {
      installTurnExportButtons(root);
      installTurnExportInteractionTriggers(root);
    }
    if (messageTimeUiStarted && isArcaiaFeatureEnabled('messageTimestamps')) scheduleApplyMessageTimestamps(reason);
    if (rollingLiteUiStarted) scheduleRollingLiteApply(reason);
  }

  function refreshConversationDomObserverBindings(reason = 'refresh') {
    if (!conversationDomObserverStarted || !isArcaiaExtensionEnabled()) {
      return { changed: false, reason, contentRoot: false, stableAnchor: false };
    }
    const contentRoot = findRollingLiteContentRoot();
    const stableAnchor = findRollingLiteStableAnchor(contentRoot);
    const stableAnchorChanged = stableAnchor !== conversationDomObservedStableAnchor;
    const contentRootChanged = contentRoot !== conversationDomObservedContentRoot;

    if (stableAnchorChanged) {
      disconnectConversationDomStableAnchorObserver();
      conversationDomObservedStableAnchor = stableAnchor;
      if (stableAnchor) {
        conversationDomStableAnchorObserver = new MutationObserver(() => {
          if (!conversationDomObserverStarted) return;
          handleConversationDependentDomSignal('stable_anchor_direct_child_mutation');
          const refresh = refreshConversationDomObserverBindings('stable_anchor_direct_child_mutation');
          if (!refresh.changed && conversationDomObservedContentRoot) {
            reconcileConversationDomFeatures(conversationDomObservedContentRoot, 'stable_anchor_direct_child_mutation');
          }
        });
        conversationDomStableAnchorObserver.observe(stableAnchor, { childList: true, subtree: false });
      }
    }

    if (contentRootChanged) {
      disconnectConversationDomContentObserver();
      conversationDomObservedContentRoot = contentRoot;
      if (contentRoot) {
        resetRollingLiteGroupingMutationState(contentRoot);
        conversationDomContentObserver = new MutationObserver(handleConversationDomMutations);
        conversationDomContentObserver.observe(contentRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            'data-message-author-role',
            'data-message-id',
            'data-writing-block',
            'data-writing-block-fullscreen-fallback-target',
            'data-writing-block-fullscreen-header-chrome',
            'data-start',
            'data-end'
          ]
        });
        reconcileConversationDomFeatures(contentRoot, `content_root_rebound:${reason}`);
      }
    }

    return {
      changed: stableAnchorChanged || contentRootChanged,
      reason,
      contentRoot: Boolean(contentRoot),
      stableAnchor: Boolean(stableAnchor)
    };
  }

  function startConversationDomObserver() {
    if (!isArcaiaExtensionEnabled()) return;
    conversationDomObserverStarted = true;
    refreshConversationDomObserverBindings('startup');
  }

  function stopConversationDomObserver() {
    conversationDomObserverStarted = false;
    disconnectConversationDomContentObserver();
    disconnectConversationDomStableAnchorObserver();
  }

  let observedPageConversationId = tryExtractConversationIdFromUrl(window.location.href);
  let observedPageUrl = window.location.href;
  let pageConversationMonitorStarted = false;
  let pageConversationSyncInFlight = false;
  let pageConversationSyncQueued = false;
  let pageConversationScheduledSyncReason = null;
  let pageConversationPendingSyncReason = null;
  let pageConversationPendingDomSync = null;
  let pageConversationPendingDomObserver = null;
  let pageConversationPendingDomObserverTarget = null;

  function disconnectPageConversationPendingDomObserver() {
    try { pageConversationPendingDomObserver?.disconnect?.(); } catch {}
    pageConversationPendingDomObserver = null;
    pageConversationPendingDomObserverTarget = null;
  }

  function getConversationDependentDomIdentity() {
    const composer = document.querySelector('form[data-type="unified-composer"]');
    const modelTrigger = composer?.querySelector?.('button[aria-haspopup="menu"]') || null;
    const shareButton = findNativeShareButton();
    const header = shareButton?.closest?.('header') || document.querySelector('header');
    return {
      composer: composer instanceof Element ? composer : null,
      modelTrigger: modelTrigger instanceof Element ? modelTrigger : null,
      header: header instanceof Element ? header : null,
      shareButton: shareButton instanceof Element ? shareButton : null,
      actionsContainer: shareButton?.parentElement instanceof Element ? shareButton.parentElement : null
    };
  }

  function sameConversationDependentDomIdentity(left, right) {
    return Boolean(left && right)
      && left.composer === right.composer
      && left.modelTrigger === right.modelTrigger
      && left.header === right.header
      && left.shareButton === right.shareButton
      && left.actionsContainer === right.actionsContainer;
  }

  function isConversationDependentDomIdentityReady(identity) {
    const modelReady = !isArcaiaFeatureEnabled('modelDecoration') || Boolean(
      identity?.composer?.isConnected
    );
    const headerReady = !isArcaiaFeatureEnabled('headerMarkdownButton') || Boolean(
      identity?.header?.isConnected
      && identity?.shareButton?.isConnected
      && identity?.actionsContainer?.isConnected
    );
    return modelReady && headerReady;
  }

  function getCurrentConversationDependentDomSyncPending() {
    const pending = pageConversationPendingDomSync;
    if (!pending) return null;
    if (
      pending.pageUrl !== window.location.href
      || pending.conversationId !== tryExtractConversationIdFromUrl(window.location.href)
    ) return null;
    return pending;
  }

  function nodeContainsConversationDependentDomRoot(node) {
    if (!(node instanceof Element)) return false;
    const selector = 'header, form[data-type="unified-composer"]';
    if (node.matches?.(selector)) return true;
    return Boolean(node.querySelector?.(selector));
  }

  function isPageConversationPendingDomMutationRelevant(mutations) {
    return Array.from(mutations || []).some((mutation) => {
      if (mutation.type !== 'childList') return false;
      const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
      if (target?.closest?.('header')) return true;
      return [...mutation.addedNodes, ...mutation.removedNodes]
        .some(nodeContainsConversationDependentDomRoot);
    });
  }

  function ensurePageConversationPendingDomObserver() {
    const pending = getCurrentConversationDependentDomSyncPending();
    if (
      !pending?.conversationId
      || !pageConversationMonitorStarted
      || !isArcaiaExtensionEnabled()
    ) {
      disconnectPageConversationPendingDomObserver();
      return false;
    }
    const target = document.documentElement;
    if (!(target instanceof Element)) return false;
    if (
      pageConversationPendingDomObserver
      && pageConversationPendingDomObserverTarget === target
      && target.isConnected
    ) return true;
    disconnectPageConversationPendingDomObserver();
    pageConversationPendingDomObserverTarget = target;
    pageConversationPendingDomObserver = new MutationObserver((mutations) => {
      const current = getCurrentConversationDependentDomSyncPending();
      if (!current || !pageConversationMonitorStarted || !isArcaiaExtensionEnabled()) {
        disconnectPageConversationPendingDomObserver();
        return;
      }
      if (!isPageConversationPendingDomMutationRelevant(mutations)) return;
      noteConversationDependentDomSyncSignal('pending_conversation_dom_mutation');
    });
    pageConversationPendingDomObserver.observe(target, { childList: true, subtree: true });
    return true;
  }

  function markConversationDependentDomSyncPending(reason = 'navigation') {
    if (!pageConversationMonitorStarted || !isArcaiaExtensionEnabled()) return null;
    const pageUrl = window.location.href;
    const conversationId = tryExtractConversationIdFromUrl(pageUrl);
    const current = getCurrentConversationDependentDomSyncPending();
    if (current) {
      ensurePageConversationPendingDomObserver();
      return current;
    }
    pageConversationPendingDomSync = {
      pageUrl,
      conversationId,
      reason,
      baselineIdentity: getConversationDependentDomIdentity(),
      lastSignaledIdentity: null,
      domSignalReceived: false
    };
    ensurePageConversationPendingDomObserver();
    return pageConversationPendingDomSync;
  }

  function noteConversationDependentDomSyncSignal(reason = 'conversation_dom_signal') {
    const pending = getCurrentConversationDependentDomSyncPending();
    if (!pending) return false;
    const identity = getConversationDependentDomIdentity();
    if (!isConversationDependentDomIdentityReady(identity)) return false;
    if (sameConversationDependentDomIdentity(identity, pending.baselineIdentity)) return false;
    if (sameConversationDependentDomIdentity(identity, pending.lastSignaledIdentity)) return false;
    pending.lastSignaledIdentity = identity;
    pending.domSignalReceived = true;
    scheduleConversationDependentStateSync(reason);
    return true;
  }

  function handleConversationDependentDomSignal(reason = 'conversation_dom_signal') {
    if (!pageConversationMonitorStarted || !isArcaiaExtensionEnabled()) return false;
    if (hasObservedPageConversationStateChanged()) {
      markConversationDependentDomSyncPending('mutation_url_check');
    }
    return noteConversationDependentDomSyncSignal(reason);
  }

  function hasObservedPageConversationStateChanged() {
    return observedPageUrl !== window.location.href
      || observedPageConversationId !== tryExtractConversationIdFromUrl(window.location.href);
  }

  function scheduleConversationDependentStateSync(reason = 'scheduled_url_check') {
    if (!isArcaiaExtensionEnabled()) return;
    pageConversationScheduledSyncReason = String(reason || 'scheduled_url_check');
    if (pageConversationSyncQueued) return;
    pageConversationSyncQueued = true;
    queueMicrotask(() => {
      pageConversationSyncQueued = false;
      if (!pageConversationMonitorStarted || !isArcaiaExtensionEnabled()) return;
      const syncReason = pageConversationScheduledSyncReason || 'scheduled_url_check';
      pageConversationScheduledSyncReason = null;
      syncConversationDependentState(syncReason);
    });
  }

  async function syncConversationDependentState(reason = 'main_world_navigation') {
    if (!isArcaiaExtensionEnabled()) return;
    if (pageConversationSyncInFlight) {
      pageConversationPendingSyncReason = reason;
      return;
    }
    const nextUrl = window.location.href;
    const nextConversationId = tryExtractConversationIdFromUrl(nextUrl);
    const previousConversationId = observedPageConversationId;
    const conversationChanged = previousConversationId !== nextConversationId;
    const urlChanged = observedPageUrl !== nextUrl;
    const controlledRecentViewRoundTrip = Boolean(
      recentViewRefreshState.active
      && recentViewRefreshState.conversationId
      && (
        previousConversationId === recentViewRefreshState.conversationId
        || nextConversationId === recentViewRefreshState.conversationId
      )
    );
    const leavingExpandedConversation = Boolean(
      conversationChanged
      && previousConversationId
      && previousConversationId === recentViewExpansionState?.conversationId
      && !controlledRecentViewRoundTrip
    );
    const pendingDomSync = getCurrentConversationDependentDomSyncPending();
    if (!conversationChanged && !urlChanged && !pendingDomSync?.domSignalReceived) return;

    if (conversationChanged) {
      reconcileAssistantGenerationConversationChange(
        previousConversationId,
        nextConversationId,
        `conversation_changed:${reason}`
      );
    }

    observedPageUrl = nextUrl;
    observedPageConversationId = nextConversationId;
    clearLiteDisplayMainCache(conversationChanged ? 'conversation_changed' : 'url_changed');
    pageConversationSyncInFlight = true;
    try {
      if (conversationChanged) {
        unhideRollingLiteContainers();
        clearObsoleteRestoredHistoryElements();
        removeRecentViewHistoryControls();
        if (!controlledRecentViewRoundTrip) {
          fullLoadModeState = { active: false, conversationId: null, requestedAt: null, reason: 'conversation_changed' };
          writeFullLoadModeToStorage(fullLoadModeState);
        }
        if (leavingExpandedConversation) clearRecentViewExpansionState();
        if (messageTimeUiStarted) {
          resetMessageTimeStateForConversation(nextConversationId);
          markInitialMessageTimeRoleNodes(getRoleNodesForTimestampBadges(), 'conversation_changed_initial_dom_snapshot');
        }
        resetRollingLiteStateForConversation(nextConversationId);
      }

      const mainWorldSync = await syncMainWorldConversation(1800, reason).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
      if (leavingExpandedConversation) {
        await resetRecentViewMainWorldOverride('conversation_changed_clear_recent_view_expansion').catch(() => null);
      }
      const cachedConversationModelConfig = mainWorldSync?.conversationModelConfig || null;
      const currentConversationIdAfterSync = tryExtractConversationIdFromUrl(window.location.href);
      if (
        nextConversationId
        && currentConversationIdAfterSync === nextConversationId
        && cachedConversationModelConfig?.conversationId === nextConversationId
      ) {
        try {
          window.__ARCAIA_MODEL_SELECTOR_UI__?.applyConversationModelConfig?.(
            cachedConversationModelConfig,
            'main_world_conversation_cache_sync'
          );
        } catch {}
      }
      try {
        window.__ARCAIA_MODEL_SELECTOR_UI__?.scan?.('conversation_state_sync_complete');
      } catch {}
      if (assistantLoadingFaviconMonitorStarted) {
        refreshAssistantLoadingStreamRootObserver(conversationChanged ? 'conversation_changed' : 'url_changed');
        if (isAssistantActivityFeedbackEnabled()) {
          scheduleAssistantLoadingFaviconCheck(conversationChanged ? 'conversation_changed' : 'url_changed');
        }
      }
      refreshConversationDomObserverBindings(conversationChanged ? 'conversation_changed' : 'url_changed');
      syncHeaderMarkdownButtonUi(conversationChanged ? 'conversation_changed' : 'url_changed');
      if (nextConversationId) {
        scheduleApplyMessageTimestamps('conversation_changed_dom_first_observation');
        scheduleRefreshMessageTimestampIndex('conversation_changed_existing_fetch_index');
        scheduleRollingLiteApply('conversation_changed');
      } else {
        const bar = document.getElementById(LITE_BAR_ID);
        if (bar) bar.hidden = true;
        scheduleRollingLiteApply('not_conversation_page');
      }
      const completedPendingDomSync = getCurrentConversationDependentDomSyncPending();
      if (
        completedPendingDomSync?.domSignalReceived
        && isConversationDependentDomIdentityReady(getConversationDependentDomIdentity())
      ) {
        pageConversationPendingDomSync = null;
        disconnectPageConversationPendingDomObserver();
      }
    } finally {
      pageConversationSyncInFlight = false;
      signalRecentViewRefreshConditions();
      const pendingReason = pageConversationPendingSyncReason;
      pageConversationPendingSyncReason = null;
      if (
        pageConversationMonitorStarted
        && isArcaiaExtensionEnabled()
        && (pendingReason || hasObservedPageConversationStateChanged())
      ) {
        scheduleConversationDependentStateSync(pendingReason || 'main_world_navigation_queued');
      }
    }
  }

  function startPageConversationMonitor() {
    if (!isArcaiaExtensionEnabled() || pageConversationMonitorStarted || window.top !== window) return;
    pageConversationMonitorStarted = true;
    scheduleConversationDependentStateSync('monitor_started');
  }

  function stopPageConversationMonitor() {
    pageConversationSyncQueued = false;
    pageConversationScheduledSyncReason = null;
    pageConversationPendingSyncReason = null;
    pageConversationPendingDomSync = null;
    disconnectPageConversationPendingDomObserver();
    pageConversationMonitorStarted = false;
    pageConversationSyncInFlight = false;
  }

  function startRollingLiteUi() {
    if (!isArcaiaExtensionEnabled()) return;
    installLiteDisplayStyles();
    if (!(fullLoadModeState.active && fullLoadModeState.conversationId === tryExtractConversationIdFromUrl(window.location.href))) {
      setPromptTocHiddenActive(true);
    }
    rollingLiteUiStarted = true;
    startConversationDomObserver();
    refreshConversationDomObserverBindings('rolling_lite_startup');
    resetRollingLiteGroupingMutationState(conversationDomObservedContentRoot);
    scheduleRollingLiteApply('initial_dom_ready');
  }

  function stopRollingLiteUi() {
    rollingLiteUiStarted = false;
    rollingLiteApplyQueued = false;
    rollingLitePendingApplyReason = null;
    rollingLiteRolelessSectionState = new WeakMap();
    setPromptTocHiddenActive(false);
    removeRecentViewHistoryControls();
    removeRecentViewLoadingOverlay();
    removeRecentViewFailureNotice();
  }

  const CTRL_ENTER_COMPOSER_FORM_SELECTOR = 'form[data-type="unified-composer"]';
  let ctrlEnterSendInstalled = false;

  function isCtrlEnterElementVisible(el) {
    if (!el) return false;
    return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects?.().length);
  }

  function isCtrlEnterElementDisabled(el) {
    if (!el) return true;
    return Boolean(el.disabled || el.getAttribute?.('aria-disabled') === 'true' || el.dataset?.disabled === 'true');
  }

  function isCtrlEnterJapaneseComposing(event) {
    return Boolean(event?.isComposing || event?.keyCode === 229);
  }

  function isPlainEnterKey(event) {
    return event?.key === 'Enter' && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
  }

  function isCtrlEnterKey(event) {
    return event?.key === 'Enter' && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
  }

  function isEditableMessageTextarea(el) {
    if (!(el instanceof HTMLTextAreaElement)) return false;
    const aria = el.getAttribute('aria-label') || '';
    return aria.includes('メッセージを編集') || aria.toLowerCase().includes('edit message');
  }

  function findEditSubmitButton(textarea) {
    const turn = textarea.closest('[data-turn="user"]')
      || textarea.closest('[data-testid^="conversation-turn-"]')
      || textarea.closest('section');
    if (!(turn instanceof Element)) return null;
    const buttons = Array.from(turn.querySelectorAll('button'));
    return buttons.find((button) => {
      const text = normalizePinnedSortText(button.textContent || '');
      return ['送信する', 'submit', 'save'].includes(text.toLowerCase()) && isCtrlEnterElementVisible(button) && !isCtrlEnterElementDisabled(button);
    }) || null;
  }

  function getCtrlEnterComposerForm(fromEl) {
    if (!(fromEl instanceof Element)) return null;
    const form = fromEl.closest(CTRL_ENTER_COMPOSER_FORM_SELECTOR);
    return form instanceof HTMLFormElement ? form : null;
  }

  function getPromptEditorFromKeyTarget(fromEl) {
    if (!(fromEl instanceof Element)) return null;
    const editor = fromEl.closest('#prompt-textarea.ProseMirror[contenteditable="true"]')
      || fromEl.closest('[role="textbox"][contenteditable="true"][aria-multiline="true"]');
    if (!(editor instanceof HTMLElement) || !isCtrlEnterElementVisible(editor)) return null;
    const form = getCtrlEnterComposerForm(editor);
    if (!(form instanceof HTMLFormElement) || !form.contains(editor)) return null;
    return editor;
  }

  function findComposerSendButton(fromEl) {
    const form = getCtrlEnterComposerForm(fromEl);
    if (!(form instanceof HTMLFormElement)) return null;
    const selectors = [
      '#composer-submit-button[data-testid="send-button"]',
      'button[data-testid="send-button"]',
      'button[aria-label="プロンプトを送信する"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="送信"]'
    ];
    for (const selector of selectors) {
      const button = Array.from(form.querySelectorAll(selector))
        .find((candidate) => candidate instanceof HTMLButtonElement && isCtrlEnterElementVisible(candidate) && !isCtrlEnterElementDisabled(candidate));
      if (button) return button;
    }
    return null;
  }

  function clickComposerSendButton(editor) {
    const button = findComposerSendButton(editor);
    if (!button) return false;
    button.click();
    return true;
  }

  function dispatchCtrlEnterShiftEnter(originalEvent, editor) {
    editor.focus();
    const eventInit = {
      key: 'Enter',
      code: originalEvent.code || 'Enter',
      location: originalEvent.location || 0,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      repeat: Boolean(originalEvent.repeat),
      bubbles: true,
      cancelable: true,
      composed: true
    };
    editor.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    editor.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  }

  function handleCtrlEnterKeydown(event) {
    if (!isArcaiaExtensionEnabled()) return;
    if (event.key !== 'Enter') return;
    if (isCtrlEnterJapaneseComposing(event)) return;
    const target = event.target;

    if (isEditableMessageTextarea(target)) {
      if (isPlainEnterKey(event)) return;
      if (!isCtrlEnterKey(event)) return;
      const button = findEditSubmitButton(target);
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      button.click();
      return;
    }

    const editor = getPromptEditorFromKeyTarget(target);
    if (!(editor instanceof HTMLElement)) return;

    if (isCtrlEnterKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      clickComposerSendButton(editor);
      return;
    }

    if (isPlainEnterKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      dispatchCtrlEnterShiftEnter(event, editor);
    }
  }

  function startCtrlEnterSendUi() {
    if (!isArcaiaExtensionEnabled() || ctrlEnterSendInstalled) return;
    ctrlEnterSendInstalled = true;
    document.addEventListener('keydown', handleCtrlEnterKeydown, true);
  }

  function stopCtrlEnterSendUi() {
    if (!ctrlEnterSendInstalled) return;
    document.removeEventListener('keydown', handleCtrlEnterKeydown, true);
    ctrlEnterSendInstalled = false;
  }

  const CODE_BLOCK_COLLAPSER_STYLE_ID = 'arcaia-code-block-collapser-style';
  const CODE_BLOCK_COLLAPSED_ATTR = 'data-arcaia-code-block-collapsed';
  const CODE_BLOCK_PROCESSED_ATTR = 'data-arcaia-code-block-collapser-processed';
  const WRITING_BLOCK_PROCESSED_ATTR = 'data-arcaia-writing-block-collapser-processed';
  const CODE_BLOCK_TOGGLE_BOUND_ATTR = 'data-arcaia-code-block-toggle-bound';
  const CODE_BLOCK_HEADER_CLASS = 'arcaia-code-block-collapse-header';
  const CODE_BLOCK_TOGGLE_CLASS = 'arcaia-code-block-collapse-toggle';
  const CODE_BLOCK_MIN_COLLAPSE_LINES = 6;
  const CODE_BLOCK_OUTER_SELECTOR = 'pre[data-start][data-end]';
  const CODE_BLOCK_VIEWER_SELECTOR = '[id="code-block-viewer"]';
  const WRITING_OUTER_SELECTOR = '[data-writing-block-fullscreen-fallback-target="inline"]';
  const WRITING_BLOCK_SELECTOR = '[data-writing-block]';
  const WRITING_HEADER_CHROME_SELECTOR = '[data-writing-block-fullscreen-header-chrome="true"]';
  const WRITING_EDITOR_WRAPPER_SELECTOR = '.writing-block-editor';
  const WRITING_EDITOR_REGION_SELECTOR = '[data-writing-block-fullscreen-editor-region="true"]';
  let codeBlockCollapserUiStarted = false;

  function injectCodeBlockCollapserStyle() {
    if (document.getElementById(CODE_BLOCK_COLLAPSER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CODE_BLOCK_COLLAPSER_STYLE_ID;
    style.textContent = `
      .${CODE_BLOCK_HEADER_CLASS} {
        position: relative !important;
      }

      .${CODE_BLOCK_TOGGLE_CLASS} {
        position: absolute !important;
        left: 50% !important;
        top: 50% !important;
        transform: translate(-50%, -50%) !important;
        width: clamp(108px, calc(100% - 420px), 165px) !important;
        height: 30px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 0 8px !important;
        margin: 0 !important;
        border: none !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        outline: none !important;
        color: currentColor !important;
        font: inherit !important;
        font-size: 12px !important;
        line-height: 1 !important;
        font-weight: 500 !important;
        opacity: 0.78 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        cursor: pointer !important;
        user-select: none !important;
        pointer-events: auto !important;
        z-index: 20 !important;
        -webkit-tap-highlight-color: transparent !important;
      }

      [${WRITING_BLOCK_PROCESSED_ATTR}="true"].${CODE_BLOCK_HEADER_CLASS} {
        min-height: 34px !important;
      }

      .${CODE_BLOCK_TOGGLE_CLASS}:hover,
      .${CODE_BLOCK_TOGGLE_CLASS}:active,
      .${CODE_BLOCK_TOGGLE_CLASS}:focus,
      .${CODE_BLOCK_TOGGLE_CLASS}:focus-visible,
      .${CODE_BLOCK_TOGGLE_CLASS}:focus-within {
        background: transparent !important;
        box-shadow: none !important;
        outline: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getArcaiaClassText(el) {
    if (!(el instanceof Element)) return '';
    const value = el.getAttribute('class');
    return typeof value === 'string' ? value : '';
  }

  function getArcaiaControlLabel(el) {
    if (!(el instanceof Element)) return '';
    return [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('data-testid'),
      el.textContent
    ].filter(Boolean).join(' ').trim().toLowerCase();
  }

  function isCodeBlockCopyButton(button) {
    const label = getArcaiaControlLabel(button);
    return label.includes('コピー') || label.includes('copy');
  }

  function isWritingEditButton(button) {
    const label = getArcaiaControlLabel(button);
    return label.includes('編集') || label.includes('edit');
  }

  function countCodeBlockLines(el) {
    if (!(el instanceof HTMLElement)) return 0;
    const text = (el.innerText || el.textContent || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
    if (!text.trim()) return 0;
    return text.split('\n').length;
  }

  function shouldCollapseCodeBlock(el) {
    return countCodeBlockLines(el) >= CODE_BLOCK_MIN_COLLAPSE_LINES;
  }

  function removeLegacyCodeBlockCollapseElements(root) {
    if (!(root instanceof Element)) return;
    const selector = [
      '.chatopi-writing-block-collapse-button',
      '.chatopi-writing-block-collapse-placeholder',
      '.chatopi-writing-block-center-toggle-button',
      '.chatopi-writing-block-center-toggle-label',
      '.chatopi-writing-block-center-toggle-no-highlight',
      '.chatopi-writing-block-clickable-header',
      '.chatopi-block-center-toggle-button',
      '.chatopi-block-center-toggle-no-highlight'
    ].join(',');
    for (const el of Array.from(root.querySelectorAll(selector))) el.remove();
  }

  function findCodeHeaderRows(codeOuterBlock) {
    return Array.from(codeOuterBlock.querySelectorAll('div')).filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const classText = getArcaiaClassText(el);
      return classText.includes('items-center') && classText.includes('justify-between') && el.querySelector('button') instanceof HTMLElement;
    });
  }

  function getCodeLanguageText(headerChrome) {
    const copyButtons = Array.from(headerChrome.querySelectorAll('button')).filter(isCodeBlockCopyButton);
    let cleaned = normalizePinnedSortText(headerChrome.textContent || '');
    for (const button of copyButtons) {
      const buttonText = normalizePinnedSortText(button.textContent || '');
      if (buttonText) cleaned = cleaned.replace(buttonText, '').trim();
    }
    return cleaned;
  }

  function isRealCodeHeader(headerChrome) {
    if (!(headerChrome instanceof HTMLElement)) return false;
    const buttons = Array.from(headerChrome.querySelectorAll('button'));
    if (!buttons.some(isCodeBlockCopyButton)) return false;
    if (!(headerChrome.querySelector('svg') instanceof SVGElement)) return false;
    return Boolean(getCodeLanguageText(headerChrome));
  }

  function findCodeHeaderChrome(codeOuterBlock) {
    for (const row of findCodeHeaderRows(codeOuterBlock)) {
      if (isRealCodeHeader(row)) return row;
    }
    return null;
  }

  function findCodeCardRoot(codeOuterBlock, codeViewer, headerChrome) {
    let el = codeViewer.parentElement;
    while (el && el !== codeOuterBlock) {
      if (el instanceof HTMLElement && el.contains(headerChrome)) {
        const classText = getArcaiaClassText(el);
        if (classText.includes('bg-token-bg-elevated-secondary') || classText.includes('overflow-clip') || classText.includes('rounded-3xl')) {
          return el;
        }
      }
      el = el.parentElement;
    }
    return codeOuterBlock;
  }

  function findCodeFallbackContentTarget(codeOuterBlock, codeViewer) {
    let candidate = codeViewer;
    let el = codeViewer.parentElement;
    while (el && el !== codeOuterBlock) {
      if (el instanceof HTMLElement) {
        const classText = getArcaiaClassText(el);
        if (classText.includes('relative') && classText.includes('z-0') && classText.includes('flex')) candidate = el;
      }
      el = el.parentElement;
    }
    return candidate instanceof HTMLElement ? candidate : codeViewer;
  }

  function findCodeContentTargets(codeOuterBlock, codeViewer, headerChrome) {
    const cardRoot = findCodeCardRoot(codeOuterBlock, codeViewer, headerChrome);
    if (cardRoot instanceof HTMLElement && cardRoot !== codeOuterBlock) {
      const directChildren = Array.from(cardRoot.children).filter((child) => child instanceof HTMLElement);
      const body = directChildren.find((child) => child instanceof HTMLElement && child.contains(codeViewer) && !child.contains(headerChrome));
      const decorations = directChildren.filter((child) => {
        if (!(child instanceof HTMLElement)) return false;
        if (child.contains(codeViewer) || child.contains(headerChrome)) return false;
        return getArcaiaClassText(child).includes('pointer-events-none');
      });
      const targets = [];
      if (body instanceof HTMLElement) targets.push(body);
      for (const decoration of decorations) if (decoration instanceof HTMLElement) targets.push(decoration);
      if (targets.length > 0) return targets;
    }
    return [findCodeFallbackContentTarget(codeOuterBlock, codeViewer)];
  }

  function ensureCodeBlockToggle(headerChrome) {
    let toggle = headerChrome.querySelector(`.${CODE_BLOCK_TOGGLE_CLASS}`);
    if (toggle instanceof HTMLButtonElement) return toggle;
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = CODE_BLOCK_TOGGLE_CLASS;
    toggle.tabIndex = -1;
    toggle.textContent = 'クリックで展開';
    headerChrome.appendChild(toggle);
    return toggle;
  }

  function setCodeBlockTextIfChanged(el, value) {
    if (el.textContent !== value) el.textContent = value;
  }

  function setCodeBlockTargetsDisplay(targets, collapsed) {
    for (const target of targets) {
      if (!(target instanceof HTMLElement)) continue;
      target.style.display = collapsed ? 'none' : '';
    }
  }

  function setCodeBlockCollapsed(root, contentTargets, toggle, collapsed) {
    root.setAttribute(CODE_BLOCK_COLLAPSED_ATTR, collapsed ? 'true' : 'false');
    setCodeBlockTargetsDisplay(contentTargets, collapsed);
    const label = collapsed ? 'クリックで展開' : 'クリックで折りたたみ';
    setCodeBlockTextIfChanged(toggle, label);
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function bindCodeBlockToggle(root, contentTargets, toggle) {
    if (toggle.getAttribute(CODE_BLOCK_TOGGLE_BOUND_ATTR) === 'true') return;
    toggle.addEventListener('mousedown', (event) => {
      if (typeof event.button === 'number' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const collapsed = root.getAttribute(CODE_BLOCK_COLLAPSED_ATTR) === 'true';
      setCodeBlockCollapsed(root, contentTargets, toggle, !collapsed);
    }, true);
    toggle.setAttribute(CODE_BLOCK_TOGGLE_BOUND_ATTR, 'true');
  }

  function findWritingEditorWrapper(outerBlock) {
    const editorWrapper = outerBlock.querySelector(WRITING_EDITOR_WRAPPER_SELECTOR);
    if (editorWrapper instanceof HTMLElement) return editorWrapper;

    const editorRegion = outerBlock.querySelector(WRITING_EDITOR_REGION_SELECTOR);
    if (editorRegion instanceof HTMLElement) {
      const closestWrapper = editorRegion.closest(WRITING_EDITOR_WRAPPER_SELECTOR);
      if (closestWrapper instanceof HTMLElement) return closestWrapper;
      return editorRegion;
    }

    const writingBlock = outerBlock.querySelector(WRITING_BLOCK_SELECTOR);
    if (writingBlock instanceof HTMLElement) return writingBlock;

    return null;
  }

  function findWritingBlockInOuter(outerBlock) {
    if (!(outerBlock instanceof HTMLElement)) return null;
    if (outerBlock.matches?.(WRITING_BLOCK_SELECTOR)) return outerBlock;
    const writingBlock = outerBlock.querySelector(WRITING_BLOCK_SELECTOR);
    return writingBlock instanceof HTMLElement ? writingBlock : null;
  }

  function findWritingOuterBlock(writingBlock) {
    if (!(writingBlock instanceof HTMLElement)) return null;
    const legacyOuter = writingBlock.closest(WRITING_OUTER_SELECTOR);
    if (legacyOuter instanceof HTMLElement) return legacyOuter;
    const section = writingBlock.closest('section');
    return section instanceof HTMLElement ? section : null;
  }

  function findWritingHeaderChrome(outerBlock) {
    const headerChrome = outerBlock.querySelector(WRITING_HEADER_CHROME_SELECTOR);
    if (headerChrome instanceof HTMLElement) return headerChrome;

    const editButton = Array.from(outerBlock.querySelectorAll('button')).find(isWritingEditButton);
    if (!(editButton instanceof HTMLElement)) return outerBlock;

    let candidate = editButton.parentElement;
    while (candidate && candidate !== outerBlock) {
      if (candidate instanceof HTMLElement) {
        const classText = getArcaiaClassText(candidate);
        if (classText.includes('items-center') || classText.includes('justify-between') || candidate.querySelectorAll('button').length >= 1) {
          return candidate;
        }
      }
      candidate = candidate.parentElement;
    }

    return editButton.parentElement instanceof HTMLElement ? editButton.parentElement : outerBlock;
  }

  function hasWritingEditButton(headerChrome) {
    const buttons = Array.from(headerChrome.querySelectorAll('button'));
    return buttons.some(isWritingEditButton);
  }

  function processWritingBlockForCollapse(outerBlock) {
    if (!isArcaiaExtensionEnabled()) return;
    if (!(outerBlock instanceof HTMLElement)) return;
    const writingBlock = findWritingBlockInOuter(outerBlock);
    if (!(writingBlock instanceof HTMLElement)) return;
    const editorWrapper = findWritingEditorWrapper(outerBlock);
    if (!(editorWrapper instanceof HTMLElement)) return;
    const headerCandidate = findWritingHeaderChrome(outerBlock);
    const headerChrome = headerCandidate instanceof HTMLElement && !editorWrapper.contains(headerCandidate) ? headerCandidate : outerBlock;
    if (!(headerChrome instanceof HTMLElement)) return;

    removeLegacyCodeBlockCollapseElements(outerBlock);
    headerChrome.classList.add(CODE_BLOCK_HEADER_CLASS);
    const toggle = ensureCodeBlockToggle(headerChrome);
    const contentTargets = [editorWrapper];
    bindCodeBlockToggle(outerBlock, contentTargets, toggle);

    if (outerBlock.getAttribute(WRITING_BLOCK_PROCESSED_ATTR) === 'true') {
      const collapsed = outerBlock.getAttribute(CODE_BLOCK_COLLAPSED_ATTR) === 'true';
      setCodeBlockCollapsed(outerBlock, contentTargets, toggle, collapsed);
      return;
    }

    outerBlock.setAttribute(WRITING_BLOCK_PROCESSED_ATTR, 'true');
    setCodeBlockCollapsed(outerBlock, contentTargets, toggle, shouldCollapseCodeBlock(editorWrapper));
  }

  function scanWritingBlocksForCollapse(root = document) {
    if (!isArcaiaExtensionEnabled()) return;
    injectCodeBlockCollapserStyle();
    const blocks = new Set();
    const addWritingOuter = (candidate) => {
      if (!(candidate instanceof HTMLElement)) return;
      const outerBlock = candidate.matches?.(WRITING_BLOCK_SELECTOR) ? findWritingOuterBlock(candidate) : candidate;
      if (outerBlock instanceof HTMLElement) blocks.add(outerBlock);
    };
    if (root instanceof Element && (root.matches?.(WRITING_OUTER_SELECTOR) || root.matches?.(WRITING_BLOCK_SELECTOR))) addWritingOuter(root);
    const queryRoot = root instanceof Document || root instanceof DocumentFragment || root instanceof Element ? root : document;
    for (const block of Array.from(queryRoot.querySelectorAll?.(WRITING_OUTER_SELECTOR) || [])) addWritingOuter(block);
    for (const block of Array.from(queryRoot.querySelectorAll?.(WRITING_BLOCK_SELECTOR) || [])) addWritingOuter(block);
    for (const block of blocks) processWritingBlockForCollapse(block);
  }

  function processCodeBlockForCollapse(codeOuterBlock) {
    if (!isArcaiaExtensionEnabled()) return;
    if (!(codeOuterBlock instanceof HTMLElement)) return;
    const codeViewer = codeOuterBlock.querySelector(CODE_BLOCK_VIEWER_SELECTOR);
    if (!(codeViewer instanceof HTMLElement)) return;
    const headerChrome = findCodeHeaderChrome(codeOuterBlock);
    if (!(headerChrome instanceof HTMLElement)) return;

    removeLegacyCodeBlockCollapseElements(codeOuterBlock);
    headerChrome.classList.add(CODE_BLOCK_HEADER_CLASS);
    const toggle = ensureCodeBlockToggle(headerChrome);
    const contentTargets = findCodeContentTargets(codeOuterBlock, codeViewer, headerChrome);
    bindCodeBlockToggle(codeOuterBlock, contentTargets, toggle);

    if (codeOuterBlock.getAttribute(CODE_BLOCK_PROCESSED_ATTR) === 'true') {
      const collapsed = codeOuterBlock.getAttribute(CODE_BLOCK_COLLAPSED_ATTR) === 'true';
      setCodeBlockCollapsed(codeOuterBlock, contentTargets, toggle, collapsed);
      return;
    }

    codeOuterBlock.setAttribute(CODE_BLOCK_PROCESSED_ATTR, 'true');
    setCodeBlockCollapsed(codeOuterBlock, contentTargets, toggle, shouldCollapseCodeBlock(codeViewer));
  }

  function scanCodeBlocksForCollapse(root = document) {
    if (!isArcaiaExtensionEnabled()) return;
    injectCodeBlockCollapserStyle();
    scanWritingBlocksForCollapse(root);
    const blocks = [];
    if (root instanceof Element && root.matches?.(CODE_BLOCK_OUTER_SELECTOR)) blocks.push(root);
    const queryRoot = root instanceof Document || root instanceof DocumentFragment || root instanceof Element ? root : document;
    for (const block of Array.from(queryRoot.querySelectorAll?.(CODE_BLOCK_OUTER_SELECTOR) || [])) blocks.push(block);
    for (const block of blocks) processCodeBlockForCollapse(block);
  }

  function nodeContainsCodeBlockCandidate(node) {
    if (!(node instanceof Element)) return false;
    return Boolean(node.matches?.(CODE_BLOCK_OUTER_SELECTOR) || node.matches?.(WRITING_OUTER_SELECTOR) || node.matches?.(WRITING_BLOCK_SELECTOR) || node.querySelector?.(CODE_BLOCK_OUTER_SELECTOR) || node.querySelector?.(CODE_BLOCK_VIEWER_SELECTOR) || node.querySelector?.(WRITING_OUTER_SELECTOR) || node.querySelector?.(WRITING_BLOCK_SELECTOR));
  }

  function isCodeBlockCollapserAttributeMutation(mutation) {
    if (mutation.type !== 'attributes') return false;
    const name = mutation.attributeName || '';
    if (!['data-writing-block', 'data-writing-block-fullscreen-fallback-target', 'data-writing-block-fullscreen-header-chrome', 'data-start', 'data-end'].includes(name)) return false;
    return mutation.target instanceof Element && nodeContainsCodeBlockCandidate(mutation.target);
  }

  function addBlockCollapserCandidateRootFromElement(roots, element) {
    if (!(roots instanceof Set) || !(element instanceof Element)) return;

    const codeOuter = element.matches?.(CODE_BLOCK_OUTER_SELECTOR) ? element : element.closest?.(CODE_BLOCK_OUTER_SELECTOR);
    if (codeOuter instanceof HTMLElement) roots.add(codeOuter);
    for (const block of Array.from(element.querySelectorAll?.(CODE_BLOCK_OUTER_SELECTOR) || [])) {
      if (block instanceof HTMLElement) roots.add(block);
    }

    const writingBlock = element.matches?.(WRITING_BLOCK_SELECTOR) ? element : element.closest?.(WRITING_BLOCK_SELECTOR);
    const writingOuter = findWritingOuterBlock(writingBlock);
    if (writingOuter instanceof HTMLElement) roots.add(writingOuter);
    const legacyOuter = element.matches?.(WRITING_OUTER_SELECTOR) ? element : element.closest?.(WRITING_OUTER_SELECTOR);
    if (legacyOuter instanceof HTMLElement) roots.add(legacyOuter);
    for (const block of Array.from(element.querySelectorAll?.(WRITING_BLOCK_SELECTOR) || [])) {
      const outer = findWritingOuterBlock(block);
      if (outer instanceof HTMLElement) roots.add(outer);
    }
    for (const outer of Array.from(element.querySelectorAll?.(WRITING_OUTER_SELECTOR) || [])) {
      if (outer instanceof HTMLElement) roots.add(outer);
    }
  }

  function addBlockCollapserCandidateRootFromNode(roots, node) {
    if (!(roots instanceof Set)) return;
    if (node instanceof Element) {
      addBlockCollapserCandidateRootFromElement(roots, node);
      return;
    }
    if (node instanceof Node && node.parentElement instanceof HTMLElement) {
      addBlockCollapserCandidateRootFromElement(roots, node.parentElement);
    }
  }

  function collectBlockCollapserMutationRoots(mutations) {
    const roots = new Set();
    for (const mutation of mutations || []) {
      if (mutation.type === 'childList') {
        for (const node of Array.from(mutation.addedNodes || [])) {
          addBlockCollapserCandidateRootFromNode(roots, node);
        }
      } else if (isCodeBlockCollapserAttributeMutation(mutation)) {
        addBlockCollapserCandidateRootFromNode(roots, mutation.target);
      }
    }
    return roots;
  }

  function processBlockCollapserMutationRoots(roots, reason) {
    if (!(roots instanceof Set) || roots.size === 0) return;
    for (const root of roots) {
      scanCodeBlocksForCollapse(root);
    }
  }

  function cleanupCodeBlockCollapserUi() {
    codeBlockCollapserUiStarted = false;
    try {
      for (const root of Array.from(document.querySelectorAll(`[${WRITING_BLOCK_PROCESSED_ATTR}="true"]`))) {
        if (!(root instanceof HTMLElement)) continue;
        const editorWrapper = findWritingEditorWrapper(root);
        const headerChrome = findWritingHeaderChrome(root);
        if (editorWrapper instanceof HTMLElement) setCodeBlockTargetsDisplay([editorWrapper], false);
        if (headerChrome instanceof HTMLElement) headerChrome.classList.remove(CODE_BLOCK_HEADER_CLASS);
        root.removeAttribute(CODE_BLOCK_COLLAPSED_ATTR);
        root.removeAttribute(WRITING_BLOCK_PROCESSED_ATTR);
      }
      for (const root of Array.from(document.querySelectorAll(`[${CODE_BLOCK_PROCESSED_ATTR}="true"]`))) {
        if (!(root instanceof HTMLElement)) continue;
        const codeViewer = root.querySelector(CODE_BLOCK_VIEWER_SELECTOR);
        const headerChrome = findCodeHeaderChrome(root);
        if (codeViewer instanceof HTMLElement && headerChrome instanceof HTMLElement) {
          setCodeBlockTargetsDisplay(findCodeContentTargets(root, codeViewer, headerChrome), false);
          headerChrome.classList.remove(CODE_BLOCK_HEADER_CLASS);
        }
        root.removeAttribute(CODE_BLOCK_COLLAPSED_ATTR);
        root.removeAttribute(CODE_BLOCK_PROCESSED_ATTR);
      }
      for (const toggle of Array.from(document.querySelectorAll(`.${CODE_BLOCK_TOGGLE_CLASS}`))) toggle.remove();
    } catch {}
  }

  function countElementsInsideRoot(elements, root) {
    if (!(root instanceof Node)) return 0;
    return elements.filter((el) => el instanceof Node && (el === root || root.contains(el))).length;
  }

  function getBlockCollapserRootRelationshipDiagnostics(writingBlocks, codeOuters, codeViewers) {
    const observerRoot = conversationDomObservedContentRoot instanceof HTMLElement ? conversationDomObservedContentRoot : null;
    const currentRoot = document.querySelector('main') || document.body || document.documentElement;
    const currentRootElement = currentRoot instanceof HTMLElement ? currentRoot : null;
    const writingInsideObserver = countElementsInsideRoot(writingBlocks, observerRoot);
    const codeInsideObserver = countElementsInsideRoot(codeOuters, observerRoot);
    const codeViewerInsideObserver = countElementsInsideRoot(codeViewers, observerRoot);
    const writingInsideCurrent = countElementsInsideRoot(writingBlocks, currentRootElement);
    const codeInsideCurrent = countElementsInsideRoot(codeOuters, currentRootElement);
    const codeViewerInsideCurrent = countElementsInsideRoot(codeViewers, currentRootElement);

    return {
      observerRootConnected: Boolean(observerRoot?.isConnected),
      currentRootFound: Boolean(currentRootElement),
      currentRootTagName: currentRootElement?.tagName?.toLowerCase?.() || null,
      observerRootIsCurrentRoot: Boolean(observerRoot && currentRootElement && observerRoot === currentRootElement),
      observerRootContainsCurrentRoot: Boolean(observerRoot && currentRootElement && observerRoot !== currentRootElement && observerRoot.contains(currentRootElement)),
      currentRootContainsObserverRoot: Boolean(observerRoot && currentRootElement && observerRoot !== currentRootElement && currentRootElement.contains(observerRoot)),
      writingBlockInsideObserverRootCount: writingInsideObserver,
      writingBlockOutsideObserverRootCount: writingBlocks.length - writingInsideObserver,
      codeOuterInsideObserverRootCount: codeInsideObserver,
      codeOuterOutsideObserverRootCount: codeOuters.length - codeInsideObserver,
      codeViewerInsideObserverRootCount: codeViewerInsideObserver,
      codeViewerOutsideObserverRootCount: codeViewers.length - codeViewerInsideObserver,
      writingBlockInsideCurrentRootCount: writingInsideCurrent,
      codeOuterInsideCurrentRootCount: codeInsideCurrent,
      codeViewerInsideCurrentRootCount: codeViewerInsideCurrent
    };
  }

  function startCodeBlockCollapserUi() {
    if (!isArcaiaExtensionEnabled()) return;
    codeBlockCollapserUiStarted = true;
    injectCodeBlockCollapserStyle();
    const conversationObserverWasStarted = conversationDomObserverStarted;
    startConversationDomObserver();
    const root = conversationDomObservedContentRoot;
    if (conversationObserverWasStarted && root instanceof Element) scanCodeBlocksForCollapse(root);
  }

  const PINNED_SORT_STYLE_ID = 'arcaia-pinned-sort-style';
  const PINNED_SORT_STORAGE_KEY = 'arcaia.sidebarPinnedSorter.v1';
  const PINNED_FAVORITES_STORAGE_KEY = 'arcaia.sidebarPinnedFavorites.v1';
  const PINNED_SORT_DROP_MARKER_ID = 'arcaia-pinned-sort-drop-marker';
  const PINNED_SORT_DROP_MARKER_STICKY_PX = 18;
  const PINNED_SORT_BOUND_ANCHOR_ATTR = 'data-arcaia-pinned-sort-bound';
  const PINNED_SORT_BOUND_ITEM_ATTR = 'data-arcaia-pinned-sort-item-bound';
  const PINNED_SORT_DRAG_SOURCE_ATTR = 'data-arcaia-pinned-sort-source';
  const PINNED_SORT_LIST_BOUND_ATTR = 'data-arcaia-pinned-sort-list-bound';
  const PINNED_FAVORITE_BOUND_ATTR = 'data-arcaia-pinned-favorite-bound';
  const PINNED_FAVORITE_ACTIVE_ATTR = 'data-arcaia-pinned-favorite';
  const PINNED_FAVORITE_ICON_ATTR = 'data-arcaia-pinned-favorite-icon';
  const PINNED_FAVORITE_ICON_PICKER_ID = 'arcaia-pinned-favorite-icon-picker';
  const PINNED_FAVORITE_DEFAULT_ICON_ID = 'star';
  const PINNED_FAVORITE_ICON_CHOICES = Object.freeze([
    {
      id: 'star',
      label: 'star',
      svg: '<svg class="arcaia-pinned-favorite-mark-icon" data-arcaia-filled="true" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.751a.53.53 0 0 1 .294.904l-3.736 3.642a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.79a.53.53 0 0 1 .294-.904l5.165-.75a2.122 2.122 0 0 0 1.596-1.16z"/></svg>'
    },
    {
      id: 'bot',
      label: 'bot',
      svg: '<svg class="arcaia-pinned-favorite-mark-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>'
    },
    {
      id: 'vector-square',
      label: 'vector-square',
      svg: '<svg class="arcaia-pinned-favorite-mark-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="16" height="16" x="4" y="4" rx="2"/><path d="M9 9h6v6H9z"/><path d="M9 4v5"/><path d="M15 4v5"/><path d="M9 15v5"/><path d="M15 15v5"/><path d="M4 9h5"/><path d="M15 9h5"/><path d="M4 15h5"/><path d="M15 15h5"/></svg>'
    },
    {
      id: 'wrench',
      label: 'wrench',
      svg: '<svg class="arcaia-pinned-favorite-mark-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/></svg>'
    },
    {
      id: 'brain-cog',
      label: 'brain-cog',
      svg: '<svg class="arcaia-pinned-favorite-mark-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a3 3 0 0 0-5.95-.55A3.5 3.5 0 0 0 3.5 9.8 3.5 3.5 0 0 0 5 16.6V19a2 2 0 0 0 2 2h3"/><path d="M12 5a3 3 0 0 1 5.95-.55 3.5 3.5 0 0 1 2.55 5.35 3.5 3.5 0 0 1-.9 5.2"/><path d="M8 11h2"/><path d="M12 11h2"/><circle cx="17" cy="17" r="3"/><path d="M17 13v1"/><path d="M17 20v1"/><path d="M13 17h1"/><path d="M20 17h1"/></svg>'
    },
    {
      id: 'globe',
      label: 'globe',
      svg: '<svg class="arcaia-pinned-favorite-mark-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
    },
    {
      id: 'globe-2',
      label: 'globe-2',
      svg: '<svg class="arcaia-pinned-favorite-mark-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.54 15H17a2 2 0 0 0-2 2v4.54"/><path d="M7 3.34V5a3 3 0 0 0 3 3 2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2 3 3 0 0 1 3-3h1.66"/><path d="M11 21.95V18a2 2 0 0 0-2-2H2.46"/><circle cx="12" cy="12" r="10"/></svg>'
    }
  ]);
  const PINNED_SORT_CONVERSATION_SELECTOR = 'a[data-sidebar-item="true"][href*="/c/"]';
  const PINNED_SORT_SECTION_SELECTOR = '.group\\/sidebar-expando-section';
  const PINNED_SORT_OBSERVER_ROOT_SELECTOR = '#stage-slideover-sidebar, nav[aria-label="チャット履歴"], nav[aria-label="Chat history"]';
  const PINNED_SORT_STATE_VERSION = 2;
  let pinnedSortState = loadPinnedSortState();
  let pinnedFavoriteState = loadPinnedFavoriteState();
  let pinnedSortObserver = null;
  let pinnedSortObserverRoot = null;
  let pinnedSortScanTimer = null;
  let pinnedSortStartupBurstScheduled = false;
  const pinnedSortStartupBurstTimers = new Set();
  let pinnedSortCurrentDrag = null;
  let pinnedSortSuppressObserverUntil = 0;
  const pinnedSortLastAppliedOrderByScope = new Map();
  let pinnedFavoritePickerCleanup = null;

  function loadPinnedSortState() {
    try {
      const raw = window.localStorage?.getItem?.(PINNED_SORT_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const orders = {};
      if (parsed?.orders && typeof parsed.orders === 'object') {
        for (const [scopeKey, ids] of Object.entries(parsed.orders)) {
          if (!scopeKey || !Array.isArray(ids)) continue;
          orders[scopeKey] = Array.from(new Set(ids.filter(Boolean)));
        }
      }
      return {
        version: PINNED_SORT_STATE_VERSION,
        orders,
        legacyOrder: Array.isArray(parsed?.order) ? Array.from(new Set(parsed.order.filter(Boolean))) : []
      };
    } catch {
      return { version: PINNED_SORT_STATE_VERSION, orders: {}, legacyOrder: [] };
    }
  }

  function savePinnedSortState(nextState = pinnedSortState) {
    const orders = {};
    if (nextState?.orders && typeof nextState.orders === 'object') {
      for (const [scopeKey, ids] of Object.entries(nextState.orders)) {
        if (!scopeKey || !Array.isArray(ids)) continue;
        orders[scopeKey] = Array.from(new Set(ids.filter(Boolean)));
      }
    }
    pinnedSortState = { version: PINNED_SORT_STATE_VERSION, orders, legacyOrder: [] };
    try {
      window.localStorage?.setItem?.(PINNED_SORT_STORAGE_KEY, JSON.stringify({
        version: PINNED_SORT_STATE_VERSION,
        orders
      }));
    } catch {}
  }

  function getPinnedFavoriteIconChoice(iconId) {
    return PINNED_FAVORITE_ICON_CHOICES.find((choice) => choice.id === iconId) || null;
  }

  function normalizePinnedFavoriteIconId(iconId) {
    return getPinnedFavoriteIconChoice(iconId)?.id || null;
  }

  function loadPinnedFavoriteState() {
    try {
      const raw = window.localStorage?.getItem?.(PINNED_FAVORITES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const icons = parsed?.icons && typeof parsed.icons === 'object' ? parsed.icons : {};
      const nextIcons = {};
      for (const [id, iconId] of Object.entries(icons)) {
        const normalized = normalizePinnedFavoriteIconId(iconId);
        if (id && normalized) nextIcons[id] = normalized;
      }
      const favoriteIds = Array.isArray(parsed?.favoriteIds) ? parsed.favoriteIds.filter(Boolean) : [];
      for (const id of favoriteIds) {
        if (id && !nextIcons[id]) nextIcons[id] = PINNED_FAVORITE_DEFAULT_ICON_ID;
      }
      return { icons: nextIcons, favoriteIds: Object.keys(nextIcons) };
    } catch {
      return { icons: {}, favoriteIds: [] };
    }
  }

  function savePinnedFavoriteState(nextState = pinnedFavoriteState) {
    const rawIcons = nextState?.icons && typeof nextState.icons === 'object' ? nextState.icons : {};
    const icons = {};
    for (const [id, iconId] of Object.entries(rawIcons)) {
      const normalized = normalizePinnedFavoriteIconId(iconId);
      if (id && normalized) icons[id] = normalized;
    }
    pinnedFavoriteState = { icons, favoriteIds: Object.keys(icons) };
    try { window.localStorage?.setItem?.(PINNED_FAVORITES_STORAGE_KEY, JSON.stringify(pinnedFavoriteState)); } catch {}
  }

  function getPinnedFavoriteIconId(id) {
    return id ? normalizePinnedFavoriteIconId(pinnedFavoriteState.icons?.[id]) : null;
  }

  function isPinnedFavoriteId(id) {
    return Boolean(getPinnedFavoriteIconId(id));
  }

  function setPinnedFavoriteIconId(id, iconId) {
    if (!id) return;
    const icons = { ...(pinnedFavoriteState.icons || {}) };
    const normalized = normalizePinnedFavoriteIconId(iconId);
    if (normalized) icons[id] = normalized;
    else delete icons[id];
    savePinnedFavoriteState({ icons });
  }

  function setPinnedFavoriteId(id, active) {
    setPinnedFavoriteIconId(id, active ? PINNED_FAVORITE_DEFAULT_ICON_ID : null);
  }

  function injectPinnedSortStyles() {
    if (document.getElementById(PINNED_SORT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PINNED_SORT_STYLE_ID;
    style.textContent = `
      #${PINNED_SORT_DROP_MARKER_ID} {
        list-style: none !important;
        box-sizing: border-box !important;
        height: 0 !important;
        margin: 3px 8px 3px 0 !important;
        padding: 0 !important;
        border-top: 1px dashed var(--text-tertiary, currentColor) !important;
        opacity: 0.95 !important;
        pointer-events: none !important;
      }
      .arcaia-pinned-sort-drop-active {
        border-radius: 10px !important;
        background: rgba(127, 127, 127, 0.08) !important;
      }
      body.arcaia-pinned-sort-dragging a[${PINNED_SORT_DRAG_SOURCE_ATTR}="true"] {
        cursor: grabbing !important;
      }
      .arcaia-pinned-favorite-icon-host {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        border-radius: 6px !important;
        min-width: 18px !important;
        min-height: 18px !important;
      }
      .arcaia-pinned-favorite-icon-host:hover,
      .arcaia-pinned-favorite-icon-host[aria-expanded="true"] {
        background: color-mix(in srgb, currentColor 10%, transparent) !important;
      }
      .arcaia-pinned-favorite-mark-icon {
        width: 18px !important;
        height: 18px !important;
        display: block !important;
        color: currentColor !important;
        fill: none !important;
        stroke: currentColor !important;
        stroke-width: 2 !important;
        stroke-linecap: round !important;
        stroke-linejoin: round !important;
        pointer-events: none !important;
      }
      .arcaia-pinned-favorite-mark-icon[data-arcaia-filled="true"] {
        fill: currentColor !important;
      }
      #${PINNED_FAVORITE_ICON_PICKER_ID} {
        position: fixed !important;
        z-index: 2147483646 !important;
        display: grid !important;
        grid-template-columns: repeat(4, 28px) !important;
        gap: 6px !important;
        padding: 8px !important;
        border-radius: 12px !important;
        background: var(--main-surface-primary, rgba(32, 33, 35, 0.98)) !important;
        color: var(--text-primary, currentColor) !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28) !important;
        border: 1px solid color-mix(in srgb, currentColor 16%, transparent) !important;
      }
      #${PINNED_FAVORITE_ICON_PICKER_ID} button {
        width: 28px !important;
        height: 28px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        border: 0 !important;
        border-radius: 8px !important;
        background: transparent !important;
        color: inherit !important;
        cursor: pointer !important;
        font: 700 15px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }
      #${PINNED_FAVORITE_ICON_PICKER_ID} button:hover,
      #${PINNED_FAVORITE_ICON_PICKER_ID} button[aria-pressed="true"] {
        background: color-mix(in srgb, currentColor 12%, transparent) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function normalizePinnedSortText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function cleanPinnedSortTitle(value) {
    return normalizePinnedSortText(value)
      .replace(/、ピン留めされた会話/g, '')
      .replace(/、未読/g, '')
      .replace(/\s+の会話オプションを開く\s*$/g, '')
      .trim();
  }

  function getPinnedSortNav() {
    const selectors = [
      '#stage-slideover-sidebar nav[aria-label="チャット履歴"]',
      '#stage-slideover-sidebar nav[aria-label="Chat history"]',
      'nav[aria-label="チャット履歴"]',
      'nav[aria-label="Chat history"]',
      '#stage-slideover-sidebar nav',
      'nav'
    ];
    for (const selector of selectors) {
      const nav = document.querySelector(selector);
      if (nav instanceof HTMLElement) return nav;
    }
    return null;
  }

  function findPinnedSortSectionByHeading(nav, headings) {
    if (!(nav instanceof HTMLElement)) return null;
    const wanted = new Set(headings.map(normalizePinnedSortText));
    const sections = Array.from(nav.querySelectorAll(PINNED_SORT_SECTION_SELECTOR));
    for (const section of sections) {
      if (!(section instanceof HTMLElement)) continue;
      const text = normalizePinnedSortText(section.querySelector('h2')?.textContent || '');
      if (wanted.has(text)) return section;
    }
    return null;
  }

  function findPinnedSortSection(nav) {
    const byHeading = findPinnedSortSectionByHeading(nav, ['ピン留め', 'Pinned']);
    if (byHeading instanceof HTMLElement) return byHeading;
    const sections = Array.from(nav?.querySelectorAll?.(PINNED_SORT_SECTION_SELECTOR) || []);
    for (const section of sections) {
      if (!(section instanceof HTMLElement)) continue;
      const hasPinnedLabel = Array.from(section.querySelectorAll(PINNED_SORT_CONVERSATION_SELECTOR)).some((anchor) => {
        if (!(anchor instanceof HTMLAnchorElement)) return false;
        const label = [anchor.getAttribute('aria-label'), anchor.getAttribute('title'), anchor.textContent].filter(Boolean).join(' ');
        return /ピン留め|pinned/i.test(label);
      });
      if (hasPinnedLabel) return section;
    }
    return null;
  }

  function extractPinnedSortConversationId(href) {
    try {
      const url = new URL(href, window.location.origin);
      const match = url.pathname.match(/\/c\/([^/?#]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  function extractPinnedSortProjectId(href) {
    try {
      const url = new URL(href, window.location.origin);
      const match = url.pathname.match(/^\/g\/(g-p-[^/?#]+)\/c\/[^/?#]+/i);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  function getPinnedSortScopeDescriptor(anchor, item) {
    if (!(anchor instanceof HTMLAnchorElement) || !(item instanceof HTMLElement)) return null;
    const list = item.parentElement;
    if (!(list instanceof HTMLElement)) return null;
    const projectId = extractPinnedSortProjectId(anchor.href);
    return projectId
      ? { key: `project:${projectId}`, type: 'project', projectId, list }
      : { key: 'standalone', type: 'standalone', projectId: null, list };
  }

  function getPinnedSortRowItem(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return null;
    const li = anchor.closest('li');
    return li instanceof HTMLElement ? li : anchor;
  }

  function collectPinnedSortRows(pinnedSection) {
    const rows = [];
    const seen = new Set();
    const anchors = Array.from(pinnedSection?.querySelectorAll?.(PINNED_SORT_CONVERSATION_SELECTOR) || []);
    for (const anchor of anchors) {
      if (!(anchor instanceof HTMLAnchorElement)) continue;
      const id = extractPinnedSortConversationId(anchor.href);
      if (!id || seen.has(id)) continue;
      const item = getPinnedSortRowItem(anchor);
      if (!(item instanceof HTMLElement)) continue;
      const scope = getPinnedSortScopeDescriptor(anchor, item);
      if (!scope) continue;
      seen.add(id);
      const title = cleanPinnedSortTitle(
        anchor.querySelector('span[dir="auto"]')?.textContent
          || anchor.querySelector('.truncate')?.getAttribute('title')
          || anchor.getAttribute('aria-label')
          || anchor.textContent
          || id
      );
      rows.push({
        id,
        anchor,
        item,
        title,
        href: anchor.getAttribute('href') || `/c/${id}`,
        scopeKey: scope.key,
        scopeType: scope.type,
        projectId: scope.projectId,
        list: scope.list
      });
    }
    return rows;
  }

  function collectPinnedSortScopes(rows) {
    const scopes = [];
    for (const row of rows || []) {
      if (!row?.scopeKey || !(row.list instanceof HTMLElement)) continue;
      let scope = scopes.find((candidate) => candidate.key === row.scopeKey && candidate.list === row.list);
      if (!scope) {
        scope = {
          key: row.scopeKey,
          type: row.scopeType || 'standalone',
          projectId: row.projectId || null,
          list: row.list,
          rows: []
        };
        scopes.push(scope);
      }
      scope.rows.push(row);
    }
    return scopes;
  }

  function findPinnedSortListFromRows(rows, pinnedSection) {
    for (const row of rows || []) {
      const parent = row.item?.parentElement;
      if (parent instanceof HTMLElement && pinnedSection?.contains?.(parent)) return parent;
    }
    return null;
  }

  function getPinnedSortSavedOrder(scope) {
    const rows = scope?.rows || [];
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const used = new Set();
    const ordered = [];
    const saved = Array.isArray(pinnedSortState.orders?.[scope?.key])
      ? pinnedSortState.orders[scope.key]
      : pinnedSortState.legacyOrder || [];
    for (const id of saved) {
      if (!rowById.has(id) || used.has(id)) continue;
      ordered.push(id);
      used.add(id);
    }
    for (const row of rows) {
      if (used.has(row.id)) continue;
      ordered.push(row.id);
      used.add(row.id);
    }
    return ordered;
  }

  function adoptPinnedSortExpandedProjectOrder(scope, currentIds) {
    if (scope?.type !== 'project' || !scope?.key || !Array.isArray(currentIds)) return false;
    const saved = Array.isArray(pinnedSortState.orders?.[scope.key])
      ? pinnedSortState.orders[scope.key]
      : [];
    const currentSet = new Set(currentIds);
    const nextOrder = [...currentIds, ...saved.filter((id) => !currentSet.has(id))];
    if (saved.join('\n') === nextOrder.join('\n')) return false;
    savePinnedSortState({
      orders: {
        ...(pinnedSortState.orders || {}),
        [scope.key]: nextOrder
      }
    });
    return true;
  }

  function suppressPinnedSortObserverBriefly(ms = 300) {
    pinnedSortSuppressObserverUntil = Date.now() + ms;
  }

  function applyPinnedSortScopeSavedOrder(scope) {
    const rows = scope?.rows || [];
    const list = scope?.list;
    if (rows.length < 2 || !(list instanceof HTMLElement)) return false;
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const currentIds = rows.map((row) => row.id);
    const previousAppliedIds = pinnedSortLastAppliedOrderByScope.get(scope.key) || [];
    const previousSet = new Set(previousAppliedIds);
    const currentSet = new Set(currentIds);
    const addedIds = currentIds.filter((id) => !previousSet.has(id));
    const removedIds = previousAppliedIds.filter((id) => !currentSet.has(id));
    const retainedCurrentIds = currentIds.filter((id) => previousSet.has(id));
    const expandedProjectList = (
      scope.type === 'project'
      && previousAppliedIds.length > 0
      && addedIds.length > 0
      && removedIds.length === 0
      && retainedCurrentIds.join('\n') === previousAppliedIds.join('\n')
    );
    if (expandedProjectList) {
      adoptPinnedSortExpandedProjectOrder(scope, currentIds);
      pinnedSortLastAppliedOrderByScope.set(scope.key, currentIds.slice());
      return false;
    }
    const orderedIds = getPinnedSortSavedOrder(scope);
    if (currentIds.join('\n') === orderedIds.join('\n')) return false;
    const markers = rows.map((row) => {
      const marker = document.createComment(`arcaia-pinned-slot:${scope.type}`);
      list.insertBefore(marker, row.item);
      return marker;
    });
    suppressPinnedSortObserverBriefly();
    for (let index = 0; index < orderedIds.length; index += 1) {
      const row = rowById.get(orderedIds[index]);
      const marker = markers[index];
      if (row?.item instanceof HTMLElement && marker?.parentNode === list) {
        list.insertBefore(row.item, marker.nextSibling);
      }
    }
    for (const marker of markers) marker.remove();
    pinnedSortLastAppliedOrderByScope.set(scope.key, orderedIds.slice());
    return true;
  }

  function applyPinnedSortSavedOrder(pinnedSection) {
    const rows = collectPinnedSortRows(pinnedSection);
    for (const scope of collectPinnedSortScopes(rows)) {
      const changed = applyPinnedSortScopeSavedOrder(scope);
      if (!changed) {
        pinnedSortLastAppliedOrderByScope.set(scope.key, scope.rows.map((row) => row.id));
      }
    }
    return collectPinnedSortRows(pinnedSection);
  }

  function saveCurrentPinnedSortOrder(scope) {
    if (!scope?.key || !(scope.list instanceof HTMLElement)) return;
    const rows = (scope.rows || [])
      .filter((row) => row?.scopeKey === scope.key && row.item?.parentElement === scope.list)
      .slice()
      .sort((left, right) => {
        if (left.item === right.item) return 0;
        return left.item.compareDocumentPosition(right.item) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
    if (!rows.length) return;
    savePinnedSortState({
      orders: {
        ...(pinnedSortState.orders || {}),
        [scope.key]: rows.map((row) => row.id)
      }
    });
  }

  function ensurePinnedSortScopeOrders(rows) {
    const scopes = collectPinnedSortScopes(rows);
    const orders = { ...(pinnedSortState.orders || {}) };
    let changed = false;
    for (const scope of scopes) {
      if (Array.isArray(orders[scope.key]) && orders[scope.key].length) continue;
      const legacy = (pinnedSortState.legacyOrder || []).filter((id) => scope.rows.some((row) => row.id === id));
      const current = scope.rows.map((row) => row.id);
      orders[scope.key] = legacy.length ? [...legacy, ...current.filter((id) => !legacy.includes(id))] : current;
      changed = true;
    }
    if (changed || (pinnedSortState.legacyOrder || []).length) savePinnedSortState({ orders });
  }

  function escapePinnedFavoriteHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] || char));
  }

  function pinnedFavoriteIconHtml(iconId) {
    const choice = getPinnedFavoriteIconChoice(iconId) || getPinnedFavoriteIconChoice(PINNED_FAVORITE_DEFAULT_ICON_ID);
    return choice?.svg || '';
  }

  function closePinnedFavoriteIconPicker() {
    if (pinnedFavoritePickerCleanup) {
      const cleanup = pinnedFavoritePickerCleanup;
      pinnedFavoritePickerCleanup = null;
      cleanup();
    }
    const existing = document.getElementById(PINNED_FAVORITE_ICON_PICKER_ID);
    if (existing) existing.remove();
    document.querySelectorAll?.('.arcaia-pinned-favorite-icon-host[aria-expanded="true"]')?.forEach?.((host) => {
      host.setAttribute('aria-expanded', 'false');
    });
  }

  function findPinnedFavoriteIconHost(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return null;
    const titleEl = anchor.querySelector('span[dir="auto"], .truncate');
    const svgs = Array.from(anchor.querySelectorAll('svg'));
    for (const svg of svgs) {
      if (!(svg instanceof SVGElement)) continue;
      if (titleEl instanceof Node && !(svg.compareDocumentPosition(titleEl) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const host = svg.closest('span, div') || svg;
      if (host instanceof HTMLElement && host !== anchor) return host;
    }
    return null;
  }

  function renderPinnedFavoriteIcon(row, host) {
    if (!(host instanceof HTMLElement)) return;
    const iconId = getPinnedFavoriteIconId(row.id);
    const active = Boolean(iconId);
    if (typeof host.__arcaiaPinnedFavoriteOriginalHtml !== 'string') {
      host.__arcaiaPinnedFavoriteOriginalHtml = host.innerHTML;
      host.__arcaiaPinnedFavoriteOriginalAttrs = {
        role: host.getAttribute('role'),
        tabIndex: host.getAttribute('tabindex'),
        ariaHaspopup: host.getAttribute('aria-haspopup'),
        ariaExpanded: host.getAttribute('aria-expanded'),
        title: host.getAttribute('title'),
        ariaLabel: host.getAttribute('aria-label')
      };
    }
    host.__arcaiaPinnedFavoriteRow = row;
    host.classList.add('arcaia-pinned-favorite-icon-host');
    host.setAttribute('role', 'button');
    host.setAttribute('tabindex', '0');
    host.setAttribute('aria-haspopup', 'menu');
    host.setAttribute('aria-expanded', 'false');
    host.setAttribute('title', active ? 'Arcaia: アイコンを変更' : 'Arcaia: アイコンを選択');
    host.setAttribute('aria-label', active ? 'Arcaiaアイコンを変更' : 'Arcaiaアイコンを選択');
    if (active) {
      host.innerHTML = pinnedFavoriteIconHtml(iconId);
      row.anchor.setAttribute(PINNED_FAVORITE_ACTIVE_ATTR, 'true');
      row.anchor.setAttribute(PINNED_FAVORITE_ICON_ATTR, iconId);
      row.item?.setAttribute?.(PINNED_FAVORITE_ACTIVE_ATTR, 'true');
      row.item?.setAttribute?.(PINNED_FAVORITE_ICON_ATTR, iconId);
    } else {
      if (host.querySelector('.arcaia-pinned-favorite-mark-icon')) {
        host.innerHTML = host.__arcaiaPinnedFavoriteOriginalHtml || '';
      }
      row.anchor.removeAttribute(PINNED_FAVORITE_ACTIVE_ATTR);
      row.anchor.removeAttribute(PINNED_FAVORITE_ICON_ATTR);
      row.item?.removeAttribute?.(PINNED_FAVORITE_ACTIVE_ATTR);
      row.item?.removeAttribute?.(PINNED_FAVORITE_ICON_ATTR);
    }
  }

  function selectPinnedFavoriteIcon(event, row, host, iconId) {
    event.preventDefault();
    event.stopPropagation();
    const id = extractPinnedSortConversationId(row.anchor.href) || row.id;
    setPinnedFavoriteIconId(id, iconId);
    closePinnedFavoriteIconPicker();
    renderPinnedFavoriteIcon({ ...row, id }, host);
    schedulePinnedSortScan(80);
  }

  function openPinnedFavoriteIconPicker(event, row, host) {
    event.preventDefault();
    event.stopPropagation();
    closePinnedFavoriteIconPicker();
    const currentIconId = getPinnedFavoriteIconId(row.id);
    const picker = document.createElement('div');
    picker.id = PINNED_FAVORITE_ICON_PICKER_ID;
    picker.setAttribute('role', 'menu');
    picker.setAttribute('aria-label', 'Arcaia icon picker');
    const choices = [{ id: null, label: 'なし', text: '×' }, ...PINNED_FAVORITE_ICON_CHOICES];
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      if (choice.svg) button.innerHTML = choice.svg;
      else button.textContent = choice.text || '';
      button.title = `Arcaia: ${choice.label}`;
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-label', choice.label);
      button.setAttribute('aria-pressed', String((choice.id || null) === (currentIconId || null)));
      button.addEventListener('click', (clickEvent) => selectPinnedFavoriteIcon(clickEvent, row, host, choice.id), true);
      picker.appendChild(button);
    }
    document.documentElement.appendChild(picker);
    const rect = host.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - pickerRect.width - 8, rect.left));
    const top = Math.max(8, Math.min(window.innerHeight - pickerRect.height - 8, rect.bottom + 6));
    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
    host.setAttribute('aria-expanded', 'true');
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('pointerdown', closeOnOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
      if (pinnedFavoritePickerCleanup === cleanup) pinnedFavoritePickerCleanup = null;
      picker.remove();
      host.setAttribute('aria-expanded', 'false');
    };
    const closeOnOutside = (outsideEvent) => {
      if (picker.contains(outsideEvent.target) || host.contains(outsideEvent.target)) return;
      cleanup();
    };
    const closeOnEscape = (keyEvent) => {
      if (keyEvent.key !== 'Escape') return;
      cleanup();
    };
    pinnedFavoritePickerCleanup = cleanup;
    setTimeout(() => { if (!closed) document.addEventListener('pointerdown', closeOnOutside, true); }, 0);
    document.addEventListener('keydown', closeOnEscape, true);
  }

  function bindPinnedFavoriteIcon(row) {
    if (!isArcaiaFeatureEnabled('pinnedIcons')) return;
    if (!row?.scopeKey || !(row.anchor instanceof HTMLAnchorElement) || !(row.item instanceof HTMLElement) || !row.item.contains(row.anchor)) return;
    const host = findPinnedFavoriteIconHost(row.anchor);
    if (!(host instanceof HTMLElement)) return;
    if (host.getAttribute(PINNED_FAVORITE_BOUND_ATTR) !== 'true') {
      const clickHandler = (event) => {
        if (!isArcaiaExtensionEnabled()) return;
        const latestRow = host.__arcaiaPinnedFavoriteRow || row;
        openPinnedFavoriteIconPicker(event, latestRow, host);
      };
      const keydownHandler = (event) => {
        if (!isArcaiaExtensionEnabled()) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const latestRow = host.__arcaiaPinnedFavoriteRow || row;
        openPinnedFavoriteIconPicker(event, latestRow, host);
      };
      host.__arcaiaPinnedFavoriteHandlers = { clickHandler, keydownHandler };
      host.addEventListener('click', clickHandler, true);
      host.addEventListener('keydown', keydownHandler, true);
      host.setAttribute(PINNED_FAVORITE_BOUND_ATTR, 'true');
    }
    renderPinnedFavoriteIcon(row, host);
  }

  function getPinnedSortDropMarker() {
    return document.getElementById(PINNED_SORT_DROP_MARKER_ID);
  }

  function ensurePinnedSortDropMarker() {
    let marker = getPinnedSortDropMarker();
    if (marker instanceof HTMLElement) return marker;
    marker = document.createElement('li');
    marker.id = PINNED_SORT_DROP_MARKER_ID;
    marker.setAttribute('aria-hidden', 'true');
    return marker;
  }

  function clearPinnedSortDropIndicators(root = document) {
    getPinnedSortDropMarker()?.remove();
    for (const target of root.querySelectorAll('.arcaia-pinned-sort-drop-active')) {
      target.classList.remove('arcaia-pinned-sort-drop-active');
    }
  }

  function isNearPinnedSortDropMarker(event) {
    const marker = getPinnedSortDropMarker();
    if (!(marker instanceof HTMLElement)) return false;
    const rect = marker.getBoundingClientRect();
    const sticky = PINNED_SORT_DROP_MARKER_STICKY_PX;
    const clientX = Number(event?.clientX);
    const clientY = Number(event?.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    return (
      clientX >= rect.left - sticky &&
      clientX <= rect.right + sticky &&
      clientY >= rect.top - sticky &&
      clientY <= rect.bottom + sticky
    );
  }

  function isPinnedSortDropMarkerRelatedTarget(event) {
    const related = event?.relatedTarget;
    const marker = getPinnedSortDropMarker();
    return related instanceof Node && marker instanceof HTMLElement && (related === marker || marker.contains(related));
  }

  function resetPinnedSortDrag() {
    pinnedSortCurrentDrag = null;
    document.body?.classList?.remove?.('arcaia-pinned-sort-dragging');
    clearPinnedSortDropIndicators();
  }

  function setPinnedSortDragPayload(event, row) {
    pinnedSortCurrentDrag = {
      kind: 'pinned-chat',
      id: row.id,
      title: row.title,
      href: row.href,
      scopeKey: row.scopeKey,
      scopeType: row.scopeType,
      draggedAt: Date.now()
    };
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-arcaia-pinned-chat', JSON.stringify(pinnedSortCurrentDrag));
    event.dataTransfer.setData('text/plain', row.title || row.id);
  }

  function parsePinnedSortDragPayload(event) {
    if (pinnedSortCurrentDrag?.kind === 'pinned-chat' && pinnedSortCurrentDrag?.scopeKey) return pinnedSortCurrentDrag;
    if (!event.dataTransfer) return null;
    const raw = event.dataTransfer.getData('application/x-arcaia-pinned-chat');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.kind === 'pinned-chat' && parsed?.id && parsed?.scopeKey ? parsed : null;
    } catch {
      return null;
    }
  }

  function findPinnedSortRowById(pinnedSection, chatId, scopeKey) {
    return collectPinnedSortRows(pinnedSection).find((row) => row.id === chatId && row.scopeKey === scopeKey) || null;
  }

  function shouldIgnorePinnedSortDragStartTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('button, input, textarea, select, [contenteditable="true"], [role="menuitem"], [data-conversation-options-trigger]'));
  }

  function showPinnedSortMarker(item, after, scope) {
    if (!(item instanceof HTMLElement) || !(item.parentElement instanceof HTMLElement)) return;
    if (!scope?.key || item.parentElement !== scope.list) return;
    const marker = ensurePinnedSortDropMarker();
    marker.__arcaiaPinnedSortScopeKey = scope.key;
    marker.__arcaiaPinnedSortScopeType = scope.type;
    const reference = after ? item.nextSibling : item;
    if (marker.parentNode === item.parentElement && marker.nextSibling === reference) return;
    item.parentElement.insertBefore(marker, reference);
  }

  function showPinnedSortAppendMarker(scope) {
    const lastRow = scope?.rows?.[scope.rows.length - 1];
    if (!lastRow?.item) return;
    showPinnedSortMarker(lastRow.item, true, scope);
  }

  function commitPinnedSortDrop(pinnedSection, event, expectedScope) {
    const payload = parsePinnedSortDragPayload(event);
    const marker = getPinnedSortDropMarker();
    if (!payload || !(marker instanceof HTMLElement) || !(marker.parentElement instanceof HTMLElement)) return false;
    if (!expectedScope?.key || payload.scopeKey !== expectedScope.key) return false;
    if (marker.__arcaiaPinnedSortScopeKey !== payload.scopeKey || marker.parentElement !== expectedScope.list) return false;
    const draggedRow = findPinnedSortRowById(pinnedSection, payload.id, payload.scopeKey);
    const draggedItem = draggedRow?.item || null;
    if (!(draggedItem instanceof HTMLElement) || draggedItem.parentElement !== expectedScope.list) return false;
    event.preventDefault();
    event.stopPropagation();
    suppressPinnedSortObserverBriefly();
    marker.parentElement.insertBefore(draggedItem, marker);
    marker.remove();
    saveCurrentPinnedSortOrder(expectedScope);
    resetPinnedSortDrag();
    schedulePinnedSortScan(80);
    return true;
  }

  function bindPinnedSortAnchor(row) {
    const anchor = row.anchor;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    anchor.__arcaiaPinnedSortRow = row;
    if (!anchor.__arcaiaPinnedSortOriginalDraggable) {
      anchor.__arcaiaPinnedSortOriginalDraggable = {
        attr: anchor.getAttribute('draggable'),
        property: Boolean(anchor.draggable)
      };
    }
    anchor.setAttribute('draggable', 'true');
    anchor.setAttribute(PINNED_SORT_DRAG_SOURCE_ATTR, 'true');
    if (anchor.getAttribute(PINNED_SORT_BOUND_ANCHOR_ATTR) === 'true') return;
    const dragstartHandler = (event) => {
      if (!isArcaiaExtensionEnabled()) return;
      const latestRow = anchor.__arcaiaPinnedSortRow || row;
      const ignored = shouldIgnorePinnedSortDragStartTarget(event.target);
      if (ignored) {
        event.preventDefault();
        return;
      }
      const id = extractPinnedSortConversationId(anchor.href);
      if (!id) return;
      const dragRow = {
        ...latestRow,
        id,
        title: cleanPinnedSortTitle(
          anchor.querySelector('span[dir="auto"]')?.textContent
            || anchor.querySelector('.truncate')?.getAttribute('title')
            || anchor.getAttribute('aria-label')
            || anchor.textContent
            || id
        ),
        href: anchor.getAttribute('href') || `/c/${id}`
      };
      document.body?.classList?.add?.('arcaia-pinned-sort-dragging');
      setPinnedSortDragPayload(event, dragRow);
    };
    const dragendHandler = () => {
      if (!isArcaiaExtensionEnabled()) return;
      resetPinnedSortDrag();
    };
    anchor.__arcaiaPinnedSortHandlers = { dragstartHandler, dragendHandler };
    anchor.addEventListener('dragstart', dragstartHandler, true);
    anchor.addEventListener('dragend', dragendHandler);
    anchor.setAttribute(PINNED_SORT_BOUND_ANCHOR_ATTR, 'true');
  }

  function getLastPinnedSortRow(scope) {
    const rows = scope?.rows || [];
    return rows.length ? rows[rows.length - 1] : null;
  }

  function isPinnedSortLastRow(row, scope) {
    const lastRow = getLastPinnedSortRow(scope);
    return Boolean(row?.id && lastRow?.id && row.id === lastRow.id);
  }

  function getPinnedSortRowForEventTarget(event, scope) {
    const target = event?.target instanceof Element ? event.target : null;
    if (!target) return null;
    return (scope?.rows || []).find((row) => {
      const item = row.item;
      return item instanceof HTMLElement && (item === target || item.contains(target));
    }) || null;
  }

  function isPinnedSortForeignContainerTarget(event, scope) {
    const target = event?.target instanceof Element ? event.target : null;
    const list = scope?.list;
    if (!target || !(list instanceof HTMLElement) || target === list) return false;
    const directChild = Array.from(list.children).find((child) => child === target || child.contains(target));
    if (!(directChild instanceof HTMLElement)) return false;
    return !(scope.rows || []).some((row) => row.item === directChild);
  }

  function isPinnedSortLowerHalfEvent(event, item) {
    if (!(item instanceof HTMLElement)) return false;
    const rect = item.getBoundingClientRect();
    return Number(event?.clientY) > rect.top + rect.height / 2;
  }

  function showPinnedSortMarkerForRow(row, scope, event) {
    const item = row?.item;
    if (!(item instanceof HTMLElement)) return;
    const after = isPinnedSortLowerHalfEvent(event, item);
    if (after && isPinnedSortLastRow(row, scope)) {
      showPinnedSortAppendMarker(scope);
      return;
    }
    showPinnedSortMarker(item, after, scope);
  }

  function bindPinnedSortItem(row, scope, pinnedSection) {
    const item = row.item;
    if (!(item instanceof HTMLElement)) return;
    item.__arcaiaPinnedSortRow = row;
    item.__arcaiaPinnedSortScope = scope;
    if (item.getAttribute(PINNED_SORT_BOUND_ITEM_ATTR) === 'true') return;
    const dragoverHandler = (event) => {
      if (!isArcaiaExtensionEnabled()) return;
      const latestRow = item.__arcaiaPinnedSortRow || row;
      const latestScope = item.__arcaiaPinnedSortScope || scope;
      const payload = parsePinnedSortDragPayload(event);
      if (!payload || payload.scopeKey !== latestScope.key || payload.id === latestRow.id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      if (isNearPinnedSortDropMarker(event)) return;
      clearPinnedSortDropIndicators(pinnedSection);
      item.classList.add('arcaia-pinned-sort-drop-active');
      showPinnedSortMarkerForRow(latestRow, latestScope, event);
    };
    const dragleaveHandler = (event) => {
      if (!isArcaiaExtensionEnabled()) return;
      const related = event.relatedTarget;
      if (related instanceof Node && item.contains(related)) return;
      if (isPinnedSortDropMarkerRelatedTarget(event) || isNearPinnedSortDropMarker(event)) return;
      item.classList.remove('arcaia-pinned-sort-drop-active');
    };
    const dropHandler = (event) => {
      if (!isArcaiaExtensionEnabled()) return;
      const latestScope = item.__arcaiaPinnedSortScope || scope;
      commitPinnedSortDrop(pinnedSection, event, latestScope);
    };
    item.__arcaiaPinnedSortHandlers = { dragoverHandler, dragleaveHandler, dropHandler };
    item.addEventListener('dragover', dragoverHandler);
    item.addEventListener('dragleave', dragleaveHandler);
    item.addEventListener('drop', dropHandler);
    item.setAttribute(PINNED_SORT_BOUND_ITEM_ATTR, 'true');
  }

  function bindPinnedSortList(scope, pinnedSection) {
    const list = scope?.list;
    if (!(list instanceof HTMLElement)) return;
    list.__arcaiaPinnedSortScope = scope;
    if (list.getAttribute(PINNED_SORT_LIST_BOUND_ATTR) === 'true') return;
    const dragoverHandler = (event) => {
      if (!isArcaiaExtensionEnabled()) return;
      const latestScope = list.__arcaiaPinnedSortScope || scope;
      const payload = parsePinnedSortDragPayload(event);
      if (!payload || payload.scopeKey !== latestScope.key) return;
      if (isPinnedSortForeignContainerTarget(event, latestScope)) return;
      const targetRow = getPinnedSortRowForEventTarget(event, latestScope);
      if (targetRow) {
        if (payload.id === targetRow.id || !isPinnedSortLastRow(targetRow, latestScope) || !isPinnedSortLowerHalfEvent(event, targetRow.item)) return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      if (isNearPinnedSortDropMarker(event)) return;
      clearPinnedSortDropIndicators(pinnedSection);
      list.classList.add('arcaia-pinned-sort-drop-active');
      showPinnedSortAppendMarker(latestScope);
    };
    const dragleaveHandler = (event) => {
      if (!isArcaiaExtensionEnabled()) return;
      const related = event.relatedTarget;
      if (related instanceof Node && list.contains(related)) return;
      if (isPinnedSortDropMarkerRelatedTarget(event) || isNearPinnedSortDropMarker(event)) return;
      list.classList.remove('arcaia-pinned-sort-drop-active');
    };
    const dropHandler = (event) => {
      if (!isArcaiaExtensionEnabled()) return;
      const latestScope = list.__arcaiaPinnedSortScope || scope;
      if (isPinnedSortForeignContainerTarget(event, latestScope)) return;
      commitPinnedSortDrop(pinnedSection, event, latestScope);
    };
    list.__arcaiaPinnedSortHandlers = { dragoverHandler, dragleaveHandler, dropHandler };
    list.addEventListener('dragover', dragoverHandler);
    list.addEventListener('dragleave', dragleaveHandler);
    list.addEventListener('drop', dropHandler);
    list.setAttribute(PINNED_SORT_LIST_BOUND_ATTR, 'true');
  }

  function bindPinnedSortRows(pinnedSection) {
    const rows = collectPinnedSortRows(pinnedSection);
    const scopes = collectPinnedSortScopes(rows);
    for (const scope of scopes) {
      for (const row of scope.rows) {
        if (isArcaiaFeatureEnabled('pinnedIcons')) bindPinnedFavoriteIcon(row);
        if (isArcaiaFeatureEnabled('pinnedSort')) {
          bindPinnedSortAnchor(row);
          bindPinnedSortItem(row, scope, pinnedSection);
        }
      }
      if (isArcaiaFeatureEnabled('pinnedSort')) bindPinnedSortList(scope, pinnedSection);
    }
  }

  function schedulePinnedSortScan(delay = 120, reason = 'scheduled') {
    clearTimeout(pinnedSortScanTimer);
    pinnedSortScanTimer = setTimeout(() => scanPinnedSortUi(reason), delay);
  }

  function getPinnedSortObserverRoot() {
    const root = document.querySelector(PINNED_SORT_OBSERVER_ROOT_SELECTOR);
    if (root instanceof HTMLElement) return root;
    const nav = getPinnedSortNav();
    return nav instanceof HTMLElement ? nav : null;
  }

  function ensurePinnedSortObserverRoot(reason = 'ensure') {
    const root = getPinnedSortObserverRoot();
    if (!(root instanceof HTMLElement)) return false;
    return observePinnedSortRoot(root);
  }

  function isPinnedSortSectionElement(element) {
    if (!(element instanceof HTMLElement) || !element.matches(PINNED_SORT_SECTION_SELECTOR)) return false;
    const heading = normalizePinnedSortText(element.querySelector('h2')?.textContent || '');
    if (heading === 'ピン留め' || heading === 'Pinned') return true;
    return Array.from(element.querySelectorAll(PINNED_SORT_CONVERSATION_SELECTOR)).some((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) return false;
      const label = [anchor.getAttribute('aria-label'), anchor.getAttribute('title'), anchor.textContent]
        .filter(Boolean)
        .join(' ');
      return /ピン留め|pinned/i.test(label);
    });
  }

  function mutationNodeContainsPinnedSortSection(node) {
    if (!(node instanceof Element)) return false;
    if (isPinnedSortSectionElement(node)) return true;
    return Array.from(node.querySelectorAll(PINNED_SORT_SECTION_SELECTOR)).some(isPinnedSortSectionElement);
  }

  function mutationNodeContainsPinnedSortConversationAnchor(node) {
    if (!(node instanceof Element)) return false;
    return node.matches(PINNED_SORT_CONVERSATION_SELECTOR)
      || Boolean(node.querySelector(PINNED_SORT_CONVERSATION_SELECTOR));
  }

  function getPinnedSortMutationSection(node) {
    const element = node instanceof Element ? node : node?.parentElement;
    if (!(element instanceof Element)) return null;
    const section = element.matches(PINNED_SORT_SECTION_SELECTOR)
      ? element
      : element.closest(PINNED_SORT_SECTION_SELECTOR);
    return isPinnedSortSectionElement(section) ? section : null;
  }

  function shouldSchedulePinnedSortForMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      if (changedNodes.some(mutationNodeContainsPinnedSortSection)) return true;
      const pinnedSection = getPinnedSortMutationSection(mutation.target);
      if (!(pinnedSection instanceof HTMLElement)) continue;
      if (changedNodes.some(mutationNodeContainsPinnedSortConversationAnchor)) return true;
      const targetElement = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
      if (targetElement instanceof Element && targetElement.closest('h2')) return true;
    }
    return false;
  }

  function observePinnedSortRoot(root) {
    if (!(root instanceof HTMLElement)) return false;
    if (pinnedSortObserver && pinnedSortObserverRoot === root && root.isConnected) return true;
    try { pinnedSortObserver?.disconnect?.(); } catch {}
    pinnedSortObserver = new MutationObserver((mutations) => {
      if (!shouldSchedulePinnedSortForMutations(mutations)) return;
      const suppressRemainingMs = pinnedSortSuppressObserverUntil - Date.now();
      if (suppressRemainingMs > 0) {
        schedulePinnedSortScan(Math.min(Math.max(suppressRemainingMs + 80, 120), 1800), 'observer_suppressed_deferred');
        return;
      }
      schedulePinnedSortScan(120, 'observer_mutation');
    });
    pinnedSortObserver.observe(root, { childList: true, subtree: true });
    pinnedSortObserverRoot = root;
    return true;
  }

  function scanPinnedSortUi(reason = 'scan') {
    if (!isArcaiaExtensionEnabled()) return;
    if (!isArcaiaFeatureEnabled('pinnedSort') && !isArcaiaFeatureEnabled('pinnedIcons')) {
      releasePinnedSortGate(`pinned_features_disabled:${reason}`);
      return;
    }
    if (Date.now() < pinnedSortSuppressObserverUntil) return;
    injectPinnedSortStyles();
    ensurePinnedSortObserverRoot(`scan:${reason}`);
    const nav = getPinnedSortNav();
    if (!(nav instanceof HTMLElement)) return;
    const pinnedSection = findPinnedSortSection(nav);
    if (!(pinnedSection instanceof HTMLElement)) {
      releasePinnedSortGate(`no_pinned_section:${reason}`);
      return;
    }
    const rowsBeforeApply = collectPinnedSortRows(pinnedSection);
    const rows = isArcaiaFeatureEnabled('pinnedSort')
      ? applyPinnedSortSavedOrder(pinnedSection)
      : rowsBeforeApply;
    bindPinnedSortRows(pinnedSection);
    if (isArcaiaFeatureEnabled('pinnedSort')) ensurePinnedSortScopeOrders(rows);
    releasePinnedSortGate(`pinned_sort_applied:${reason}`);
  }

  function startPinnedSortUi() {
    if (!isArcaiaExtensionEnabled()) return;
    injectPinnedSortStyles();
    scanPinnedSortUi('startup');
    if (!pinnedSortStartupBurstScheduled) {
      pinnedSortStartupBurstScheduled = true;
      [300, 900, 1800].forEach((delay) => {
        const timer = setTimeout(() => {
          pinnedSortStartupBurstTimers.delete(timer);
          scanPinnedSortUi(`startup_retry_${delay}`);
        }, delay);
        pinnedSortStartupBurstTimers.add(timer);
      });
    }
    ensurePinnedSortObserverRoot('startup');
  }

  function stopPinnedSortUi(reason = 'stop') {
    try { pinnedSortObserver?.disconnect?.(); } catch {}
    pinnedSortObserver = null;
    pinnedSortObserverRoot = null;
    if (pinnedSortScanTimer) clearTimeout(pinnedSortScanTimer);
    pinnedSortScanTimer = null;
    for (const timer of pinnedSortStartupBurstTimers) clearTimeout(timer);
    pinnedSortStartupBurstTimers.clear();
    pinnedSortStartupBurstScheduled = false;
    pinnedSortLastAppliedOrderByScope.clear();
    closePinnedFavoriteIconPicker();
    resetPinnedSortDrag();
    for (const host of document.querySelectorAll(`[${PINNED_FAVORITE_BOUND_ATTR}="true"]`)) {
      const handlers = host.__arcaiaPinnedFavoriteHandlers;
      if (handlers?.clickHandler) host.removeEventListener('click', handlers.clickHandler, true);
      if (handlers?.keydownHandler) host.removeEventListener('keydown', handlers.keydownHandler, true);
      delete host.__arcaiaPinnedFavoriteHandlers;
      host.removeAttribute(PINNED_FAVORITE_BOUND_ATTR);
      host.classList.remove('arcaia-pinned-favorite-icon-host');
      if (typeof host.__arcaiaPinnedFavoriteOriginalHtml === 'string') host.innerHTML = host.__arcaiaPinnedFavoriteOriginalHtml;
      const originalAttrs = host.__arcaiaPinnedFavoriteOriginalAttrs || {};
      for (const [attr, value] of [
        ['role', originalAttrs.role],
        ['tabindex', originalAttrs.tabIndex],
        ['aria-haspopup', originalAttrs.ariaHaspopup],
        ['aria-expanded', originalAttrs.ariaExpanded],
        ['title', originalAttrs.title],
        ['aria-label', originalAttrs.ariaLabel]
      ]) {
        if (value == null) host.removeAttribute(attr);
        else host.setAttribute(attr, value);
      }
      delete host.__arcaiaPinnedFavoriteOriginalHtml;
      delete host.__arcaiaPinnedFavoriteRow;
      delete host.__arcaiaPinnedFavoriteOriginalAttrs;
    }
    for (const anchor of document.querySelectorAll(`[${PINNED_SORT_BOUND_ANCHOR_ATTR}="true"]`)) {
      const handlers = anchor.__arcaiaPinnedSortHandlers;
      if (handlers?.dragstartHandler) anchor.removeEventListener('dragstart', handlers.dragstartHandler, true);
      if (handlers?.dragendHandler) anchor.removeEventListener('dragend', handlers.dragendHandler);
      delete anchor.__arcaiaPinnedSortHandlers;
      delete anchor.__arcaiaPinnedSortRow;
      anchor.removeAttribute(PINNED_SORT_BOUND_ANCHOR_ATTR);
      anchor.removeAttribute(PINNED_SORT_DRAG_SOURCE_ATTR);
      anchor.removeAttribute(PINNED_FAVORITE_ACTIVE_ATTR);
      anchor.removeAttribute(PINNED_FAVORITE_ICON_ATTR);
      const originalDraggable = anchor.__arcaiaPinnedSortOriginalDraggable;
      if (originalDraggable?.attr == null) anchor.removeAttribute('draggable');
      else anchor.setAttribute('draggable', originalDraggable.attr);
      if (originalDraggable) anchor.draggable = Boolean(originalDraggable.property);
      delete anchor.__arcaiaPinnedSortOriginalDraggable;
    }
    for (const item of document.querySelectorAll(`[${PINNED_SORT_BOUND_ITEM_ATTR}="true"]`)) {
      const handlers = item.__arcaiaPinnedSortHandlers;
      if (handlers?.dragoverHandler) item.removeEventListener('dragover', handlers.dragoverHandler);
      if (handlers?.dragleaveHandler) item.removeEventListener('dragleave', handlers.dragleaveHandler);
      if (handlers?.dropHandler) item.removeEventListener('drop', handlers.dropHandler);
      delete item.__arcaiaPinnedSortHandlers;
      delete item.__arcaiaPinnedSortRow;
      delete item.__arcaiaPinnedSortScope;
      item.removeAttribute(PINNED_SORT_BOUND_ITEM_ATTR);
      item.removeAttribute(PINNED_FAVORITE_ACTIVE_ATTR);
      item.removeAttribute(PINNED_FAVORITE_ICON_ATTR);
    }
    for (const list of document.querySelectorAll(`[${PINNED_SORT_LIST_BOUND_ATTR}="true"]`)) {
      const handlers = list.__arcaiaPinnedSortHandlers;
      if (handlers?.dragoverHandler) list.removeEventListener('dragover', handlers.dragoverHandler);
      if (handlers?.dragleaveHandler) list.removeEventListener('dragleave', handlers.dragleaveHandler);
      if (handlers?.dropHandler) list.removeEventListener('drop', handlers.dropHandler);
      delete list.__arcaiaPinnedSortHandlers;
      delete list.__arcaiaPinnedSortScope;
      list.removeAttribute(PINNED_SORT_LIST_BOUND_ATTR);
    }
    releasePinnedSortGate(`pinned_sort_stopped:${reason}`);
  }

  const TURN_EXPORT_BUTTON_ATTR = 'data-arcaia-turn-export-button';
  const TURN_EXPORT_TOOLBAR_ATTR = 'data-arcaia-turn-export-toolbar';
  const TURN_COPY_BUTTON_SELECTOR = 'button[data-testid="copy-turn-action-button"]';
  const ASSISTANT_COMPLETION_TURN_SELECTOR = 'section[data-turn="assistant"]';
  const CHATGPT_STREAM_ERROR_RETRY_BUTTON_SELECTOR = 'button[data-testid="regenerate-thread-error-button"]';
  const CHATGPT_STREAM_ERROR_BLOCK_SELECTOR = '.text-token-text-error';
  let turnExportUiStarted = false;
  let turnExportInteractionHandler = null;
  let turnExportInteractionRoot = null;

  function installTurnExportStyles() {
    if (document.getElementById('arcaia-turn-export-style')) return;
    const style = document.createElement('style');
    style.id = 'arcaia-turn-export-style';
    style.textContent = `
      .arcaia-turn-export-button {
        border: 0 !important;
        background: transparent;
        cursor: pointer;
      }
      .arcaia-turn-export-button[disabled] {
        cursor: wait !important;
      }
      .arcaia-turn-export-button .arcaia-turn-export-icon-wrap {
        pointer-events: none !important;
      }
      .arcaia-turn-export-button .arcaia-turn-export-icon {
        width: 20px !important;
        height: 20px !important;
        display: block !important;
        flex: 0 0 auto !important;
        color: currentColor !important;
        pointer-events: none !important;
      }
      .arcaia-turn-export-button .arcaia-turn-export-icon path,
      .arcaia-turn-export-button .arcaia-turn-export-icon polyline,
      .arcaia-turn-export-button .arcaia-turn-export-icon line {
        vector-effect: non-scaling-stroke !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function turnExportIconHtml() {
    return [
      '<span class="arcaia-turn-export-icon-wrap flex items-center justify-center touch:w-10 h-8 w-8" aria-hidden="true">',
      '<svg class="arcaia-turn-export-icon icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">',
      '<path d="M5.5 2.75h6.25L16 7v9.25a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.5-1.5v-12a1.5 1.5 0 0 1 1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/>',
      '<path d="M11.75 2.75V6a1 1 0 0 0 1 1H16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>',
      '<path d="M6.7 13.15V8.85l2.05 2.75 2.05-2.75v4.3" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>',
      '<line x1="14.2" y1="10.15" x2="14.2" y2="15.45" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/>',
      '<polyline points="12.2 13.45 14.2 15.45 16.2 13.45" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>',
      '</svg>',
      '</span>'
    ].join('');
  }

  const NATIVE_BRANCH_PREV_LABELS = ['前の回答', 'Previous response'];
  const NATIVE_BRANCH_NEXT_LABELS = ['次の回答', 'Next response'];

  function hasButtonWithAnyAriaLabel(root, labels) {
    if (!root?.querySelector) return false;
    return labels.some((label) => {
      try { return Boolean(root.querySelector(`button[aria-label="${label}"]`)); }
      catch { return false; }
    });
  }

  function isNativeBranchNavigationElement(element) {
    if (!element?.isConnected && !element?.querySelector) return false;
    let node = element?.nodeType === Node.ELEMENT_NODE ? element : element?.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      if (hasButtonWithAnyAriaLabel(node, NATIVE_BRANCH_PREV_LABELS) && hasButtonWithAnyAriaLabel(node, NATIVE_BRANCH_NEXT_LABELS)) return true;
    }
    return false;
  }

  function getTurnCopyButtons(root = document) {
    const queryRoot = root?.querySelectorAll ? root : document;
    const buttons = [];
    if (root instanceof Element && root.matches?.(TURN_COPY_BUTTON_SELECTOR)) buttons.push(root);
    buttons.push(...Array.from(queryRoot.querySelectorAll(TURN_COPY_BUTTON_SELECTOR)));
    return buttons
      .filter((button) => !button.closest(`[${TURN_EXPORT_BUTTON_ATTR}]`))
      .filter(isLikelyAssistantTurnCopyButton);
  }

  function getLatestAssistantCompletionTurn() {
    const turns = Array.from(document.querySelectorAll(ASSISTANT_COMPLETION_TURN_SELECTOR));
    return turns.at(-1) || null;
  }

  function buildAssistantCompletionSignal(element) {
    const turnElement = element?.closest?.(ASSISTANT_COMPLETION_TURN_SELECTOR) || null;
    if (!turnElement) return { turnElement: null, key: null };
    const ids = getMessageIdHintsFromElement(element).sort();
    const fallbackId = turnElement.getAttribute?.('data-turn-id')
      || turnElement.querySelector?.('[data-message-id]')?.getAttribute?.('data-message-id')
      || turnElement.getAttribute?.('data-testid')
      || null;
    const key = ids.length
      ? `ids:${ids.join('|')}`
      : (fallbackId ? `turn:${fallbackId}` : null);
    return { turnElement, key };
  }

  function buildLatestAssistantCompletionSignal() {
    const turnElement = getLatestAssistantCompletionTurn();
    return turnElement
      ? buildAssistantCompletionSignal(turnElement)
      : { turnElement: null, key: null };
  }

  function isElementInsideLatestAssistantCompletionTurn(element) {
    const latestAssistantTurn = getLatestAssistantCompletionTurn();
    const elementTurn = element?.closest?.(ASSISTANT_COMPLETION_TURN_SELECTOR) || null;
    return Boolean(latestAssistantTurn && elementTurn === latestAssistantTurn);
  }

  function isConfirmedChatGPTStreamErrorRetryButton(button) {
    return Boolean(
      button?.matches?.(CHATGPT_STREAM_ERROR_RETRY_BUTTON_SELECTOR)
      && button.closest?.(CHATGPT_STREAM_ERROR_BLOCK_SELECTOR)
      && isElementInsideLatestAssistantCompletionTurn(button)
    );
  }

  function markAssistantCompletedFromStreamErrorRetryButton(button) {
    if (!isConfirmedChatGPTStreamErrorRetryButton(button)) {
      return { skipped: true, reason: 'not_confirmed_latest_stream_error' };
    }
    return markAssistantCompletedFromSignal(
      buildAssistantCompletionSignal(button),
      'assistant_stream_error:retry_button_mutation'
    );
  }

  function primeExistingAssistantCompletionSignals() {
    const candidates = Array.from(
      document.querySelectorAll(CHATGPT_STREAM_ERROR_RETRY_BUTTON_SELECTOR)
    );
    for (const element of candidates) {
      const signal = buildAssistantCompletionSignal(element);
      rememberAssistantCompletionSignal(signal.turnElement, signal.key);
    }
    return candidates.length;
  }

  function isLikelyAssistantTurnCopyButton(button) {
    if (!button || !button.isConnected) return false;
    if (isNativeBranchNavigationElement(button)) return false;
    if (button.closest('[data-message-author-role="user"], [data-turn="user"]')) return false;
    if (button.closest('[data-message-author-role="assistant"], [data-turn="assistant"]')) return true;
    const section = button.closest?.(MESSAGE_SECTION_SELECTOR);
    if (section?.querySelector?.('[data-message-author-role="assistant"], [data-turn="assistant"]')) return true;
    if (section?.querySelector?.('[data-message-author-role="user"], [data-turn="user"]')) return false;
    const label = String(button.getAttribute?.('aria-label') || '').toLowerCase();
    return label.includes('copy') || label.includes('コピー');
  }

  function getMessageIdHintsFromElement(element) {
    const ids = new Set();
    let root = element?.closest?.('[data-message-id], [data-turn-id], article, section, [data-message-author-role="assistant"], [data-turn="assistant"]');
    if (!root) root = element?.parentElement || element;

    for (const attr of ['data-message-id', 'data-turn-id']) {
      const own = root?.getAttribute?.(attr);
      if (own) ids.add(own);
      const nested = root?.querySelectorAll?.(`[${attr}]`) || [];
      for (const item of nested) {
        const value = item.getAttribute(attr);
        if (value) ids.add(value);
      }
    }

    const idLike = root?.id || '';
    if (idLike && /[a-f0-9-]{12,}/i.test(idLike)) ids.add(idLike);
    return Array.from(ids);
  }

  function getAssistantOrdinalForButton(button) {
    const buttons = getTurnCopyButtons().filter((item) => item.isConnected);
    return buttons.indexOf(button);
  }

  function resolveTurnFromHints(result, hints) {
    const turns = Array.isArray(result?.turns) ? result.turns : [];
    const idSet = new Set(hints?.ids || []);
    if (idSet.size) {
      const matched = turns.find((turn) => {
        const assistantMessages = Array.isArray(turn.assistantMessages) ? turn.assistantMessages : [];
        return assistantMessages.some((msg) => idSet.has(msg.message_id) || idSet.has(msg.id));
      });
      if (matched) return matched;
    }

    const ordinal = Number.isInteger(hints?.assistantOrdinal) ? hints.assistantOrdinal : -1;
    if (ordinal >= 0) {
      const assistantTurns = turns.filter((turn) => Array.isArray(turn.assistantMessages) && turn.assistantMessages.length > 0);
      if (assistantTurns[ordinal]) return assistantTurns[ordinal];
    }
    return null;
  }

  async function handleSingleTurnExportClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    if (!button || button.disabled) return;

    const originalTitle = button.title;
    button.disabled = true;
    button.title = 'Arcaia: 保存中...';

    try {
      const copyButton = button.__arcaiaCopyButton || button.previousElementSibling || button.parentElement;
      const hints = {
        ids: getMessageIdHintsFromElement(copyButton),
        assistantOrdinal: getAssistantOrdinalForButton(copyButton)
      };
      const result = await extractChatGPTInternal(false);
      const turn = resolveTurnFromHints(result, hints);
      if (!turn) throw new Error('クリックされた回答に対応するTurnを特定できませんでした。');

      const markdown = buildSingleTurnMarkdownDraft(
        result.title,
        result.url,
        result.conversationId,
        turn,
        result.turnCount || result.turns?.length || 1
      );
      const filename = `${makeSingleTurnExportName(result, turn)}.md`;
      downloadText(filename, markdown, 'text/markdown;charset=utf-8');
      button.title = `Arcaia: Turn ${turn.turnIndex + 1}/${result.turnCount || result.turns?.length || 1} を保存しました`;
      setTimeout(() => { if (button.isConnected) button.title = originalTitle; }, 1800);
    } catch (error) {
      console.warn('[Arcaia] single turn export failed', error);
      button.title = `Arcaia: 保存失敗 - ${error instanceof Error ? error.message : String(error)}`;
      setTimeout(() => { if (button.isConnected) button.title = originalTitle; }, 2600);
    } finally {
      button.disabled = false;
    }
  }

  function createTurnExportButton(copyButton) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'arcaia-turn-export-button text-token-text-secondary hover:bg-token-surface-hover rounded-lg';
    button.setAttribute(TURN_EXPORT_BUTTON_ATTR, 'true');
    button.setAttribute('aria-label', 'ArcaiaでこのTurnをMarkdown保存');
    button.title = 'Arcaia: このTurnをMarkdown保存';
    button.innerHTML = turnExportIconHtml();
    button.__arcaiaCopyButton = copyButton;
    button.addEventListener('click', handleSingleTurnExportClick, true);
    return button;
  }

  function getTurnExportToolbarContainer(copyButton) {
    const container = copyButton?.parentElement || null;
    if (!container || !container.isConnected) return null;
    if (container.closest?.(`[${TURN_EXPORT_BUTTON_ATTR}]`)) return null;
    if (isNativeBranchNavigationElement(container)) return null;
    return container;
  }

  function installTurnExportButtons(root = document, copyButtonCandidates = null) {
    if (!isArcaiaExtensionEnabled()) return;
    installTurnExportStyles();
    const copyButtons = Array.isArray(copyButtonCandidates) ? copyButtonCandidates : getTurnCopyButtons(root);
    for (const copyButton of copyButtons) {
      const container = getTurnExportToolbarContainer(copyButton);
      if (!container) continue;
      const existing = container.querySelector?.(`[${TURN_EXPORT_BUTTON_ATTR}]`);
      if (existing) {
        existing.__arcaiaCopyButton = copyButton;
        container.setAttribute(TURN_EXPORT_TOOLBAR_ATTR, 'true');
        continue;
      }
      const button = createTurnExportButton(copyButton);
      try {
        container.insertBefore(button, container.firstChild);
      } catch {
        container.appendChild(button);
      }
      container.setAttribute(TURN_EXPORT_TOOLBAR_ATTR, 'true');
    }
  }

  function installTurnExportInteractionTriggers(root = conversationDomObservedContentRoot) {
    const nextRoot = root instanceof Element ? root : null;
    if (turnExportInteractionRoot === nextRoot && turnExportInteractionHandler) return;
    if (turnExportInteractionRoot && turnExportInteractionHandler) {
      turnExportInteractionRoot.removeEventListener('pointerover', turnExportInteractionHandler, true);
      turnExportInteractionRoot.removeEventListener('focusin', turnExportInteractionHandler, true);
    }
    turnExportInteractionRoot = nextRoot;
    if (!nextRoot) return;
    if (!turnExportInteractionHandler) turnExportInteractionHandler = (event) => {
      if (!isArcaiaExtensionEnabled()) return;
      const target = event.target?.nodeType === Node.ELEMENT_NODE ? event.target : event.target?.parentElement;
      const assistantTurn = target?.closest?.('[data-message-author-role="assistant"], section[data-turn="assistant"], section[data-testid^="conversation-turn-"]');
      if (!(assistantTurn instanceof Element) || !turnExportInteractionRoot?.contains?.(assistantTurn)) return;
      queueMicrotask(() => {
        if (assistantTurn.isConnected) installTurnExportButtons(assistantTurn);
      });
    };
    nextRoot.addEventListener('pointerover', turnExportInteractionHandler, true);
    nextRoot.addEventListener('focusin', turnExportInteractionHandler, true);
  }

  function nodeContainsTurnCopyButton(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (isNativeBranchNavigationElement(node)) return false;
    if (node.matches?.(TURN_COPY_BUTTON_SELECTOR)) return true;
    return Boolean(node.querySelector?.(TURN_COPY_BUTTON_SELECTOR));
  }

  function getAddedTurnCopyButtonsFromMutations(mutations) {
    const buttons = [];
    const seen = new Set();
    for (const mutation of mutations || []) {
      for (const node of Array.from(mutation.addedNodes || [])) {
        if (!nodeContainsTurnCopyButton(node)) continue;
        const candidates = node.matches?.(TURN_COPY_BUTTON_SELECTOR)
          ? [node]
          : Array.from(node.querySelectorAll?.(TURN_COPY_BUTTON_SELECTOR) || []);
        for (const button of candidates) {
          if (seen.has(button) || !isLikelyAssistantTurnCopyButton(button)) continue;
          seen.add(button);
          buttons.push(button);
        }
      }
    }
    return buttons;
  }

  function getAddedChatGPTStreamErrorRetryButtonsFromMutations(mutations) {
    const buttons = [];
    const seen = new Set();
    for (const mutation of mutations || []) {
      for (const node of Array.from(mutation.addedNodes || [])) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
        const candidates = node.matches?.(CHATGPT_STREAM_ERROR_RETRY_BUTTON_SELECTOR)
          ? [node]
          : Array.from(node.querySelectorAll?.(CHATGPT_STREAM_ERROR_RETRY_BUTTON_SELECTOR) || []);
        for (const button of candidates) {
          if (seen.has(button) || !isConfirmedChatGPTStreamErrorRetryButton(button)) continue;
          seen.add(button);
          buttons.push(button);
        }
      }
    }
    return buttons;
  }

  function handleTurnExportMutations(mutations) {
    const addedCopyButtons = getAddedTurnCopyButtonsFromMutations(mutations);
    if (addedCopyButtons.length) {
      installTurnExportButtons(conversationDomObservedContentRoot, addedCopyButtons);
      scheduleApplyMessageTimestamps('assistant_toolbar_ready');
    }
    const addedStreamErrorRetryButtons = getAddedChatGPTStreamErrorRetryButtonsFromMutations(mutations);
    for (const retryButton of addedStreamErrorRetryButtons) {
      markAssistantCompletedFromStreamErrorRetryButton(retryButton);
    }
  }

  function startTurnExportUi() {
    if (!isArcaiaExtensionEnabled()) return;
    turnExportUiStarted = true;
    const conversationObserverWasStarted = conversationDomObserverStarted;
    startConversationDomObserver();
    primeExistingAssistantCompletionSignals();
    const root = conversationDomObservedContentRoot;
    if (conversationObserverWasStarted && root instanceof Element) {
      installTurnExportButtons(root);
      installTurnExportInteractionTriggers(root);
    }
  }

  function stopTurnExportUi() {
    turnExportUiStarted = false;
    if (turnExportInteractionHandler && turnExportInteractionRoot) {
      turnExportInteractionRoot.removeEventListener('pointerover', turnExportInteractionHandler, true);
      turnExportInteractionRoot.removeEventListener('focusin', turnExportInteractionHandler, true);
    }
    turnExportInteractionHandler = null;
    turnExportInteractionRoot = null;
    for (const button of document.querySelectorAll(`[${TURN_EXPORT_BUTTON_ATTR}]`)) button.remove();
    for (const toolbar of document.querySelectorAll(`[${TURN_EXPORT_TOOLBAR_ATTR}="true"]`)) {
      toolbar.removeAttribute(TURN_EXPORT_TOOLBAR_ATTR);
    }
  }

  const HEADER_MARKDOWN_BUTTON_ID = 'arcaia-header-markdown-button';
  const HEADER_MARKDOWN_CONTENT_VERSION = 'download-icon-v1';
  let headerMarkdownObserver = null;
  let headerMarkdownObserverTarget = null;
  let headerMarkdownObserverSubtree = false;

  function createHeaderMarkdownDownloadIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 3v12m0 0 4-4m-4 4-4-4M5 21h14a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2');
    svg.appendChild(path);
    return svg;
  }

  function renderHeaderMarkdownButtonContent(button, shareButton) {
    button.replaceChildren();
    const wrapper = document.createElement('div');
    wrapper.className = shareButton?.firstElementChild?.className || 'flex w-full items-center justify-center';
    wrapper.appendChild(createHeaderMarkdownDownloadIcon());
    button.appendChild(wrapper);
    button.dataset.arcaiaContentVersion = HEADER_MARKDOWN_CONTENT_VERSION;
  }

  function findNativeShareButton(root = document) {
    const queryRoot = root?.querySelectorAll ? root : document;
    const buttons = Array.from(queryRoot.querySelectorAll(root instanceof Element && root.matches?.('header') ? 'button' : 'header button'));
    return buttons.find((button) => {
      if (!button?.isConnected) return false;
      if (!button.closest?.('header')) return false;
      const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = String(button.getAttribute('aria-label') || '').trim();
      const testId = String(button.getAttribute('data-testid') || '');
      return /^(共有する|共有|Share)$/i.test(text)
        || /^(共有する|共有|Share)$/i.test(aria)
        || /share/i.test(testId);
    }) || null;
  }

  function findHeaderMarkdownObserverBinding() {
    const shareButton = findNativeShareButton();
    const actionsContainer = shareButton?.parentElement;
    if (actionsContainer instanceof Element) {
      return { target: actionsContainer, subtree: false };
    }
    const existing = document.getElementById(HEADER_MARKDOWN_BUTTON_ID);
    const existingActionsContainer = existing?.parentElement;
    if (existingActionsContainer instanceof Element && existingActionsContainer.closest?.('header')) {
      return { target: existingActionsContainer, subtree: false };
    }
    const header = existing?.closest?.('header') || document.querySelector('header');
    return {
      target: header instanceof Element ? header : null,
      subtree: Boolean(header)
    };
  }

  function ensureHeaderMarkdownButton() {
    if (!isArcaiaNormalMode() || window.top !== window) return null;
    const shareButton = findNativeShareButton();
    const parent = shareButton?.parentElement;
    if (!shareButton || !parent) return null;
    const existing = document.getElementById(HEADER_MARKDOWN_BUTTON_ID);
    if (existing?.isConnected) {
      existing.className = shareButton.className;
      if (existing.dataset.arcaiaContentVersion !== HEADER_MARKDOWN_CONTENT_VERSION) {
        renderHeaderMarkdownButtonContent(existing, shareButton);
      }
      if (existing.parentElement !== parent || existing.nextElementSibling !== shareButton) {
        parent.insertBefore(existing, shareButton);
      }
      return existing;
    }
    const button = document.createElement('button');
    button.id = HEADER_MARKDOWN_BUTTON_ID;
    button.type = 'button';
    button.className = shareButton.className;
    button.title = 'Arcaia: このチャットの全ログをMarkdownでダウンロード';
    button.setAttribute('aria-label', '全ログをMarkdownでダウンロード');
    button.setAttribute('data-testid', 'arcaia-header-markdown-button');
    renderHeaderMarkdownButtonContent(button, shareButton);
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      try {
        await startToolbarMarkdownSaveFromPopup();
      } finally {
        button.disabled = false;
      }
    }, true);
    parent.insertBefore(button, shareButton);
    return button;
  }

  function refreshHeaderMarkdownObserverBinding(reason = 'refresh') {
    if (!isArcaiaNormalMode() || window.top !== window) return false;
    const binding = findHeaderMarkdownObserverBinding();
    const target = binding.target;
    const subtree = Boolean(binding.subtree);
    if (
      headerMarkdownObserver
      && headerMarkdownObserverTarget === target
      && headerMarkdownObserverSubtree === subtree
      && target?.isConnected
    ) return true;
    try { headerMarkdownObserver?.disconnect?.(); } catch {}
    headerMarkdownObserver = null;
    headerMarkdownObserverTarget = target;
    headerMarkdownObserverSubtree = subtree;
    if (!(target instanceof Element)) return false;
    headerMarkdownObserver = new MutationObserver(() => {
      ensureHeaderMarkdownButton();
      handleConversationDependentDomSignal('header_actions_mutation');
      const nextBinding = findHeaderMarkdownObserverBinding();
      if (
        nextBinding.target !== headerMarkdownObserverTarget
        || Boolean(nextBinding.subtree) !== headerMarkdownObserverSubtree
        || !headerMarkdownObserverTarget?.isConnected
      ) {
        refreshHeaderMarkdownObserverBinding('header_actions_binding_changed');
      }
    });
    headerMarkdownObserver.observe(target, { childList: true, subtree });
    return true;
  }

  function syncHeaderMarkdownButtonUi(reason = 'sync') {
    if (!isArcaiaNormalMode() || window.top !== window) return false;
    ensureHeaderMarkdownButton();
    return refreshHeaderMarkdownObserverBinding(reason);
  }

  function startHeaderMarkdownButtonUi() {
    if (!isArcaiaNormalMode() || window.top !== window) return;
    syncHeaderMarkdownButtonUi('startup_after_settings_sync');
  }

  function stopHeaderMarkdownButtonUi() {
    try { headerMarkdownObserver?.disconnect?.(); } catch {}
    headerMarkdownObserver = null;
    headerMarkdownObserverTarget = null;
    headerMarkdownObserverSubtree = false;
    try { document.getElementById(HEADER_MARKDOWN_BUTTON_ID)?.remove?.(); } catch {}
  }

  function startArcaiaPageUi() {
    if (!isArcaiaExtensionEnabled()) {
      cleanupArcaiaPageUiForDisabled('startup_disabled');
      return;
    }
    if (arcaiaPageUiStarted) return;
    arcaiaPageUiStarted = true;
    if (window.top !== window) return;
    if (isArcaiaFeatureEnabled('ctrlEnterSend')) startCtrlEnterSendUi();
    if (isArcaiaFeatureEnabled('modelDecoration')) {
      try { window.__ARCAIA_MODEL_SELECTOR_UI__?.start?.(); } catch {}
    }
    if (isArcaiaFeatureEnabled('blockCollapser')) startCodeBlockCollapserUi();
    startPageConversationMonitor();
    if (isArcaiaFeatureEnabled('loadingTitle') || isArcaiaFeatureEnabled('completionSound') || isArcaiaFeatureEnabled('liteView')) {
      startAssistantLoadingFaviconMonitor();
    }
    if (isArcaiaFeatureEnabled('pinnedSort') || isArcaiaFeatureEnabled('pinnedIcons')) {
      if (isArcaiaFeatureEnabled('pinnedSort')) startPinnedSortEarlyGate();
      startPinnedSortUi();
    } else {
      releasePinnedSortGate('pinned_features_disabled');
    }
    if (isArcaiaFeatureEnabled('turnMarkdownButtons')) startTurnExportUi();
    if (isArcaiaFeatureEnabled('headerMarkdownButton')) startHeaderMarkdownButtonUi();
    if (isArcaiaFeatureEnabled('messageTimestamps')) startMessageTimestampUi();
    if (isArcaiaFeatureEnabled('liteView')) {
      startRollingLiteUi();
      void runLiteDisplayEnable({
        requestedBy: 'feature_settings_startup',
        liteShowImages: featureSettings.liteImages,
        commandId: 'feature_settings_startup'
      }).catch(() => {});
    } else {
      stopRollingLiteUi();
      void runLiteDisplayDisable({ requestedBy: 'feature_settings_startup_disabled', commandId: 'feature_settings_startup_disabled' }).catch(() => {});
    }
  }

  const startupSettingsSyncPromise = syncStartupSettingsFromStorage();

  function startAfterStartupSettingsSync() {
    startupSettingsSyncPromise.finally(startArcaiaPageUi);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAfterStartupSettingsSync, { once: true });
  } else {
    startAfterStartupSettingsSync();
  }


  function isElementVisibleForScreenshot(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
  }

  function getLatestAssistantScreenshotElement() {
    const turns = buildDomTurnsFromConversation(document);
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const assistants = (turns[i].containers || []).filter((container) => {
        const role = container.querySelector?.('[data-message-author-role="assistant"]') || (container.matches?.('[data-message-author-role="assistant"]') ? container : null);
        return role && isElementVisibleForScreenshot(container);
      });
      if (assistants.length) return assistants[assistants.length - 1];
    }
    const fallback = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'))
      .map((el) => getLiteMessageContainer(el))
      .filter(Boolean)
      .filter((el, idx, arr) => arr.indexOf(el) === idx)
      .filter(isElementVisibleForScreenshot)
      .pop();
    return fallback || null;
  }

  async function getLatestAnswerScreenshotTarget() {
    const element = getLatestAssistantScreenshotElement();
    if (!element) throw new Error('latest_assistant_element_not_found');
    try {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await new Promise((resolve) => setTimeout(resolve, 180));
    } catch {}
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(viewportWidth, rect.right);
    const bottom = Math.min(viewportHeight, rect.bottom);
    const captureRect = {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
    if (captureRect.width < 4 || captureRect.height < 4) throw new Error('latest_assistant_element_outside_viewport');
    return {
      ok: true,
      appVersion: APP_VERSION,
      action: 'latest_answer_screenshot_target',
      url: window.location.href,
      devicePixelRatio: window.devicePixelRatio || 1,
      viewportWidth,
      viewportHeight,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom
      },
      captureRect,
      wasClipped: rect.left < 0 || rect.top < 0 || rect.right > viewportWidth || rect.bottom > viewportHeight,
      selectorHints: {
        tagName: element.tagName,
        className: typeof element.className === 'string' ? element.className.slice(0, 300) : '',
        dataTestId: element.getAttribute?.('data-testid') || null,
        messageId: element.getAttribute?.('data-message-id') || element.querySelector?.('[data-message-id]')?.getAttribute?.('data-message-id') || null
      }
    };
  }


  function summarizeSelectorForDiagnostics(selector, root = document) {
    try {
      const nodes = Array.from(root.querySelectorAll(selector));
      return {
        selector,
        count: nodes.length,
        samples: nodes.slice(0, 5).map((node) => ({
          tag: String(node.tagName || '').toLowerCase(),
          id: node.id || '',
          className: typeof node.className === 'string' ? node.className.split(/\s+/).filter(Boolean).slice(0, 12).join(' ') : '',
          role: node.getAttribute?.('role') || null,
          dataMessageAuthorRole: node.getAttribute?.('data-message-author-role') || null,
          dataTestId: node.getAttribute?.('data-testid') || null,
          textLength: (node.textContent || '').length
        }))
      };
    } catch (error) {
      return { selector, count: null, error: error instanceof Error ? error.message : String(error) };
    }
  }


  function getIframeDiagnosticsForBundle() {
    const legacyIframe = document.getElementById(LEGACY_NATIVE_SNAPSHOT_IFRAME_ID);
    return {
      exists: Boolean(legacyIframe),
      legacyOnly: true,
      note: 'v0.1.60では独自復元ビュー/Native Snapshot iframeは廃止済みです。残骸があれば起動時に削除します。'
    };
  }

  function getDomDiagnosticsForBundle() {
    const generationDetector = isLikelyChatGPTGenerating();
    const groupingPlan = buildLiteGroupingPlan(document, getEffectiveLiteTurnCount(), generationDetector.generating);
    const groupingDiagnostics = getLiteGroupingDiagnostics(groupingPlan);
    const allTurns = groupingPlan.groups.map((group) => ({
      containers: group.records.map((record) => record.section),
      hasUser: group.hasUser,
      hasAssistant: group.hasAssistant,
      kind: group.kind
    }));
    const visibleTurns = getVisibleDomTurnsFromConversation();
    const hiddenByRolling = Array.from(document.querySelectorAll(`[${ROLLING_HIDE_ATTR}="true"]`));
    const conversationId = tryExtractConversationIdFromUrl(window.location.href);
    const selectors = [
      '[data-message-author-role]',
      '[data-message-author-role="user"]',
      '[data-message-author-role="assistant"]',
      MESSAGE_SECTION_SELECTOR,
      'article',
      'main',
      'pre',
      'pre code',
      `[${ROLLING_HIDE_ATTR}="true"]`,
    ].map((selector) => summarizeSelectorForDiagnostics(selector));
    return {
      readyState: document.readyState,
      title: document.title,
      urlRedacted: redactSnapshotUrl(window.location.href),
      conversationId,
      isTopFrame: window.top === window,
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollY: Math.round(window.scrollY || 0),
        bodyScrollHeight: document.body?.scrollHeight || 0,
        documentScrollHeight: document.documentElement?.scrollHeight || 0
      },
      allTurnCount: allTurns.length,
      visibleTurnCount: visibleTurns.length,
      hiddenByRollingCount: hiddenByRolling.length,
      generationDetector,
      ...groupingDiagnostics,
      liteGrouping: groupingDiagnostics,
      roleNodeCounts: getRoleNodeCountsForLite(),
      turnBoundaryDiagnostics: collectTurnBoundaryDiagnostics(allTurns),
      litePruneState: {
        rollingDetectedTurnCount: rollingLiteState.detectedTurnCount ?? null,
        rollingVisibleTurnCount: rollingLiteState.visibleTurnCount ?? null,
        rollingRetainedTurnCount: rollingLiteState.retainedTurnCount ?? null,
        rollingHiddenContainerCount: rollingLiteState.hiddenContainerCount ?? null,
        rollingRemovedContainerCount: rollingLiteState.removedContainerCount ?? 0,
        pruneMode: rollingLiteState.pruneMode || null,
        rollingLastSkipReason: rollingLiteState.lastSkipReason || null,
        diagnosticTurnMismatch: typeof rollingLiteState.visibleTurnCount === 'number' ? visibleTurns.length !== rollingLiteState.visibleTurnCount : null
      },
      turnSamples: allTurns.slice(-8).map((turn, index) => ({
        sampleIndexFromEnd: allTurns.length - Math.min(8, allTurns.length) + index + 1,
        role: turn.role || null,
        textLength: (turn.text || '').length,
        containerCount: turn.containers?.length || 0,
        firstContainer: turn.containers?.[0] ? {
          tag: String(turn.containers[0].tagName || '').toLowerCase(),
          className: typeof turn.containers[0].className === 'string' ? turn.containers[0].className.split(/\s+/).filter(Boolean).slice(0, 14).join(' ') : '',
          hiddenByRolling: turn.containers[0].getAttribute?.(ROLLING_HIDE_ATTR) === 'true',
          display: turn.containers[0].style?.display || ''
        } : null
      })),
      selectors,
      iframe: getIframeDiagnosticsForBundle()
    };
  }

  function getToolbarOperationDeps() {
    return {
      appVersion: APP_VERSION,
      extractChatGPTInternal,
      makeBaseExportName,
      downloadText
    };
  }

  function getToolbarOperations() {
    const toolbar = window.ArcaiaContentToolbar;
    if (!toolbar || typeof toolbar.startToolbarMarkdownSaveFromPopup !== 'function') {
      throw new Error('Arcaia toolbar helper is not loaded.');
    }
    return toolbar;
  }

  function startToolbarMarkdownSaveFromPopup() {
    return getToolbarOperations().startToolbarMarkdownSaveFromPopup(getToolbarOperationDeps());
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;

    const handlers = {
      AICE_PING: getStatus,
      AICE_GET_UI_SETTINGS_STATUS: getUiSettingsStatus,
      AICE_LITE_DISPLAY_STATUS: async () => runLiteDisplayStatus(),
      AICE_SET_UI_SETTINGS: async () => setUiSettings(message, 'popup_ui_settings'),
      AICE_SET_EXTENSION_ENABLED: async () => setExtensionEnabled(Boolean(message.enabled), 'popup_command'),
      AICE_SET_LITE_IMAGE_DISPLAY: async () => setLiteShowImagesEnabled(message.liteShowImages !== false, 'popup_command'),
      AICE_SET_ASSISTANT_COMPLETION_SOUND: async () => setAssistantCompletionSoundEnabled(Boolean(message.enabled), 'popup_command'),
      AICE_PLAY_ASSISTANT_COMPLETION_SOUND_TEST: async () => playAssistantCompletionSound('popup_manual_test'),
      AICE_GET_EXTENSION_ENABLED_STATUS: async () => ({
        ok: true,
        appVersion: APP_VERSION,
        action: 'extension_enabled_status',
        enabled: isArcaiaNormalMode(),
        runtimeEnabled: isArcaiaRuntimeEnabled(),
        operationMode,
        featureSettings
      }),
      AICE_LITE_DISPLAY_LOAD_FULL_ONCE: async () => loadFullConversationInPlace('popup_load_full_lite_off', { disableLite: true }),
      AICE_TOOLBAR_SAVE_MARKDOWN: async () => startToolbarMarkdownSaveFromPopup(),
      AICE_ASSISTANT_LOADING_FAVICON_STATUS: async () => getAssistantLoadingFaviconStatus(),
      AICE_GET_LATEST_ANSWER_SCREENSHOT_TARGET: async () => getLatestAnswerScreenshotTarget(),
      AICE_EXTRACT_CHATGPT_INTERNAL: async () => extractChatGPTInternal(Boolean(message.includeRaw))
    };

    const handler = handlers[message.type];
    if (!handler) return false;

    const offModeAllowed = new Set(['AICE_PING', 'AICE_GET_UI_SETTINGS_STATUS', 'AICE_SET_UI_SETTINGS', 'AICE_SET_EXTENSION_ENABLED', 'AICE_GET_EXTENSION_ENABLED_STATUS']);
    if (!isArcaiaRuntimeEnabled() && !offModeAllowed.has(message.type)) {
      sendResponse({ ok: false, error: 'arcaia_stopped', appVersion: APP_VERSION, operationMode, url: window.location.href });
      return true;
    }

    Promise.resolve()
      .then(() => handler())
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((error) => {
        const messageText = error instanceof Error ? error.message : String(error);
        sendResponse({
          ok: false,
          error: messageText,
          appVersion: APP_VERSION,
          url: window.location.href
        });
      });

    return true;
  });
})();
