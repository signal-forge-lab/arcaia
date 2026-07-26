(() => {
  'use strict';

  /*
   * Arcaia model-selector observer-scope probe
   *
   * Purpose:
   * - Identify stable Composer / trigger roots.
   * - Identify the Portal menu / picker insertion parent.
   * - Record replacements across new Chat, existing Chat, and Work.
   * - Provide evidence before narrowing the production MutationObserver.
   *
   * Suggested run:
   * 1. Paste this file into the ChatGPT DevTools Console.
   * 2. On a new Chat, open/close the model picker and change thinking level.
   * 3. Switch Chat <-> Work and repeat.
   * 4. Open an existing conversation, then return to a new Chat.
   * 5. Run:
   *      window.__ARCAIA_MODEL_SELECTOR_OBSERVER_SCOPE_PROBE__.download()
   *      window.__ARCAIA_MODEL_SELECTOR_OBSERVER_SCOPE_PROBE__.stop()
   *
   * The broad observer exists only inside this manually executed probe.
   */

  const API_KEY = '__ARCAIA_MODEL_SELECTOR_OBSERVER_SCOPE_PROBE__';
  const COMPOSER_SELECTOR = 'form[data-type="unified-composer"]';
  const PICKER_SELECTOR = '[data-testid="composer-intelligence-picker-content"]';
  const THINKING_SLIDER_HOST_SELECTOR = '[data-testid="composer-model-picker-slider-simple-view"]';
  const SURFACE_RADIO_SELECTOR = 'button[role="radio"]';
  const MAX_RECORDS = 1200;
  const MAX_ANCESTOR_DEPTH = 9;
  const WATCHDOG_INTERVAL_MS = 800;

  if (window[API_KEY]?.stop) {
    try { window[API_KEY].stop(); } catch {}
  }

  const startedAt = performance.now();
  const startedAtIso = new Date().toISOString();
  const records = [];
  const structuralSamples = [];
  const elementKeys = new WeakMap();
  let nextElementKey = 1;
  let stopped = false;
  let observer = null;
  let watchdogTimer = null;
  let snapshotQueued = false;
  let lastStructuralSignature = '';
  let totalObserverCallbacks = 0;
  let relevantObserverCallbacks = 0;
  let totalMutationRecords = 0;
  let relevantMutationRecords = 0;

  function elapsedMs() {
    return Math.round((performance.now() - startedAt) * 10) / 10;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function sanitizeUiText(value) {
    const text = normalizeText(value);
    if (!text) return null;
    if (/^(chat|work)$/i.test(text)) return text;
    if (/^(軽|最速|中程度|高い|非常に高い|最大|Light|Fastest|Medium|High|Very high|Maximum)$/i.test(text)) return text;
    const modelVersion = text.match(/GPT[-\s]?\d+(?:\.\d+)?/i)?.[0] || null;
    return modelVersion || '[other-ui-text]';
  }

  function push(record) {
    records.push({ atMs: elapsedMs(), ...record });
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  }

  function getElementKey(element) {
    if (!(element instanceof Element)) return null;
    if (!elementKeys.has(element)) elementKeys.set(element, `node-${nextElementKey++}`);
    return elementKeys.get(element);
  }

  function classifyContext() {
    const pathname = String(location.pathname || '');
    if (/^\/c\//i.test(pathname)) return 'existing_chat';
    if (/^\/$/.test(pathname) || /^\/?$/.test(pathname)) return 'new_chat';
    return 'other_chatgpt_route';
  }

  function getActiveSurfaceMode() {
    const active = Array.from(document.querySelectorAll(SURFACE_RADIO_SELECTOR)).find((button) => {
      const text = normalizeText(button.textContent).toLowerCase();
      const activeState = button.getAttribute('data-state') === 'on'
        || button.getAttribute('aria-checked') === 'true'
        || button.getAttribute('aria-selected') === 'true';
      return activeState && (text === 'chat' || text === 'work');
    });
    const label = normalizeText(active?.textContent).toLowerCase();
    if (label === 'work') return 'work';
    if (label === 'chat') return 'chat';
    return null;
  }

  function safeSelectorHint(element) {
    if (!(element instanceof Element)) return null;
    const tag = element.tagName.toLowerCase();
    const testId = element.getAttribute('data-testid');
    const dataType = element.getAttribute('data-type');
    const role = element.getAttribute('role');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    if (dataType) return `${tag}[data-type="${CSS.escape(dataType)}"]`;
    if (element === document.body) return 'body';
    if (element === document.documentElement) return 'html';
    if (tag === 'main' || tag === 'header' || tag === 'nav' || tag === 'form') return tag;
    if (role) return `${tag}[role="${CSS.escape(role)}"]`;
    return tag;
  }

  function selectorMatchCount(selector) {
    if (!selector) return null;
    try { return document.querySelectorAll(selector).length; } catch { return null; }
  }

  function describeElement(element) {
    if (!(element instanceof Element)) return null;
    const selectorHint = safeSelectorHint(element);
    const text = element.matches('button, [role="menuitem"], [role="menuitemradio"], [role="radio"]')
      ? sanitizeUiText(element.textContent)
      : null;
    return {
      key: getElementKey(element),
      tag: element.tagName.toLowerCase(),
      selectorHint,
      selectorMatchCount: selectorMatchCount(selectorHint),
      idPresent: Boolean(element.id),
      role: element.getAttribute('role'),
      dataTestId: element.getAttribute('data-testid'),
      dataType: element.getAttribute('data-type'),
      dataState: element.getAttribute('data-state'),
      ariaExpanded: element.getAttribute('aria-expanded'),
      ariaChecked: element.getAttribute('aria-checked'),
      ariaSelected: element.getAttribute('aria-selected'),
      ariaLabelledByPresent: Boolean(element.getAttribute('aria-labelledby')),
      text,
      connected: Boolean(element.isConnected),
      childElementCount: element.children?.length || 0,
      insideMain: Boolean(element.closest('main')),
      insideComposer: Boolean(element.closest(COMPOSER_SELECTOR))
    };
  }

  function describeAncestorChain(element) {
    const chain = [];
    let current = element instanceof Element ? element : null;
    for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
      chain.push({ depth, ...describeElement(current) });
      current = current.parentElement;
    }
    return chain;
  }

  function getVisiblePicker() {
    return Array.from(document.querySelectorAll(PICKER_SELECTOR)).find((picker) => {
      const menu = picker.closest('[role="menu"]');
      return picker.isConnected && !picker.hidden && menu?.getAttribute('data-state') !== 'closed';
    }) || null;
  }

  function getTrigger(picker, composer) {
    const menu = picker?.closest('[role="menu"][aria-labelledby]') || null;
    const labelledBy = menu?.getAttribute('aria-labelledby');
    const labelledTrigger = labelledBy ? document.getElementById(labelledBy) : null;
    if (labelledTrigger instanceof HTMLButtonElement) return labelledTrigger;
    return Array.from(composer?.querySelectorAll?.('button[aria-haspopup="menu"]') || []).find((button) => {
      const text = normalizeText(button.textContent);
      return /GPT[-\s]?\d+(?:\.\d+)?/i.test(text)
        || /^(軽|最速|中程度|高い|非常に高い|最大|Light|Fastest|Medium|High|Very high|Maximum)$/i.test(text);
    }) || null;
  }

  function nearestCommonAncestor(left, right) {
    if (!(left instanceof Element) || !(right instanceof Element)) return null;
    const leftAncestors = new Set();
    for (let node = left; node; node = node.parentElement) leftAncestors.add(node);
    for (let node = right; node; node = node.parentElement) {
      if (leftAncestors.has(node)) return node;
    }
    return null;
  }

  function countDepthToAncestor(element, ancestor) {
    if (!(element instanceof Element) || !(ancestor instanceof Element)) return null;
    let depth = 0;
    for (let node = element; node; node = node.parentElement, depth += 1) {
      if (node === ancestor) return depth;
    }
    return null;
  }

  function createStructuralSnapshot(reason) {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    const picker = getVisiblePicker();
    const pickerMenu = picker?.closest('[role="menu"]') || null;
    const trigger = getTrigger(picker, composer);
    const commonAncestor = nearestCommonAncestor(trigger, picker);
    const slider = picker?.querySelector(`${THINKING_SLIDER_HOST_SELECTOR} [role="slider"]`) || null;
    return {
      reason,
      contextKind: classifyContext(),
      surfaceMode: getActiveSurfaceMode(),
      composer: describeElement(composer),
      composerChain: describeAncestorChain(composer),
      trigger: describeElement(trigger),
      triggerChain: describeAncestorChain(trigger),
      picker: describeElement(picker),
      pickerChain: describeAncestorChain(picker),
      pickerMenu: describeElement(pickerMenu),
      pickerMenuChain: describeAncestorChain(pickerMenu),
      pickerInsertionParent: describeElement(pickerMenu?.parentElement || picker?.parentElement || null),
      slider: describeElement(slider),
      triggerPickerCommonAncestor: describeElement(commonAncestor),
      triggerDepthToCommonAncestor: countDepthToAncestor(trigger, commonAncestor),
      pickerDepthToCommonAncestor: countDepthToAncestor(picker, commonAncestor)
    };
  }

  function structuralSignature(snapshot) {
    return JSON.stringify({
      contextKind: snapshot.contextKind,
      surfaceMode: snapshot.surfaceMode,
      composerKey: snapshot.composer?.key || null,
      composerParentKey: snapshot.composerChain?.[1]?.key || null,
      triggerKey: snapshot.trigger?.key || null,
      triggerParentKey: snapshot.triggerChain?.[1]?.key || null,
      pickerKey: snapshot.picker?.key || null,
      pickerMenuKey: snapshot.pickerMenu?.key || null,
      pickerInsertionParentKey: snapshot.pickerInsertionParent?.key || null,
      commonAncestorKey: snapshot.triggerPickerCommonAncestor?.key || null,
      sliderKey: snapshot.slider?.key || null
    });
  }

  function snapshot(reason = 'manual') {
    if (stopped) return null;
    const structural = createStructuralSnapshot(reason);
    const signature = structuralSignature(structural);
    const changed = signature !== lastStructuralSignature;
    lastStructuralSignature = signature;
    structuralSamples.push({ atMs: elapsedMs(), ...structural });
    push({ type: 'structural_snapshot', changed, ...structural });
    return structural;
  }

  function queueSnapshot(reason) {
    if (snapshotQueued || stopped) return;
    snapshotQueued = true;
    const run = () => {
      snapshotQueued = false;
      snapshot(reason);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function nodeContainsRelevantUi(node) {
    if (!(node instanceof Element)) return false;
    const selector = [
      COMPOSER_SELECTOR,
      PICKER_SELECTOR,
      THINKING_SLIDER_HOST_SELECTOR,
      'button[aria-haspopup="menu"]',
      '[role="menu"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      SURFACE_RADIO_SELECTOR
    ].join(', ');
    return node.matches(selector) || Boolean(node.querySelector(selector));
  }

  function mutationIsRelevant(mutation) {
    if (mutation.type === 'attributes') {
      const target = mutation.target instanceof Element ? mutation.target : null;
      return Boolean(target && (
        target.matches(`${COMPOSER_SELECTOR}, ${PICKER_SELECTOR}, ${THINKING_SLIDER_HOST_SELECTOR}, button[aria-haspopup="menu"], [role="menu"], [role="menuitem"], [role="menuitemradio"], ${SURFACE_RADIO_SELECTOR}`)
        || target.closest(PICKER_SELECTOR)
        || target.closest(COMPOSER_SELECTOR)
      ));
    }
    return [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])]
      .some(nodeContainsRelevantUi);
  }

  function describeMutation(mutation) {
    return {
      mutationType: mutation.type,
      attributeName: mutation.attributeName || null,
      target: describeElement(mutation.target),
      relevantAddedNodeCount: Array.from(mutation.addedNodes || []).filter(nodeContainsRelevantUi).length,
      relevantRemovedNodeCount: Array.from(mutation.removedNodes || []).filter(nodeContainsRelevantUi).length
    };
  }

  function handleMutations(mutations) {
    totalObserverCallbacks += 1;
    totalMutationRecords += mutations.length;
    const relevant = mutations.filter(mutationIsRelevant);
    if (!relevant.length) return;
    relevantObserverCallbacks += 1;
    relevantMutationRecords += relevant.length;
    push({
      type: 'relevant_mutation_batch',
      mutationCount: mutations.length,
      relevantMutationCount: relevant.length,
      mutations: relevant.slice(0, 16).map(describeMutation)
    });
    queueSnapshot('relevant_mutation');
  }

  function handleInteraction(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const relevantTarget = target.closest([
      'button[aria-haspopup="menu"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      SURFACE_RADIO_SELECTOR,
      `${THINKING_SLIDER_HOST_SELECTOR} [role="slider"]`
    ].join(', '));
    if (!relevantTarget) return;
    push({ type: 'interaction', eventType: event.type, target: describeElement(relevantTarget) });
    queueSnapshot(`interaction:${event.type}`);
  }

  function frequencyBy(samples, accessor) {
    const counts = new Map();
    for (const sample of samples) {
      const item = accessor(sample);
      const key = item?.key || null;
      if (!key) continue;
      const existing = counts.get(key) || { count: 0, element: item };
      existing.count += 1;
      counts.set(key, existing);
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }

  function buildReport() {
    const latest = structuralSamples[structuralSamples.length - 1] || createStructuralSnapshot('report');
    return {
      probe: 'arcaia_model_selector_observer_scope',
      startedAt: startedAtIso,
      generatedAt: new Date().toISOString(),
      durationMs: elapsedMs(),
      stopped,
      observerStats: {
        totalObserverCallbacks,
        relevantObserverCallbacks,
        totalMutationRecords,
        relevantMutationRecords,
        irrelevantCallbackRatio: totalObserverCallbacks
          ? Math.round(((totalObserverCallbacks - relevantObserverCallbacks) / totalObserverCallbacks) * 1000) / 1000
          : 0
      },
      identityFrequency: {
        composer: frequencyBy(structuralSamples, (sample) => sample.composer),
        composerParent: frequencyBy(structuralSamples, (sample) => sample.composerChain?.[1]),
        trigger: frequencyBy(structuralSamples, (sample) => sample.trigger),
        triggerParent: frequencyBy(structuralSamples, (sample) => sample.triggerChain?.[1]),
        picker: frequencyBy(structuralSamples, (sample) => sample.picker),
        pickerMenu: frequencyBy(structuralSamples, (sample) => sample.pickerMenu),
        pickerInsertionParent: frequencyBy(structuralSamples, (sample) => sample.pickerInsertionParent),
        triggerPickerCommonAncestor: frequencyBy(structuralSamples, (sample) => sample.triggerPickerCommonAncestor)
      },
      latest,
      structuralSamples,
      records,
      privacy: {
        rawUrlStored: false,
        rawDomIdsStored: false,
        arbitraryUiTextStored: false,
        elementIdentityUsesSessionLocalSequence: true
      },
      reviewChecklist: [
        'Compare composerParent identity across new Chat, existing Chat, and Work.',
        'Confirm whether the trigger remains inside the same Composer subtree after navigation.',
        'Confirm the picker menu insertion parent and whether it is a Portal outside Composer.',
        'Confirm the smallest stable ancestor that sees picker insertion/replacement.',
        'Do not narrow the production observer until Chat, Work, and new Chat samples are all present.'
      ]
    };
  }

  function download() {
    const report = buildReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `arcaia-model-selector-observer-scope-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return report;
  }

  function stop() {
    if (stopped) return buildReport();
    stopped = true;
    try { observer?.disconnect(); } catch {}
    observer = null;
    if (watchdogTimer != null) clearInterval(watchdogTimer);
    watchdogTimer = null;
    for (const type of ['pointerdown', 'click', 'change', 'input', 'menu.itemSelect']) {
      document.removeEventListener(type, handleInteraction, true);
    }
    window.removeEventListener('popstate', handleNavigation);
    window.removeEventListener('hashchange', handleNavigation);
    push({ type: 'stopped' });
    return buildReport();
  }

  function handleNavigation(event) {
    push({ type: 'navigation_event', eventType: event.type });
    queueSnapshot(`navigation:${event.type}`);
  }

  observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'data-state',
      'aria-checked',
      'aria-selected',
      'aria-expanded',
      'aria-labelledby',
      'aria-valuenow'
    ]
  });

  for (const type of ['pointerdown', 'click', 'change', 'input', 'menu.itemSelect']) {
    document.addEventListener(type, handleInteraction, true);
  }
  window.addEventListener('popstate', handleNavigation);
  window.addEventListener('hashchange', handleNavigation);

  watchdogTimer = setInterval(() => {
    if (stopped || document.hidden) return;
    const next = createStructuralSnapshot('watchdog');
    const signature = structuralSignature(next);
    if (signature !== lastStructuralSignature) snapshot('watchdog_identity_change');
  }, WATCHDOG_INTERVAL_MS);

  const api = {
    snapshot,
    mark: snapshot,
    report: buildReport,
    dump: buildReport,
    download,
    stop
  };
  window[API_KEY] = api;
  snapshot('startup');

  console.info('[Arcaia] Model selector observer-scope probe started.');
  console.info(`[Arcaia] Export: window.${API_KEY}.download()`);
  console.info(`[Arcaia] Stop: window.${API_KEY}.stop()`);
})();
