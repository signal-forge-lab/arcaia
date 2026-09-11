(() => {
  'use strict';

  const API_KEY = '__ARCAIA_MODEL_SELECTOR_INTERACTION_PROBE__';
  const PROBE_VERSION = '1.1.0';
  const SOURCE = 'arcaia-model-selector-interaction-probe-v1';
  const MAIN_SOURCE = 'arcaia-model-selector-interaction-probe-main-v1';
  const ARCAIA_PROBE_SOURCE = 'arcaia-model-decoration-watch-v1';
  const INTERNAL_REQUEST = 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_REQUEST';
  const INTERNAL_RESPONSE = 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_RESPONSE';
  const COMPOSER_SELECTOR = 'form[data-type="unified-composer"]';
  const PICKER_SELECTOR = '[data-testid="composer-intelligence-picker-content"]';
  const EDITOR_SELECTOR = '#prompt-textarea, [contenteditable="true"]';
  const TRIGGER_SELECTOR = 'button[aria-haspopup="menu"]';
  const MAX_RECORDS = 700;
  const MAX_DURATION_MS = 20 * 60 * 1000;
  const BOOTSTRAP_TIMEOUT_MS = 30 * 1000;
  const DELAY_STAGES = Object.freeze([
    ['frame', 'raf'],
    ['80ms', 80],
    ['300ms', 300],
    ['900ms', 900]
  ]);
  const PERFORMANCE_LABELS = new Set([
    '軽', '最速', '中程度', '高い', '非常に高い', '最大',
    'Light', 'Fastest', 'Medium', 'High', 'Very high', 'Maximum'
  ]);

  if (window[API_KEY]?.stop) {
    try { window[API_KEY].stop('replaced'); } catch {}
  }

  let startedAt = Date.now();
  let records = [];
  let droppedRecordCount = 0;
  let stopped = false;
  let sequence = 0;
  let captureSequence = 0;
  let composerObserver = null;
  let observedComposer = null;
  let pickerObserver = null;
  let observedPicker = null;
  let bootstrapObserver = null;
  let bootstrapTimer = null;
  let durationTimer = null;
  const delayedTimers = new Set();
  const pendingMain = new Map();
  const pendingInternal = new Map();

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function elapsedMs() {
    return Math.max(0, Date.now() - startedAt);
  }

  function safeReason(value) {
    return normalizeText(value).replace(/[^a-z0-9_.:-]+/gi, '_').slice(0, 80) || 'unspecified';
  }

  function emit(type, payload = {}, captureId = null) {
    if (records.length >= MAX_RECORDS) {
      droppedRecordCount += 1;
      return;
    }
    records.push({
      sequence: ++sequence,
      elapsedMs: elapsedMs(),
      type,
      captureId,
      ...payload
    });
  }

  function rect(element) {
    if (!(element instanceof Element) || !element.isConnected) return null;
    const value = element.getBoundingClientRect();
    return {
      left: Math.round(value.left * 10) / 10,
      top: Math.round(value.top * 10) / 10,
      right: Math.round(value.right * 10) / 10,
      bottom: Math.round(value.bottom * 10) / 10,
      width: Math.round(value.width * 10) / 10,
      height: Math.round(value.height * 10) / 10
    };
  }

  function rectsOverlap(left, right) {
    return Boolean(
      left && right
      && left.left < right.right
      && left.right > right.left
      && left.top < right.bottom
      && left.bottom > right.top
    );
  }

  function horizontalOverlap(left, right) {
    if (!rectsOverlap(left, right)) return 0;
    return Math.max(0, Math.round((Math.min(left.right, right.right) - Math.max(left.left, right.left)) * 10) / 10);
  }

  function visible(element) {
    if (!(element instanceof Element) || !element.isConnected || element.hidden) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && Boolean(element.getClientRects().length);
  }

  function modelVersion(text) {
    const match = normalizeText(text).match(/\bGPT[-\u2011\u2013\s]?(\d+(?:\.\d+)?)\b/i);
    return match ? 'GPT-' + match[1] : null;
  }

  function subtype(text) {
    const normalized = normalizeText(text).toLowerCase();
    if (/(?:^|[^a-z])sol(?:$|[^a-z])/i.test(normalized)) return 'sol';
    if (/(?:^|[^a-z])terra(?:$|[^a-z])/i.test(normalized)) return 'terra';
    if (/(?:^|[^a-z])luna(?:$|[^a-z])/i.test(normalized)) return 'luna';
    return null;
  }

  function performanceLabel(text) {
    const normalized = normalizeText(text);
    if (PERFORMANCE_LABELS.has(normalized)) return normalized;
    for (const label of PERFORMANCE_LABELS) {
      if (normalized === label || normalized.startsWith(label + ' ') || normalized.endsWith(' ' + label)) return label;
    }
    return null;
  }

  function classifyText(text) {
    return {
      modelVersion: modelVersion(text),
      subtype: subtype(text),
      performance: performanceLabel(text)
    };
  }

  function activeSurfaceFromDom() {
    const button = Array.from(document.querySelectorAll('button[role="radio"][data-state="on"]'))
      .find((item) => /^(Chat|Work)$/i.test(normalizeText(item.textContent || '')));
    const label = normalizeText(button?.textContent || '').toLowerCase();
    return label === 'work' ? 'work' : label === 'chat' ? 'chatgpt' : null;
  }

  function findComposer() {
    return document.querySelector(COMPOSER_SELECTOR);
  }

  function findEditor(composer) {
    return composer?.querySelector?.(EDITOR_SELECTOR) || null;
  }

  function findTrigger(composer) {
    if (!(composer instanceof Element)) return null;
    return composer.querySelector('button[data-arcaia-model-rich="true"]')
      || Array.from(composer.querySelectorAll(TRIGGER_SELECTOR)).find((button) => {
        const info = classifyText(button.textContent || '');
        return Boolean(info.modelVersion || info.performance);
      })
      || null;
  }

  function findPicker() {
    return Array.from(document.querySelectorAll(PICKER_SELECTOR)).find((picker) => visible(picker)) || null;
  }

  function lastTextRect(editor) {
    if (!(editor instanceof Element)) return null;
    try {
      const range = document.createRange();
      range.selectNodeContents(editor);
      const values = Array.from(range.getClientRects());
      const last = values[values.length - 1];
      return last ? {
        rect: {
          left: Math.round(last.left * 10) / 10,
          top: Math.round(last.top * 10) / 10,
          right: Math.round(last.right * 10) / 10,
          bottom: Math.round(last.bottom * 10) / 10,
          width: Math.round(last.width * 10) / 10,
          height: Math.round(last.height * 10) / 10
        },
        lineRectCount: values.length
      } : null;
    } catch {
      return null;
    }
  }

  function selectionRect(editor) {
    try {
      const selection = window.getSelection?.();
      if (!selection?.rangeCount) return null;
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer?.parentElement;
      if (!(container instanceof Element) || !editor?.contains?.(container)) return null;
      const value = range.getBoundingClientRect();
      return {
        left: Math.round(value.left * 10) / 10,
        top: Math.round(value.top * 10) / 10,
        right: Math.round(value.right * 10) / 10,
        bottom: Math.round(value.bottom * 10) / 10,
        width: Math.round(value.width * 10) / 10,
        height: Math.round(value.height * 10) / 10
      };
    } catch {
      return null;
    }
  }

  function textLengthInfo(editor) {
    const length = Math.min(10000, normalizeText(editor?.textContent || '').length);
    return {
      present: length > 0,
      cappedLength: length,
      bucket: length === 0 ? 'empty' : length <= 20 ? 'short' : length <= 80 ? 'medium' : length <= 240 ? 'long' : 'very_long'
    };
  }

  function internalRichOverlap(trigger) {
    if (!(trigger instanceof Element)) return { pairCount: 0, pairs: [] };
    const parts = [
      ['sparkle', trigger.querySelector('.arcaia-model-sparkle')],
      ['version', trigger.querySelector('.arcaia-model-version')],
      ['subtype', trigger.querySelector('.arcaia-model-suffix')],
      ['performance', trigger.querySelector('.arcaia-model-performance')],
      ['chevron', Array.from(trigger.children).find((child) => child instanceof SVGElement) || null]
    ].filter((entry) => entry[1] instanceof Element);
    const pairs = [];
    for (let index = 0; index < parts.length; index += 1) {
      for (let next = index + 1; next < parts.length; next += 1) {
        const left = rect(parts[index][1]);
        const right = rect(parts[next][1]);
        if (rectsOverlap(left, right)) pairs.push(parts[index][0] + ':' + parts[next][0]);
      }
    }
    return { pairCount: pairs.length, pairs };
  }

  function triggerSummary(trigger) {
    if (!(trigger instanceof HTMLButtonElement)) return null;
    const rich = trigger.querySelector('[data-arcaia-model-rich-content="true"]');
    const native = Array.from(trigger.children).find((child) => child instanceof HTMLElement && child.tagName !== 'SVG' && child !== rich) || null;
    const richInfo = classifyText(rich?.textContent || '');
    const attrVersion = trigger.getAttribute('data-arcaia-model-version');
    const attrPerformance = trigger.getAttribute('data-arcaia-model-performance');
    const computed = window.getComputedStyle(trigger);
    const explicitStyle = trigger.getAttribute('data-arcaia-model-style')
      || trigger.closest?.(COMPOSER_SELECTOR)?.getAttribute?.('data-arcaia-model-style')
      || null;
    return {
      present: true,
      visible: visible(trigger),
      richApplied: trigger.getAttribute('data-arcaia-model-rich') === 'true',
      modelVersion: modelVersion(attrVersion) || richInfo.modelVersion || modelVersion(native?.textContent || ''),
      subtype: richInfo.subtype,
      performance: performanceLabel(attrPerformance) || richInfo.performance || performanceLabel(native?.textContent || ''),
      ariaExpanded: trigger.getAttribute('aria-expanded'),
      dataState: trigger.getAttribute('data-state'),
      explicitStyle,
      auroraFingerprint: /linear-gradient/i.test(computed.backgroundImage) && computed.boxShadow !== 'none',
      style: {
        width: computed.width,
        minWidth: computed.minWidth,
        paddingInlineStart: computed.paddingInlineStart,
        paddingInlineEnd: computed.paddingInlineEnd,
        borderColor: computed.borderColor,
        backgroundImage: String(computed.backgroundImage || '').slice(0, 500),
        boxShadow: String(computed.boxShadow || '').slice(0, 500),
        filter: String(computed.filter || '').slice(0, 120)
      },
      rect: rect(trigger),
      richRect: rect(rich),
      internalOverlap: internalRichOverlap(trigger)
    };
  }

  function itemSummary(item) {
    const info = classifyText(item?.textContent || '');
    return {
      role: item?.getAttribute?.('role') || null,
      selected: item?.getAttribute?.('aria-checked') === 'true' || item?.getAttribute?.('data-state') === 'checked',
      ariaExpanded: item?.getAttribute?.('aria-expanded') || null,
      dataState: item?.getAttribute?.('data-state') || null,
      modelVersion: info.modelVersion,
      subtype: info.subtype,
      performance: info.performance
    };
  }

  function pickerSummary(picker) {
    if (!(picker instanceof Element)) return null;
    const items = Array.from(picker.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"]'))
      .map(itemSummary)
      .filter((item) => item.modelVersion || item.subtype || item.performance || item.selected)
      .slice(0, 24);
    const selected = items.filter((item) => item.selected);
    const slider = picker.querySelector('[role="slider"], input[type="range"]');
    const sliderInfo = slider instanceof Element ? {
      ariaValueNow: slider.getAttribute('aria-valuenow') || null,
      ariaValueText: performanceLabel(slider.getAttribute('aria-valuetext') || ''),
      value: slider instanceof HTMLInputElement ? String(slider.value || '').slice(0, 40) || null : null
    } : null;
    return {
      present: true,
      visible: visible(picker),
      rect: rect(picker),
      items,
      selected,
      slider: sliderInfo
    };
  }

  function buildDomSnapshot(reason, stage) {
    const composer = findComposer();
    const editor = findEditor(composer);
    const trigger = findTrigger(composer);
    const picker = findPicker();
    const editorRect = rect(editor);
    const triggerRect = rect(trigger);
    const textTail = lastTextRect(editor);
    const caretRect = selectionRect(editor);
    const editorStyle = editor instanceof Element ? window.getComputedStyle(editor) : null;
    const composerStyle = composer instanceof HTMLElement ? composer.style : null;
    const triggerState = triggerSummary(trigger);
    const pickerState = pickerSummary(picker);
    const selectedSubtype = pickerState?.selected?.map((item) => item.subtype).find(Boolean) || null;
    const selectedPerformance = pickerState?.selected?.map((item) => item.performance).find(Boolean) || pickerState?.slider?.ariaValueText || null;
    return {
      reason: safeReason(reason),
      stage,
      surface: activeSurfaceFromDom(),
      composerPresent: Boolean(composer),
      editorPresent: Boolean(editor),
      pickerPresent: Boolean(picker),
      editor: editor instanceof Element ? {
        rect: editorRect,
        text: textLengthInfo(editor),
        clientWidth: editor.clientWidth,
        scrollWidth: editor.scrollWidth,
        paddingInlineEnd: editorStyle?.paddingInlineEnd || null,
        lastTextRect: textTail?.rect || null,
        lineRectCount: textTail?.lineRectCount || 0,
        selectionRect: caretRect
      } : null,
      trigger: triggerState,
      picker: pickerState,
      reservation: composer instanceof HTMLElement ? {
        enabled: composer.getAttribute('data-arcaia-model-rich-composer') === 'true',
        nativePaddingEnd: composerStyle?.getPropertyValue('--arcaia-model-native-editor-padding-end')?.trim() || null,
        extraInlineReserve: composerStyle?.getPropertyValue('--arcaia-model-extra-inline-reserve')?.trim() || null
      } : null,
      geometry: {
        editorTriggerBoxOverlapPx: horizontalOverlap(editorRect, triggerRect),
        lastTextTriggerOverlapPx: horizontalOverlap(textTail?.rect || null, triggerRect),
        selectionTriggerOverlapPx: horizontalOverlap(caretRect, triggerRect),
        lastTextToTriggerGapPx: textTail?.rect && triggerRect
          ? Math.round((triggerRect.left - textTail.rect.right) * 10) / 10
          : null,
        pickerTriggerOverlapPx: horizontalOverlap(rect(picker), triggerRect)
      },
      consistency: {
        selectedSubtypePresent: Boolean(selectedSubtype),
        selectedPerformancePresent: Boolean(selectedPerformance),
        selectedSubtypeMatchesDecoration: selectedSubtype && triggerState?.subtype
          ? selectedSubtype === triggerState.subtype
          : null,
        selectedPerformanceMatchesDecoration: selectedPerformance && triggerState?.performance
          ? selectedPerformance === triggerState.performance
          : null
      }
    };
  }

  function compareAuthority(dom, mainState) {
    const surface = dom?.surface || mainState?.surface || null;
    const authorityModel = surface === 'work' ? mainState?.workModel : mainState?.chatModel;
    const authorityEffort = surface === 'work' ? mainState?.workEffort : mainState?.chatEffort;
    const performanceToEffort = new Map([
      ['軽', 'min'], ['Light', 'min'], ['最速', 'min'], ['Fastest', 'min'],
      ['中程度', 'standard'], ['Medium', 'standard'],
      ['高い', 'extended'], ['High', 'extended'],
      ['非常に高い', 'xhigh'], ['Very high', 'xhigh'],
      ['最大', 'max'], ['Maximum', 'max']
    ]);
    const decoratedEffort = performanceToEffort.get(dom?.trigger?.performance) || null;
    return {
      surface,
      authorityFamily: authorityModel?.family || null,
      decoratedFamily: dom?.trigger?.subtype || null,
      authorityEffort: authorityEffort?.value || null,
      decoratedEffort,
      authorityFamilyMatchesDecoration: authorityModel?.family && dom?.trigger?.subtype
        ? authorityModel.family === dom.trigger.subtype
        : null,
      authorityEffortMatchesDecoration: authorityEffort?.value && authorityEffort.value !== 'other' && decoratedEffort
        ? authorityEffort.value === decoratedEffort
        : null
    };
  }

  function requestMainSnapshot(captureId, reason, stage) {
    const requestId = 'main-' + captureId + '-' + Math.random().toString(36).slice(2, 8);
    pendingMain.set(requestId, { captureId, reason, stage });
    window.postMessage({ source: SOURCE, type: 'MAIN_SNAPSHOT_REQUEST', requestId }, '*');
  }

  function requestInternalSnapshot(captureId, reason, stage) {
    const requestId = 'internal-' + captureId + '-' + Math.random().toString(36).slice(2, 8);
    pendingInternal.set(requestId, { captureId, reason, stage });
    window.postMessage({ source: ARCAIA_PROBE_SOURCE, type: INTERNAL_REQUEST, requestId }, '*');
  }

  function capture(reason = 'manual', stage = 'immediate', captureId = null) {
    if (stopped) return null;
    ensureObservers();
    const id = captureId || 'capture-' + (++captureSequence);
    const dom = buildDomSnapshot(reason, stage);
    emit('dom_snapshot', { dom }, id);
    requestMainSnapshot(id, reason, stage);
    requestInternalSnapshot(id, reason, stage);
    return id;
  }

  function scheduleCaptureSeries(reason) {
    const id = capture(reason, 'immediate');
    if (!id) return;
    for (const [stage, delay] of DELAY_STAGES) {
      if (delay === 'raf') {
        requestAnimationFrame(() => capture(reason, stage, id));
        continue;
      }
      const timer = setTimeout(() => {
        delayedTimers.delete(timer);
        capture(reason, stage, id);
      }, delay);
      delayedTimers.add(timer);
    }
  }

  function handleInteraction(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest(PICKER_SELECTOR)) {
      scheduleCaptureSeries('picker_' + event.type);
      return;
    }
    const surface = target.closest('button[role="radio"]');
    if (surface && /^(Chat|Work)$/i.test(normalizeText(surface.textContent || ''))) {
      scheduleCaptureSeries('surface_' + event.type);
      return;
    }
    const composer = target.closest(COMPOSER_SELECTOR);
    if (!composer) return;
    const modelTrigger = target.closest(TRIGGER_SELECTOR);
    if (modelTrigger && composer.contains(modelTrigger)) scheduleCaptureSeries('model_trigger_' + event.type);
  }

  function nodeTouchesModelUi(node) {
    if (!(node instanceof Element)) return false;
    return node.matches?.(TRIGGER_SELECTOR)
      || node.matches?.('[data-arcaia-model-rich-content="true"]')
      || Boolean(node.querySelector?.(TRIGGER_SELECTOR))
      || Boolean(node.querySelector?.('[data-arcaia-model-rich-content="true"]'));
  }

  function handleComposerMutations(mutations) {
    const relevant = Array.from(mutations || []).some((mutation) => {
      if (mutation.type === 'childList') {
        if (nodeTouchesModelUi(mutation.target)) return true;
        return Array.from(mutation.addedNodes || []).some(nodeTouchesModelUi)
          || Array.from(mutation.removedNodes || []).some(nodeTouchesModelUi);
      }
      return mutation.type === 'attributes' && [
        'data-arcaia-model-rich',
        'data-arcaia-model-version',
        'data-arcaia-model-performance',
        'data-arcaia-model-style',
        'aria-expanded',
        'data-state',
        'style'
      ].includes(mutation.attributeName);
    });
    if (relevant) scheduleCaptureSeries('composer_mutation');
  }

  function handlePickerMutations(mutations) {
    const relevant = Array.from(mutations || []).some((mutation) => (
      mutation.type === 'childList'
      || (mutation.type === 'attributes' && ['aria-checked', 'aria-expanded', 'aria-valuenow', 'aria-valuetext', 'data-state'].includes(mutation.attributeName))
    ));
    if (relevant) scheduleCaptureSeries('picker_mutation');
  }

  function observePicker() {
    const picker = findPicker();
    if (picker === observedPicker && pickerObserver) return;
    try { pickerObserver?.disconnect?.(); } catch {}
    pickerObserver = null;
    observedPicker = picker;
    if (!picker) return;
    pickerObserver = new MutationObserver(handlePickerMutations);
    pickerObserver.observe(picker, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-checked', 'aria-expanded', 'aria-valuenow', 'aria-valuetext', 'data-state']
    });
  }

  function observeComposer() {
    const composer = findComposer();
    if (composer === observedComposer && composerObserver) {
      observePicker();
      return true;
    }
    try { composerObserver?.disconnect?.(); } catch {}
    composerObserver = null;
    observedComposer = composer;
    if (!composer) return false;
    composerObserver = new MutationObserver(handleComposerMutations);
    composerObserver.observe(composer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-arcaia-model-rich',
        'data-arcaia-model-version',
        'data-arcaia-model-performance',
        'data-arcaia-model-style',
        'aria-expanded',
        'data-state',
        'style'
      ]
    });
    observePicker();
    return true;
  }

  function stopBootstrap() {
    try { bootstrapObserver?.disconnect?.(); } catch {}
    bootstrapObserver = null;
    if (bootstrapTimer) clearTimeout(bootstrapTimer);
    bootstrapTimer = null;
  }

  function ensureObservers() {
    if (observeComposer()) {
      stopBootstrap();
      return;
    }
    if (bootstrapObserver || stopped) return;
    const root = document.documentElement;
    if (!root) return;
    bootstrapObserver = new MutationObserver(() => {
      if (observeComposer()) scheduleCaptureSeries('composer_discovered');
    });
    bootstrapObserver.observe(root, { childList: true, subtree: true });
    bootstrapTimer = setTimeout(stopBootstrap, BOOTSTRAP_TIMEOUT_MS);
  }

  function sanitizeInternal(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const identifier = (value) => normalizeText(value).replace(/[^a-z0-9_.:-]+/gi, '_').slice(0, 80) || null;
    return {
      apiPresent: Boolean(source.apiPresent),
      snapshotAvailable: Boolean(source.snapshotAvailable),
      activeSurfaceModePresent: Boolean(source.activeSurfaceModePresent),
      activeSurfaceMode: source.activeSurfaceMode === 'work' || source.activeSurfaceMode === 'chatgpt' ? source.activeSurfaceMode : null,
      newChatModelConfigPresent: Boolean(source.newChatModelConfigPresent),
      newChatStateCandidateFound: Boolean(source.newChatStateCandidateFound),
      resolvedContextKind: identifier(source.resolvedContextKind),
      triggerFound: Boolean(source.triggerFound),
      scanReason: identifier(source.scanReason),
      scanOutcome: identifier(source.scanOutcome)
    };
  }

  function handleWindowMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.source === MAIN_SOURCE) {
      if (data.type === 'storage_mutation' || data.type === 'storage_event' || data.type === 'ready') {
        emit('main_event', { eventType: data.type, state: data.payload?.state || null });
        if (data.type !== 'ready') scheduleCaptureSeries('main_' + data.type);
        return;
      }
      if (data.type === 'MAIN_SNAPSHOT_RESPONSE' && typeof data.requestId === 'string') {
        const pending = pendingMain.get(data.requestId);
        pendingMain.delete(data.requestId);
        if (!pending) return;
        const dom = buildDomSnapshot(pending.reason, pending.stage);
        const state = data.payload?.state || null;
        emit('main_state_snapshot', {
          reason: pending.reason,
          stage: pending.stage,
          state,
          consistency: compareAuthority(dom, state),
          dom
        }, pending.captureId);
        return;
      }
    }
    if (data?.source === ARCAIA_PROBE_SOURCE && data.type === INTERNAL_RESPONSE && typeof data.requestId === 'string') {
      const pending = pendingInternal.get(data.requestId);
      pendingInternal.delete(data.requestId);
      if (!pending) return;
      emit('arcaia_internal_snapshot', {
        reason: pending.reason,
        stage: pending.stage,
        internal: sanitizeInternal(data.payload),
        dom: buildDomSnapshot(pending.reason, pending.stage)
      }, pending.captureId);
    }
  }

  function summary() {
    const domRecords = records.filter((record) => record.type === 'dom_snapshot').map((record) => record.dom).filter(Boolean);
    const mainRecords = records.filter((record) => record.type === 'main_state_snapshot');
    const overlapValues = domRecords.map((dom) => dom.geometry?.lastTextTriggerOverlapPx || 0);
    return {
      recordCount: records.length,
      droppedRecordCount,
      domSnapshotCount: domRecords.length,
      mainSnapshotCount: mainRecords.length,
      maxLastTextTriggerOverlapPx: overlapValues.length ? Math.max(...overlapValues) : 0,
      snapshotsWithTextOverlap: overlapValues.filter((value) => value > 0).length,
      snapshotsWithInternalDecorationOverlap: domRecords.filter((dom) => (dom.trigger?.internalOverlap?.pairCount || 0) > 0).length,
      pickerDecorationSubtypeMismatchCount: domRecords.filter((dom) => dom.consistency?.selectedSubtypeMatchesDecoration === false).length,
      pickerDecorationPerformanceMismatchCount: domRecords.filter((dom) => dom.consistency?.selectedPerformanceMatchesDecoration === false).length,
      authorityDecorationFamilyMismatchCount: mainRecords.filter((record) => record.consistency?.authorityFamilyMatchesDecoration === false).length,
      authorityDecorationEffortMismatchCount: mainRecords.filter((record) => record.consistency?.authorityEffortMatchesDecoration === false).length
    };
  }

  function report() {
    return {
      probe: 'arcaia_model_selector_interaction_probe',
      probeVersion: PROBE_VERSION,
      generatedAt: new Date().toISOString(),
      durationMs: elapsedMs(),
      stopped,
      privacy: {
        conversationTextStored: false,
        urlStored: false,
        conversationIdStored: false,
        rawCookieStored: false,
        rawStorageStored: false
      },
      summary: summary(),
      records: records.slice()
    };
  }

  function save() {
    const payload = report();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'arcaia-model-selector-interaction-probe-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    anchor.style.display = 'none';
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    return payload.summary;
  }

  function reset() {
    records = [];
    droppedRecordCount = 0;
    sequence = 0;
    captureSequence = 0;
    startedAt = Date.now();
    emit('session_reset');
    scheduleCaptureSeries('reset');
    return report();
  }

  function mark(scenario) {
    const safeScenario = safeReason(scenario);
    emit('scenario_marker', { scenario: safeScenario });
    scheduleCaptureSeries('manual_' + safeScenario);
    return safeScenario;
  }

  function stop(reason = 'manual_stop') {
    if (stopped) return report();
    stopped = true;
    emit('probe_stopped', { reason: safeReason(reason) });
    stopBootstrap();
    try { composerObserver?.disconnect?.(); } catch {}
    try { pickerObserver?.disconnect?.(); } catch {}
    composerObserver = null;
    pickerObserver = null;
    observedComposer = null;
    observedPicker = null;
    document.removeEventListener('pointerup', handleInteraction, true);
    document.removeEventListener('click', handleInteraction, true);
    document.removeEventListener('change', handleInteraction, true);
    document.removeEventListener('focusout', handleInteraction, true);
    window.removeEventListener('message', handleWindowMessage);
    for (const timer of delayedTimers) clearTimeout(timer);
    delayedTimers.clear();
    if (durationTimer) clearTimeout(durationTimer);
    durationTimer = null;
    window.postMessage({ source: SOURCE, type: 'MAIN_STOP_REQUEST' }, '*');
    return report();
  }

  function status() {
    return {
      ok: true,
      running: !stopped,
      elapsedMs: elapsedMs(),
      summary: summary()
    };
  }

  function handleRuntimeMessage(message, _sender, sendResponse) {
    const action = message?.action;
    try {
      if (action === 'status') sendResponse(status());
      else if (action === 'capture') sendResponse({ ok: true, captureId: capture('popup_capture') });
      else if (action === 'mark') sendResponse({ ok: true, scenario: mark(message?.scenario || 'manual') });
      else if (action === 'save') sendResponse({ ok: true, summary: save() });
      else if (action === 'reset') sendResponse({ ok: true, report: reset() });
      else if (action === 'stop') sendResponse({ ok: true, report: stop('popup_stop') });
      else sendResponse({ ok: false, error: 'unknown_action' });
    } catch (error) {
      sendResponse({ ok: false, error: normalizeText(error?.message || error).slice(0, 160) });
    }
    return true;
  }

  document.addEventListener('pointerup', handleInteraction, true);
  document.addEventListener('click', handleInteraction, true);
  document.addEventListener('change', handleInteraction, true);
  document.addEventListener('focusout', handleInteraction, true);
  window.addEventListener('message', handleWindowMessage);
  if (globalThis.chrome?.runtime?.onMessage) chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  durationTimer = setTimeout(() => stop('duration_limit'), MAX_DURATION_MS);
  ensureObservers();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleCaptureSeries('dom_content_loaded'), { once: true });
  } else {
    scheduleCaptureSeries('startup');
  }

  window[API_KEY] = Object.freeze({
    capture: (reason = 'api_capture') => capture(reason),
    mark,
    report,
    reset,
    save,
    status,
    stop
  });
})();
