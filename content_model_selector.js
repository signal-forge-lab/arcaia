(() => {
  'use strict';

  const API_KEY = '__ARCAIA_MODEL_SELECTOR_UI__';
  const STYLE_ID = 'arcaia-model-selector-rich-style';
  const PICKER_SELECTOR = '[data-testid="composer-intelligence-picker-content"]';
  const THINKING_SLIDER_HOST_SELECTOR = '[data-testid="composer-model-picker-slider-simple-view"]';
  const COMPOSER_SELECTOR = 'form[data-type="unified-composer"]';
  const WORK_TRIGGER_WRAPPER_SELECTOR = '[data-animated-slider-trigger="true"]';
  const WORK_TRIGGER_MODEL_LABEL_SELECTOR = '[class*="_SliderTriggerModelLabel"]';
  const WORK_TRIGGER_EFFORT_LABEL_SELECTOR = '[class*="_SliderTriggerEffortLabel"]';
  const SURFACE_MODE_BUTTON_SELECTOR = 'button[role="radio"]';
  const RICH_ATTR = 'data-arcaia-model-rich';
  const NATIVE_LABEL_ATTR = 'data-arcaia-model-native-label';
  const RICH_CONTENT_ATTR = 'data-arcaia-model-rich-content';
  const ORIGINAL_TITLE_ATTR = 'data-arcaia-model-original-title';
  const ORIGINAL_ARIA_LABEL_ATTR = 'data-arcaia-model-original-aria-label';
  const ORIGINAL_WIDTH_ATTR = 'data-arcaia-model-native-width';
  const COMPOSER_RICH_ATTR = 'data-arcaia-model-rich-composer';
  const COMPOSER_NATIVE_EDITOR_PADDING_ATTR = 'data-arcaia-model-native-editor-padding-end';
  const VISUAL_STYLE_ATTR = 'data-arcaia-model-style';
  const VISUAL_STYLES = new Set(['classic', 'aurora', 'outline']);
  const CHATGPT_LAST_MODEL_COOKIE = 'oai-last-model-config';
  const CHATGPT_SURFACE_MODE_STORAGE_KEY = 'oai/apps/tpp/chat-surface-mode';
  const CHATGPT_SURFACE_MODE_COOKIE = 'oai-chat-surface-mode';
  const WORK_MODEL_SETTINGS_STORAGE_KEY = 'oai/apps/tpp/model-settings';
  const WORK_THINKING_EFFORT_STORAGE_KEY = 'oai/apps/tpp/thinking-effort';
  const MAX_NAVIGATION_RESET_HISTORY = 4;
  const MODEL_VERSION_PATTERN = /\bGPT[-\u2011\u2013\s]?5\.6\b/i;
  const ANY_MODEL_PATTERN = /\bGPT[-\u2011\u2013\s]?\d+(?:\.\d+)?\b/i;
  const BARE_MODEL_VERSION_PATTERN = /\b(\d+\.\d+)\b/;
  const PERFORMANCE_LABELS = new Set([
    '軽', '最速', '中程度', '高い', '非常に高い', '最大',
    'Light', 'Fastest', 'Medium', 'High', 'Very high', 'Maximum'
  ]);
  const PERFORMANCE_LABEL_BY_EFFORT = Object.freeze({
    min: Object.freeze({ ja: '軽', en: 'Light' }),
    standard: Object.freeze({ ja: '中程度', en: 'Medium' }),
    extended: Object.freeze({ ja: '高い', en: 'High' }),
    xhigh: Object.freeze({ ja: '非常に高い', en: 'Very high' }),
    max: Object.freeze({ ja: '最大', en: 'Maximum' })
  });
  const THINKING_EFFORT_BY_SLIDER_VALUE = Object.freeze(['min', 'standard', 'extended', 'xhigh', 'max']);
  const EFFORT_BY_PERFORMANCE_LABEL = Object.freeze({
    軽: 'min',
    Light: 'min',
    最速: 'min',
    Fastest: 'min',
    中程度: 'standard',
    Medium: 'standard',
    高い: 'extended',
    High: 'extended',
    非常に高い: 'xhigh',
    'Very high': 'xhigh',
    最大: 'max',
    Maximum: 'max'
  });
  const ENGLISH_PERFORMANCE_DISPLAY = Object.freeze({
    '軽': 'light',
    Light: 'light',
    '最速': 'fastest',
    Fastest: 'fastest',
    '中程度': 'medium',
    Medium: 'medium',
    '高い': 'high',
    High: 'high',
    '非常に高い': 'very high',
    'Very high': 'very high',
    '最大': 'maximum',
    Maximum: 'maximum'
  });

  if (window[API_KEY]) return;

  let started = false;
  let composerObserver = null;
  let observedComposer = null;
  let composerParentObserver = null;
  let observedComposerParent = null;
  let composerGrandparentObserver = null;
  let observedComposerGrandparent = null;
  let composerBootstrapObserver = null;
  let surfaceModeObserver = null;
  let observedSurfaceModeButtons = [];
  let pickerObserver = null;
  let observedPicker = null;
  let thinkingSliderObserver = null;
  let observedThinkingSlider = null;
  let observedThinkingEffort = '';
  let triggerStateObserver = null;
  let observedTriggerState = null;
  let pendingPickerState = null;
  let pendingPickerContextKey = null;
  let confirmedComposerState = null;
  let confirmedComposerContextKey = null;
  let navigationCarryState = null;
  let navigationCarryContextKey = null;
  let currentTrigger = null;
  let scanQueued = false;
  let currentState = null;
  let currentStateContextKey = null;
  let conversationState = null;
  let conversationContextToken = null;
  let lastReason = 'not_started';
  let scanCount = 0;
  let lastScanAt = null;
  let lastScanResult = { outcome: 'not_scanned', reason: null };
  let lastConversationConfig = null;
  let lastNavigationReset = null;
  let navigationResetSequence = 0;
  let navigationResetHistory = [];
  let stateMutationSequence = 0;
  let lastStateMutation = null;
  let lastApplySnapshot = null;
  let lastResolvedContext = null;
  let visualStyle = 'aurora';

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeVisualStyle(value) {
    const normalized = normalizeText(value).toLowerCase();
    return VISUAL_STYLES.has(normalized) ? normalized : 'aurora';
  }

  function parseJsonValue(raw) {
    try {
      return JSON.parse(String(raw ?? ''));
    } catch {
      return null;
    }
  }

  function readLocalStorageJson(key) {
    try {
      const raw = window.localStorage?.getItem?.(key);
      return raw == null ? null : parseJsonValue(raw);
    } catch {
      return null;
    }
  }

  function readLocalStorageScalar(key) {
    try {
      const raw = window.localStorage?.getItem?.(key);
      if (raw == null) return '';
      const parsed = parseJsonValue(raw);
      return normalizeText(parsed == null ? raw : parsed);
    } catch {
      return '';
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

  function readCookieJson(name) {
    const raw = getCookieValue(name);
    return raw == null ? null : parseJsonValue(raw);
  }

  function getCurrentConversationToken() {
    const match = String(window.location?.pathname || '').match(/\/c\/([^/?#]+)/i);
    return match?.[1] || null;
  }

  function getActiveSurfaceMode() {
    const activeButton = Array.from(document.querySelectorAll?.('button[role="radio"][data-state="on"]') || [])
      .find((button) => /^(Chat|Work)$/i.test(normalizeText(button.textContent || '')));
    const activeLabel = normalizeText(activeButton?.textContent || '').toLowerCase();
    if (activeLabel === 'work') return 'work';
    if (activeLabel === 'chat') return 'chatgpt';

    const stored = readLocalStorageScalar(CHATGPT_SURFACE_MODE_STORAGE_KEY).toLowerCase();
    if (stored === 'work' || stored === 'chatgpt') return stored;

    const cookie = normalizeText(getCookieValue(CHATGPT_SURFACE_MODE_COOKIE)).toLowerCase();
    return cookie === 'work' || cookie === 'chatgpt' ? cookie : null;
  }

  function getCurrentModelContextKey() {
    const conversationToken = getCurrentConversationToken();
    if (conversationToken) return `conversation:${conversationToken}`;

    const pathname = String(window.location?.pathname || '');
    if (/^\/(?:g|gg)\/[^/]+/i.test(pathname)) {
      const activeSurfaceMode = getActiveSurfaceMode();
      return `gpt_surface:${pathname}:${activeSurfaceMode || 'default'}`;
    }
    if (pathname === '/' || pathname === '') {
      const activeSurfaceMode = getActiveSurfaceMode();
      return activeSurfaceMode ? `new_surface:${activeSurfaceMode}` : null;
    }
    return null;
  }

  function classifyModelContextKey(key) {
    const normalized = String(key || '');
    if (!normalized) return null;
    if (normalized === 'new_surface:chatgpt') return 'new_chat';
    if (normalized === 'new_surface:work') return 'new_work';
    if (normalized.startsWith('conversation:')) return 'conversation';
    if (normalized.startsWith('gpt_surface:')) {
      if (normalized.endsWith(':chatgpt')) return 'gpt_surface_chat';
      if (normalized.endsWith(':work')) return 'gpt_surface_work';
      return 'gpt_surface';
    }
    return 'other';
  }

  function getNewChatPromotionSource(nextContextKey) {
    if (currentState?.modelVersion !== 'GPT-5.6' || !nextContextKey?.startsWith('conversation:')) return null;
    if (currentStateContextKey === 'new_surface:chatgpt') return 'new_chat';
    if (
      currentStateContextKey?.startsWith('gpt_surface:')
      && currentStateContextKey.endsWith(':chatgpt')
    ) return 'gpt_surface_chat';
    return null;
  }

  function recordStateMutation(nextState, nextContextKey, reason, sourceReason = null) {
    const previousState = currentState;
    const previousContextKey = currentStateContextKey;
    if (!previousState && !nextState) return;
    lastStateMutation = {
      sequence: ++stateMutationSequence,
      kind: nextState ? (previousState ? 'replace' : 'set') : 'clear',
      reason,
      sourceReason,
      at: Date.now(),
      currentContextKind: classifyModelContextKey(getCurrentModelContextKey()),
      previousContextKind: classifyModelContextKey(previousContextKey),
      nextContextKind: classifyModelContextKey(nextContextKey),
      previousModelVersion: previousState?.modelVersion || null,
      nextModelVersion: nextState?.modelVersion || null
    };
  }

  function recordNavigationReset({
    reason,
    previousContextKey,
    nextContextKey,
    statePresentBefore,
    stateModelVersionBefore,
    activeSurfaceModeAtReset,
    conditions,
    decision,
    decisionReason
  }) {
    const record = {
      sequence: ++navigationResetSequence,
      reason,
      at: Date.now(),
      previousContextKind: classifyModelContextKey(previousContextKey),
      nextContextKind: classifyModelContextKey(nextContextKey),
      contextKeyChanged: previousContextKey !== nextContextKey,
      statePresentBefore,
      stateModelVersionBefore,
      activeSurfaceModeAtReset,
      conditions,
      decision,
      decisionReason,
      preserved: decision === 'preserve',
      statePresentAfter: Boolean(currentState),
      stateContextKindAfter: classifyModelContextKey(currentStateContextKey)
    };
    lastNavigationReset = record;
    navigationResetHistory.push(record);
    if (navigationResetHistory.length > MAX_NAVIGATION_RESET_HISTORY) {
      navigationResetHistory = navigationResetHistory.slice(-MAX_NAVIGATION_RESET_HISTORY);
    }
  }

  function extractExplicitModelVersion(value) {
    const normalized = normalizeText(value);
    const prefixed = normalized.match(ANY_MODEL_PATTERN);
    if (prefixed) {
      const version = prefixed[0].match(BARE_MODEL_VERSION_PATTERN)?.[1] || '';
      return version ? `GPT-${version}` : null;
    }
    const bare = normalized.match(BARE_MODEL_VERSION_PATTERN)?.[1] || '';
    return bare ? `GPT-${bare}` : null;
  }

  function extractModelSuffix(modelLabel) {
    const normalized = normalizeText(modelLabel);
    const match = normalized.match(MODEL_VERSION_PATTERN);
    if (!match) return '';
    return normalizeText(normalized.slice((match.index || 0) + match[0].length)).slice(0, 18);
  }

  function isJapaneseUi() {
    return normalizeText(document.documentElement?.lang || navigator.language || '').toLowerCase().startsWith('ja');
  }

  function getPerformanceLabelForEffort(effort) {
    const normalizedEffort = normalizeText(effort).toLowerCase();
    const labels = PERFORMANCE_LABEL_BY_EFFORT[normalizedEffort];
    if (!labels) return '';
    return isJapaneseUi() ? labels.ja : labels.en;
  }

  function getEffortForPerformanceLabel(label) {
    return EFFORT_BY_PERFORMANCE_LABEL[normalizeText(label)] || '';
  }

  function normalizeGpt56ModelSlug(modelSlug) {
    const normalized = normalizeText(modelSlug).toLowerCase();
    if (!normalized) return null;
    if (!/(?:^|[-_])gpt[-_]?5(?:[-_.]?6)(?:[-_]|$)/i.test(normalized)) return null;
    let modelSuffix = '';
    if (/(?:^|[-_])sol(?:[-_]|$)/i.test(normalized)) modelSuffix = 'Sol';
    else if (/(?:^|[-_])luna(?:[-_]|$)/i.test(normalized)) modelSuffix = 'Luna';
    else if (/(?:^|[-_])terra(?:[-_]|$)/i.test(normalized)) modelSuffix = 'Terra';
    else if (/^gpt[-_]5[-_.]?6[-_]thinking$/i.test(normalized)) modelSuffix = 'Sol';
    return {
      modelVersion: 'GPT-5.6',
      modelSuffix,
      modelLabel: modelSuffix ? `GPT-5.6 ${modelSuffix}` : 'GPT-5.6'
    };
  }

  function isAmbiguousGpt5ModelSlug(modelSlug) {
    const normalized = normalizeText(modelSlug).toLowerCase();
    if (!normalized) return false;
    const gpt5Present = /(?:^|[-_])gpt[-_]?5(?:[-_]|$)/i.test(normalized);
    const explicitMinorVersionPresent = /(?:^|[-_])gpt[-_]?5(?:[-_.]?\d+)(?:[-_]|$)/i.test(normalized);
    return gpt5Present && !explicitMinorVersionPresent;
  }

  function buildStateFromSlugAndEffort(modelSlug, thinkingEffort, modelSource) {
    const model = normalizeGpt56ModelSlug(modelSlug);
    if (!model) return null;
    const normalizedEffort = normalizeText(thinkingEffort).toLowerCase();
    return {
      ...model,
      performance: getPerformanceLabelForEffort(normalizedEffort),
      thinkingEffort: normalizedEffort,
      observedAt: Date.now(),
      candidateFound: true,
      modelSource
    };
  }

  function buildStateResolution(modelSlug, thinkingEffort, modelSource) {
    const normalizedModelSlug = normalizeText(modelSlug);
    const state = buildStateFromSlugAndEffort(normalizedModelSlug, thinkingEffort, modelSource);
    return {
      state,
      explicitNonGpt56: Boolean(
        normalizedModelSlug
        && !state
        && !isAmbiguousGpt5ModelSlug(normalizedModelSlug)
      )
    };
  }

  function readNewChatCurrentResolution() {
    const config = readCookieJson(CHATGPT_LAST_MODEL_COOKIE);
    return buildStateResolution(
      config?.model || config?.modelSlug || config?.model_slug || '',
      config?.effort || config?.thinkingEffort || config?.thinking_effort || '',
      'new_chat_cookie_last_model_config'
    );
  }

  function readNewChatCurrentState() {
    return readNewChatCurrentResolution().state;
  }

  function isCurrentPathGptSurface() {
    return /^\/(?:g|gg)\/[^/]+/i.test(String(window.location?.pathname || ''));
  }

  function currentComposerHasMatchingPerformance(expectedPerformance) {
    const normalizedExpected = normalizeText(expectedPerformance);
    if (!normalizedExpected) return false;
    const composer = getCurrentComposer();
    if (!composer) return false;
    return Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]')).some((button) => {
      const decorated = button.getAttribute(RICH_ATTR) === 'true';
      const nativeLabel = decorated
        ? button.querySelector(`[${NATIVE_LABEL_ATTR}="true"]`)
        : null;
      const values = [
        nativeLabel?.textContent || button.textContent,
        decorated ? button.getAttribute(ORIGINAL_ARIA_LABEL_ATTR) : button.getAttribute('aria-label'),
        decorated ? button.getAttribute(ORIGINAL_TITLE_ATTR) : button.getAttribute('title')
      ]
        .map((value) => normalizeText(value));
      return values.some((value) => (
        value === normalizedExpected
        || value.startsWith(`${normalizedExpected} `)
        || value.endsWith(` ${normalizedExpected}`)
      ));
    });
  }

  function currentComposerHasExplicitNonGpt56Model() {
    const composer = getCurrentComposer();
    if (!composer) return false;
    return Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]')).some((button) => {
      const version = extractExplicitModelVersion(button.textContent || '');
      return Boolean(version && version !== 'GPT-5.6');
    });
  }

  function getWorkNativeModelTrigger() {
    if (getActiveSurfaceMode() !== 'work') return null;
    if (typeof document.querySelector !== 'function') return null;
    const composer = getCurrentComposer();
    if (!composer) return null;
    return Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]'))
      .find((button) => button.querySelector(WORK_TRIGGER_WRAPPER_SELECTOR)) || null;
  }

  function readWorkNativeTriggerResolution() {
    const trigger = getWorkNativeModelTrigger();
    const wrapper = trigger?.querySelector?.(WORK_TRIGGER_WRAPPER_SELECTOR) || null;
    const modelLabel = wrapper?.querySelector?.(WORK_TRIGGER_MODEL_LABEL_SELECTOR) || null;
    const modelText = normalizeText(modelLabel?.textContent || '');
    if (!modelText) return { state: null, explicitNonGpt56: false, authorityPresent: false };

    const modelVersion = extractExplicitModelVersion(modelText);
    if (modelVersion !== 'GPT-5.6') {
      return { state: null, explicitNonGpt56: true, authorityPresent: true };
    }

    const effortLabel = wrapper?.querySelector?.(WORK_TRIGGER_EFFORT_LABEL_SELECTOR) || null;
    const thinkingEffort = getEffortForPerformanceLabel(effortLabel?.textContent || '');
    if (!thinkingEffort) {
      return { state: null, explicitNonGpt56: false, authorityPresent: true };
    }

    const workFamily = normalizeWorkFamilyLabel(modelText.match(/\b(Sol|Terra|Luna)\b/i)?.[1] || '');
    return {
      state: {
        modelVersion: 'GPT-5.6',
        modelSuffix: workFamily,
        modelLabel: workFamily ? `GPT-5.6 ${workFamily}` : 'GPT-5.6',
        performance: getPerformanceLabelForEffort(thinkingEffort),
        thinkingEffort,
        observedAt: Date.now(),
        candidateFound: true,
        modelSource: 'work_native_trigger_current'
      },
      explicitNonGpt56: false,
      authorityPresent: true
    };
  }

  function readWorkCurrentResolution() {
    const settings = readLocalStorageJson(WORK_MODEL_SETTINGS_STORAGE_KEY);
    const modelSlug = settings?.lastUsedModelSlug || settings?.last_used_model_slug || '';
    const thinkingEffort = readLocalStorageScalar(WORK_THINKING_EFFORT_STORAGE_KEY);
    return buildStateResolution(modelSlug, thinkingEffort, 'work_local_storage_current');
  }

  function clearNavigationCarry() {
    navigationCarryState = null;
    navigationCarryContextKey = null;
  }

  function buildConversationState(config) {
    return buildStateFromSlugAndEffort(
      config?.modelSlug || config?.model_slug || '',
      config?.thinkingEffort || config?.thinking_effort || '',
      config?.source || 'conversation_detail_current_branch'
    );
  }

  function resolveCurrentContextState() {
    const currentContextKey = getCurrentModelContextKey();
    if (confirmedComposerState && confirmedComposerContextKey && confirmedComposerContextKey === currentContextKey) {
      return {
        state: confirmedComposerState,
        contextKind: 'composer_selection_confirmed',
        activeSurfaceMode: getActiveSurfaceMode()
      };
    }
    const activeSurfaceMode = getActiveSurfaceMode();
    const conversationToken = getCurrentConversationToken();
    if (conversationToken) {
      if (conversationState && conversationContextToken === conversationToken) {
        return { state: conversationState, contextKind: 'conversation_current_branch', activeSurfaceMode: null };
      }
      if (activeSurfaceMode === 'work') {
        const workNativeResolution = readWorkNativeTriggerResolution();
        if (workNativeResolution?.state?.candidateFound || workNativeResolution?.explicitNonGpt56) {
          return {
            state: workNativeResolution.state,
            contextKind: 'conversation_work_native_trigger',
            activeSurfaceMode,
            explicitNonGpt56: workNativeResolution.explicitNonGpt56,
            authorityPresent: workNativeResolution.authorityPresent
          };
        }
      }
      if (
        activeSurfaceMode === 'chatgpt'
        && isCurrentPathGptSurface()
        && !currentComposerHasExplicitNonGpt56Model()
      ) {
        const newChatResolution = readNewChatCurrentResolution();
        if (
          newChatResolution?.state?.candidateFound
          && currentComposerHasMatchingPerformance(newChatResolution.state.performance)
        ) {
          return {
            state: newChatResolution.state,
            contextKind: 'conversation_gpt_surface_cookie_native_match',
            activeSurfaceMode,
            explicitNonGpt56: false,
            authorityPresent: true
          };
        }
      }
      return { state: null, contextKind: 'conversation_waiting_for_detail', activeSurfaceMode: null };
    }

    const workNativeResolution = activeSurfaceMode === 'work'
      ? readWorkNativeTriggerResolution()
      : null;
    const navigationCarry = activeSurfaceMode === 'work'
      && navigationCarryContextKey === currentContextKey
      ? navigationCarryState
      : null;
    const preferNavigationCarryOverNativeEffort = Boolean(
      navigationCarry && workNativeResolution?.state?.modelVersion === 'GPT-5.6'
    );
    const resolution = activeSurfaceMode === 'work'
      ? preferNavigationCarryOverNativeEffort
        ? { state: navigationCarry, explicitNonGpt56: false, authorityPresent: false }
        : (workNativeResolution?.authorityPresent ? workNativeResolution : readWorkCurrentResolution())
      : activeSurfaceMode === 'chatgpt'
        ? readNewChatCurrentResolution()
        : { state: null, explicitNonGpt56: false };
    const carriedState = preferNavigationCarryOverNativeEffort
      ? navigationCarry
      : activeSurfaceMode === 'work'
      && !workNativeResolution?.authorityPresent
      && !resolution.state
      && !resolution.explicitNonGpt56
      && navigationCarry
      ? navigationCarry
      : null;
    if (activeSurfaceMode === 'work' && !carriedState && (resolution.state || resolution.explicitNonGpt56)) {
      clearNavigationCarry();
    }

    return {
      state: resolution.state || carriedState,
      contextKind: carriedState
        ? 'new_work_navigation_carry'
        : activeSurfaceMode === 'work'
          ? workNativeResolution?.authorityPresent ? 'new_work_native_trigger' : 'new_work_local_storage'
          : 'new_chat_cookie',
      activeSurfaceMode,
      explicitNonGpt56: resolution.explicitNonGpt56,
      authorityPresent: Boolean(workNativeResolution?.authorityPresent)
    };
  }

  function applyConversationModelConfig(config, reason = 'conversation_detail') {
    const modelSlug = normalizeText(config?.modelSlug || config?.model_slug || '');
    const thinkingEffort = normalizeText(config?.thinkingEffort || config?.thinking_effort || '').toLowerCase();
    if (!modelSlug || !thinkingEffort) return false;
    lastConversationConfig = {
      conversationIdPresent: Boolean(config?.conversationId),
      modelSlug,
      thinkingEffort,
      source: config?.source || 'conversation_detail_current_branch',
      selectedMessageDistanceFromLeaf: Number.isFinite(Number(config?.selectedMessageDistanceFromLeaf))
        ? Number(config.selectedMessageDistanceFromLeaf)
        : null,
      currentNodeUsed: Boolean(config?.currentNodeUsed),
      observedAt: Number(config?.observedAt) || Date.now(),
      reason
    };
    const model = buildConversationState(config);
    if (
      navigationCarryContextKey === getCurrentModelContextKey()
      && (model || !isAmbiguousGpt5ModelSlug(modelSlug))
    ) clearNavigationCarry();
    const nextConversationContextToken = normalizeText(config?.conversationId || '') || getCurrentConversationToken();
    const shouldPreserveConfirmedGpt56 = !model
      && isAmbiguousGpt5ModelSlug(modelSlug)
      && currentState?.modelVersion === 'GPT-5.6'
      && conversationContextToken === nextConversationContextToken
      && currentStateContextKey === `conversation:${nextConversationContextToken}`;
    conversationContextToken = nextConversationContextToken;
    if (shouldPreserveConfirmedGpt56) {
      lastReason = `conversation_waiting_for_detail:${reason}`;
      return true;
    }
    if (confirmedComposerContextKey === `conversation:${conversationContextToken}`) {
      confirmedComposerState = null;
      confirmedComposerContextKey = null;
    }
    conversationState = model;
    if (!model) {
      const nextContextKey = getCurrentModelContextKey();
      recordStateMutation(null, nextContextKey, 'conversation_non_gpt56', reason);
      currentState = null;
      currentStateContextKey = nextContextKey;
      restoreAllTriggers();
      lastReason = `conversation_non_5_6:${reason}`;
      return true;
    }
    const nextCurrentState = {
      ...model,
      observedAt: Number(config?.observedAt) || model.observedAt
    };
    const nextCurrentStateContextKey = getCurrentModelContextKey()
      || (conversationContextToken ? `conversation:${conversationContextToken}` : null);
    recordStateMutation(nextCurrentState, nextCurrentStateContextKey, 'conversation_config', reason);
    currentState = nextCurrentState;
    currentStateContextKey = nextCurrentStateContextKey;
    conversationState = currentState;
    lastReason = `conversation_config:${reason}`;
    if (!started) return true;
    const trigger = resolveTargetTrigger(null, currentState.performance);
    if (trigger) return applyRichState(trigger, currentState, lastReason);
    queueScan(lastReason);
    return true;
  }

  function getCurrentComposer() {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    return composer instanceof HTMLFormElement ? composer : null;
  }

  function isTriggerInCurrentComposer(trigger) {
    const composer = getCurrentComposer();
    return Boolean(
      composer
      && trigger instanceof HTMLButtonElement
      && trigger.isConnected
      && trigger.closest?.(COMPOSER_SELECTOR) === composer
    );
  }

  function hasCurrentComposerDecoration() {
    return Boolean(
      currentState?.modelVersion === 'GPT-5.6'
      && isTriggerInCurrentComposer(currentTrigger)
      && currentTrigger.getAttribute(RICH_ATTR) === 'true'
    );
  }

  function resetForNavigation({ reason = 'navigation' } = {}) {
    const nextContextKey = getCurrentModelContextKey();
    const previousContextKey = currentStateContextKey;
    const statePresentBefore = Boolean(currentState);
    const stateModelVersionBefore = currentState?.modelVersion || null;
    const activeSurfaceModeAtReset = getActiveSurfaceMode();
    if (currentState && currentStateContextKey && nextContextKey === currentStateContextKey) {
      recordNavigationReset({
        reason,
        previousContextKey,
        nextContextKey,
        statePresentBefore,
        stateModelVersionBefore,
        activeSurfaceModeAtReset,
        conditions: {
          sameContext: true,
          normalNewChatPromotion: false,
          gptSurfaceChatPromotion: false,
          workNewChatCarry: false,
          confirmedDecoration: false,
          crossingChatToWork: false
        },
        decision: 'preserve',
        decisionReason: 'same_context'
      });
      lastReason = `navigation_same_context:${reason}`;
      if (started) queueScan(lastReason);
      return false;
    }
    const newChatPromotionSource = getNewChatPromotionSource(nextContextKey);
    const normalNewChatPromotion = newChatPromotionSource === 'new_chat';
    const gptSurfaceChatPromotion = newChatPromotionSource === 'gpt_surface_chat';
    const preserveNewChatPromotion = normalNewChatPromotion || gptSurfaceChatPromotion;
    const promotedConversationRekey = Boolean(
      reason === 'history_replaceState'
      && currentState?.modelVersion === 'GPT-5.6'
      && currentStateContextKey?.startsWith('conversation:')
      && nextContextKey?.startsWith('conversation:')
      && currentStateContextKey !== nextContextKey
      && confirmedComposerState === currentState
      && confirmedComposerContextKey === currentStateContextKey
      && !conversationState
      && (
        lastNavigationReset?.decisionReason === 'new_chat_promotion'
        || lastNavigationReset?.decisionReason === 'gpt_surface_chat_promotion'
      )
    );
    const crossingChatToWork = currentStateContextKey === 'new_surface:chatgpt'
      && nextContextKey === 'new_surface:work';
    const preserveConfirmedDecoration = hasCurrentComposerDecoration() && !crossingChatToWork;
    const workResolution = nextContextKey === 'new_surface:work'
      ? readWorkCurrentResolution()
      : null;
    const preserveWorkNewChatCarry = Boolean(
      currentState?.modelVersion === 'GPT-5.6'
      && nextContextKey === 'new_surface:work'
      && getActiveSurfaceMode() === 'work'
      && preserveConfirmedDecoration
      && !workResolution?.state
      && !workResolution?.explicitNonGpt56
    );
    clearNavigationCarry();
    conversationState = null;
    conversationContextToken = null;
    pendingPickerState = null;
    pendingPickerContextKey = null;
    confirmedComposerState = null;
    confirmedComposerContextKey = null;
    if (preserveNewChatPromotion) {
      confirmedComposerState = currentState;
      confirmedComposerContextKey = nextContextKey;
      currentStateContextKey = nextContextKey;
    }
    if (promotedConversationRekey) {
      confirmedComposerState = currentState;
      confirmedComposerContextKey = nextContextKey;
      currentStateContextKey = nextContextKey;
    }
    if (preserveWorkNewChatCarry) {
      navigationCarryState = currentState;
      navigationCarryContextKey = nextContextKey;
    }
    if (preserveNewChatPromotion || promotedConversationRekey || preserveWorkNewChatCarry || preserveConfirmedDecoration) {
      const decisionReason = normalNewChatPromotion
        ? 'new_chat_promotion'
        : gptSurfaceChatPromotion
          ? 'gpt_surface_chat_promotion'
          : promotedConversationRekey
            ? 'new_chat_promotion_rekey'
          : preserveWorkNewChatCarry
            ? 'work_new_chat_carry'
            : 'confirmed_decoration';
      recordNavigationReset({
        reason,
        previousContextKey,
        nextContextKey,
        statePresentBefore,
        stateModelVersionBefore,
        activeSurfaceModeAtReset,
        conditions: {
          sameContext: false,
          normalNewChatPromotion,
          gptSurfaceChatPromotion,
          promotedConversationRekey,
          workNewChatCarry: preserveWorkNewChatCarry,
          confirmedDecoration: preserveConfirmedDecoration,
          crossingChatToWork
        },
        decision: 'preserve',
        decisionReason
      });
      lastReason = `${preserveNewChatPromotion || promotedConversationRekey ? 'navigation_new_chat_promotion' : 'navigation_waiting_for_context'}:${reason}`;
      if (started) queueScan(lastReason);
      return false;
    }
    recordStateMutation(null, null, 'navigation_reset', reason);
    currentState = null;
    currentStateContextKey = null;
    recordNavigationReset({
      reason,
      previousContextKey,
      nextContextKey,
      statePresentBefore,
      stateModelVersionBefore,
      activeSurfaceModeAtReset,
      conditions: {
        sameContext: false,
        normalNewChatPromotion,
        gptSurfaceChatPromotion,
        promotedConversationRekey,
        workNewChatCarry: preserveWorkNewChatCarry,
        confirmedDecoration: preserveConfirmedDecoration,
        crossingChatToWork
      },
      decision: 'clear',
      decisionReason: 'no_preserve_condition'
    });
    restoreAllTriggers();
    lastReason = `navigation_reset:${reason}`;
    if (started) queueScan(lastReason);
    return true;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      button[${RICH_ATTR}="true"] {
        position: relative !important;
        transform: none !important;
        width: auto !important;
        max-width: none !important;
        min-width: 0 !important;
        flex-shrink: 0 !important;
        overflow: visible !important;
        padding-inline: 7px 6px !important;
        border: 1px solid transparent !important;
        border-radius: 999px !important;
        background:
          linear-gradient(135deg,
            color-mix(in srgb, var(--main-surface-secondary, #f8fafc) 96%, #ecfeff 4%),
            color-mix(in srgb, var(--main-surface-secondary, #f8fafc) 91%, #ede9fe 9%)) padding-box,
          linear-gradient(112deg, #67e8f9 0%, #60a5fa 52%, #c084fc 100%) border-box !important;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.72),
          0 0 0 1px rgba(96,165,250,.10),
          0 0 7px rgba(34,211,238,.14),
          0 0 12px rgba(139,92,246,.12),
          0 4px 12px rgba(15,23,42,.08) !important;
        transition: box-shadow 150ms ease, filter 150ms ease !important;
      }

      button[${RICH_ATTR}="true"]:hover,
      button[${RICH_ATTR}="true"]:focus-visible,
      button[${RICH_ATTR}="true"][data-state="open"] {
        filter: brightness(1.035);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.82),
          0 0 0 1px rgba(96,165,250,.18),
          0 0 10px rgba(34,211,238,.24),
          0 0 18px rgba(139,92,246,.20),
          0 6px 16px rgba(15,23,42,.10) !important;
      }

      :where(html.dark, html[data-theme="dark"], .dark, [data-theme="dark"]) button[${RICH_ATTR}="true"] {
        background:
          linear-gradient(135deg,
            color-mix(in srgb, #07111f 88%, var(--main-surface-secondary, #111827) 12%),
            color-mix(in srgb, #111827 82%, #312e81 18%)) padding-box,
          linear-gradient(112deg, #55e6f5 0%, #60a5fa 50%, #c084fc 100%) border-box !important;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.16),
          inset 0 -1px 0 rgba(96,165,250,.08),
          0 0 0 1px rgba(96,165,250,.16),
          0 0 9px rgba(34,211,238,.26),
          0 0 15px rgba(139,92,246,.22),
          0 5px 16px rgba(0,0,0,.24) !important;
      }

      :where(html.dark, html[data-theme="dark"], .dark, [data-theme="dark"]) button[${RICH_ATTR}="true"]:hover,
      :where(html.dark, html[data-theme="dark"], .dark, [data-theme="dark"]) button[${RICH_ATTR}="true"]:focus-visible,
      :where(html.dark, html[data-theme="dark"], .dark, [data-theme="dark"]) button[${RICH_ATTR}="true"][data-state="open"] {
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.22),
          inset 0 -1px 0 rgba(96,165,250,.12),
          0 0 0 1px rgba(96,165,250,.24),
          0 0 13px rgba(34,211,238,.40),
          0 0 23px rgba(139,92,246,.34),
          0 7px 20px rgba(0,0,0,.28) !important;
      }

      button[${RICH_ATTR}="true"]:hover,
      button[${RICH_ATTR}="true"]:focus,
      button[${RICH_ATTR}="true"]:focus-visible,
      button[${RICH_ATTR}="true"]:active,
      button[${RICH_ATTR}="true"][data-state="open"] {
        transform: none !important;
      }

      button[${RICH_ATTR}="true"] > [${NATIVE_LABEL_ATTR}="true"] {
        display: none !important;
      }

      [${RICH_CONTENT_ATTR}="true"] {
        display: inline-flex;
        min-width: 0;
        align-items: center;
        gap: 3px;
        white-space: nowrap;
        line-height: 1;
      }

      [${RICH_CONTENT_ATTR}="true"] .arcaia-model-sparkle {
        display: inline-grid;
        width: 16px;
        height: 16px;
        flex: 0 0 16px;
        place-items: center;
        border: 1px solid color-mix(in srgb, #67e8f9 62%, transparent);
        border-radius: 999px;
        background: radial-gradient(circle at 32% 28%, rgba(255,255,255,.88), rgba(34,211,238,.22) 38%, rgba(139,92,246,.22));
        color: color-mix(in srgb, #06b6d4 72%, currentColor);
        font-size: 9px;
        text-shadow: 0 0 8px color-mix(in srgb, #67e8f9 72%, transparent);
        box-shadow: 0 0 8px color-mix(in srgb, #22d3ee 24%, transparent);
      }

      [${RICH_CONTENT_ATTR}="true"] .arcaia-model-version {
        min-width: 0;
        color: var(--text-primary, currentColor);
        font-size: 12px;
        font-weight: 650;
        letter-spacing: -0.015em;
      }

      [${RICH_CONTENT_ATTR}="true"] .arcaia-model-suffix {
        margin-inline-start: 0;
        color: color-mix(in srgb, #818cf8 54%, var(--text-tertiary, currentColor));
        font-size: 9.5px;
        font-weight: 560;
        opacity: .86;
        text-transform: lowercase;
      }

      [${RICH_CONTENT_ATTR}="true"] .arcaia-model-performance {
        display: inline-flex;
        align-items: center;
        min-height: 17px;
        padding: 1px 5px 2px;
        border: 1px solid color-mix(in srgb, #a78bfa 34%, var(--border-light, transparent));
        border-radius: 999px;
        background: color-mix(in srgb, #8b5cf6 12%, transparent);
        color: color-mix(in srgb, #7c3aed 54%, var(--text-tertiary, currentColor));
        font-size: 9.5px;
        font-weight: 600;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="classic"] {
        min-width: 142px !important;
        padding-inline: 9px 7px !important;
        border: 1px solid color-mix(in srgb, #7dd3fc 38%, var(--border-light, rgba(127,127,127,.28))) !important;
        background:
          linear-gradient(135deg,
            color-mix(in srgb, #5eead4 10%, transparent),
            color-mix(in srgb, #a78bfa 12%, transparent)),
          var(--main-surface-secondary, rgba(255,255,255,.72)) !important;
        box-shadow:
          inset 0 1px 0 color-mix(in srgb, white 18%, transparent),
          0 0 0 1px color-mix(in srgb, #a78bfa 7%, transparent),
          0 5px 16px color-mix(in srgb, #6366f1 9%, transparent) !important;
        filter: none !important;
        transition: border-color 150ms ease, box-shadow 150ms ease !important;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="classic"]:hover,
      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="classic"]:focus-visible,
      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="classic"][data-state="open"] {
        border-color: color-mix(in srgb, #67e8f9 58%, var(--border-light, rgba(127,127,127,.28))) !important;
        box-shadow:
          inset 0 1px 0 color-mix(in srgb, white 22%, transparent),
          0 0 0 1px color-mix(in srgb, #8b5cf6 11%, transparent),
          0 7px 20px color-mix(in srgb, #6366f1 13%, transparent) !important;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="classic"] [${RICH_CONTENT_ATTR}="true"] {
        gap: 5px;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="classic"] .arcaia-model-sparkle {
        width: 17px;
        height: 17px;
        flex-basis: 17px;
        border-color: color-mix(in srgb, #67e8f9 40%, transparent);
        background: radial-gradient(circle at 32% 28%, rgba(255,255,255,.72), rgba(94,234,212,.22) 35%, rgba(139,92,246,.20));
        color: color-mix(in srgb, #22d3ee 65%, currentColor);
        font-size: 10px;
        text-shadow: 0 0 8px color-mix(in srgb, #67e8f9 55%, transparent);
        box-shadow: none;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="classic"] .arcaia-model-suffix {
        margin-inline-start: -2px;
        color: var(--text-tertiary, currentColor);
        font-size: 10px;
        font-weight: 500;
        opacity: .74;
        text-transform: none;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="classic"] .arcaia-model-performance {
        min-height: 18px;
        padding: 1px 6px 2px;
        border-color: color-mix(in srgb, #a78bfa 22%, var(--border-light, transparent));
        background: color-mix(in srgb, #8b5cf6 8%, transparent);
        color: var(--text-tertiary, currentColor);
        font-size: 10px;
        font-weight: 550;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="outline"] {
        padding-inline: 8px 7px !important;
        border: 1px solid rgba(255,255,255,.82) !important;
        background:
          linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.035)),
          color-mix(in srgb, var(--main-surface-secondary, #1f1f1f) 90%, transparent 10%) !important;
        backdrop-filter: blur(8px) saturate(.82);
        -webkit-backdrop-filter: blur(8px) saturate(.82);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.28),
          inset 0 -1px 0 rgba(255,255,255,.07),
          0 0 5px rgba(255,255,255,.30),
          0 0 13px rgba(255,255,255,.14) !important;
        filter: none !important;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="outline"]:hover,
      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="outline"]:focus-visible,
      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="outline"][data-state="open"] {
        border-color: rgba(255,255,255,.96) !important;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.34),
          inset 0 -1px 0 rgba(255,255,255,.10),
          0 0 7px rgba(255,255,255,.42),
          0 0 17px rgba(255,255,255,.20) !important;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="outline"] [${RICH_CONTENT_ATTR}="true"] {
        gap: 5px;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="outline"] .arcaia-model-sparkle {
        display: none;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="outline"] .arcaia-model-version,
      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="outline"] .arcaia-model-suffix {
        color: rgba(255,255,255,.96);
        opacity: 1;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="outline"] .arcaia-model-suffix {
        font-size: 10px;
        font-weight: 500;
        text-transform: lowercase;
      }

      button[${RICH_ATTR}="true"][${VISUAL_STYLE_ATTR}="outline"] .arcaia-model-performance {
        min-height: 17px;
        padding: 1px 5px 2px;
        border-color: rgba(255,255,255,.28);
        background: rgba(255,255,255,.06);
        color: rgba(255,255,255,.96);
        font-size: 9.5px;
        font-weight: 600;
      }

      form[${COMPOSER_RICH_ATTR}="true"] :is(#prompt-textarea, [contenteditable="true"]) {
        padding-inline-end: calc(
          var(--arcaia-model-native-editor-padding-end, 0px)
          + var(--arcaia-model-extra-inline-reserve, 0px)
        ) !important;
      }

      @media (prefers-reduced-motion: reduce) {
        button[${RICH_ATTR}="true"] { transition: none !important; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function readCssPixels(value) {
    const parsed = Number.parseFloat(String(value || ''));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function isSingleLineComposerEditor(editor) {
    if (!(editor instanceof HTMLElement)) return false;
    const computed = window.getComputedStyle(editor);
    const lineHeight = readCssPixels(computed.lineHeight)
      || (readCssPixels(computed.fontSize) * 1.2);
    if (!(lineHeight > 0)) return false;
    const oneLineHeight = lineHeight
      + readCssPixels(computed.paddingTop)
      + readCssPixels(computed.paddingBottom);
    const actualHeight = Math.max(editor.scrollHeight, editor.getBoundingClientRect().height);
    return actualHeight <= oneLineHeight + 2;
  }

  function clearComposerReservation(composer) {
    if (!(composer instanceof HTMLElement)) return;
    composer.removeAttribute(COMPOSER_RICH_ATTR);
    composer.removeAttribute(COMPOSER_NATIVE_EDITOR_PADDING_ATTR);
    composer.style.removeProperty('--arcaia-model-native-editor-padding-end');
    composer.style.removeProperty('--arcaia-model-extra-inline-reserve');
  }

  function updateComposerReservation(trigger) {
    const composer = trigger?.closest?.(COMPOSER_SELECTOR);
    if (!(composer instanceof HTMLElement)) return;
    const editor = composer.querySelector('#prompt-textarea, [contenteditable="true"]');
    if (!(editor instanceof HTMLElement)) {
      clearComposerReservation(composer);
      return;
    }

    if (!isSingleLineComposerEditor(editor)) {
      clearComposerReservation(composer);
      return;
    }

    const nativeWidth = readCssPixels(trigger.getAttribute(ORIGINAL_WIDTH_ATTR));
    const richWidth = trigger.getBoundingClientRect().width;
    if (!(nativeWidth > 0) || !(richWidth > 0)) {
      clearComposerReservation(composer);
      return;
    }

    let nativeEditorPaddingEnd = readCssPixels(composer.getAttribute(COMPOSER_NATIVE_EDITOR_PADDING_ATTR));
    if (!composer.hasAttribute(COMPOSER_NATIVE_EDITOR_PADDING_ATTR)) {
      const computed = window.getComputedStyle(editor);
      nativeEditorPaddingEnd = readCssPixels(computed.paddingInlineEnd || computed.paddingRight);
      composer.setAttribute(COMPOSER_NATIVE_EDITOR_PADDING_ATTR, String(nativeEditorPaddingEnd));
    }

    const extraInlineReserve = Math.max(0, Math.ceil(richWidth - nativeWidth + 20));
    if (!extraInlineReserve) {
      clearComposerReservation(composer);
      return;
    }

    composer.setAttribute(COMPOSER_RICH_ATTR, 'true');
    composer.style.setProperty('--arcaia-model-native-editor-padding-end', `${nativeEditorPaddingEnd}px`);
    composer.style.setProperty('--arcaia-model-extra-inline-reserve', `${extraInlineReserve}px`);

    if (!isSingleLineComposerEditor(editor)) {
      clearComposerReservation(composer);
    }
  }

  function handleComposerInput() {
    if (currentTrigger && isTriggerInCurrentComposer(currentTrigger)) {
      updateComposerReservation(currentTrigger);
    }
  }

  function getDirectPerformanceLabel(item) {
    const firstLabel = item?.querySelector?.('span.truncate');
    const normalized = normalizeText(firstLabel?.textContent || item?.textContent || '');
    if (PERFORMANCE_LABELS.has(normalized)) return normalized;
    for (const label of PERFORMANCE_LABELS) {
      if (normalized === label || normalized.startsWith(`${label} `)) return label;
    }
    return '';
  }

  function isSelectedPickerItem(item) {
    if (!(item instanceof Element)) return false;
    return item.getAttribute('aria-checked') === 'true'
      || item.getAttribute('aria-selected') === 'true'
      || item.getAttribute('data-state') === 'checked'
      || item.getAttribute('data-state') === 'on';
  }

  function findSelectedPerformanceItem(picker) {
    const items = Array.from(picker?.querySelectorAll?.(
      '[role="menuitemradio"], [role="radio"], [role="option"], [role="menuitem"]'
    ) || []);
    return items.find((item) => isSelectedPickerItem(item) && getDirectPerformanceLabel(item)) || null;
  }

  function normalizeWorkFamilyLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'sol') return 'Sol';
    if (normalized === 'terra') return 'Terra';
    if (normalized === 'luna') return 'Luna';
    return '';
  }

  function getModelCandidates(picker) {
    const workSurface = getActiveSurfaceMode() === 'work';
    return Array.from(picker?.querySelectorAll?.('[role="menuitem"]') || [])
      .map((element) => ({ element, label: normalizeText(element.textContent || '') }))
      .filter((item) => ANY_MODEL_PATTERN.test(item.label) || (workSurface && Boolean(normalizeWorkFamilyLabel(item.label))));
  }

  function chooseCurrentModelCandidate(candidates) {
    if (!candidates.length) return null;
    return candidates.find((item) => item.element.getAttribute('aria-expanded') === 'true')
      || candidates.find((item) => item.element.getAttribute('data-state') === 'open')
      || candidates.find((item) => item.element.hasAttribute('data-has-submenu'))
      || candidates[0];
  }

  function readPickerState(picker) {
    const checked = picker?.querySelector?.('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]') || null;
    const directPerformance = getDirectPerformanceLabel(checked)
      || getDirectPerformanceLabel(findSelectedPerformanceItem(picker));
    const slider = picker?.querySelector?.(`${THINKING_SLIDER_HOST_SELECTOR} [role="slider"]`) || null;
    const sliderEffort = getThinkingEffortFromSlider(slider);
    const pickerTrigger = getTriggerForPicker(picker);
    const pickerOpen = pickerTrigger?.getAttribute('aria-expanded') === 'true'
      || pickerTrigger?.getAttribute('data-state') === 'open';
    const performance = directPerformance
      || (
        pickerOpen && currentState?.modelVersion === 'GPT-5.6' && currentState.performance
          ? currentState.performance
          : getPerformanceLabelForEffort(sliderEffort)
      );
    const checkedText = normalizeText(checked?.textContent || '');
    const explicitPerformanceModelVersion = extractExplicitModelVersion(checkedText);
    const candidate = chooseCurrentModelCandidate(getModelCandidates(picker));
    const modelLabel = normalizeText(candidate?.label || '');
    const workFamily = getActiveSurfaceMode() === 'work' ? normalizeWorkFamilyLabel(modelLabel) : '';
    const pendingWorkFamily = Boolean(workFamily && pickerOpen);
    const effectiveWorkFamily = pendingWorkFamily ? currentState?.modelSuffix || '' : workFamily;
    const candidateModelVersion = extractExplicitModelVersion(modelLabel) || (effectiveWorkFamily ? 'GPT-5.6' : null);
    const currentModelVersion = !candidateModelVersion && performance && currentState?.modelVersion === 'GPT-5.6'
      ? currentState.modelVersion
      : null;
    const modelVersion = explicitPerformanceModelVersion || candidateModelVersion || currentModelVersion;
    let resolvedModelLabel = pendingWorkFamily ? currentState?.modelLabel || '' : modelLabel || currentState?.modelLabel || '';
    if (effectiveWorkFamily) resolvedModelLabel = `GPT-5.6 ${effectiveWorkFamily}`;
    else if (candidateModelVersion && candidateModelVersion !== 'GPT-5.6') resolvedModelLabel = modelLabel;
    else if (explicitPerformanceModelVersion && explicitPerformanceModelVersion !== 'GPT-5.6') resolvedModelLabel = checkedText;

    let modelSource = 'not_found';
    if (explicitPerformanceModelVersion) modelSource = 'checked_performance_item';
    else if (candidateModelVersion) modelSource = 'model_candidate';
    else if (currentModelVersion) modelSource = 'performance_picker_with_current_state';
    return {
      modelVersion,
      modelLabel: resolvedModelLabel,
      modelSuffix: modelVersion === 'GPT-5.6'
        ? (extractModelSuffix(resolvedModelLabel) || currentState?.modelSuffix || '')
        : '',
      performance,
      thinkingEffort: directPerformance
        ? getEffortForPerformanceLabel(directPerformance)
        : pickerOpen && currentState?.modelVersion === 'GPT-5.6' && currentState.thinkingEffort
          ? currentState.thinkingEffort
          : sliderEffort,
      observedAt: Date.now(),
      candidateFound: Boolean(explicitPerformanceModelVersion || candidateModelVersion || currentModelVersion),
      modelSource: pendingWorkFamily
        ? currentState?.modelSource || 'work_family_pending'
        : workFamily
          ? 'work_family_picker'
          : modelSource
    };
  }

  function getThinkingEffortFromSlider(slider) {
    if (!(slider instanceof Element)) return '';
    const rawValue = Number(slider.getAttribute('aria-valuenow'));
    if (!Number.isInteger(rawValue) || rawValue < 0 || rawValue >= THINKING_EFFORT_BY_SLIDER_VALUE.length) return '';
    return THINKING_EFFORT_BY_SLIDER_VALUE[rawValue] || '';
  }

  function buildSliderState(thinkingEffort) {
    if (!thinkingEffort) return null;
    const pickerState = readPickerState(observedPicker);
    const baseState = pendingPickerState?.candidateFound && pendingPickerState.modelVersion === 'GPT-5.6'
      ? pendingPickerState
      : pickerState?.candidateFound && pickerState.modelVersion === 'GPT-5.6'
        ? pickerState
        : currentState?.modelVersion === 'GPT-5.6'
          ? currentState
          : null;
    if (!baseState) return null;
    return {
      ...baseState,
      performance: getPerformanceLabelForEffort(thinkingEffort),
      thinkingEffort,
      observedAt: Date.now(),
      candidateFound: true,
      modelSource: 'picker_slider_confirmed'
    };
  }

  function rememberConfirmedPickerState(state) {
    const contextKey = getCurrentModelContextKey();
    if (!contextKey) return;
    if (state?.candidateFound && state.modelVersion === 'GPT-5.6') {
      confirmedComposerState = state;
      confirmedComposerContextKey = contextKey;
      return;
    }
    if (confirmedComposerContextKey === contextKey) {
      confirmedComposerState = null;
      confirmedComposerContextKey = null;
    }
  }

  function stagePendingPickerState(state, reason) {
    if (!state?.candidateFound) return false;
    const contextKey = getCurrentModelContextKey();
    if (!contextKey) return false;
    pendingPickerState = state;
    pendingPickerContextKey = contextKey;
    lastReason = reason;
    return true;
  }

  function getTriggerForPicker(picker) {
    const menu = picker?.closest?.('[role="menu"][aria-labelledby]') || null;
    const labelledBy = menu?.getAttribute?.('aria-labelledby');
    if (labelledBy) {
      const exact = document.getElementById(labelledBy);
      if (exact instanceof HTMLButtonElement) return exact;
    }
    return null;
  }

  function looksLikePerformanceTrigger(button, expectedPerformance = '') {
    if (!(button instanceof HTMLButtonElement) || button.getAttribute('aria-haspopup') !== 'menu') return false;
    const values = [button.textContent, button.getAttribute('aria-label'), button.getAttribute('title')]
      .map((value) => normalizeText(value));
    return values.some((value) => {
      if (expectedPerformance && (
        value === expectedPerformance
        || value.startsWith(`${expectedPerformance} `)
        || value.endsWith(` ${expectedPerformance}`)
      )) return true;
      for (const label of PERFORMANCE_LABELS) {
        if (value === label || value.startsWith(`${label} `) || value.endsWith(` ${label}`)) return true;
      }
      return false;
    });
  }

  function looksLikeExpectedModelTrigger(button, expectedModelVersion = '') {
    if (!(button instanceof HTMLButtonElement) || button.getAttribute('aria-haspopup') !== 'menu') return false;
    if (!expectedModelVersion) return false;
    return extractExplicitModelVersion(button.textContent || '') === expectedModelVersion;
  }

  function looksLikeStructuralModelTrigger(button) {
    if (!(button instanceof HTMLButtonElement) || button.getAttribute('aria-haspopup') !== 'menu') return false;
    const state = normalizeText(button.getAttribute('data-state')).toLowerCase();
    if (state !== 'open' && state !== 'closed') return false;
    if (button.hasAttribute('aria-label')) return false;
    const directChildren = Array.from(button.children || []);
    const hasSpan = directChildren.some((child) => child instanceof HTMLElement && child.tagName === 'SPAN');
    const hasSvg = directChildren.some((child) => child instanceof SVGElement);
    return hasSpan && hasSvg;
  }

  function findFallbackTrigger(expectedPerformance = '') {
    const composer = getCurrentComposer();
    if (!composer) return null;
    const buttons = Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]'));
    const structuralModelTriggers = buttons.filter(looksLikeStructuralModelTrigger);
    return getWorkNativeModelTrigger()
      || buttons.find((button) => looksLikePerformanceTrigger(button, expectedPerformance))
      || buttons.find((button) => looksLikeExpectedModelTrigger(button, currentState?.modelVersion || ''))
      || (structuralModelTriggers.length === 1 ? structuralModelTriggers[0] : null)
      || (
        buttons.length === 1
        && navigationCarryState === currentState
        && navigationCarryContextKey === getCurrentModelContextKey()
        ? buttons[0]
        : null
      )
      || null;
  }

  function resolveTargetTrigger(preferredTrigger, expectedPerformance = '') {
    if (isTriggerInCurrentComposer(preferredTrigger)) return preferredTrigger;
    if (isTriggerInCurrentComposer(currentTrigger)) return currentTrigger;
    return findFallbackTrigger(expectedPerformance);
  }

  function describeModelTrigger(button) {
    if (!(button instanceof HTMLButtonElement)) return null;
    const text = normalizeText(button.textContent || '');
    return {
      connected: Boolean(button.isConnected),
      inComposer: Boolean(button.closest?.(COMPOSER_SELECTOR)),
      ariaHaspopup: button.getAttribute('aria-haspopup') || null,
      dataTestid: button.getAttribute('data-testid') || null,
      knownPerformanceLabel: PERFORMANCE_LABELS.has(text) ? text : null,
      explicitModelVersion: extractExplicitModelVersion(text),
      textLength: text.length,
      childElementCount: button.children?.length || 0,
      hasSvgChild: Boolean(Array.from(button.children || []).some((child) => child instanceof SVGElement)),
      richApplied: button.getAttribute(RICH_ATTR) === 'true',
      richPerformance: button.getAttribute('data-arcaia-model-performance') || null,
      isCurrentTrigger: button === currentTrigger
    };
  }

  function createRichContent(state) {
    const root = document.createElement('span');
    root.setAttribute(RICH_CONTENT_ATTR, 'true');
    root.setAttribute('aria-hidden', 'true');

    const sparkle = document.createElement('span');
    sparkle.className = 'arcaia-model-sparkle';
    sparkle.textContent = '✦';

    const version = document.createElement('span');
    version.className = 'arcaia-model-version';
    version.textContent = state.modelVersion;

    root.append(sparkle, version);

    if (state.modelSuffix) {
      const suffix = document.createElement('span');
      suffix.className = 'arcaia-model-suffix';
      suffix.textContent = state.modelSuffix;
      root.appendChild(suffix);
    }

    if (state.performance) {
      const performance = document.createElement('span');
      performance.className = 'arcaia-model-performance';
      performance.textContent = ENGLISH_PERFORMANCE_DISPLAY[state.performance] || normalizeText(state.performance).toLowerCase();
      root.appendChild(performance);
    }

    return root;
  }

  function restoreTrigger(trigger) {
    if (!(trigger instanceof HTMLButtonElement)) return;
    const composer = trigger.closest?.(COMPOSER_SELECTOR);
    trigger.removeAttribute(RICH_ATTR);
    trigger.removeAttribute('data-arcaia-model-version');
    trigger.removeAttribute('data-arcaia-model-performance');
    trigger.removeAttribute(VISUAL_STYLE_ATTR);
    trigger.removeAttribute(ORIGINAL_WIDTH_ATTR);
    trigger.querySelector?.(`[${RICH_CONTENT_ATTR}="true"]`)?.remove?.();
    trigger.querySelector?.(`[${NATIVE_LABEL_ATTR}="true"]`)?.removeAttribute?.(NATIVE_LABEL_ATTR);
    const originalTitle = trigger.getAttribute(ORIGINAL_TITLE_ATTR);
    if (originalTitle === '') trigger.removeAttribute('title');
    else if (originalTitle != null) trigger.setAttribute('title', originalTitle);
    trigger.removeAttribute(ORIGINAL_TITLE_ATTR);
    const originalAriaLabel = trigger.getAttribute(ORIGINAL_ARIA_LABEL_ATTR);
    if (originalAriaLabel === '') trigger.removeAttribute('aria-label');
    else if (originalAriaLabel != null) trigger.setAttribute('aria-label', originalAriaLabel);
    trigger.removeAttribute(ORIGINAL_ARIA_LABEL_ATTR);
    if (composer instanceof HTMLElement && !composer.querySelector(`button[${RICH_ATTR}="true"]`)) {
      clearComposerReservation(composer);
    }
  }

  function restoreAllTriggers() {
    for (const trigger of Array.from(document.querySelectorAll(`button[${RICH_ATTR}="true"]`))) restoreTrigger(trigger);
    observeTriggerState(null);
    currentTrigger = null;
  }

  function applyRichState(trigger, state, reason = 'apply') {
    if (!isTriggerInCurrentComposer(trigger) || !state || state.modelVersion !== 'GPT-5.6') {
      lastApplySnapshot = {
        ok: false,
        reason,
        triggerPresent: trigger instanceof HTMLButtonElement,
        triggerInCurrentComposer: isTriggerInCurrentComposer(trigger),
        statePresent: Boolean(state),
        modelVersion: state?.modelVersion || null,
        at: Date.now()
      };
      restoreAllTriggers();
      return false;
    }

    for (const other of Array.from(document.querySelectorAll(`button[${RICH_ATTR}="true"]`))) {
      if (other !== trigger) restoreTrigger(other);
    }

    if (!trigger.hasAttribute(ORIGINAL_WIDTH_ATTR)) {
      const nativeWidth = trigger.getBoundingClientRect().width;
      if (nativeWidth > 0) trigger.setAttribute(ORIGINAL_WIDTH_ATTR, String(nativeWidth));
    }

    const nativeLabel = Array.from(trigger.children).find((child) => child instanceof HTMLElement && child.tagName !== 'SVG' && !child.hasAttribute(RICH_CONTENT_ATTR)) || null;
    if (nativeLabel instanceof HTMLElement) nativeLabel.setAttribute(NATIVE_LABEL_ATTR, 'true');

    trigger.querySelector?.(`[${RICH_CONTENT_ATTR}="true"]`)?.remove?.();
    const richContent = createRichContent(state);
    const chevron = Array.from(trigger.children).find((child) => child instanceof SVGElement) || null;
    if (chevron) trigger.insertBefore(richContent, chevron);
    else trigger.appendChild(richContent);

    if (!trigger.hasAttribute(ORIGINAL_TITLE_ATTR)) trigger.setAttribute(ORIGINAL_TITLE_ATTR, trigger.getAttribute('title') || '');
    const titleParts = [state.modelLabel || state.modelVersion];
    if (state.performance) titleParts.push(`応答性能: ${state.performance}`);
    trigger.setAttribute('title', titleParts.join(' / '));
    if (!trigger.hasAttribute(ORIGINAL_ARIA_LABEL_ATTR)) trigger.setAttribute(ORIGINAL_ARIA_LABEL_ATTR, trigger.getAttribute('aria-label') || '');
    trigger.setAttribute('aria-label', titleParts.join('、'));
    trigger.setAttribute(RICH_ATTR, 'true');
    trigger.setAttribute('data-arcaia-model-version', state.modelVersion);
    trigger.setAttribute('data-arcaia-model-performance', state.performance || '');
    trigger.setAttribute(VISUAL_STYLE_ATTR, visualStyle);
    updateComposerReservation(trigger);
    currentTrigger = trigger;
    observeTriggerState(trigger);
    lastReason = reason;
    lastApplySnapshot = {
      ok: true,
      reason,
      modelVersion: state.modelVersion,
      performance: state.performance || null,
      trigger: describeModelTrigger(trigger),
      at: Date.now()
    };
    return true;
  }

  function setCurrentState(state, trigger, reason) {
    if (!state?.candidateFound) return false;
    if (
      navigationCarryContextKey === getCurrentModelContextKey()
      && state !== navigationCarryState
    ) clearNavigationCarry();
    if (state.modelVersion !== 'GPT-5.6') {
      const nextContextKey = getCurrentModelContextKey();
      recordStateMutation(null, nextContextKey, 'set_current_non_gpt56', reason);
      currentState = null;
      currentStateContextKey = nextContextKey;
      restoreAllTriggers();
      lastReason = `non_5_6:${reason}`;
      return true;
    }
    const nextContextKey = getCurrentModelContextKey();
    recordStateMutation(state, nextContextKey, 'set_current_state', reason);
    currentState = state;
    currentStateContextKey = nextContextKey;
    return applyRichState(resolveTargetTrigger(trigger, state.performance), state, reason);
  }

  function getVisiblePicker() {
    return Array.from(document.querySelectorAll(PICKER_SELECTOR)).find((picker) => {
      const menu = picker.closest?.('[role="menu"]');
      return picker.isConnected && !picker.hidden && menu?.getAttribute?.('data-state') !== 'closed';
    }) || null;
  }

  function commitPendingPickerState(reason = 'picker_focusout_confirmed') {
    const pendingState = pendingPickerState;
    const pendingContextKey = pendingPickerContextKey;
    pendingPickerState = null;
    pendingPickerContextKey = null;
    if (!pendingState?.candidateFound) return false;

    const currentContextKey = getCurrentModelContextKey();
    if (!currentContextKey || pendingContextKey !== currentContextKey) return false;

    const liveSliderEffort = getThinkingEffortFromSlider(observedThinkingSlider);
    if (liveSliderEffort && pendingState.thinkingEffort && liveSliderEffort !== pendingState.thinkingEffort) return false;
    rememberConfirmedPickerState(pendingState);
    return setCurrentState(pendingState, observedTriggerState, reason);
  }

  function handleTriggerStateMutations(mutations) {
    const decorationMissing = Boolean(
      started
      && observedTriggerState === currentTrigger
      && !hasCurrentComposerDecoration()
    );
    if (decorationMissing) {
      queueScan('model_decoration_removed');
      return;
    }
    const triggerStateChanged = Array.from(mutations || []).some((mutation) => (
      mutation.type === 'attributes'
      && mutation.target === observedTriggerState
      && (mutation.attributeName === 'aria-expanded' || mutation.attributeName === 'data-state')
    ));
    if (!triggerStateChanged) return;
    const pickerOpened = observedTriggerState?.getAttribute('aria-expanded') === 'true'
      || observedTriggerState?.getAttribute('data-state') === 'open';
    if (pickerOpened) {
      queueScan('model_trigger_opened');
      return;
    }
    const pickerClosed = observedTriggerState?.getAttribute('aria-expanded') === 'false'
      || observedTriggerState?.getAttribute('data-state') === 'closed';
    if (!pickerClosed) return;
    const pickerState = observedPicker?.isConnected ? readPickerState(observedPicker) : null;
    if (pickerState?.candidateFound) {
      pendingPickerState = null;
      pendingPickerContextKey = null;
      rememberConfirmedPickerState(pickerState);
      setCurrentState(pickerState, observedTriggerState, 'picker_closed_confirmed');
    } else if (pendingPickerState) {
      commitPendingPickerState();
    }
    queueScan('model_trigger_closed');
  }

  function observeTriggerState(trigger) {
    const nextTrigger = trigger instanceof HTMLButtonElement ? trigger : null;
    if (observedTriggerState === nextTrigger && triggerStateObserver) return;
    try { triggerStateObserver?.disconnect?.(); } catch {}
    triggerStateObserver = null;
    observedTriggerState = nextTrigger;
    if (!nextTrigger) return;
    triggerStateObserver = new MutationObserver(handleTriggerStateMutations);
    triggerStateObserver.observe(nextTrigger, {
      attributes: true,
      attributeFilter: ['aria-expanded', 'data-state', RICH_ATTR]
    });
  }

  function observeThinkingSlider(picker) {
    const slider = picker?.querySelector?.(`${THINKING_SLIDER_HOST_SELECTOR} [role="slider"]`) || null;
    if (observedThinkingSlider === slider && thinkingSliderObserver) return;
    if (observedThinkingSlider !== slider && slider) {
      pendingPickerState = null;
      pendingPickerContextKey = null;
    }
    try { thinkingSliderObserver?.disconnect?.(); } catch {}
    thinkingSliderObserver = null;
    observedThinkingSlider = slider;
    observedThinkingEffort = slider ? getThinkingEffortFromSlider(slider) : '';
    if (!slider) return;
    thinkingSliderObserver = new MutationObserver(handleThinkingSliderMutations);
    thinkingSliderObserver.observe(slider, {
      attributes: true,
      attributeFilter: ['aria-valuenow']
    });
  }

  function observePicker(picker) {
    if (observedPicker === picker && pickerObserver) {
      observeThinkingSlider(picker);
      return;
    }
    try { pickerObserver?.disconnect?.(); } catch {}
    pickerObserver = null;
    observedPicker = picker || null;
    observeThinkingSlider(picker);
    if (!picker) return;
    pickerObserver = new MutationObserver(handlePickerMutations);
    pickerObserver.observe(picker, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-checked', 'aria-selected', 'aria-expanded', 'data-state']
    });
  }

  function handlePickerMutations(mutations) {
    const picker = observedPicker;
    if (!picker) return;
    observeThinkingSlider(picker);

    const confirmedSelectionChanged = Array.from(mutations || []).some((mutation) => {
      if (mutation.type !== 'attributes') return false;
      if (!['aria-checked', 'aria-selected', 'data-state'].includes(mutation.attributeName)) return false;
      const item = mutation.target instanceof Element
        ? mutation.target.closest?.('[role="menuitemradio"], [role="radio"], [role="option"], [role="menuitem"]')
        : null;
      return Boolean(
        item
        && item.closest?.(PICKER_SELECTOR) === picker
        && isSelectedPickerItem(item)
        && (item.matches('[role="menuitemradio"]') || getDirectPerformanceLabel(item))
      );
    });

    const pendingWorkFamily = Array.from(mutations || []).map((mutation) => {
      if (mutation.type !== 'attributes') return null;
      if (mutation.attributeName !== 'aria-expanded' && mutation.attributeName !== 'data-state') return null;
      const item = mutation.target instanceof Element ? mutation.target.closest?.('[role="menuitem"]') : null;
      if (!item || item.closest?.(PICKER_SELECTOR) !== picker) return null;
      const family = normalizeWorkFamilyLabel(item.textContent || '');
      const selected = item.getAttribute('aria-expanded') === 'true' || item.getAttribute('data-state') === 'open';
      return family && selected ? family : null;
    }).find(Boolean);

    if (pendingWorkFamily && getActiveSurfaceMode() === 'work' && currentState?.modelVersion === 'GPT-5.6') {
      stagePendingPickerState({
        ...currentState,
        modelLabel: `GPT-5.6 ${pendingWorkFamily}`,
        modelSuffix: pendingWorkFamily,
        observedAt: Date.now(),
        candidateFound: true,
        modelSource: 'work_family_picker_pending'
      }, 'work_family_pending');
    }

    if (confirmedSelectionChanged) {
      const state = readPickerState(picker);
      if (state?.candidateFound) {
        rememberConfirmedPickerState(state);
        const applied = setCurrentState(state, getTriggerForPicker(picker), 'picker_confirmed_selection');
        lastScanResult = {
          outcome: applied ? 'picker_confirmed_applied' : 'picker_confirmed_not_applied',
          reason: 'picker_confirmed_selection',
          at: Date.now()
        };
        return;
      }
    }

    if (picker.isConnected) queueScan('picker_mutation');
  }

  function handleThinkingSliderMutations(mutations) {
    const sliderValueConfirmed = Array.from(mutations || []).some((mutation) => (
      mutation.type === 'attributes'
      && mutation.attributeName === 'aria-valuenow'
      && mutation.target === observedThinkingSlider
    ));
    if (!sliderValueConfirmed) return;

    const nextThinkingEffort = getThinkingEffortFromSlider(observedThinkingSlider);
    const sliderChanged = Boolean(nextThinkingEffort && nextThinkingEffort !== observedThinkingEffort);
    observedThinkingEffort = nextThinkingEffort;
    if (!sliderChanged) return;

    const state = buildSliderState(nextThinkingEffort);
    if (state?.candidateFound) {
      stagePendingPickerState(state, 'thinking_effort_pending');
    }
  }

  function getSurfaceModeButtons() {
    return Array.from(document.querySelectorAll?.(SURFACE_MODE_BUTTON_SELECTOR) || [])
      .filter((button) => /^(Chat|Work)$/i.test(normalizeText(button.textContent || '')));
  }

  function sameElements(left, right) {
    return left.length === right.length && left.every((element, index) => element === right[index]);
  }

  function handleSurfaceModeMutations(mutations) {
    const stateChanged = Array.from(mutations || []).some((mutation) => (
      mutation.type === 'attributes'
      && observedSurfaceModeButtons.includes(mutation.target)
      && ['data-state', 'aria-checked', 'aria-selected'].includes(mutation.attributeName)
    ));
    if (stateChanged) queueScan('surface_state_changed');
  }

  function observeSurfaceModeButtons() {
    const buttons = getSurfaceModeButtons();
    if (sameElements(observedSurfaceModeButtons, buttons) && surfaceModeObserver) return;
    try { surfaceModeObserver?.disconnect?.(); } catch {}
    surfaceModeObserver = null;
    observedSurfaceModeButtons = buttons;
    if (!buttons.length) return;
    surfaceModeObserver = new MutationObserver(handleSurfaceModeMutations);
    for (const button of buttons) {
      surfaceModeObserver.observe(button, {
        attributes: true,
        attributeFilter: ['data-state', 'aria-checked', 'aria-selected']
      });
    }
  }

  function nodeContainsModelTrigger(node) {
    if (!(node instanceof Element)) return false;
    if (node.matches('button[aria-haspopup="menu"]')) return true;
    return Boolean(node.querySelector?.('button[aria-haspopup="menu"]'));
  }

  function handleComposerMutations(mutations) {
    if (currentTrigger && !isTriggerInCurrentComposer(currentTrigger)) {
      queueScan('trigger_disconnected');
      return;
    }
    for (const mutation of mutations || []) {
      const addedRelevant = Array.from(mutation.addedNodes || []).some(nodeContainsModelTrigger);
      const removedRelevant = Array.from(mutation.removedNodes || []).some(nodeContainsModelTrigger);
      if (addedRelevant || removedRelevant) {
        queueScan(addedRelevant ? 'composer_trigger_added' : 'composer_trigger_removed');
        return;
      }
    }
  }

  function handleComposerParentMutations() {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    if (composer !== observedComposer) queueScan('composer_replaced');
  }

  function handleComposerGrandparentMutations() {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    if (composer !== observedComposer) queueScan('composer_parent_replaced');
  }

  function disconnectComposerBootstrapObserver() {
    try { composerBootstrapObserver?.disconnect?.(); } catch {}
    composerBootstrapObserver = null;
  }

  function ensureComposerBootstrapObserver() {
    if (composerBootstrapObserver || document.querySelector(COMPOSER_SELECTOR)) return;
    const target = document.body || document.documentElement;
    if (!target) return;
    composerBootstrapObserver = new MutationObserver(() => {
      if (!document.querySelector(COMPOSER_SELECTOR)) return;
      disconnectComposerBootstrapObserver();
      queueScan('composer_bootstrap_added');
    });
    composerBootstrapObserver.observe(target, { childList: true, subtree: true });
  }

  function observeComposer(composer) {
    const nextComposer = composer instanceof HTMLFormElement ? composer : null;
    const nextParent = nextComposer?.parentElement || null;
    const nextGrandparent = nextParent?.parentElement || null;
    if (
      observedComposer === nextComposer
      && observedComposerParent === nextParent
      && observedComposerGrandparent === nextGrandparent
      && (nextComposer ? Boolean(composerObserver && composerParentObserver && composerGrandparentObserver) : true)
    ) {
      if (!nextComposer) ensureComposerBootstrapObserver();
      return;
    }

    try { observedComposer?.removeEventListener('input', handleComposerInput, true); } catch {}
    try { composerObserver?.disconnect?.(); } catch {}
    try { composerParentObserver?.disconnect?.(); } catch {}
    try { composerGrandparentObserver?.disconnect?.(); } catch {}
    composerObserver = null;
    composerParentObserver = null;
    composerGrandparentObserver = null;
    observedComposer = nextComposer;
    observedComposerParent = nextParent;
    observedComposerGrandparent = nextGrandparent;

    if (!nextComposer) {
      ensureComposerBootstrapObserver();
      return;
    }

    disconnectComposerBootstrapObserver();
    nextComposer.addEventListener('input', handleComposerInput, true);
    composerObserver = new MutationObserver(handleComposerMutations);
    composerObserver.observe(nextComposer, { childList: true, subtree: true });
    if (nextParent) {
      composerParentObserver = new MutationObserver(handleComposerParentMutations);
      composerParentObserver.observe(nextParent, { childList: true });
    }
    if (nextGrandparent) {
      composerGrandparentObserver = new MutationObserver(handleComposerGrandparentMutations);
      composerGrandparentObserver.observe(nextGrandparent, { childList: true });
    }
  }

  function scan(reason = 'manual') {
    scanQueued = false;
    scanCount += 1;
    lastScanAt = Date.now();
    if (!started) {
      lastScanResult = { outcome: 'not_started', reason, at: lastScanAt };
      return;
    }
    injectStyle();
    observeSurfaceModeButtons();
    observeComposer(document.querySelector(COMPOSER_SELECTOR));

    const picker = getVisiblePicker();
    observePicker(picker);
    if (picker) {
      const state = readPickerState(picker);
      const applied = setCurrentState(state, getTriggerForPicker(picker), `picker:${reason}`);
      lastScanResult = { outcome: applied ? 'picker_applied' : 'picker_not_applied', reason, at: lastScanAt };
      return;
    }

    const resolved = resolveCurrentContextState();
    lastResolvedContext = {
      contextKind: resolved.contextKind,
      activeSurfaceMode: resolved.activeSurfaceMode,
      modelSource: resolved.state?.modelSource || null,
      modelLabel: resolved.state?.modelLabel || null,
      thinkingEffort: resolved.state?.thinkingEffort || null,
      at: lastScanAt
    };
    if (resolved.state?.candidateFound) {
      const applied = setCurrentState(resolved.state, null, `resolved:${resolved.contextKind}:${reason}`);
      lastScanResult = {
        outcome: applied ? 'resolved_state_applied' : 'resolved_state_not_applied',
        reason,
        contextKind: resolved.contextKind,
        at: lastScanAt
      };
      return;
    }
    const preserveConfirmedDecoration = !resolved.authorityPresent
      && !resolved.explicitNonGpt56
      && hasCurrentComposerDecoration();
    const preservePendingNewChatPromotion = !resolved.authorityPresent
      && !resolved.explicitNonGpt56
      && Boolean(getNewChatPromotionSource(getCurrentModelContextKey()));
    if (!preserveConfirmedDecoration && !preservePendingNewChatPromotion) {
      const nextContextKey = resolved.explicitNonGpt56 ? getCurrentModelContextKey() : null;
      recordStateMutation(null, nextContextKey, 'resolved_state_unavailable', reason);
      currentState = null;
      currentStateContextKey = nextContextKey;
      restoreAllTriggers();
      if (resolved.explicitNonGpt56) {
        lastReason = `non_5_6:resolved:${resolved.contextKind}:${reason}`;
      }
    }
    lastScanResult = {
      outcome: 'resolved_state_unavailable',
      reason,
      contextKind: resolved.contextKind,
      preserved: preserveConfirmedDecoration || preservePendingNewChatPromotion,
      at: lastScanAt
    };
  }

  function queueScan(reason = 'queued') {
    lastReason = reason;
    if (scanQueued || !started) return;
    scanQueued = true;
    const run = () => scan(reason);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function handleStorageChange(event) {
    const key = String(event?.key || '');
    if (!key || [
      CHATGPT_SURFACE_MODE_STORAGE_KEY,
      WORK_MODEL_SETTINGS_STORAGE_KEY,
      WORK_THINKING_EFFORT_STORAGE_KEY
    ].includes(key)) queueScan('storage_changed');
  }

  function handleWindowFocus() {
    queueScan('window_focus');
  }

  function handleDocumentClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const surfaceButton = target.closest?.(SURFACE_MODE_BUTTON_SELECTOR) || null;
    if (surfaceButton && /^(Chat|Work)$/i.test(normalizeText(surfaceButton.textContent || ''))) {
      queueScan('surface_control_click');
      return;
    }
    const menuButton = target.closest('button[aria-haspopup="menu"]');
    if (
      menuButton?.closest?.(COMPOSER_SELECTOR)
      && (
        extractExplicitModelVersion(menuButton.textContent || '')
        || looksLikePerformanceTrigger(menuButton, currentState?.performance || '')
        || menuButton === currentTrigger
      )
    ) {
      queueScan('model_trigger_click');
    }
  }

  function start() {
    if (started) {
      queueScan('restart');
      return getLightweightStatus();
    }
    started = true;
    injectStyle();
    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleWindowFocus);
    queueScan('startup');
    return getLightweightStatus();
  }

  function cleanup(reason = 'cleanup') {
    started = false;
    try { observedComposer?.removeEventListener('input', handleComposerInput, true); } catch {}
    try { composerObserver?.disconnect?.(); } catch {}
    try { composerParentObserver?.disconnect?.(); } catch {}
    try { composerGrandparentObserver?.disconnect?.(); } catch {}
    try { composerBootstrapObserver?.disconnect?.(); } catch {}
    try { surfaceModeObserver?.disconnect?.(); } catch {}
    try { pickerObserver?.disconnect?.(); } catch {}
    try { thinkingSliderObserver?.disconnect?.(); } catch {}
    try { triggerStateObserver?.disconnect?.(); } catch {}
    composerObserver = null;
    observedComposer = null;
    composerParentObserver = null;
    observedComposerParent = null;
    composerGrandparentObserver = null;
    observedComposerGrandparent = null;
    composerBootstrapObserver = null;
    surfaceModeObserver = null;
    observedSurfaceModeButtons = [];
    pickerObserver = null;
    observedPicker = null;
    thinkingSliderObserver = null;
    observedThinkingSlider = null;
    observedThinkingEffort = '';
    triggerStateObserver = null;
    observedTriggerState = null;
    pendingPickerState = null;
    pendingPickerContextKey = null;
    confirmedComposerState = null;
    confirmedComposerContextKey = null;
    clearNavigationCarry();
    currentStateContextKey = null;
    document.removeEventListener('click', handleDocumentClick, true);
    window.removeEventListener('storage', handleStorageChange);
    window.removeEventListener('focus', handleWindowFocus);
    restoreAllTriggers();
    lastReason = reason;
    return getLightweightStatus();
  }

  function getLightweightStatus() {
    return {
      started,
      modelVersion: currentState?.modelVersion || null,
      modelLabel: currentState?.modelLabel || null,
      modelSuffix: currentState?.modelSuffix || null,
      performance: currentState?.performance || null,
      thinkingEffort: currentState?.thinkingEffort || null,
      modelSource: currentState?.modelSource || null,
      triggerApplied: Boolean(isTriggerInCurrentComposer(currentTrigger) && currentTrigger.getAttribute(RICH_ATTR) === 'true'),
      pickerObserved: Boolean(observedPicker?.isConnected),
      activeSurfaceMode: getActiveSurfaceMode(),
      lastReason
    };
  }

  function getProbeSnapshot() {
    const activeSurfaceMode = getActiveSurfaceMode();
    const status = getLightweightStatus();
    const newChatModelConfig = readCookieJson(CHATGPT_LAST_MODEL_COOKIE);
    const newChatState = readNewChatCurrentState();
    const currentContextKey = getCurrentModelContextKey();
    const currentConversationToken = getCurrentConversationToken();
    const resolved = resolveCurrentContextState();
    const trigger = resolveTargetTrigger(null, resolved.state?.performance || status.performance || '');
    return {
      activeSurfaceModePresent: Boolean(activeSurfaceMode),
      activeSurfaceMode: activeSurfaceMode === 'chatgpt' || activeSurfaceMode === 'work'
        ? activeSurfaceMode
        : null,
      newChatModelConfigPresent: Boolean(newChatModelConfig && typeof newChatModelConfig === 'object'),
      newChatStateCandidateFound: Boolean(newChatState?.candidateFound),
      resolvedContextKind: typeof resolved.contextKind === 'string' ? resolved.contextKind : null,
      resolvedExplicitNonGpt56: resolved.explicitNonGpt56 === true,
      currentContextKind: classifyModelContextKey(currentContextKey),
      currentStateContextKind: classifyModelContextKey(currentStateContextKey),
      currentStateContextMatchesCurrent: Boolean(currentContextKey && currentStateContextKey === currentContextKey),
      conversationStatePresent: Boolean(conversationState?.candidateFound),
      conversationContextMatchesCurrent: Boolean(currentConversationToken && conversationContextToken === currentConversationToken),
      confirmedComposerStatePresent: Boolean(confirmedComposerState?.candidateFound),
      confirmedComposerContextMatchesCurrent: Boolean(currentContextKey && confirmedComposerContextKey === currentContextKey),
      navigationCarryStatePresent: Boolean(navigationCarryState?.candidateFound),
      navigationCarryContextMatchesCurrent: Boolean(currentContextKey && navigationCarryContextKey === currentContextKey),
      lastNavigationResetPresent: Boolean(lastNavigationReset),
      lastNavigationResetPreserved: lastNavigationReset?.preserved === true,
      navigationResetHistory: navigationResetHistory.map((record) => ({
        sequence: record.sequence,
        reason: record.reason,
        previousContextKind: record.previousContextKind,
        nextContextKind: record.nextContextKind,
        contextKeyChanged: record.contextKeyChanged,
        statePresentBefore: record.statePresentBefore,
        stateModelVersionBefore: record.stateModelVersionBefore,
        activeSurfaceModeAtReset: record.activeSurfaceModeAtReset,
        conditions: { ...record.conditions },
        decision: record.decision,
        decisionReason: record.decisionReason,
        statePresentAfter: record.statePresentAfter,
        stateContextKindAfter: record.stateContextKindAfter
      })),
      lastStateMutation: lastStateMutation ? {
        sequence: lastStateMutation.sequence,
        kind: lastStateMutation.kind,
        reason: lastStateMutation.reason,
        sourceReason: lastStateMutation.sourceReason,
        currentContextKind: lastStateMutation.currentContextKind,
        previousContextKind: lastStateMutation.previousContextKind,
        nextContextKind: lastStateMutation.nextContextKind,
        previousModelVersion: lastStateMutation.previousModelVersion,
        nextModelVersion: lastStateMutation.nextModelVersion
      } : null,
      triggerFound: Boolean(trigger),
      currentStatePresent: Boolean(status.modelVersion || status.modelSource || status.thinkingEffort || status.performance),
      modelSource: status.modelSource,
      thinkingEffort: status.thinkingEffort,
      performance: status.performance,
      triggerApplied: status.triggerApplied,
      currentTriggerInComposer: Boolean(currentTrigger && isTriggerInCurrentComposer(currentTrigger)),
      scanReason: typeof lastScanResult?.reason === 'string' ? lastScanResult.reason : null,
      scanOutcome: typeof lastScanResult?.outcome === 'string' ? lastScanResult.outcome : null
    };
  }

  function getStatus() {
    return getLightweightStatus();
  }

  function setVisualStyle(value) {
    visualStyle = normalizeVisualStyle(value);
    for (const trigger of Array.from(document.querySelectorAll(`button[${RICH_ATTR}="true"]`))) {
      trigger.setAttribute(VISUAL_STYLE_ATTR, visualStyle);
      updateComposerReservation(trigger);
    }
    return visualStyle;
  }

  window[API_KEY] = Object.freeze({
    start,
    cleanup,
    scan,
    getStatus,
    getLightweightStatus,
    getProbeSnapshot,
    setVisualStyle,
    applyConversationModelConfig,
    resetForNavigation
  });
})();
