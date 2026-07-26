(() => {
  'use strict';

  const API_KEY = '__ARCAIA_MODEL_SELECTOR_UI__';
  const STYLE_ID = 'arcaia-model-selector-rich-style';
  const PICKER_SELECTOR = '[data-testid="composer-intelligence-picker-content"]';
  const THINKING_SLIDER_HOST_SELECTOR = '[data-testid="composer-model-picker-slider-simple-view"]';
  const COMPOSER_SELECTOR = 'form[data-type="unified-composer"]';
  const SURFACE_MODE_BUTTON_SELECTOR = 'button[role="radio"]';
  const RICH_ATTR = 'data-arcaia-model-rich';
  const NATIVE_LABEL_ATTR = 'data-arcaia-model-native-label';
  const RICH_CONTENT_ATTR = 'data-arcaia-model-rich-content';
  const ORIGINAL_TITLE_ATTR = 'data-arcaia-model-original-title';
  const ORIGINAL_ARIA_LABEL_ATTR = 'data-arcaia-model-original-aria-label';
  const CHATGPT_LAST_MODEL_COOKIE = 'oai-last-model-config';
  const CHATGPT_SURFACE_MODE_STORAGE_KEY = 'oai/apps/tpp/chat-surface-mode';
  const CHATGPT_SURFACE_MODE_COOKIE = 'oai-chat-surface-mode';
  const WORK_MODEL_SETTINGS_STORAGE_KEY = 'oai/apps/tpp/model-settings';
  const WORK_THINKING_EFFORT_STORAGE_KEY = 'oai/apps/tpp/thinking-effort';
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

  if (window[API_KEY]) return;

  let started = false;
  let composerObserver = null;
  let observedComposer = null;
  let composerParentObserver = null;
  let observedComposerParent = null;
  let composerBootstrapObserver = null;
  let surfaceModeObserver = null;
  let observedSurfaceModeButtons = [];
  let pickerObserver = null;
  let observedPicker = null;
  let thinkingSliderObserver = null;
  let observedThinkingSlider = null;
  let observedWorkThinkingEffort = '';
  let triggerStateObserver = null;
  let observedTriggerState = null;
  let pendingWorkThinkingState = null;
  let pendingWorkThinkingContextToken = null;
  let confirmedComposerState = null;
  let confirmedComposerContextToken = null;
  let currentTrigger = null;
  let scanQueued = false;
  let currentState = null;
  let conversationState = null;
  let conversationContextToken = null;
  let lastReason = 'not_started';
  let scanCount = 0;
  let lastScanAt = null;
  let lastScanResult = { outcome: 'not_scanned', reason: null };
  let lastConversationConfig = null;
  let lastNavigationReset = null;
  let lastApplySnapshot = null;
  let lastResolvedContext = null;

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

  function normalizeModelVersion(value) {
    const match = normalizeText(value).match(MODEL_VERSION_PATTERN);
    return match ? 'GPT-5.6' : null;
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

  function readNewChatCurrentState() {
    const config = readCookieJson(CHATGPT_LAST_MODEL_COOKIE);
    return buildStateFromSlugAndEffort(
      config?.model || config?.modelSlug || config?.model_slug || '',
      config?.effort || config?.thinkingEffort || config?.thinking_effort || '',
      'new_chat_cookie_last_model_config'
    );
  }

  function readWorkCurrentState() {
    const settings = readLocalStorageJson(WORK_MODEL_SETTINGS_STORAGE_KEY);
    const modelSlug = settings?.lastUsedModelSlug || settings?.last_used_model_slug || '';
    const thinkingEffort = readLocalStorageScalar(WORK_THINKING_EFFORT_STORAGE_KEY);
    return buildStateFromSlugAndEffort(modelSlug, thinkingEffort, 'work_local_storage_current');
  }

  function buildConversationState(config) {
    return buildStateFromSlugAndEffort(
      config?.modelSlug || config?.model_slug || '',
      config?.thinkingEffort || config?.thinking_effort || '',
      config?.source || 'conversation_detail_current_branch'
    );
  }

  function resolveCurrentContextState() {
    const conversationToken = getCurrentConversationToken();
    if (conversationToken) {
      if (confirmedComposerState && confirmedComposerContextToken === conversationToken) {
        return { state: confirmedComposerState, contextKind: 'composer_work_selection_confirmed', activeSurfaceMode: 'work' };
      }
      if (conversationState && conversationContextToken === conversationToken) {
        return { state: conversationState, contextKind: 'conversation_current_branch', activeSurfaceMode: null };
      }
      return { state: null, contextKind: 'conversation_waiting_for_detail', activeSurfaceMode: null };
    }

    const activeSurfaceMode = getActiveSurfaceMode();
    const authoritativeState = activeSurfaceMode === 'work'
      ? readWorkCurrentState()
      : activeSurfaceMode === 'chatgpt'
        ? readNewChatCurrentState()
        : null;

    return {
      state: authoritativeState,
      contextKind: activeSurfaceMode === 'work' ? 'new_work_local_storage' : 'new_chat_cookie',
      activeSurfaceMode
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
    conversationContextToken = normalizeText(config?.conversationId || '') || getCurrentConversationToken();
    if (confirmedComposerContextToken === conversationContextToken) {
      confirmedComposerState = null;
      confirmedComposerContextToken = null;
    }
    conversationState = model;
    if (!model) {
      currentState = null;
      restoreAllTriggers();
      lastReason = `conversation_non_5_6:${reason}`;
      return true;
    }
    currentState = {
      ...model,
      observedAt: Number(config?.observedAt) || model.observedAt
    };
    conversationState = currentState;
    lastReason = `conversation_config:${reason}`;
    if (!started) return true;
    const trigger = currentTrigger?.isConnected
      ? currentTrigger
      : findFallbackTrigger(currentState.performance);
    if (trigger) return applyRichState(trigger, currentState, lastReason);
    queueScan(lastReason);
    return true;
  }

  function resetForNavigation({ reason = 'navigation' } = {}) {
    conversationState = null;
    conversationContextToken = null;
    pendingWorkThinkingState = null;
    pendingWorkThinkingContextToken = null;
    confirmedComposerState = null;
    confirmedComposerContextToken = null;
    currentState = null;
    lastNavigationReset = {
      reason,
      at: Date.now()
    };
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
        min-width: 142px !important;
        flex-shrink: 0 !important;
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
        transition: border-color 150ms ease, box-shadow 150ms ease !important;
      }

      button[${RICH_ATTR}="true"]:hover {
        border-color: color-mix(in srgb, #67e8f9 58%, var(--border-light, rgba(127,127,127,.28))) !important;
        box-shadow:
          inset 0 1px 0 color-mix(in srgb, white 22%, transparent),
          0 0 0 1px color-mix(in srgb, #8b5cf6 11%, transparent),
          0 7px 20px color-mix(in srgb, #6366f1 13%, transparent) !important;
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
        gap: 5px;
        white-space: nowrap;
        line-height: 1;
      }

      [${RICH_CONTENT_ATTR}="true"] .arcaia-model-sparkle {
        display: inline-grid;
        width: 17px;
        height: 17px;
        flex: 0 0 17px;
        place-items: center;
        border: 1px solid color-mix(in srgb, #67e8f9 40%, transparent);
        border-radius: 999px;
        background: radial-gradient(circle at 32% 28%, rgba(255,255,255,.72), rgba(94,234,212,.22) 35%, rgba(139,92,246,.20));
        color: color-mix(in srgb, #22d3ee 65%, currentColor);
        font-size: 10px;
        text-shadow: 0 0 8px color-mix(in srgb, #67e8f9 55%, transparent);
      }

      [${RICH_CONTENT_ATTR}="true"] .arcaia-model-version {
        min-width: 0;
        color: var(--text-primary, currentColor);
        font-size: 12px;
        font-weight: 650;
        letter-spacing: -0.015em;
      }

      [${RICH_CONTENT_ATTR}="true"] .arcaia-model-suffix {
        margin-inline-start: -2px;
        color: var(--text-tertiary, currentColor);
        font-size: 10px;
        font-weight: 500;
        opacity: .74;
      }

      [${RICH_CONTENT_ATTR}="true"] .arcaia-model-performance {
        display: inline-flex;
        align-items: center;
        min-height: 18px;
        padding: 1px 6px 2px;
        border: 1px solid color-mix(in srgb, #a78bfa 22%, var(--border-light, transparent));
        border-radius: 999px;
        background: color-mix(in srgb, #8b5cf6 8%, transparent);
        color: var(--text-tertiary, currentColor);
        font-size: 10px;
        font-weight: 550;
      }

      @media (prefers-reduced-motion: reduce) {
        button[${RICH_ATTR}="true"] { transition: none !important; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
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

  function getModelCandidates(picker) {
    return Array.from(picker?.querySelectorAll?.('[role="menuitem"]') || [])
      .map((element) => ({ element, label: normalizeText(element.textContent || '') }))
      .filter((item) => ANY_MODEL_PATTERN.test(item.label));
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
    const performance = getDirectPerformanceLabel(checked);
    const checkedText = normalizeText(checked?.textContent || '');
    const explicitPerformanceModelVersion = extractExplicitModelVersion(checkedText);
    const candidate = chooseCurrentModelCandidate(getModelCandidates(picker));
    const modelLabel = normalizeText(candidate?.label || '');
    const candidateModelVersion = normalizeModelVersion(modelLabel);
    const currentModelVersion = performance && currentState?.modelVersion === 'GPT-5.6'
      ? currentState.modelVersion
      : null;
    const modelVersion = explicitPerformanceModelVersion || candidateModelVersion || currentModelVersion;
    const resolvedModelLabel = explicitPerformanceModelVersion && explicitPerformanceModelVersion !== 'GPT-5.6'
      ? checkedText
      : (modelLabel || currentState?.modelLabel || '');
    const modelSource = explicitPerformanceModelVersion
      ? 'checked_performance_item'
      : candidateModelVersion
        ? 'model_candidate'
        : currentModelVersion
          ? 'performance_picker_with_current_state'
          : 'not_found';
    return {
      modelVersion,
      modelLabel: resolvedModelLabel,
      modelSuffix: modelVersion === 'GPT-5.6'
        ? (extractModelSuffix(resolvedModelLabel) || currentState?.modelSuffix || '')
        : '',
      performance,
      thinkingEffort: getEffortForPerformanceLabel(performance),
      observedAt: Date.now(),
      candidateFound: Boolean(explicitPerformanceModelVersion || candidate || currentModelVersion),
      modelSource
    };
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
    const text = normalizeText(button.textContent || '');
    if (expectedPerformance && text === expectedPerformance) return true;
    return PERFORMANCE_LABELS.has(text);
  }

  function looksLikeExpectedModelTrigger(button, expectedModelVersion = '') {
    if (!(button instanceof HTMLButtonElement) || button.getAttribute('aria-haspopup') !== 'menu') return false;
    if (!expectedModelVersion) return false;
    return extractExplicitModelVersion(button.textContent || '') === expectedModelVersion;
  }

  function findFallbackTrigger(expectedPerformance = '') {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    if (!composer) return null;
    const buttons = Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]'));
    return buttons.find((button) => looksLikePerformanceTrigger(button, expectedPerformance))
      || buttons.find((button) => looksLikeExpectedModelTrigger(button, currentState?.modelVersion || ''))
      || null;
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
      performance.textContent = state.performance;
      root.appendChild(performance);
    }

    return root;
  }

  function restoreTrigger(trigger) {
    if (!(trigger instanceof HTMLButtonElement)) return;
    trigger.removeAttribute(RICH_ATTR);
    trigger.removeAttribute('data-arcaia-model-version');
    trigger.removeAttribute('data-arcaia-model-performance');
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
  }

  function restoreAllTriggers() {
    for (const trigger of Array.from(document.querySelectorAll(`button[${RICH_ATTR}="true"]`))) restoreTrigger(trigger);
    observeTriggerState(null);
    currentTrigger = null;
  }

  function applyRichState(trigger, state, reason = 'apply') {
    if (!(trigger instanceof HTMLButtonElement) || !state || state.modelVersion !== 'GPT-5.6') {
      lastApplySnapshot = {
        ok: false,
        reason,
        triggerPresent: trigger instanceof HTMLButtonElement,
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
    if (state.modelVersion !== 'GPT-5.6') {
      currentState = null;
      restoreAllTriggers();
      lastReason = `non_5_6:${reason}`;
      return true;
    }
    currentState = state;
    return applyRichState(trigger || findFallbackTrigger(state.performance), state, reason);
  }

  function getVisiblePicker() {
    return Array.from(document.querySelectorAll(PICKER_SELECTOR)).find((picker) => {
      const menu = picker.closest?.('[role="menu"]');
      return picker.isConnected && !picker.hidden && menu?.getAttribute?.('data-state') !== 'closed';
    }) || null;
  }

  function commitPendingWorkThinkingState(reason = 'work_thinking_effort_focusout_confirmed') {
    const pendingState = pendingWorkThinkingState;
    const pendingContextToken = pendingWorkThinkingContextToken;
    pendingWorkThinkingState = null;
    pendingWorkThinkingContextToken = null;
    if (!pendingState?.candidateFound) return false;

    const currentContextToken = getCurrentConversationToken();
    if (pendingContextToken !== currentContextToken) return false;

    const authoritativeState = readWorkCurrentState();
    const authorityMatchesPending = authoritativeState?.candidateFound
      && authoritativeState.modelLabel === pendingState.modelLabel
      && authoritativeState.thinkingEffort === pendingState.thinkingEffort;
    if (!authorityMatchesPending) return false;

    if (currentContextToken) {
      confirmedComposerState = authoritativeState;
      confirmedComposerContextToken = currentContextToken;
    }
    const trigger = observedTriggerState?.isConnected
      ? observedTriggerState
      : currentTrigger?.isConnected
        ? currentTrigger
        : findFallbackTrigger(authoritativeState.performance);
    return setCurrentState(authoritativeState, trigger, reason);
  }

  function handleTriggerStateMutations(mutations) {
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
    if (!pendingWorkThinkingState) return;
    const pickerClosed = observedTriggerState?.getAttribute('aria-expanded') === 'false'
      || observedTriggerState?.getAttribute('data-state') === 'closed';
    if (pickerClosed) commitPendingWorkThinkingState();
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
      attributeFilter: ['aria-expanded', 'data-state']
    });
  }

  function observeThinkingSlider(picker) {
    const slider = picker?.querySelector?.(`${THINKING_SLIDER_HOST_SELECTOR} [role="slider"]`) || null;
    if (observedThinkingSlider === slider && thinkingSliderObserver) return;
    if (observedThinkingSlider !== slider && slider) {
      pendingWorkThinkingState = null;
      pendingWorkThinkingContextToken = null;
    }
    try { thinkingSliderObserver?.disconnect?.(); } catch {}
    thinkingSliderObserver = null;
    observedThinkingSlider = slider;
    observedWorkThinkingEffort = slider
      ? readLocalStorageScalar(WORK_THINKING_EFFORT_STORAGE_KEY).toLowerCase()
      : '';
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
      attributeFilter: ['aria-checked', 'aria-expanded', 'data-state']
    });
  }

  function handlePickerMutations(mutations) {
    const picker = observedPicker;
    if (!picker) return;
    observeThinkingSlider(picker);

    const confirmedSelectionChanged = Array.from(mutations || []).some((mutation) => {
      if (mutation.type !== 'attributes') return false;
      if (mutation.attributeName !== 'aria-checked' && mutation.attributeName !== 'data-state') return false;
      const item = mutation.target instanceof Element
        ? mutation.target.closest?.('[role="menuitemradio"]')
        : null;
      return Boolean(
        item
        && item.closest?.(PICKER_SELECTOR) === picker
        && (item.getAttribute('aria-checked') === 'true' || item.getAttribute('data-state') === 'checked')
      );
    });

    if (confirmedSelectionChanged) {
      const state = readPickerState(picker);
      if (state?.candidateFound) {
        const trigger = getTriggerForPicker(picker)
          || (currentTrigger?.isConnected ? currentTrigger : null)
          || findFallbackTrigger(state.performance);
        const applied = setCurrentState(state, trigger, 'picker_confirmed_selection');
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

    const nextThinkingEffort = readLocalStorageScalar(WORK_THINKING_EFFORT_STORAGE_KEY).toLowerCase();
    const storageConfirmed = Boolean(nextThinkingEffort && nextThinkingEffort !== observedWorkThinkingEffort);
    observedWorkThinkingEffort = nextThinkingEffort;
    if (!storageConfirmed) return;

    const state = readWorkCurrentState();
    if (state?.candidateFound && state.thinkingEffort === nextThinkingEffort) {
      pendingWorkThinkingState = state;
      pendingWorkThinkingContextToken = getCurrentConversationToken();
      lastReason = 'work_thinking_effort_pending';
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
    if (currentTrigger && !currentTrigger.isConnected) {
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
    if (
      observedComposer === nextComposer
      && observedComposerParent === nextParent
      && (nextComposer ? Boolean(composerObserver && composerParentObserver) : true)
    ) {
      if (!nextComposer) ensureComposerBootstrapObserver();
      return;
    }

    try { composerObserver?.disconnect?.(); } catch {}
    try { composerParentObserver?.disconnect?.(); } catch {}
    composerObserver = null;
    composerParentObserver = null;
    observedComposer = nextComposer;
    observedComposerParent = nextParent;

    if (!nextComposer) {
      ensureComposerBootstrapObserver();
      return;
    }

    disconnectComposerBootstrapObserver();
    composerObserver = new MutationObserver(handleComposerMutations);
    composerObserver.observe(nextComposer, { childList: true, subtree: true });
    if (nextParent) {
      composerParentObserver = new MutationObserver(handleComposerParentMutations);
      composerParentObserver.observe(nextParent, { childList: true });
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
      const trigger = getTriggerForPicker(picker) || findFallbackTrigger(state.performance);
      const applied = setCurrentState(state, trigger, `picker:${reason}`);
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
      const trigger = currentTrigger?.isConnected
        ? currentTrigger
        : findFallbackTrigger(resolved.state.performance);
      const applied = setCurrentState(resolved.state, trigger, `resolved:${resolved.contextKind}:${reason}`);
      lastScanResult = {
        outcome: applied ? 'resolved_state_applied' : 'resolved_state_not_applied',
        reason,
        contextKind: resolved.contextKind,
        at: lastScanAt
      };
      return;
    }
    currentState = null;
    restoreAllTriggers();
    lastScanResult = {
      outcome: 'resolved_state_unavailable',
      reason,
      contextKind: resolved.contextKind,
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
    try { composerObserver?.disconnect?.(); } catch {}
    try { composerParentObserver?.disconnect?.(); } catch {}
    try { composerBootstrapObserver?.disconnect?.(); } catch {}
    try { surfaceModeObserver?.disconnect?.(); } catch {}
    try { pickerObserver?.disconnect?.(); } catch {}
    try { thinkingSliderObserver?.disconnect?.(); } catch {}
    try { triggerStateObserver?.disconnect?.(); } catch {}
    composerObserver = null;
    observedComposer = null;
    composerParentObserver = null;
    observedComposerParent = null;
    composerBootstrapObserver = null;
    surfaceModeObserver = null;
    observedSurfaceModeButtons = [];
    pickerObserver = null;
    observedPicker = null;
    thinkingSliderObserver = null;
    observedThinkingSlider = null;
    observedWorkThinkingEffort = '';
    triggerStateObserver = null;
    observedTriggerState = null;
    pendingWorkThinkingState = null;
    pendingWorkThinkingContextToken = null;
    confirmedComposerState = null;
    confirmedComposerContextToken = null;
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
      triggerApplied: Boolean(currentTrigger?.isConnected && currentTrigger.getAttribute(RICH_ATTR) === 'true'),
      pickerObserved: Boolean(observedPicker?.isConnected),
      activeSurfaceMode: getActiveSurfaceMode(),
      lastReason
    };
  }

  function getStatus() {
    return getLightweightStatus();
  }

  window[API_KEY] = Object.freeze({
    start,
    cleanup,
    scan,
    getStatus,
    getLightweightStatus,
    applyConversationModelConfig,
    resetForNavigation
  });
})();
