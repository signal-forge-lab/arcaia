(() => {
  'use strict';

  const SOURCE = 'arcaia-model-decoration-watch-v1';
  const PROBE_NAME = 'Arcaia Model Decoration Watch Probe';
  const PROBE_VERSION = '1.0.28';
  const RUNTIME_KEY = '__arcaiaModelDecorationWatchProbeContent';
  const MAIN_PROTOCOL_SOURCE = 'aice-probe-main-v159';
  const CONTENT_PROTOCOL_SOURCE = 'aice-probe-content-v159';
  const COMPOSER_SELECTOR = 'form[data-type="unified-composer"]';
  const PICKER_SELECTOR = '[data-testid="composer-intelligence-picker-content"]';
  const THINKING_SLIDER_HOST_SELECTOR = '[data-testid="composer-model-picker-slider-simple-view"]';
  const RICH_TRIGGER_SELECTOR = 'button[data-arcaia-model-rich="true"]';
  const RICH_CONTENT_SELECTOR = '[data-arcaia-model-rich-content="true"]';
  const MODEL_STYLE_SELECTOR = '#arcaia-model-selector-rich-style';
  const NATIVE_LABEL_SELECTOR = '[data-arcaia-model-native-label="true"]';
  const BOOTSTRAP_DURATION_MS = 30000;
  const REPLACEMENT_GRACE_MS = 1200;
  const COLD_START_GRACE_MS = 7000;
  const WORK_TRIGGER_WRAPPER_SELECTOR = '[data-animated-slider-trigger="true"]';
  const WORK_TRIGGER_MODEL_LABEL_SELECTOR = '[class*="_SliderTriggerModelLabel"]';
  const WORK_TRIGGER_EFFORT_LABEL_SELECTOR = '[class*="_SliderTriggerEffortLabel"]';
  const WORK_MODEL_SETTINGS_STORAGE_KEY = 'oai/apps/tpp/model-settings';
  const WORK_THINKING_EFFORT_STORAGE_KEY = 'oai/apps/tpp/thinking-effort';
  const TPP_STORAGE_PREFIX = 'oai/apps/tpp/';
  const MAX_PENDING_SYNC_REQUESTS = 12;
  const MAX_PENDING_INTERNAL_PROBE_REQUESTS = 12;
  const MAX_COMPOSER_SUMMARIES = 4;
  const MAX_BUTTON_PROFILES_PER_COMPOSER = 6;
  const MAX_PICKER_MODEL_CANDIDATES = 6;
  const MAX_PRE_PICKER_DOM_SIGNALS = 24;
  const MAX_PRE_PICKER_STORAGE_SIGNALS = 16;
  const MAX_PRE_PICKER_SEMANTIC_PATHS = 12;
  const INTERNAL_PROBE_REQUEST = 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_REQUEST';
  const INTERNAL_PROBE_RESPONSE = 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_RESPONSE';
  const MAIN_SURVEY_REQUEST = 'ARCAIA_MODEL_DECORATION_MAIN_SURVEY_REQUEST';
  const MAIN_SURVEY_RESPONSE = 'ARCAIA_MODEL_DECORATION_MAIN_SURVEY_RESPONSE';
  const REARM_CONVERSATION_CAPTURE = 'ARCAIA_MODEL_DECORATION_REARM_CONVERSATION_CAPTURE';
  const MAX_PENDING_MAIN_SURVEYS = 8;
  const MAIN_SURVEY_TIMEOUT_MS = 1200;
  const MAX_LOCAL_EVENTS = 24;
  const MODEL_PATTERN = /\bGPT[-\u2011\u2013\s]?(\d+(?:\.\d+)?)\b/i;
  const PERFORMANCE_LABELS = new Set([
    '軽', '最速', '中程度', '高い', '非常に高い', '最大',
    'Light', 'Fastest', 'Medium', 'High', 'Very high', 'Maximum'
  ]);
  const STRUCTURAL_HINTS = [
    'model', 'thinking', 'intelligence', 'picker', 'trigger', 'composer',
    'tools', 'attach', 'upload', 'voice', 'record', 'menu', 'mode', 'more', 'plus'
  ];
  const THINKING_EFFORTS = new Set([
    'none', 'minimal', 'low', 'medium', 'standard', 'high', 'extended', 'xhigh', 'max'
  ]);
  const SEMANTIC_AUTHORITY_KEY_PATTERN = /model|slug|thinking|effort|intelligence|tier/i;

  if (globalThis[RUNTIME_KEY]?.version === PROBE_VERSION) return;
  globalThis[RUNTIME_KEY] = { version: PROBE_VERSION };

  let sessionId = createSessionId();
  let eventSequence = 0;
  let routeGeneration = 1;
  let lastPathname = String(location.pathname || '');
  let surfaceGeneration = 1;
  /** @type {'chatgpt' | 'work' | null} */
  let lastSurfaceMode = null;
  /** @type {Array<object>} */
  let recentEvents = [];
  /** @type {null | {trigger: HTMLButtonElement, triggerSequence: number, routeGeneration: number, surfaceGeneration: number, modelVersion: string, performance: string | null, armedAtIso: string}} */
  let baseline = null;
  let incidentActive = false;
  let triggerSequence = 0;
  let observedComposer = null;
  let observedComposerParent = null;
  let observedComposerGrandparent = null;
  let observedTrigger = null;
  let composerObserver = null;
  let composerParentObserver = null;
  let composerGrandparentObserver = null;
  let triggerObserver = null;
  let headObserver = null;
  let bootstrapObserver = null;
  let bootstrapTimer = null;
  let replacementTimer = null;
  let replacementToken = 0;
  let coldStartTimer = null;
  let evaluationQueued = false;
  let pendingSyncRequests = new Map();
  let pendingInternalProbeRequests = new Map();
  let pendingMainSurveyRequests = new Map();
  let lastMainWorldAuthority = null;
  let supplyDiagnostics = createSupplyDiagnostics();

  function createSupplyDiagnostics() {
    return {
      currentConfigEventCount: 0,
      syncRequestCount: 0,
      syncResponseCount: 0,
      internalSnapshotCount: 0,
      lastCurrentConfigEvent: null,
      lastSyncRequest: null,
      lastSyncResponse: null,
      lastInternalSnapshot: null,
      lastTransitionInternalSnapshot: null
    };
  }

  function createSessionId() {
    return `model-watch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function classifyRoute() {
    const pathname = String(location.pathname || '');
    if (/^\/c\/[^/]+/i.test(pathname)) return 'conversation';
    if (pathname === '/' || pathname === '') return 'new_chat';
    if (/^\/(?:g|gg)\/[^/]+/i.test(pathname)) return 'gpt_surface';
    return 'other';
  }

  function getActiveSurfaceMode() {
    const activeButton = Array.from(document.querySelectorAll('button[role="radio"][data-state="on"]'))
      .find((button) => /^(Chat|Work)$/i.test(normalizeText(button.textContent || '')));
    const label = normalizeText(activeButton?.textContent || '').toLowerCase();
    if (label === 'work') return 'work';
    if (label === 'chat') return 'chatgpt';
    return null;
  }

  function getSurfaceModeForButton(button) {
    if (!(button instanceof HTMLButtonElement)) return null;
    const label = normalizeText(button.textContent || '').toLowerCase();
    if (label === 'work') return 'work';
    if (label === 'chat') return 'chatgpt';
    return null;
  }

  function parseStorageJson(raw) {
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function readStorageScalarPresent(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return false;
      const parsed = parseStorageJson(raw);
      const value = typeof parsed === 'string' ? parsed : raw;
      return Boolean(normalizeText(value));
    } catch {
      return false;
    }
  }

  function sanitizeStoragePathSegment(value) {
    const normalized = normalizeText(value);
    return /^[a-z][a-z0-9_.-]{0,63}$/i.test(normalized) ? normalized : null;
  }

  function collectSemanticStoragePaths(value, prefix = '', depth = 0, output = []) {
    if (!value || typeof value !== 'object' || depth > 2 || output.length >= 12) return output;
    for (const [rawKey, child] of Object.entries(value)) {
      if (output.length >= 12) break;
      const key = sanitizeStoragePathSegment(rawKey);
      if (!key) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (/model|slug|thinking|effort/i.test(key)) output.push(path);
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        collectSemanticStoragePaths(child, path, depth + 1, output);
      }
    }
    return output;
  }

  function sanitizeTppStorageKey(value) {
    const key = String(value || '');
    if (!key.startsWith(TPP_STORAGE_PREFIX)) return null;
    const suffix = key.slice(TPP_STORAGE_PREFIX.length);
    const parts = suffix.split('/').filter(Boolean).slice(0, 6).map((part) => {
      if (!/^[a-z][a-z0-9_.-]{0,47}$/i.test(part)) return '<redacted>';
      if (/[a-f0-9]{20,}/i.test(part) || /\d{12,}/.test(part)) return '<redacted>';
      return part;
    });
    return parts.length ? `${TPP_STORAGE_PREFIX}${parts.join('/')}` : TPP_STORAGE_PREFIX;
  }

  function summarizeWorkAuthorityStorage() {
    let rawSettings = null;
    let tppKeyNames = [];
    try {
      rawSettings = localStorage.getItem(WORK_MODEL_SETTINGS_STORAGE_KEY);
      const names = [];
      for (let index = 0; index < localStorage.length && names.length < 24; index += 1) {
        const safe = sanitizeTppStorageKey(localStorage.key(index));
        if (safe) names.push(safe);
      }
      tppKeyNames = Array.from(new Set(names)).sort();
    } catch {}

    const settings = parseStorageJson(rawSettings);
    const settingsJsonObject = Boolean(settings && typeof settings === 'object' && !Array.isArray(settings));
    const knownModelSlug = settingsJsonObject
      ? normalizeText(settings.lastUsedModelSlug || settings.last_used_model_slug || '')
      : '';
    const thinkingEffortPresent = readStorageScalarPresent(WORK_THINKING_EFFORT_STORAGE_KEY);
    const knownModelSlugLooksGpt56 = isGpt56ModelSlug(knownModelSlug);
    return {
      settingsPresent: rawSettings != null,
      settingsJsonObject,
      knownModelSlugPresent: Boolean(knownModelSlug),
      knownModelSlugLooksGpt56,
      thinkingEffortPresent,
      authorityCandidateFound: Boolean(knownModelSlugLooksGpt56 && thinkingEffortPresent),
      semanticPaths: settingsJsonObject ? collectSemanticStoragePaths(settings) : [],
      tppKeyNames
    };
  }

  function sanitizeThinkingEffort(value) {
    const normalized = normalizeText(value).toLowerCase();
    return THINKING_EFFORTS.has(normalized) ? normalized : null;
  }

  function createRecognizedAuthoritySignals() {
    return {
      gpt56SignalPresent: false,
      workFamily: null,
      performance: null,
      thinkingEffort: null
    };
  }

  function mergeRecognizedAuthorityValue(signals, value) {
    if (!signals) return signals;
    const normalized = normalizeText(value);
    if (!normalized) return signals;
    if (isGpt56ModelSlug(normalized) || /\bGPT[-\u2011\u2013\s]?5\.6\b/i.test(normalized)) {
      signals.gpt56SignalPresent = true;
    }
    if (!signals.workFamily) {
      if (/(?:^|[-_.\s])sol(?:[-_.\s]|$)/i.test(normalized)) signals.workFamily = 'Sol';
      else if (/(?:^|[-_.\s])terra(?:[-_.\s]|$)/i.test(normalized)) signals.workFamily = 'Terra';
      else if (/(?:^|[-_.\s])luna(?:[-_.\s]|$)/i.test(normalized)) signals.workFamily = 'Luna';
    }
    if (!signals.performance) {
      const direct = sanitizePerformance(normalized);
      if (direct) signals.performance = direct;
      else {
        for (const label of PERFORMANCE_LABELS) {
          if (normalized.startsWith(`${label} `) || normalized.endsWith(` ${label}`)) {
            signals.performance = label;
            break;
          }
        }
      }
    }
    if (!signals.thinkingEffort) signals.thinkingEffort = sanitizeThinkingEffort(normalized);
    return signals;
  }

  function mergeAuthoritySignals(target, source) {
    if (!target || !source) return target;
    if (source.gpt56SignalPresent) target.gpt56SignalPresent = true;
    if (!target.workFamily && source.workFamily) target.workFamily = source.workFamily;
    if (!target.performance && source.performance) target.performance = source.performance;
    if (!target.thinkingEffort && source.thinkingEffort) target.thinkingEffort = source.thinkingEffort;
    return target;
  }

  function collectRecognizedSemanticObjectSignals(
    value,
    prefix = '',
    depth = 0,
    output = null,
    allowNonSemanticObjectTraversal = true
  ) {
    const result = output || { semanticPaths: [], ...createRecognizedAuthoritySignals() };
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return result;
    for (const [rawKey, child] of Object.entries(value)) {
      if (result.semanticPaths.length >= MAX_PRE_PICKER_SEMANTIC_PATHS) break;
      const key = sanitizeStoragePathSegment(rawKey);
      if (!key) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const semantic = SEMANTIC_AUTHORITY_KEY_PATTERN.test(key);
      if (semantic) {
        result.semanticPaths.push(path);
        if (typeof child === 'string' || typeof child === 'number') {
          mergeRecognizedAuthorityValue(result, child);
        }
      }
      if (
        child
        && typeof child === 'object'
        && !Array.isArray(child)
        && (allowNonSemanticObjectTraversal || semantic)
      ) {
        collectRecognizedSemanticObjectSignals(
          child,
          path,
          depth + 1,
          result,
          allowNonSemanticObjectTraversal
        );
      }
    }
    return result;
  }

  function sanitizeAuthorityStorageKey(value) {
    const key = normalizeText(value);
    if (!key || key.length > 192 || !SEMANTIC_AUTHORITY_KEY_PATTERN.test(key)) return null;
    const parts = key.split('/').filter(Boolean).slice(0, 8).map((part) => {
      if (/^user-[a-z0-9_-]{8,}$/i.test(part)) return '<redacted>';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(part)) return '<redacted>';
      if (!/^[a-z0-9_.:-]{1,64}$/i.test(part)) return '<redacted>';
      if (/[a-f0-9]{20,}/i.test(part) || /\d{12,}/.test(part)) return '<redacted>';
      return part;
    });
    return parts.length ? parts.join('/') : null;
  }

  function summarizeSemanticStorageArea(storage, storageArea) {
    const output = [];
    try {
      for (let index = 0; index < storage.length && output.length < MAX_PRE_PICKER_STORAGE_SIGNALS; index += 1) {
        const rawKey = storage.key(index);
        const keyName = sanitizeAuthorityStorageKey(rawKey);
        if (!keyName) continue;
        const raw = storage.getItem(rawKey);
        const parsed = parseStorageJson(raw);
        const signals = createRecognizedAuthoritySignals();
        let semanticPaths = [];
        let valueShape = 'scalar';
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          valueShape = 'json_object';
          const nested = collectRecognizedSemanticObjectSignals(parsed);
          semanticPaths = nested.semanticPaths;
          mergeAuthoritySignals(signals, nested);
        } else if (Array.isArray(parsed)) {
          valueShape = 'json_array';
        } else {
          mergeRecognizedAuthorityValue(signals, typeof parsed === 'string' ? parsed : raw);
        }
        output.push({
          storageArea,
          keyName,
          valueShape,
          semanticPaths,
          ...signals
        });
      }
    } catch {}
    return output;
  }

  function summarizeConversationColdStartAuthority() {
    if (classifyRoute() !== 'conversation') return null;
    const composer = document.querySelector(COMPOSER_SELECTOR);
    if (!(composer instanceof Element)) {
      return {
        eligible: true,
        composerPresent: false,
        menuButtonSignals: [],
        storageSignals: [],
        modelSignalFound: false,
        thinkingSignalFound: false,
        authoritySignalFound: false
      };
    }

    const menuButtonSignals = Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]'))
      .slice(0, MAX_BUTTON_PROFILES_PER_COMPOSER)
      .map((button) => {
        const values = [
          button.textContent,
          button.getAttribute('aria-label'),
          button.getAttribute('title')
        ].map((value) => normalizeText(value)).filter(Boolean);
        const signals = createRecognizedAuthoritySignals();
        for (const value of values) mergeRecognizedAuthorityValue(signals, value);
        const bareGpt56SignalPresent = values.some((value) => /(?:^|[^\d])5\.6(?:[^\d]|$)/.test(value));
        return {
          dataTestidCategory: classifyDataTestid(button.getAttribute('data-testid')),
          bareGpt56SignalPresent,
          ...signals
        };
      });

    const storageSignals = [
      ...summarizeSemanticStorageArea(localStorage, 'local'),
      ...summarizeSemanticStorageArea(sessionStorage, 'session')
    ].slice(0, MAX_PRE_PICKER_STORAGE_SIGNALS);
    const currentStateStorageSignals = storageSignals.filter((item) => !/(?:^|\/)(?:models|tpp-models)$/i.test(item.keyName || ''));
    const modelSignalFound = Boolean(
      menuButtonSignals.some((item) => item.bareGpt56SignalPresent || item.gpt56SignalPresent)
      || currentStateStorageSignals.some((item) => item.gpt56SignalPresent)
    );
    const thinkingSignalFound = Boolean(
      menuButtonSignals.some((item) => item.performance || item.thinkingEffort)
      || currentStateStorageSignals.some((item) => item.performance || item.thinkingEffort)
    );
    return {
      eligible: true,
      composerPresent: true,
      menuButtonSignals,
      storageSignals,
      modelSignalFound,
      thinkingSignalFound,
      authoritySignalFound: Boolean(modelSignalFound && thinkingSignalFound)
    };
  }

  function classifyAuthorityTag(element) {
    const tag = String(element?.tagName || '').toLowerCase();
    return ['button', 'span', 'div', 'label'].includes(tag) ? tag : 'other';
  }

  function collectDomAuthoritySignals(root, scope, output, seen) {
    if (!(root instanceof Element) || output.length >= MAX_PRE_PICKER_DOM_SIGNALS) return;
    const selectors = [
      '[data-model]', '[data-model-slug]', '[data-thinking-effort]', '[data-effort]', '[data-value]',
      '[data-testid*="model" i]', '[data-testid*="thinking" i]', '[data-testid*="intelligence" i]',
      '[aria-label]', '[title]', '[role="slider"]'
    ].join(',');
    const elements = [root, ...Array.from(root.querySelectorAll(selectors))];
    for (const element of elements) {
      if (!(element instanceof Element) || seen.has(element) || output.length >= MAX_PRE_PICKER_DOM_SIGNALS) continue;
      seen.add(element);
      const attributeNames = [];
      const signals = createRecognizedAuthoritySignals();
      const values = [];
      for (const name of ['data-model', 'data-model-slug', 'data-thinking-effort', 'data-effort', 'data-value', 'aria-label', 'title']) {
        if (!element.hasAttribute(name)) continue;
        const value = element.getAttribute(name);
        values.push(value);
        if (SEMANTIC_AUTHORITY_KEY_PATTERN.test(name) || mergeRecognizedAuthorityValue(createRecognizedAuthoritySignals(), value).gpt56SignalPresent) {
          attributeNames.push(name);
        }
      }
      const testidCategory = classifyDataTestid(element.getAttribute('data-testid'));
      if (testidCategory !== 'none' && testidCategory !== 'other') {
        attributeNames.push('data-testid');
        values.push(element.textContent || '');
      }
      const sliderValueRaw = Number(element.getAttribute('aria-valuenow'));
      const sliderValue = element.getAttribute('role') === 'slider'
        && Number.isInteger(sliderValueRaw)
        && sliderValueRaw >= 0
        && sliderValueRaw <= 12
        ? sliderValueRaw
        : null;
      for (const value of values) mergeRecognizedAuthorityValue(signals, value);
      if (!attributeNames.length && sliderValue == null && !signals.gpt56SignalPresent && !signals.workFamily && !signals.performance && !signals.thinkingEffort) continue;
      output.push({
        scope,
        tag: classifyAuthorityTag(element),
        dataTestidCategory: testidCategory,
        attributeNames: Array.from(new Set(attributeNames)).sort(),
        sliderValue,
        ...signals
      });
    }
  }

  function summarizeDormantPickerAuthority() {
    const pickers = Array.from(document.querySelectorAll(PICKER_SELECTOR));
    const sliderValues = [];
    let openPickerCount = 0;
    let sliderCount = 0;
    for (const picker of pickers) {
      const menu = picker.closest?.('[role="menu"]');
      const open = picker.isConnected && !picker.hidden && menu?.getAttribute?.('data-state') !== 'closed';
      if (open) openPickerCount += 1;
      const sliders = Array.from(picker.querySelectorAll(`${THINKING_SLIDER_HOST_SELECTOR} [role="slider"]`));
      sliderCount += sliders.length;
      for (const slider of sliders) {
        const raw = Number(slider.getAttribute('aria-valuenow'));
        if (Number.isInteger(raw) && raw >= 0 && raw <= 12 && sliderValues.length < 6) sliderValues.push(raw);
      }
    }
    return {
      pickerCount: pickers.length,
      openPickerCount,
      closedOrHiddenPickerCount: Math.max(0, pickers.length - openPickerCount),
      sliderCount,
      sliderValues: Array.from(new Set(sliderValues))
    };
  }

  function getWorkModelButton() {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    if (!(composer instanceof Element)) return null;
    const menuButtons = Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]'));
    return menuButtons.find((button) => Boolean(button.querySelector(WORK_TRIGGER_WRAPPER_SELECTOR)))
      || menuButtons.find((button) => button.matches(RICH_TRIGGER_SELECTOR))
      || findPotentialTrigger(composer)
      || (getActiveSurfaceMode() === 'work' && menuButtons.length === 1 ? menuButtons[0] : null);
  }

  function summarizeWorkPrePickerAuthority() {
    if (getActiveSurfaceMode() !== 'work') return null;
    const nativePickerOpen = Boolean(summarizeNativePickerAuthority());
    const modelButton = getWorkModelButton();
    const composer = document.querySelector(COMPOSER_SELECTOR);
    const domSignals = [];
    const seen = new Set();
    if (modelButton) collectDomAuthoritySignals(modelButton, 'model_button', domSignals, seen);
    if (composer) collectDomAuthoritySignals(composer, 'composer', domSignals, seen);
    if (composer?.parentElement) collectDomAuthoritySignals(composer.parentElement, 'composer_parent', domSignals, seen);
    if (document.body) collectDomAuthoritySignals(document.body, 'document', domSignals, seen);
    const dormantPicker = summarizeDormantPickerAuthority();
    const triggerDisplay = summarizeWorkTriggerDisplay(modelButton);
    const storageSignals = [
      ...summarizeSemanticStorageArea(localStorage, 'local'),
      ...summarizeSemanticStorageArea(sessionStorage, 'session')
    ].slice(0, MAX_PRE_PICKER_STORAGE_SIGNALS);
    const modelSignalFound = Boolean(
      triggerDisplay?.modelVersion === 'GPT-5.6'
      ||
      domSignals.some((item) => item.gpt56SignalPresent)
      || storageSignals.some((item) => item.gpt56SignalPresent)
    );
    const thinkingSignalFound = Boolean(
      triggerDisplay?.performance
      ||
      dormantPicker.sliderValues.length
      || domSignals.some((item) => item.thinkingEffort || item.performance || item.sliderValue != null)
      || storageSignals.some((item) => item.thinkingEffort || item.performance)
    );
    return {
      eligible: !nativePickerOpen,
      nativePickerOpen,
      modelButtonPresent: Boolean(modelButton),
      triggerDisplay,
      dormantPicker,
      domSignals,
      storageSignals,
      modelSignalFound,
      thinkingSignalFound,
      authoritySignalFound: Boolean(modelSignalFound && thinkingSignalFound)
    };
  }

  function summarizeWorkTriggerDisplay(modelButton) {
    if (!(modelButton instanceof Element)) return null;
    const wrapper = modelButton.querySelector(WORK_TRIGGER_WRAPPER_SELECTOR);
    const modelLabel = wrapper?.querySelector(WORK_TRIGGER_MODEL_LABEL_SELECTOR) || null;
    const effortLabel = wrapper?.querySelector(WORK_TRIGGER_EFFORT_LABEL_SELECTOR) || null;
    const modelText = normalizeText(modelLabel?.textContent);
    const effortText = normalizeText(effortLabel?.textContent);
    const explicit = modelText.match(MODEL_PATTERN);
    const compact = modelText.match(/\b(5\.6)\b/);
    const modelVersion = explicit?.[1]
      ? `GPT-${explicit[1]}`
      : compact?.[1]
        ? `GPT-${compact[1]}`
        : null;
    const workFamily = mergeRecognizedAuthorityValue(createRecognizedAuthoritySignals(), modelText).workFamily;
    const performance = sanitizePerformance(effortText);
    return {
      animatedSliderTriggerPresent: Boolean(wrapper),
      modelLabelPresent: Boolean(modelLabel),
      effortLabelPresent: Boolean(effortLabel),
      modelVersion,
      workFamily,
      performance,
      performanceSource: performance ? 'localized_display_text' : null
    };
  }

  function sanitizeCount(value, max = 10000) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? Math.min(number, max) : 0;
  }

  function sanitizeSemanticPaths(values, max = 24) {
    return Array.isArray(values)
      ? values.map((value) => sanitizeInternalIdentifier(value)).filter(Boolean).slice(0, max)
      : [];
  }

  function sanitizeRecognizedSignals(source) {
    const value = source && typeof source === 'object' ? source : {};
    return {
      gpt56SignalPresent: value.gpt56SignalPresent === true,
      workFamily: ['Sol', 'Terra', 'Luna'].includes(value.workFamily) ? value.workFamily : null,
      performance: sanitizePerformance(value.performance),
      thinkingEffort: sanitizeThinkingEffort(value.thinkingEffort)
    };
  }

  function sanitizeMainWorldAuthorityPayload(value) {
    const source = value && typeof value === 'object' ? value : {};
    const indexedDb = source.indexedDb && typeof source.indexedDb === 'object' ? source.indexedDb : {};
    const resources = source.resources && typeof source.resources === 'object' ? source.resources : {};
    const network = source.network && typeof source.network === 'object' ? source.network : {};
    const resourceCategories = resources.categories && typeof resources.categories === 'object' ? resources.categories : {};
    const globals = source.globals && typeof source.globals === 'object' ? source.globals : {};
    const react = source.react && typeof source.react === 'object' ? source.react : {};
    const modelButton = source.modelButton && typeof source.modelButton === 'object' ? source.modelButton : {};
    const validShape = new Set(['array', 'null', 'object', 'string', 'number', 'boolean', 'other']);
    const validCategory = new Set(['model', 'thinking', 'intelligence', 'settings', 'state', 'cache', 'chat', 'other']);
    return {
      phase: sanitizeInternalIdentifier(source.phase),
      activeSurfaceMode: source.activeSurfaceMode === 'work' || source.activeSurfaceMode === 'chatgpt' ? source.activeSurfaceMode : null,
      modelButton: {
        present: modelButton.present === true,
        ariaExpanded: sanitizeBooleanAttribute(modelButton.ariaExpanded),
        dataState: sanitizeDataState(modelButton.dataState),
        ariaControlsPresent: modelButton.ariaControlsPresent === true,
        controlledElementPresent: modelButton.controlledElementPresent === true
      },
      react: {
        inspectedDomNodeCount: sanitizeCount(react.inspectedDomNodeCount, 12),
        reactOwnerCount: sanitizeCount(react.reactOwnerCount, 12),
        semanticPaths: sanitizeSemanticPaths(react.semanticPaths),
        triggerDescendants: {
          inspectedDomNodeCount: sanitizeCount(react.triggerDescendants?.inspectedDomNodeCount, 12),
          reactOwnerCount: sanitizeCount(react.triggerDescendants?.reactOwnerCount, 12),
          semanticPaths: sanitizeSemanticPaths(react.triggerDescendants?.semanticPaths),
          effortReactPropNames: sanitizeSemanticPaths(react.triggerDescendants?.effortReactPropNames, 12),
          effortDomAttributeNames: sanitizeSemanticPaths(react.triggerDescendants?.effortDomAttributeNames, 12),
          dataMaxEffort: (() => {
            const raw = react.triggerDescendants?.dataMaxEffort;
            if (!raw || typeof raw !== 'object') return null;
            const type = ['boolean', 'number', 'string', 'null', 'other'].includes(raw.valueType) ? raw.valueType : 'other';
            return {
              valueType: type,
              booleanValue: type === 'boolean' && typeof raw.booleanValue === 'boolean' ? raw.booleanValue : null,
              numberValue: type === 'number' && Number.isFinite(raw.numberValue) && Math.abs(raw.numberValue) <= 1000
                ? raw.numberValue
                : null,
              identifierValue: type === 'string' ? sanitizeInternalIdentifier(raw.identifierValue) : null
            };
          })(),
          ...sanitizeRecognizedSignals(react.triggerDescendants)
        },
        ...sanitizeRecognizedSignals(react)
      },
      historyState: {
        semanticPaths: sanitizeSemanticPaths(source.historyState?.semanticPaths),
        ...sanitizeRecognizedSignals(source.historyState)
      },
      navigationState: {
        semanticPaths: sanitizeSemanticPaths(source.navigationState?.semanticPaths),
        ...sanitizeRecognizedSignals(source.navigationState)
      },
      globals: {
        scannedCount: sanitizeCount(globals.scannedCount, 256),
        matches: Array.isArray(globals.matches) ? globals.matches.slice(0, 16).map((item) => ({
          name: sanitizeInternalIdentifier(item?.name),
          valueShape: validShape.has(item?.valueShape) ? item.valueShape : 'other',
          semanticPaths: sanitizeSemanticPaths(item?.semanticPaths),
          ...sanitizeRecognizedSignals(item)
        })).filter((item) => item.name) : []
      },
      indexedDb: {
        supported: indexedDb.supported === true,
        requested: indexedDb.requested === true,
        databaseCount: indexedDb.databaseCount == null ? null : sanitizeCount(indexedDb.databaseCount, 128),
        scannedDatabaseCount: sanitizeCount(indexedDb.scannedDatabaseCount, 8),
        scannedStoreCount: sanitizeCount(indexedDb.scannedStoreCount, 24),
        recordSamplesScanned: sanitizeCount(indexedDb.recordSamplesScanned, 512),
        semanticRecords: Array.isArray(indexedDb.semanticRecords) ? indexedDb.semanticRecords.slice(0, 16).map((item) => ({
          databaseCategory: validCategory.has(item?.databaseCategory) ? item.databaseCategory : 'other',
          storeCategory: validCategory.has(item?.storeCategory) ? item.storeCategory : 'other',
          valueShape: validShape.has(item?.valueShape) ? item.valueShape : 'other',
          semanticPaths: sanitizeSemanticPaths(item?.semanticPaths),
          ...sanitizeRecognizedSignals(item)
        })) : []
      },
      resources: {
        matchedCount: sanitizeCount(resources.matchedCount, 256),
        categories: {
          model: sanitizeCount(resourceCategories.model, 256),
          settings: sanitizeCount(resourceCategories.settings, 256),
          conversation: sanitizeCount(resourceCategories.conversation, 256),
          tpp: sanitizeCount(resourceCategories.tpp, 256),
          work: sanitizeCount(resourceCategories.work, 256),
          backendApi: sanitizeCount(resourceCategories.backendApi, 256)
        }
      },
      network: {
        captureWindowMs: sanitizeCount(network.captureWindowMs, 10000),
        responsesInspected: sanitizeCount(network.responsesInspected, 64),
        semanticResponses: Array.isArray(network.semanticResponses) ? network.semanticResponses.slice(0, 12).map((item) => ({
          statusClass: ['2xx', '4xx_or_5xx', 'other'].includes(item?.statusClass) ? item.statusClass : 'other',
          resourceCategories: Array.isArray(item?.resourceCategories)
            ? item.resourceCategories.filter((category) => ['model', 'settings', 'conversation', 'tpp', 'work', 'backendApi'].includes(category)).slice(0, 6)
            : [],
          semanticPaths: sanitizeSemanticPaths(item?.semanticPaths),
          ...sanitizeRecognizedSignals(item)
        })) : []
      }
    };
  }

  function requestMainWorldAuthoritySurvey(phase, includeIndexedDb = false) {
    const requestId = `model-main-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        const pending = pendingMainSurveyRequests.get(requestId);
        if (!pending) return;
        pendingMainSurveyRequests.delete(requestId);
        resolve(null);
      }, MAIN_SURVEY_TIMEOUT_MS);
      pendingMainSurveyRequests.set(requestId, {
        phase: sanitizeInternalIdentifier(phase),
        routeGeneration,
        includeIndexedDb: includeIndexedDb === true,
        timeoutId,
        resolve
      });
      while (pendingMainSurveyRequests.size > MAX_PENDING_MAIN_SURVEYS) {
        const oldestId = pendingMainSurveyRequests.keys().next().value;
        const oldest = pendingMainSurveyRequests.get(oldestId);
        if (oldest?.timeoutId) clearTimeout(oldest.timeoutId);
        oldest?.resolve?.(null);
        pendingMainSurveyRequests.delete(oldestId);
      }
      window.postMessage({
        source: SOURCE,
        type: MAIN_SURVEY_REQUEST,
        requestId,
        phase: sanitizeInternalIdentifier(phase),
        includeIndexedDb: includeIndexedDb === true
      }, '*');
    });
  }

  function getCurrentConversationToken() {
    const match = String(location.pathname || '').match(/^\/c\/([^/]+)/i);
    return match?.[1] || null;
  }

  function summarizeConversationMatch(value) {
    const current = getCurrentConversationToken();
    const supplied = normalizeText(value);
    return {
      suppliedConversationPresent: Boolean(supplied),
      currentRouteConversationPresent: Boolean(current),
      suppliedConversationMatchesCurrentRoute: current && supplied ? current === supplied : null
    };
  }

  function summarizeModelConfig(config) {
    const candidate = config && typeof config === 'object' ? config : null;
    const modelSlug = normalizeText(candidate?.modelSlug || candidate?.model_slug || '');
    const thinkingEffort = normalizeText(candidate?.thinkingEffort || candidate?.thinking_effort || '');
    const conversationMatch = summarizeConversationMatch(candidate?.conversationId);
    const isGpt56 = isGpt56ModelSlug(modelSlug);
    return {
      configPresent: Boolean(candidate),
      ...conversationMatch,
      modelSlugPresent: Boolean(modelSlug),
      modelVersion: sanitizeModelVersion(modelSlug),
      thinkingEffortPresent: Boolean(thinkingEffort),
      isGpt56,
      slugStructure: classifyModelSlugStructure(modelSlug),
      shouldDecorate: Boolean(
        candidate
        && conversationMatch.suppliedConversationMatchesCurrentRoute === true
        && isGpt56
        && thinkingEffort
      )
    };
  }

  function copySupplyDiagnostics() {
    return {
      currentConfigEventCount: supplyDiagnostics.currentConfigEventCount,
      syncRequestCount: supplyDiagnostics.syncRequestCount,
      syncResponseCount: supplyDiagnostics.syncResponseCount,
      internalSnapshotCount: supplyDiagnostics.internalSnapshotCount,
      lastCurrentConfigEvent: supplyDiagnostics.lastCurrentConfigEvent,
      lastSyncRequest: supplyDiagnostics.lastSyncRequest,
      lastSyncResponse: supplyDiagnostics.lastSyncResponse,
      lastInternalSnapshot: supplyDiagnostics.lastInternalSnapshot,
      lastTransitionInternalSnapshot: supplyDiagnostics.lastTransitionInternalSnapshot
    };
  }

  function sanitizeInternalIdentifier(value) {
    const normalized = normalizeText(value);
    return /^[a-z0-9_.:-]{1,96}$/i.test(normalized) ? normalized : null;
  }

  function sanitizeNavigationResetRecord(value) {
    const source = value && typeof value === 'object' ? value : {};
    const conditions = source.conditions && typeof source.conditions === 'object' ? source.conditions : {};
    const decision = source.decision === 'preserve' || source.decision === 'clear' ? source.decision : null;
    const activeSurfaceModeAtReset = source.activeSurfaceModeAtReset === 'chatgpt' || source.activeSurfaceModeAtReset === 'work'
      ? source.activeSurfaceModeAtReset
      : null;
    return {
      sequence: sanitizeCount(source.sequence, 1000000),
      reason: sanitizeInternalIdentifier(source.reason),
      previousContextKind: sanitizeInternalIdentifier(source.previousContextKind),
      nextContextKind: sanitizeInternalIdentifier(source.nextContextKind),
      contextKeyChanged: source.contextKeyChanged === true,
      statePresentBefore: source.statePresentBefore === true,
      stateModelVersionBefore: sanitizeModelVersion(source.stateModelVersionBefore),
      activeSurfaceModeAtReset,
      conditions: {
        sameContext: conditions.sameContext === true,
        normalNewChatPromotion: conditions.normalNewChatPromotion === true,
        gptSurfaceChatPromotion: conditions.gptSurfaceChatPromotion === true,
        workNewChatCarry: conditions.workNewChatCarry === true,
        confirmedDecoration: conditions.confirmedDecoration === true,
        crossingChatToWork: conditions.crossingChatToWork === true
      },
      decision,
      decisionReason: sanitizeInternalIdentifier(source.decisionReason),
      statePresentAfter: source.statePresentAfter === true,
      stateContextKindAfter: sanitizeInternalIdentifier(source.stateContextKindAfter)
    };
  }

  function sanitizeStateMutation(value) {
    const source = value && typeof value === 'object' ? value : {};
    const kind = ['set', 'replace', 'clear'].includes(source.kind) ? source.kind : null;
    if (!kind) return null;
    return {
      sequence: sanitizeCount(source.sequence, 1000000),
      kind,
      reason: sanitizeInternalIdentifier(source.reason),
      sourceReason: sanitizeInternalIdentifier(source.sourceReason),
      currentContextKind: sanitizeInternalIdentifier(source.currentContextKind),
      previousContextKind: sanitizeInternalIdentifier(source.previousContextKind),
      nextContextKind: sanitizeInternalIdentifier(source.nextContextKind),
      previousModelVersion: sanitizeModelVersion(source.previousModelVersion),
      nextModelVersion: sanitizeModelVersion(source.nextModelVersion)
    };
  }

  function sanitizeInternalSnapshot(value) {
    const source = value && typeof value === 'object' ? value : {};
    const activeSurfaceMode = source.activeSurfaceMode === 'chatgpt' || source.activeSurfaceMode === 'work'
      ? source.activeSurfaceMode
      : null;
    return {
      apiPresent: source.apiPresent === true,
      snapshotAvailable: source.snapshotAvailable === true,
      activeSurfaceModePresent: source.activeSurfaceModePresent === true,
      activeSurfaceMode,
      newChatModelConfigPresent: source.newChatModelConfigPresent === true,
      newChatStateCandidateFound: source.newChatStateCandidateFound === true,
      resolvedContextKind: sanitizeInternalIdentifier(source.resolvedContextKind),
      resolvedExplicitNonGpt56: source.resolvedExplicitNonGpt56 === true,
      currentContextKind: sanitizeInternalIdentifier(source.currentContextKind),
      currentStateContextKind: sanitizeInternalIdentifier(source.currentStateContextKind),
      currentStateContextMatchesCurrent: source.currentStateContextMatchesCurrent === true,
      conversationStatePresent: source.conversationStatePresent === true,
      conversationContextMatchesCurrent: source.conversationContextMatchesCurrent === true,
      confirmedComposerStatePresent: source.confirmedComposerStatePresent === true,
      confirmedComposerContextMatchesCurrent: source.confirmedComposerContextMatchesCurrent === true,
      navigationCarryStatePresent: source.navigationCarryStatePresent === true,
      navigationCarryContextMatchesCurrent: source.navigationCarryContextMatchesCurrent === true,
      lastNavigationResetPresent: source.lastNavigationResetPresent === true,
      lastNavigationResetPreserved: source.lastNavigationResetPreserved === true,
      navigationResetHistory: Array.isArray(source.navigationResetHistory)
        ? source.navigationResetHistory.slice(-4).map(sanitizeNavigationResetRecord)
        : [],
      lastStateMutation: sanitizeStateMutation(source.lastStateMutation),
      triggerFound: source.triggerFound === true,
      currentStatePresent: source.currentStatePresent === true,
      modelSource: sanitizeInternalIdentifier(source.modelSource),
      thinkingEffort: sanitizeThinkingEffort(source.thinkingEffort),
      performance: sanitizePerformance(source.performance),
      triggerApplied: source.triggerApplied === true,
      currentTriggerInComposer: source.currentTriggerInComposer === true,
      scanReason: sanitizeInternalIdentifier(source.scanReason),
      scanOutcome: sanitizeInternalIdentifier(source.scanOutcome)
    };
  }

  function requestArcaiaInternalSnapshot(reason = 'unspecified') {
    const requestId = `model-internal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const request = {
      requestedAtIso: new Date().toISOString(),
      reason: sanitizeInternalIdentifier(reason),
      routeKind: classifyRoute(),
      routeGeneration,
      surfaceGeneration
    };
    pendingInternalProbeRequests.set(requestId, request);
    while (pendingInternalProbeRequests.size > MAX_PENDING_INTERNAL_PROBE_REQUESTS) {
      pendingInternalProbeRequests.delete(pendingInternalProbeRequests.keys().next().value);
    }
    window.postMessage({ source: SOURCE, type: INTERNAL_PROBE_REQUEST, requestId }, '*');
  }

  function requestArcaiaInternalSnapshotAfterRender(reason) {
    const run = () => requestArcaiaInternalSnapshot(reason);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else queueMicrotask(run);
  }

  function updateRouteGeneration() {
    const pathname = String(location.pathname || '');
    if (pathname === lastPathname) return false;
    lastPathname = pathname;
    routeGeneration += 1;
    return true;
  }

  function updateSurfaceGeneration() {
    const surface = getActiveSurfaceMode();
    if (!surface) return false;
    if (!lastSurfaceMode) {
      lastSurfaceMode = surface;
      return false;
    }
    if (surface === lastSurfaceMode) return false;
    lastSurfaceMode = surface;
    surfaceGeneration += 1;
    cancelColdStartGrace();
    return true;
  }

  function extractExplicitModelVersion(element) {
    if (!(element instanceof Element)) return null;
    const values = [
      element.textContent,
      element.getAttribute('aria-label'),
      element.getAttribute('title')
    ];
    for (const value of values) {
      const match = normalizeText(value).match(MODEL_PATTERN);
      if (match?.[1]) return `GPT-${match[1]}`;
    }
    return null;
  }

  function findKnownPerformanceLabel(element) {
    if (!(element instanceof Element)) return null;
    const values = [
      normalizeText(element.textContent),
      normalizeText(element.getAttribute('aria-label')),
      normalizeText(element.getAttribute('title'))
    ];
    for (const value of values) {
      for (const label of PERFORMANCE_LABELS) {
        if (value === label || value.startsWith(`${label} `) || value.endsWith(` ${label}`)) return label;
      }
    }
    return null;
  }

  function sanitizeModelVersion(value) {
    const match = normalizeText(value).match(MODEL_PATTERN);
    return match?.[1] ? `GPT-${match[1]}` : null;
  }

  function isGpt56ModelSlug(value) {
    return /(?:^|[-_])gpt[-_]?5(?:[-_.]?6)(?:[-_]|$)/i.test(normalizeText(value));
  }

  function classifyModelSlugStructure(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
      return {
        slugLength: 0,
        tokenCount: 0,
        separatorPattern: 'none',
        gpt5Present: false,
        version6Present: false,
        thinkingAlias: false,
        knownFamily: 'none'
      };
    }

    const separators = new Set();
    if (normalized.includes('-')) separators.add('hyphen');
    if (normalized.includes('_')) separators.add('underscore');
    if (normalized.includes('.')) separators.add('dot');
    const separatorPattern = separators.size === 0
      ? 'none'
      : separators.size === 1
        ? Array.from(separators)[0]
        : 'mixed';
    const tokens = normalized.split(/[-_.]+/).filter(Boolean);
    const gpt5Present = /(?:^|[-_.])gpt(?:[-_.]?5)(?:[-_.]|$)/i.test(normalized);
    const version6Present = tokens.includes('6') || /(?:^|[-_.])5(?:[-_.]?6)(?:[-_.]|$)/i.test(normalized);
    const thinkingAlias = tokens.includes('thinking');
    const hasSol = tokens.includes('sol');
    const hasLuna = tokens.includes('luna');
    const hasTerra = tokens.includes('terra');
    const knownFamily = isGpt56ModelSlug(normalized)
      ? 'explicit_gpt56'
      : gpt5Present && thinkingAlias
        ? 'gpt5_thinking_alias'
        : gpt5Present && hasSol
          ? 'gpt5_sol_alias'
          : gpt5Present && hasLuna
            ? 'gpt5_luna_alias'
            : gpt5Present && hasTerra
              ? 'gpt5_terra_alias'
              : gpt5Present
                ? 'gpt5_generic'
                : 'other';

    return {
      slugLength: Math.min(normalized.length, 160),
      tokenCount: Math.min(tokens.length, 24),
      separatorPattern,
      gpt5Present,
      version6Present,
      thinkingAlias,
      knownFamily
    };
  }

  function sanitizePerformance(value) {
    const normalized = normalizeText(value);
    return PERFORMANCE_LABELS.has(normalized) ? normalized : null;
  }

  function sanitizeWorkFamily(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'sol') return 'Sol';
    if (normalized === 'terra') return 'Terra';
    if (normalized === 'luna') return 'Luna';
    return null;
  }

  function describePickerModelCandidate(item) {
    if (!(item instanceof Element)) return null;
    const explicitModelVersion = extractExplicitModelVersion(item);
    const workFamily = sanitizeWorkFamily(item.textContent || '');
    if (!explicitModelVersion && !workFamily) return null;
    return {
      explicitModelVersion,
      workFamily,
      ariaExpanded: sanitizeBooleanAttribute(item.getAttribute('aria-expanded')),
      dataState: sanitizeDataState(item.getAttribute('data-state')),
      hasSubmenu: item.hasAttribute('data-has-submenu')
    };
  }

  function summarizeNativePickerAuthority() {
    const picker = Array.from(document.querySelectorAll(PICKER_SELECTOR)).find((item) => {
      const menu = item.closest?.('[role="menu"]');
      return item.isConnected && !item.hidden && menu?.getAttribute?.('data-state') !== 'closed';
    }) || null;
    if (!picker) return null;

    const menu = picker.closest?.('[role="menu"][aria-labelledby]') || null;
    const labelledBy = menu?.getAttribute?.('aria-labelledby');
    const trigger = labelledBy ? document.getElementById(labelledBy) : null;
    const checked = picker.querySelector('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]');
    const slider = picker.querySelector(`${THINKING_SLIDER_HOST_SELECTOR} [role="slider"]`);
    const rawSliderValue = Number(slider?.getAttribute?.('aria-valuenow'));
    const sliderValue = Number.isInteger(rawSliderValue) && rawSliderValue >= 0 && rawSliderValue <= 12
      ? rawSliderValue
      : null;
    const modelCandidates = Array.from(picker.querySelectorAll('[role="menuitem"]'))
      .map(describePickerModelCandidate)
      .filter(Boolean)
      .slice(0, MAX_PICKER_MODEL_CANDIDATES);
    const selectedModelCandidate = modelCandidates.find((candidate) => (
      candidate.ariaExpanded === 'true'
      || candidate.dataState === 'open'
      || candidate.hasSubmenu
    )) || modelCandidates[0] || null;

    return {
      surfaceMode: getActiveSurfaceMode(),
      triggerLinkedToComposer: Boolean(trigger instanceof HTMLButtonElement && trigger.closest?.(COMPOSER_SELECTOR)),
      checkedItemPresent: Boolean(checked),
      checkedExplicitModelVersion: extractExplicitModelVersion(checked),
      checkedKnownPerformanceLabel: findKnownPerformanceLabel(checked),
      sliderPresent: Boolean(slider),
      sliderValue,
      modelCandidates,
      selectedModelCandidate
    };
  }

  function afterTwoRenderFrames(run) {
    if (typeof requestAnimationFrame !== 'function') {
      queueMicrotask(run);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  function captureSurfaceTransitionAfterRender(fromSurface, targetSurface) {
    afterTwoRenderFrames(() => {
      const settledSurface = getActiveSurfaceMode();
      updateSurfaceGeneration();
      emit('surface_control_transition_observed', {
        fromSurface,
        targetSurface,
        settledSurface,
        snapshot: buildSnapshot('surface_control_transition_observed')
      });
      requestArcaiaInternalSnapshot('surface_control_transition_observed');
      captureWorkPrePickerAuthority('render_settled');
    });
  }

  function captureWorkPrePickerAuthority(phase) {
    if (getActiveSurfaceMode() !== 'work' || summarizeNativePickerAuthority()) return;
    emit('work_pre_picker_authority_observed', {
      phase,
      snapshot: buildSnapshot(`work_pre_picker_authority_${phase}`)
    });
    requestMainWorldAuthoritySurvey(phase, false);
  }

  function captureNativePickerAuthorityAfterRender() {
    afterTwoRenderFrames(() => {
      if (summarizeNativePickerAuthority()) {
        emit('native_picker_authority_observed', {
          reason: 'native_picker_authority_after_click',
          snapshot: buildSnapshot('native_picker_authority_after_click')
        });
        return;
      }
      setTimeout(() => emit('native_picker_authority_observed', {
        reason: 'native_picker_authority_delayed',
        snapshot: buildSnapshot('native_picker_authority_delayed')
      }), 160);
    });
  }

  function isPickerOpen(trigger) {
    return trigger?.getAttribute?.('aria-expanded') === 'true'
      || trigger?.getAttribute?.('data-state') === 'open';
  }

  function describeTrigger(trigger) {
    if (!(trigger instanceof HTMLButtonElement)) return null;
    return {
      connected: Boolean(trigger.isConnected),
      inComposer: Boolean(trigger.closest?.(COMPOSER_SELECTOR)),
      richApplied: trigger.getAttribute('data-arcaia-model-rich') === 'true',
      richContentPresent: Boolean(trigger.querySelector(RICH_CONTENT_SELECTOR)),
      nativeLabelMarked: Boolean(trigger.querySelector(NATIVE_LABEL_SELECTOR)),
      modelVersion: sanitizeModelVersion(trigger.getAttribute('data-arcaia-model-version')),
      performance: sanitizePerformance(trigger.getAttribute('data-arcaia-model-performance')),
      explicitModelVersion: extractExplicitModelVersion(trigger),
      knownPerformanceLabel: findKnownPerformanceLabel(trigger),
      pickerOpen: isPickerOpen(trigger),
      stylePresent: Boolean(document.querySelector(MODEL_STYLE_SELECTOR)),
      childElementCount: trigger.children?.length || 0,
      richContentChildCount: trigger.querySelector(RICH_CONTENT_SELECTOR)?.children?.length || 0
    };
  }

  function findNativePerformanceLabel(trigger) {
    if (!(trigger instanceof HTMLButtonElement)) return null;
    const picker = summarizeNativePickerAuthority();
    if (picker?.triggerLinkedToComposer && picker.checkedKnownPerformanceLabel) {
      return picker.checkedKnownPerformanceLabel;
    }
    const nativeLabel = trigger.querySelector(NATIVE_LABEL_SELECTOR);
    const preserved = findKnownPerformanceLabel(nativeLabel);
    if (preserved) return preserved;
    if (trigger.getAttribute('data-arcaia-model-rich') !== 'true') return findKnownPerformanceLabel(trigger);
    return null;
  }

  function buildModelDisplayState(trigger, expectedDecoration = false) {
    const description = describeTrigger(trigger);
    const nativePerformance = findNativePerformanceLabel(trigger);
    const arcaiaPerformance = description?.performance || null;
    const decoration = description?.richApplied && description.richContentPresent && description.stylePresent
      ? 'applied'
      : 'missing';
    let comparison = 'unknown';
    if (decoration === 'applied' && nativePerformance && arcaiaPerformance) {
      comparison = nativePerformance === arcaiaPerformance ? 'match' : 'performance_mismatch';
    } else if (expectedDecoration && decoration !== 'applied') {
      comparison = 'missing_decoration';
    }
    return {
      native: {
        performance: nativePerformance,
        source: pickerSelectedPerformancePresent() ? 'selected_picker' : nativePerformance ? 'native_trigger' : null
      },
      arcaia: {
        modelVersion: description?.modelVersion || null,
        performance: arcaiaPerformance
      },
      decoration,
      comparison
    };
  }

  function pickerSelectedPerformancePresent() {
    return Boolean(summarizeNativePickerAuthority()?.checkedKnownPerformanceLabel);
  }

  function detectWrongDecorationValue(trigger, reason) {
    const displayState = buildModelDisplayState(trigger, false);
    if (displayState.comparison !== 'performance_mismatch') return false;
    markIncident('wrong_decoration_value', reason, trigger);
    return true;
  }

  function sanitizeAriaHaspopup(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return 'none';
    return ['menu', 'listbox', 'dialog', 'tree', 'grid'].includes(normalized) ? normalized : 'other';
  }

  function sanitizeBooleanAttribute(value) {
    const normalized = normalizeText(value).toLowerCase();
    return normalized === 'true' || normalized === 'false' ? normalized : null;
  }

  function sanitizeDataState(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return null;
    return ['open', 'closed', 'on', 'off', 'checked', 'unchecked'].includes(normalized) ? normalized : 'other';
  }

  function classifyDataTestid(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return 'none';
    if (normalized.includes('model')) return 'model';
    if (normalized.includes('thinking')) return 'thinking';
    if (normalized.includes('intelligence')) return 'intelligence';
    return 'other';
  }

  function structuralHints(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return [];
    return STRUCTURAL_HINTS.filter((hint) => normalized.includes(hint));
  }

  function summarizeWrapper(element) {
    if (!(element instanceof Element)) return null;
    return {
      tag: element.tagName.toLowerCase(),
      role: normalizeText(element.getAttribute('role')).toLowerCase() || null,
      dataTestidCategory: classifyDataTestid(element.getAttribute('data-testid')),
      dataTestidHints: structuralHints(element.getAttribute('data-testid')),
      knownPerformanceLabel: findKnownPerformanceLabel(element),
      explicitModelVersion: extractExplicitModelVersion(element),
      childElementCount: element.children?.length || 0,
      menuButtonCount: element.querySelectorAll?.('button[aria-haspopup="menu"]').length || 0
    };
  }

  function describeButtonProfile(button, buttonOrder = null, menuOrder = null) {
    if (!(button instanceof HTMLButtonElement)) return null;
    return {
      buttonOrder,
      menuOrder,
      ariaHaspopup: sanitizeAriaHaspopup(button.getAttribute('aria-haspopup')),
      ariaExpanded: sanitizeBooleanAttribute(button.getAttribute('aria-expanded')),
      ariaControlsPresent: Boolean(normalizeText(button.getAttribute('aria-controls'))),
      ariaLabelPresent: Boolean(normalizeText(button.getAttribute('aria-label'))),
      ariaLabelHints: structuralHints(button.getAttribute('aria-label')),
      titlePresent: Boolean(normalizeText(button.getAttribute('title'))),
      titleHints: structuralHints(button.getAttribute('title')),
      dataState: sanitizeDataState(button.getAttribute('data-state')),
      explicitModelVersion: extractExplicitModelVersion(button),
      knownPerformanceLabel: findKnownPerformanceLabel(button),
      dataTestidCategory: classifyDataTestid(button.getAttribute('data-testid')),
      dataTestidHints: structuralHints(button.getAttribute('data-testid')),
      richApplied: button.getAttribute('data-arcaia-model-rich') === 'true',
      childElementCount: button.children?.length || 0,
      directChildTags: Array.from(button.children || []).slice(0, 6).map((child) => child.tagName.toLowerCase()),
      hasSvgChild: Boolean(button.querySelector?.('svg')),
      parent: summarizeWrapper(button.parentElement),
      grandparent: summarizeWrapper(button.parentElement?.parentElement)
    };
  }

  function isRenderedComposer(composer) {
    if (!(composer instanceof Element)) return false;
    const style = getComputedStyle(composer);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = composer.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function summarizeComposer(composer, selectedComposer) {
    if (!(composer instanceof Element)) return null;
    const buttons = Array.from(composer.querySelectorAll('button'));
    const menuButtons = buttons.filter((button) => button.getAttribute('aria-haspopup') === 'menu');
    return {
      connected: Boolean(composer.isConnected),
      selectedByQuery: composer === selectedComposer,
      observed: composer === observedComposer,
      rendered: isRenderedComposer(composer),
      buttonCount: buttons.length,
      menuButtonCount: menuButtons.length,
      potentialTriggerCount: findPotentialTriggers(composer).length,
      decoratedTriggerCount: composer.querySelectorAll(RICH_TRIGGER_SELECTOR).length,
      buttonProfiles: buttons.slice(0, MAX_BUTTON_PROFILES_PER_COMPOSER).map((button, buttonOrder) => (
        describeButtonProfile(button, buttonOrder, menuButtons.indexOf(button))
      )).filter(Boolean)
    };
  }

  function findPotentialTriggers(composer = observedComposer) {
    if (!(composer instanceof Element)) return [];
    return Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]')).filter((button) => (
      Boolean(button.querySelector(WORK_TRIGGER_WRAPPER_SELECTOR))
      || button.matches(RICH_TRIGGER_SELECTOR)
      || Boolean(extractExplicitModelVersion(button))
      || Boolean(findKnownPerformanceLabel(button))
      || /model|thinking|intelligence/i.test(String(button.getAttribute('data-testid') || ''))
    ));
  }

  function findDecoratedTrigger(composer = observedComposer) {
    return composer?.querySelector?.(RICH_TRIGGER_SELECTOR) || null;
  }

  function findPotentialTrigger(composer = observedComposer) {
    const candidates = findPotentialTriggers(composer);
    return candidates.find((button) => Boolean(button.querySelector(WORK_TRIGGER_WRAPPER_SELECTOR)))
      || candidates.find((button) => button.matches(RICH_TRIGGER_SELECTOR))
      || candidates.find((button) => Boolean(extractExplicitModelVersion(button)))
      || candidates.find((button) => Boolean(findKnownPerformanceLabel(button)))
      || candidates[0]
      || null;
  }

  function baselineSummary() {
    if (!baseline) return null;
    return {
      triggerSequence: baseline.triggerSequence,
      routeGeneration: baseline.routeGeneration,
      routeKind: baseline.routeKind,
      surfaceGeneration: baseline.surfaceGeneration,
      surfaceMode: baseline.surfaceMode,
      modelVersion: baseline.modelVersion,
      performance: baseline.performance,
      armedAtIso: baseline.armedAtIso,
      triggerConnected: Boolean(baseline.trigger?.isConnected)
    };
  }

  function buildSnapshot(reason) {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    const composers = Array.from(document.querySelectorAll(COMPOSER_SELECTOR));
    const decorated = findDecoratedTrigger(composer);
    const candidate = decorated || findPotentialTrigger(composer);
    const includeWorkPrePickerAuthority = /^work_pre_picker_authority_/.test(reason)
      || reason === 'toolbar_manual_capture'
      || reason === 'get_live_status';
    const includeConversationColdStartAuthority = classifyRoute() === 'conversation'
      && (
        reason === 'toolbar_manual_capture'
        || reason === 'get_live_status'
        || reason === 'cold_start_timeout'
        || reason === 'cold_start_grace_expired'
      );
    return {
      reason,
      capturedAtIso: new Date().toISOString(),
      readyState: document.readyState,
      routeKind: classifyRoute(),
      routeGeneration,
      surfaceGeneration,
      activeSurfaceMode: getActiveSurfaceMode(),
      documentVisible: document.visibilityState === 'visible',
      composerPresent: Boolean(composer),
      composerConnected: Boolean(composer?.isConnected),
      composerCount: composers.length,
      observedComposerIsSelected: Boolean(observedComposer && observedComposer === composer),
      composers: composers.slice(0, MAX_COMPOSER_SUMMARIES).map((item) => summarizeComposer(item, composer)).filter(Boolean),
      potentialTriggerCount: findPotentialTriggers(composer).length,
      decoratedTriggerCount: composer?.querySelectorAll?.(RICH_TRIGGER_SELECTOR).length || 0,
      stylePresent: Boolean(document.querySelector(MODEL_STYLE_SELECTOR)),
      workAuthorityStorage: summarizeWorkAuthorityStorage(),
      nativePickerAuthority: summarizeNativePickerAuthority(),
      workPrePickerAuthority: includeWorkPrePickerAuthority ? summarizeWorkPrePickerAuthority() : null,
      conversationColdStartAuthority: includeConversationColdStartAuthority
        ? summarizeConversationColdStartAuthority()
        : null,
      mainWorldAuthority: lastMainWorldAuthority,
      baseline: baselineSummary(),
      incidentActive,
      candidate: describeTrigger(candidate),
      displayState: buildModelDisplayState(candidate, Boolean(baseline)),
      supplyDiagnostics: copySupplyDiagnostics(),
      observers: {
        composerBound: Boolean(observedComposer?.isConnected && composerObserver),
        triggerBound: Boolean(observedTrigger?.isConnected && triggerObserver),
        headBound: Boolean(headObserver),
        bootstrapActive: Boolean(bootstrapObserver)
      }
    };
  }

  function emit(type, details = {}) {
    const event = {
      sessionId,
      sequence: ++eventSequence,
      type,
      atIso: new Date().toISOString(),
      routeKind: classifyRoute(),
      routeGeneration,
      surfaceGeneration,
      ...details
    };
    recentEvents.push(event);
    if (recentEvents.length > MAX_LOCAL_EVENTS) {
      recentEvents.splice(0, recentEvents.length - MAX_LOCAL_EVENTS);
    }
    try {
      chrome.runtime.sendMessage({ source: SOURCE, type: 'PROBE_EVENT', event });
    } catch {}
    return event;
  }

  function disconnectObserver(observer) {
    try { observer?.disconnect?.(); } catch {}
  }

  function stopBootstrap() {
    disconnectObserver(bootstrapObserver);
    bootstrapObserver = null;
    if (bootstrapTimer) clearTimeout(bootstrapTimer);
    bootstrapTimer = null;
  }

  function nodeContainsComposer(node) {
    if (!(node instanceof Element)) return false;
    return node.matches(COMPOSER_SELECTOR) || Boolean(node.querySelector?.(COMPOSER_SELECTOR));
  }

  function startBootstrap(reason = 'composer_missing') {
    if (bootstrapObserver || document.querySelector(COMPOSER_SELECTOR)) return;
    const target = document.documentElement;
    if (!target) return;
    bootstrapObserver = new MutationObserver((mutations) => {
      const composerAdded = mutations.some((mutation) => (
        Array.from(mutation.addedNodes || []).some(nodeContainsComposer)
      ));
      if (!composerAdded && !document.querySelector(COMPOSER_SELECTOR)) return;
      stopBootstrap();
      queueEvaluate('bootstrap_composer_added');
    });
    bootstrapObserver.observe(target, { childList: true, subtree: true });
    bootstrapTimer = setTimeout(() => {
      stopBootstrap();
      emit('bootstrap_timeout', { reason, snapshot: buildSnapshot('bootstrap_timeout') });
    }, BOOTSTRAP_DURATION_MS);
  }

  function bindHeadObserver() {
    if (headObserver || !document.head) return;
    headObserver = new MutationObserver((mutations) => {
      const styleChanged = mutations.some((mutation) => {
        const nodes = [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])];
        return nodes.some((node) => (
          node instanceof Element
          && (node.id === MODEL_STYLE_SELECTOR.slice(1) || Boolean(node.querySelector?.(MODEL_STYLE_SELECTOR)))
        ));
      });
      if (styleChanged) queueEvaluate('model_style_mutation');
    });
    headObserver.observe(document.head, { childList: true });
  }

  function nodeContainsModelSignal(node) {
    if (!(node instanceof Element)) return false;
    const selector = [
      'button[aria-haspopup="menu"]',
      '[data-arcaia-model-rich-content="true"]',
      WORK_TRIGGER_WRAPPER_SELECTOR,
      WORK_TRIGGER_MODEL_LABEL_SELECTOR,
      WORK_TRIGGER_EFFORT_LABEL_SELECTOR
    ].join(',');
    if (node.matches(selector)) return true;
    return Boolean(node.querySelector?.(selector));
  }

  function handleComposerMutations(mutations) {
    const relevant = mutations.some((mutation) => {
      if (mutation.type === 'characterData') {
        const button = mutation.target?.parentElement?.closest?.('button[aria-haspopup="menu"]');
        return Boolean(button?.closest?.(COMPOSER_SELECTOR));
      }
      if (mutation.type === 'attributes') {
        const button = mutation.target instanceof Element
          ? mutation.target.closest?.('button[aria-haspopup="menu"]')
          : null;
        return Boolean(button?.closest?.(COMPOSER_SELECTOR));
      }
      if (
        mutation.target instanceof Element
        && mutation.target.closest?.(WORK_TRIGGER_WRAPPER_SELECTOR)
        && mutation.target.closest?.('button[aria-haspopup="menu"]')?.closest?.(COMPOSER_SELECTOR)
      ) return true;
      return [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])]
        .some(nodeContainsModelSignal);
    });
    if (relevant) {
      queueEvaluate('composer_model_mutation');
      captureWorkPrePickerAuthority('composer_model_mutation');
    }
  }

  function handleComposerContainerMutation(reason) {
    if (!observedComposer?.isConnected || document.querySelector(COMPOSER_SELECTOR) !== observedComposer) {
      queueEvaluate(reason);
    }
  }

  function bindComposer() {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    const parent = composer?.parentElement || null;
    const grandparent = parent?.parentElement || null;
    if (
      composer === observedComposer
      && parent === observedComposerParent
      && grandparent === observedComposerGrandparent
      && composerObserver
    ) {
      return composer;
    }

    disconnectObserver(composerObserver);
    disconnectObserver(composerParentObserver);
    disconnectObserver(composerGrandparentObserver);
    composerObserver = null;
    composerParentObserver = null;
    composerGrandparentObserver = null;
    observedComposer = composer;
    observedComposerParent = parent;
    observedComposerGrandparent = grandparent;

    if (!composer) {
      startBootstrap('bind_composer_missing');
      return null;
    }

    stopBootstrap();
    composerObserver = new MutationObserver(handleComposerMutations);
    composerObserver.observe(composer, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'aria-expanded',
        'data-state',
        'data-arcaia-model-rich',
        'data-arcaia-model-version',
        'data-arcaia-model-performance'
      ]
    });
    if (parent) {
      composerParentObserver = new MutationObserver(() => handleComposerContainerMutation('composer_parent_mutation'));
      composerParentObserver.observe(parent, { childList: true });
    }
    if (grandparent) {
      composerGrandparentObserver = new MutationObserver(() => handleComposerContainerMutation('composer_grandparent_mutation'));
      composerGrandparentObserver.observe(grandparent, { childList: true });
    }
    emit('composer_bound', { snapshot: buildSnapshot('composer_bound') });
    return composer;
  }

  function bindTriggerObserver(trigger) {
    const next = trigger instanceof HTMLButtonElement ? trigger : null;
    if (next === observedTrigger && triggerObserver) return;
    disconnectObserver(triggerObserver);
    triggerObserver = null;
    observedTrigger = next;
    if (!next) return;
    triggerObserver = new MutationObserver(() => queueEvaluate('baseline_trigger_mutation'));
    triggerObserver.observe(next, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'aria-expanded',
        'data-state',
        'data-arcaia-model-rich',
        'data-arcaia-model-version',
        'data-arcaia-model-performance'
      ]
    });
  }

  function cancelReplacementGrace() {
    replacementToken += 1;
    if (replacementTimer) clearTimeout(replacementTimer);
    replacementTimer = null;
  }

  function cancelColdStartGrace() {
    if (coldStartTimer) clearTimeout(coldStartTimer);
    coldStartTimer = null;
  }

  function scheduleColdStartGrace(reason = 'cold_start') {
    const surface = getActiveSurfaceMode();
    const route = classifyRoute();
    const eligible = surface === 'work'
      || (surface === 'chatgpt' && ['new_chat', 'conversation', 'gpt_surface'].includes(route));
    if (
      baseline
      || coldStartTimer
      || !eligible
    ) return;
    const scheduledSurfaceGeneration = surfaceGeneration;
    const scheduledRouteGeneration = routeGeneration;
    coldStartTimer = setTimeout(() => {
      coldStartTimer = null;
      bindComposer();
      if (
        baseline
        || getActiveSurfaceMode() !== surface
        || surfaceGeneration !== scheduledSurfaceGeneration
        || routeGeneration !== scheduledRouteGeneration
        || findDecoratedTrigger()
      ) return;
      emit('cold_start_grace_expired', {
        reason,
        surface,
        snapshot: buildSnapshot('cold_start_grace_expired')
      });
      void requestMainWorldAuthoritySurvey('cold_start_grace_expired', surface === 'work');
      requestArcaiaInternalSnapshotAfterRender('cold_start_grace_expired');
    }, COLD_START_GRACE_MS);
  }

  function armBaseline(trigger, reason) {
    const description = describeTrigger(trigger);
    if (!description?.richApplied || !description.richContentPresent || !description.stylePresent) return false;
    const isSameBaseline = baseline?.trigger === trigger
      && baseline.modelVersion === description.modelVersion
      && baseline.performance === description.performance
      && baseline.surfaceGeneration === surfaceGeneration;
    if (isSameBaseline) {
      bindTriggerObserver(trigger);
      return true;
    }
    triggerSequence += 1;
    baseline = {
      trigger,
      triggerSequence,
      routeGeneration,
      routeKind: classifyRoute(),
      surfaceGeneration,
      surfaceMode: getActiveSurfaceMode(),
      modelVersion: description.modelVersion || 'GPT-5.6',
      performance: description.performance,
      armedAtIso: new Date().toISOString()
    };
    bindTriggerObserver(trigger);
    cancelReplacementGrace();
    cancelColdStartGrace();
    const type = triggerSequence === 1 ? 'baseline_armed' : 'baseline_rearmed';
    emit(type, {
      reason,
      baseline: baselineSummary(),
      snapshot: buildSnapshot(type)
    });
    if (incidentActive) {
      incidentActive = false;
      emit('recovered', {
        reason,
        baseline: baselineSummary(),
        snapshot: buildSnapshot('recovered')
      });
    }
    return true;
  }

  function disarmForModelChange(trigger, reason) {
    const explicitModelVersion = extractExplicitModelVersion(trigger);
    if (!explicitModelVersion || explicitModelVersion === baseline?.modelVersion) return false;
    emit('explicit_model_change', {
      reason,
      fromModelVersion: baseline?.modelVersion || null,
      toModelVersion: explicitModelVersion,
      snapshot: buildSnapshot('explicit_model_change')
    });
    baseline = null;
    incidentActive = false;
    bindTriggerObserver(null);
    cancelReplacementGrace();
    return true;
  }

  function markIncident(kind, reason, trigger = null) {
    if (incidentActive) return;
    incidentActive = true;
    const incident = {
      category: 'model_decoration',
      kind,
      reason,
      detectedAtIso: new Date().toISOString(),
      routeKind: classifyRoute(),
      routeGeneration,
      surfaceGeneration,
      baseline: baselineSummary(),
      observed: describeTrigger(trigger),
      displayState: buildModelDisplayState(trigger, true)
    };
    emit('incident', {
      reason,
      incident,
      snapshot: buildSnapshot(`incident:${kind}`)
    });
  }

  function candidateLooksExpected(candidate) {
    if (!(candidate instanceof HTMLButtonElement) || !baseline) return false;
    const explicit = extractExplicitModelVersion(candidate);
    if (explicit) return explicit === baseline.modelVersion;
    const performance = findKnownPerformanceLabel(candidate);
    if (!performance) return false;
    if (baseline.routeGeneration !== routeGeneration) {
      return Boolean(baseline.performance && performance === baseline.performance);
    }
    return !baseline.performance || performance === baseline.performance || PERFORMANCE_LABELS.has(performance);
  }

  function scheduleReplacementGrace(reason, candidate, incidentKind = 'replacement_trigger_not_redecorated') {
    if (replacementTimer) return;
    const token = ++replacementToken;
    emit('replacement_grace_started', {
      reason,
      candidate: describeTrigger(candidate),
      snapshot: buildSnapshot('replacement_grace_started')
    });
    requestArcaiaInternalSnapshotAfterRender('replacement_grace_started');
    replacementTimer = setTimeout(() => {
      replacementTimer = null;
      if (token !== replacementToken || !baseline) return;
      bindComposer();
      requestArcaiaInternalSnapshotAfterRender('replacement_grace_expired');
      const decorated = findDecoratedTrigger();
      if (decorated && armBaseline(decorated, 'replacement_grace_recovered')) return;
      const nextCandidate = findPotentialTrigger();
      if (disarmForModelChange(nextCandidate, 'replacement_grace_model_change')) return;
      if (candidateLooksExpected(nextCandidate)) {
        markIncident(incidentKind, reason, nextCandidate);
      } else {
        emit('replacement_grace_inconclusive', {
          reason,
          candidate: describeTrigger(nextCandidate),
          snapshot: buildSnapshot('replacement_grace_inconclusive')
        });
      }
    }, REPLACEMENT_GRACE_MS);
  }

  function evaluate(reason = 'evaluate') {
    evaluationQueued = false;
    const routeChanged = updateRouteGeneration();
    if (routeChanged && classifyRoute() === 'conversation') {
      window.postMessage({ source: SOURCE, type: REARM_CONVERSATION_CAPTURE }, '*');
    }
    const surfaceChanged = updateSurfaceGeneration();
    bindHeadObserver();
    const composer = bindComposer();
    if (!composer) return buildSnapshot(reason);

    const decorated = findDecoratedTrigger(composer);
    if (decorated && detectWrongDecorationValue(decorated, reason)) return buildSnapshot(reason);
    if (decorated && armBaseline(decorated, reason)) return buildSnapshot(reason);
    if (!baseline) {
      scheduleColdStartGrace(reason);
      return buildSnapshot(reason);
    }

    const baselineTrigger = baseline.trigger;
    if (baselineTrigger?.isConnected && baselineTrigger.closest?.(COMPOSER_SELECTOR) === composer) {
      if (disarmForModelChange(baselineTrigger, `${reason}:same_trigger_model_change`)) return buildSnapshot(reason);
      const description = describeTrigger(baselineTrigger);
      if (description?.pickerOpen) {
        scheduleReplacementGrace(`${reason}:picker_open`, baselineTrigger);
        return buildSnapshot(reason);
      }
      if (!description?.stylePresent) {
        markIncident('model_style_removed', reason, baselineTrigger);
      } else if (!description?.richApplied) {
        markIncident('same_trigger_rich_attribute_removed', reason, baselineTrigger);
      } else if (!description?.richContentPresent) {
        markIncident('same_trigger_rich_content_removed', reason, baselineTrigger);
      }
      return buildSnapshot(reason);
    }

    bindTriggerObserver(null);
    const candidate = findPotentialTrigger(composer);
    if (disarmForModelChange(candidate, `${reason}:replacement_model_change`)) return buildSnapshot(reason);
    if (candidateLooksExpected(candidate)) {
      const crossRoute = baseline.routeGeneration !== routeGeneration;
      const crossSurface = baseline.surfaceGeneration !== surfaceGeneration;
      scheduleReplacementGrace(
        routeChanged ? `${reason}:route_changed` : surfaceChanged ? `${reason}:surface_changed` : reason,
        candidate,
        crossRoute
          ? 'route_transition_not_redecorated'
          : crossSurface
            ? 'surface_transition_not_redecorated'
            : 'replacement_trigger_not_redecorated'
      );
    } else if (!bootstrapObserver) {
      emit('replacement_waiting_for_candidate', {
        reason,
        routeChanged,
        candidate: describeTrigger(candidate),
        snapshot: buildSnapshot('replacement_waiting_for_candidate')
      });
      requestArcaiaInternalSnapshotAfterRender('replacement_waiting_for_candidate');
    }
    return buildSnapshot(reason);
  }

  function queueEvaluate(reason = 'queued') {
    if (evaluationQueued) return;
    evaluationQueued = true;
    const run = () => evaluate(reason);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function manualSnapshot(reason = 'toolbar_manual_capture') {
    const snapshot = evaluate(reason);
    emit('manual_snapshot', { reason, snapshot });
    requestArcaiaInternalSnapshotAfterRender(reason);
    return snapshot;
  }

  function getRecentLocalEvents() {
    return recentEvents.slice(-MAX_LOCAL_EVENTS);
  }

  function resetProbeSession() {
    sessionId = createSessionId();
    eventSequence = 0;
    recentEvents = [];
    baseline = null;
    incidentActive = false;
    triggerSequence = 0;
    pendingSyncRequests = new Map();
    pendingInternalProbeRequests = new Map();
    for (const pending of pendingMainSurveyRequests.values()) {
      if (pending?.timeoutId) clearTimeout(pending.timeoutId);
      pending?.resolve?.(null);
    }
    pendingMainSurveyRequests = new Map();
    lastMainWorldAuthority = null;
    supplyDiagnostics = createSupplyDiagnostics();
    bindTriggerObserver(null);
    cancelReplacementGrace();
    cancelColdStartGrace();
    emit('probe_reset', { snapshot: buildSnapshot('probe_reset') });
    queueEvaluate('probe_reset_rearm');
  }

  function handleDocumentClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const modelButton = target.closest?.('button[aria-haspopup="menu"]');
    const surfaceButton = target.closest?.('button[role="radio"]');
    const navigationLink = target.closest?.('a[href]');
    if (surfaceButton) {
      captureSurfaceTransitionAfterRender(getActiveSurfaceMode(), getSurfaceModeForButton(surfaceButton));
    }
    if (modelButton?.closest?.(COMPOSER_SELECTOR)) {
      captureNativePickerAuthorityAfterRender();
    }
    if (modelButton?.closest?.(COMPOSER_SELECTOR) || surfaceButton || navigationLink) {
      queueEvaluate('relevant_document_click');
      requestArcaiaInternalSnapshotAfterRender('relevant_document_click');
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') queueEvaluate('document_visible');
  }

  function handleArcaiaMainMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.source === SOURCE && data.type === MAIN_SURVEY_RESPONSE) {
      const request = typeof data.requestId === 'string' ? pendingMainSurveyRequests.get(data.requestId) : null;
      if (typeof data.requestId === 'string') pendingMainSurveyRequests.delete(data.requestId);
      if (!request) return;
      if (request.timeoutId) clearTimeout(request.timeoutId);
      lastMainWorldAuthority = sanitizeMainWorldAuthorityPayload(data.payload);
      request.resolve?.(lastMainWorldAuthority);
      emit('work_main_world_authority_observed', {
        phase: request.phase,
        includeIndexedDb: request.includeIndexedDb,
        authority: lastMainWorldAuthority,
        snapshot: buildSnapshot('work_main_world_authority_observed')
      });
      return;
    }

    if (data.source === SOURCE && data.type === INTERNAL_PROBE_RESPONSE) {
      const request = typeof data.requestId === 'string'
        ? pendingInternalProbeRequests.get(data.requestId)
        : null;
      if (typeof data.requestId === 'string') pendingInternalProbeRequests.delete(data.requestId);
      if (!request) return;
      const summary = {
        observedAtIso: new Date().toISOString(),
        responseMatchedObservedRequest: true,
        requestReason: request.reason,
        requestRouteKind: request.routeKind,
        requestRouteGeneration: request.routeGeneration,
        requestSurfaceGeneration: request.surfaceGeneration,
        ...sanitizeInternalSnapshot(data.payload)
      };
      supplyDiagnostics.internalSnapshotCount += 1;
      supplyDiagnostics.lastInternalSnapshot = summary;
      if (/^(?:replacement_|arcaia_page_navigation|surface_control_transition_observed$)/.test(request.reason || '')) {
        supplyDiagnostics.lastTransitionInternalSnapshot = summary;
      }
      emit('arcaia_internal_model_selector_snapshot', {
        internal: summary,
        snapshot: buildSnapshot('arcaia_internal_model_selector_snapshot')
      });
      if (
        request.reason === 'cold_start_grace_expired'
        && !baseline
        && (
          summary.activeSurfaceMode === 'work'
          || (summary.activeSurfaceMode === 'chatgpt' && ['new_chat', 'conversation', 'gpt_surface'].includes(classifyRoute()))
        )
        && !findDecoratedTrigger()
        && summary.activeSurfaceMode === getActiveSurfaceMode()
        && request.surfaceGeneration === surfaceGeneration
      ) {
        const candidate = findPotentialTrigger();
        const incidentPrefix = summary.activeSurfaceMode === 'work'
          ? 'work_cold_start'
          : classifyRoute() === 'new_chat'
            ? 'new_chat'
            : 'conversation_cold_start';
        if (summary.scanOutcome === 'resolved_state_not_applied') {
          markIncident(`${incidentPrefix}_resolved_state_not_applied`, request.reason, candidate);
        } else if (summary.scanOutcome === 'resolved_state_applied') {
          markIncident(`${incidentPrefix}_decoration_missing_after_applied`, request.reason, candidate);
        } else {
          emit(`${incidentPrefix}_internal_inconclusive`, {
            reason: request.reason,
            internal: summary,
            snapshot: buildSnapshot(`${incidentPrefix}_internal_inconclusive`)
          });
        }
      }
      return;
    }

    if (data.source === CONTENT_PROTOCOL_SOURCE && data.type === 'SYNC_PAGE_CONVERSATION') {
      const summary = {
        observedAtIso: new Date().toISOString(),
        routeKind: classifyRoute(),
        routeGeneration,
        ...summarizeConversationMatch(data.payload?.conversationId)
      };
      supplyDiagnostics.syncRequestCount += 1;
      supplyDiagnostics.lastSyncRequest = summary;
      if (typeof data.requestId === 'string' && data.requestId) {
        pendingSyncRequests.set(data.requestId, summary);
        while (pendingSyncRequests.size > MAX_PENDING_SYNC_REQUESTS) {
          pendingSyncRequests.delete(pendingSyncRequests.keys().next().value);
        }
      }
      emit('conversation_sync_request_observed', {
        supply: summary,
        snapshot: buildSnapshot('conversation_sync_request_observed')
      });
      return;
    }

    if (data.source === MAIN_PROTOCOL_SOURCE && data.type === 'PAGE_CONVERSATION_SYNC_RESULT') {
      const request = typeof data.requestId === 'string' ? pendingSyncRequests.get(data.requestId) : null;
      if (typeof data.requestId === 'string') pendingSyncRequests.delete(data.requestId);
      const summary = {
        observedAtIso: new Date().toISOString(),
        responseMatchedObservedRequest: Boolean(request),
        requestRouteGeneration: request?.routeGeneration ?? null,
        requestConversationMatchedRouteAtRequest: request?.suppliedConversationMatchesCurrentRoute ?? null,
        responseOk: data.payload?.ok === true,
        ...summarizeModelConfig(data.payload?.conversationModelConfig)
      };
      supplyDiagnostics.syncResponseCount += 1;
      supplyDiagnostics.lastSyncResponse = summary;
      emit('conversation_sync_result_observed', {
        supply: summary,
        snapshot: buildSnapshot('conversation_sync_result_observed')
      });
      requestArcaiaInternalSnapshotAfterRender('conversation_sync_result_observed');
      return;
    }

    if (data.source !== MAIN_PROTOCOL_SOURCE || data.type !== 'AICE_MAIN_EVENT') return;
    const eventType = data.eventType || data.payload?.event || null;
    if (eventType === 'page_navigation') {
      queueEvaluate('arcaia_page_navigation');
      requestArcaiaInternalSnapshotAfterRender('arcaia_page_navigation');
      return;
    }
    if (eventType === 'current_conversation_model_config') {
      const summary = {
        observedAtIso: new Date().toISOString(),
        ...summarizeModelConfig(data.payload)
      };
      supplyDiagnostics.currentConfigEventCount += 1;
      supplyDiagnostics.lastCurrentConfigEvent = summary;
      emit('conversation_model_config_event_observed', {
        supply: summary,
        snapshot: buildSnapshot('conversation_model_config_event_observed')
      });
      queueEvaluate('arcaia_model_config_event');
      requestArcaiaInternalSnapshotAfterRender('arcaia_model_config_event');
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.source !== SOURCE) return false;
    if (message.type === 'PING_PROBE') {
      sendResponse({ ok: true, version: PROBE_VERSION });
      return false;
    }
    if (message.type === 'CAPTURE_NOW') {
      void (async () => {
        const surface = getActiveSurfaceMode();
        if (classifyRoute() === 'conversation' || surface === 'work') {
          await requestMainWorldAuthoritySurvey('manual_capture', surface === 'work');
        }
        const snapshot = manualSnapshot();
        sendResponse({ ok: true, snapshot, events: getRecentLocalEvents() });
      })();
      return true;
    }
    if (message.type === 'RESET_PROBE_SESSION') {
      resetProbeSession();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'GET_LIVE_STATUS') {
      sendResponse({ ok: true, snapshot: buildSnapshot('get_live_status') });
      return false;
    }
    return false;
  });

  document.addEventListener('click', handleDocumentClick, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('message', handleArcaiaMainMessage);
  window.addEventListener('focus', () => queueEvaluate('window_focus'));
  window.addEventListener('pageshow', () => queueEvaluate('pageshow'));
  window.addEventListener('popstate', () => queueEvaluate('popstate'));
  window.addEventListener('hashchange', () => queueEvaluate('hashchange'));
  document.addEventListener('DOMContentLoaded', () => queueEvaluate('DOMContentLoaded'), { once: true });
  window.addEventListener('load', () => queueEvaluate('window_load'), { once: true });

  emit('probe_started', {
    probe: { name: PROBE_NAME, version: PROBE_VERSION },
    privacy: {
      conversationTextCollected: false,
      conversationIdsCollected: false,
      urlsCollected: false,
      cookiesCollected: false,
      authorizationCollected: false,
      pageStorageValuesCollected: false,
      pageStorageKeyNamesCollected: true,
      htmlCollected: false,
      otherExtensionStorageCollected: false
    },
    snapshot: buildSnapshot('document_start')
  });
  queueEvaluate('startup');
  requestArcaiaInternalSnapshotAfterRender('startup');
})();
