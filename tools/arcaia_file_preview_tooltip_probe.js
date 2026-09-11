(() => {
  'use strict';

  const API_KEY = '__ARCAIA_FILE_PREVIEW_TOOLTIP_PROBE__';
  const PANEL_SELECTOR = 'section[data-testid="screen-threadFlyOut"]';
  const CUSTOM_BUTTON_SELECTOR = '[data-arcaia-file-preview-copy-button="true"]';
  const TOOLTIP_SELECTOR = '[role="tooltip"],[data-radix-popper-content-wrapper],#arcaia-file-preview-copy-tooltip';
  const MAX_EVENTS = 120;
  const MAX_SNAPSHOTS = 80;
  const MAX_CLASSES = 20;
  const PROBE_TIMEOUT_MS = 90000;
  const AUTO_FINISH_DELAY_MS = 2400;

  try { window[API_KEY]?.cancel?.(); } catch {}

  const startedAt = Date.now();
  const events = [];
  const snapshots = [];
  const timers = new Set();
  const seenKinds = new Set();
  let observer = null;
  let stopped = false;
  let finalReport = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function round(value) {
    return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  }

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function safeToken(value, maxLength = 100) {
    const text = normalize(value);
    if (!text || text.length > maxLength) return null;
    if (/https?:\/\/|blob:|data:|@|[\\/]{2,}/i.test(text)) return null;
    if (/^[0-9a-f-]{24,}$/i.test(text)) return null;
    return text;
  }

  function classTokens(element) {
    return Array.from(element?.classList || [])
      .map((token) => safeToken(token, 80))
      .filter(Boolean)
      .slice(0, MAX_CLASSES);
  }

  function rectOf(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
      right: round(rect.right),
      bottom: round(rect.bottom),
      intersectsViewport: rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight,
      fullyInViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      outsideTop: rect.bottom <= 0 || rect.top < 0,
      outsideBottom: rect.top >= innerHeight || rect.bottom > innerHeight
    };
  }

  function styleOf(element) {
    const style = getComputedStyle(element);
    return {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      position: style.position,
      zIndex: style.zIndex,
      pointerEvents: style.pointerEvents,
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderRadius: style.borderRadius,
      padding: style.padding,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      boxShadow: style.boxShadow,
      transform: style.transform,
      overflow: style.overflow
    };
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) !== 0;
  }

  function labelKind(element) {
    const label = normalize([
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.textContent
    ].filter(Boolean).join(' ')).toLowerCase();
    if (/コピーしました|copied/.test(label)) return 'copied';
    if (/コピー|copy/.test(label)) return 'copy';
    if (/ダウンロード|download/.test(label)) return 'download';
    if (/閉じる|close/.test(label)) return 'close';
    return 'other';
  }

  function describeButton(button) {
    if (!(button instanceof Element)) return null;
    return {
      kind: classifyButton(button),
      labelKind: labelKind(button),
      dataTestId: safeToken(button.getAttribute('data-testid')),
      classTokens: classTokens(button),
      disabled: button.matches(':disabled,[aria-disabled="true"]'),
      ariaDescribedByPresent: Boolean(button.getAttribute('aria-describedby')),
      copiedState: safeToken(button.getAttribute('data-arcaia-copied')),
      rect: rectOf(button),
      style: styleOf(button)
    };
  }

  function describeAncestor(element) {
    if (!(element instanceof Element)) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      role: safeToken(element.getAttribute('role')),
      classTokens: classTokens(element),
      radixWrapper: element.hasAttribute('data-radix-popper-content-wrapper'),
      position: style.position,
      zIndex: style.zIndex,
      overflow: style.overflow
    };
  }

  function describeTooltip(element) {
    const ancestors = [];
    let current = element.parentElement;
    while (current instanceof Element && ancestors.length < 6) {
      ancestors.push(describeAncestor(current));
      if (current === document.body) break;
      current = current.parentElement;
    }
    return {
      sourceKind: element.id === 'arcaia-file-preview-copy-tooltip' ? 'arcaia' : 'native_or_unknown',
      associatedButtonKind: getAssociatedButtonKind(element),
      tag: element.tagName.toLowerCase(),
      role: safeToken(element.getAttribute('role')),
      idKind: element.id === 'arcaia-file-preview-copy-tooltip' ? 'arcaia_tooltip' : (element.id ? 'generated_id' : 'none'),
      labelKind: labelKind(element),
      textLength: String(element.textContent || '').length,
      dataState: safeToken(element.getAttribute('data-state')),
      dataSide: safeToken(element.getAttribute('data-side')),
      dataAlign: safeToken(element.getAttribute('data-align')),
      classTokens: classTokens(element),
      visible: isVisible(element),
      rect: rectOf(element),
      style: styleOf(element),
      ancestors
    };
  }

  function getAssociatedButtonKind(element) {
    const id = String(element?.id || '');
    if (!id) return 'none';
    for (const button of document.querySelectorAll('button[aria-describedby],[role="button"][aria-describedby]')) {
      if (String(button.getAttribute('aria-describedby') || '').split(/\s+/).includes(id)) return classifyButton(button);
    }
    return 'none';
  }

  function findPanel() {
    return Array.from(document.querySelectorAll(PANEL_SELECTOR)).find((panel) => isVisible(panel)) || null;
  }

  function classifyButton(button) {
    if (!(button instanceof Element)) return 'other';
    if (button.matches(CUSTOM_BUTTON_SELECTOR)) return 'arcaia_copy';
    const panel = button.closest(PANEL_SELECTOR);
    if (!panel) return 'other';
    if (button.matches('[data-testid="close-button"]') || labelKind(button) === 'close') return 'native_close';
    if (labelKind(button) === 'download') return 'native_download';
    const closeButton = panel.querySelector('button[data-testid="close-button"]');
    if (closeButton?.parentElement === button.parentElement) return 'native_toolbar';
    return 'other';
  }

  function findEventButton(event) {
    for (const item of event.composedPath?.() || []) {
      if (item instanceof Element) {
        const button = item.closest?.('button,[role="button"]');
        if (button) return button;
      }
    }
    return event.target instanceof Element ? event.target.closest('button,[role="button"]') : null;
  }

  function tooltipCandidates() {
    return Array.from(document.querySelectorAll(TOOLTIP_SELECTOR))
      .slice(0, 16)
      .map(describeTooltip);
  }

  function pushEvent(entry) {
    if (events.length >= MAX_EVENTS) return;
    events.push({ atIso: nowIso(), elapsedMs: Date.now() - startedAt, ...entry });
  }

  function takeSnapshot(reason, triggerKind = null) {
    if (stopped || snapshots.length >= MAX_SNAPSHOTS) return;
    const panel = findPanel();
    const customButton = panel?.querySelector(CUSTOM_BUTTON_SELECTOR) || document.querySelector(CUSTOM_BUTTON_SELECTOR);
    const nativeButtons = panel
      ? Array.from(panel.querySelectorAll('button')).filter((button) => ['native_download', 'native_toolbar'].includes(classifyButton(button)))
      : [];
    snapshots.push({
      atIso: nowIso(),
      elapsedMs: Date.now() - startedAt,
      reason,
      triggerKind,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      panelPresent: Boolean(panel),
      customButton: describeButton(customButton),
      nativeButtons: nativeButtons.slice(0, 4).map(describeButton),
      tooltips: tooltipCandidates()
    });
  }

  function scheduleSnapshot(delay, reason, triggerKind) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      takeSnapshot(reason, triggerKind);
    }, delay);
    timers.add(timer);
  }

  function handleInteraction(event) {
    const button = findEventButton(event);
    const kind = classifyButton(button);
    if (!['arcaia_copy', 'native_download', 'native_toolbar'].includes(kind)) return;
    if (event.type === 'pointerover' && event.relatedTarget instanceof Node && button.contains(event.relatedTarget)) return;
    seenKinds.add(kind === 'arcaia_copy' ? 'arcaia' : 'native');
    pushEvent({ type: event.type, targetKind: kind, isTrusted: event.isTrusted, button: describeButton(button) });
    takeSnapshot(`interaction:${event.type}`, kind);
    for (const delay of [80, 300, 800, 1600]) scheduleSnapshot(delay, `after_${event.type}_${delay}ms`, kind);
    if (seenKinds.has('arcaia') && seenKinds.has('native')) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        finish('both_targets_observed');
      }, AUTO_FINISH_DELAY_MS);
      timers.add(timer);
    }
  }

  function mutationTouchesTooltip(mutation) {
    if (mutation.type === 'attributes') return mutation.target instanceof Element && mutation.target.matches(TOOLTIP_SELECTOR);
    return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => (
      node instanceof Element && (node.matches(TOOLTIP_SELECTOR) || node.querySelector(TOOLTIP_SELECTOR))
    ));
  }

  function buildDiagnosis() {
    const arcaiaEvents = events.filter((event) => event.targetKind === 'arcaia_copy');
    const nativeEvents = events.filter((event) => event.targetKind === 'native_download' || event.targetKind === 'native_toolbar');
    const observedTooltips = snapshots.flatMap((snapshot) => (
      snapshot.tooltips.map((tooltip) => ({ ...tooltip, triggerKind: snapshot.triggerKind }))
    ));
    const arcaiaTooltips = observedTooltips.filter((tooltip) => (
      tooltip.sourceKind === 'arcaia' || tooltip.associatedButtonKind === 'arcaia_copy'
    ));
    const nativeTooltips = observedTooltips.filter((tooltip) => (
      tooltip.associatedButtonKind === 'native_download'
      || tooltip.associatedButtonKind === 'native_toolbar'
      || tooltip.triggerKind === 'native_download'
      || tooltip.triggerKind === 'native_toolbar'
    ));
    const visibleArcaia = arcaiaTooltips.find((tooltip) => tooltip.visible);
    const inViewportArcaia = arcaiaTooltips.find((tooltip) => tooltip.visible && tooltip.rect.intersectsViewport);
    let likelyCause = 'insufficient_evidence';
    if (!arcaiaEvents.length) likelyCause = 'arcaia_hover_event_not_observed';
    else if (!arcaiaTooltips.length) likelyCause = 'arcaia_event_observed_but_tooltip_dom_not_created';
    else if (!visibleArcaia) likelyCause = 'arcaia_tooltip_created_but_hidden_by_style';
    else if (!inViewportArcaia && arcaiaTooltips.some((tooltip) => tooltip.rect.outsideTop)) likelyCause = 'arcaia_tooltip_positioned_above_viewport';
    else if (!inViewportArcaia) likelyCause = 'arcaia_tooltip_outside_viewport';
    else likelyCause = 'arcaia_tooltip_visible_in_probe';
    return {
      likelyCause,
      arcaiaHoverObserved: arcaiaEvents.length > 0,
      nativeHoverObserved: nativeEvents.length > 0,
      arcaiaTooltipDomObserved: arcaiaTooltips.length > 0,
      nativeTooltipDomObserved: nativeTooltips.length > 0,
      arcaiaTooltipVisibleInViewport: Boolean(inViewportArcaia),
      arcaiaSides: [...new Set(arcaiaTooltips.map((tooltip) => tooltip.dataSide).filter(Boolean))],
      nativeSides: [...new Set(nativeTooltips.map((tooltip) => tooltip.dataSide).filter(Boolean))]
    };
  }

  function buildReport(reason) {
    return {
      probe: {
        name: 'Arcaia File Preview Tooltip Comparison Console Probe',
        version: '1.0.0',
        startedAtIso: new Date(startedAt).toISOString(),
        finishedAtIso: nowIso(),
        durationMs: Date.now() - startedAt,
        finishReason: reason
      },
      privacy: {
        conversationTextCollected: false,
        fileContentsCollected: false,
        fileNamesCollected: false,
        urlsCollected: false,
        htmlCollected: false,
        cookiesCollected: false,
        authorizationCollected: false,
        storageValuesCollected: false,
        tooltipTextCollected: false
      },
      setup: {
        panelPresentAtFinish: Boolean(findPanel()),
        instructionsCompleted: seenKinds.has('native') && seenKinds.has('arcaia')
      },
      diagnosis: buildDiagnosis(),
      events,
      snapshots
    };
  }

  function cleanup() {
    document.removeEventListener('pointerover', handleInteraction, true);
    document.removeEventListener('focusin', handleInteraction, true);
    try { observer?.disconnect?.(); } catch {}
    observer = null;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function download(report) {
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `arcaia-file-preview-tooltip-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function finish(reason = 'manual') {
    if (stopped) return finalReport;
    takeSnapshot('finish', null);
    stopped = true;
    cleanup();
    finalReport = buildReport(reason);
    download(finalReport);
    console.log('[Arcaia Tooltip Probe]', finalReport);
    console.info('Tooltip比較probeのJSONをダウンロードしました。');
    return finalReport;
  }

  function cancel() {
    if (stopped) return;
    stopped = true;
    cleanup();
    console.info('Arcaia Tooltip Probeを停止しました。JSONは生成していません。');
  }

  document.addEventListener('pointerover', handleInteraction, true);
  document.addEventListener('focusin', handleInteraction, true);
  observer = new MutationObserver((mutations) => {
    if (!mutations.some(mutationTouchesTooltip)) return;
    pushEvent({ type: 'tooltip_dom_mutation', tooltipCount: document.querySelectorAll(TOOLTIP_SELECTOR).length });
    takeSnapshot('tooltip_dom_mutation', null);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['role', 'class', 'style', 'hidden', 'data-state', 'data-side', 'data-align', 'aria-describedby']
  });
  takeSnapshot('startup', null);
  scheduleSnapshot(250, 'startup_250ms', null);
  const timeoutTimer = setTimeout(() => {
    timers.delete(timeoutTimer);
    finish('bounded_timeout');
  }, PROBE_TIMEOUT_MS);
  timers.add(timeoutTimer);

  window[API_KEY] = Object.freeze({
    finish,
    cancel,
    snapshot() { takeSnapshot('manual_snapshot', null); },
    get result() { return finalReport; },
    json() { return `${JSON.stringify(finalReport || buildReport('preview'), null, 2)}\n`; }
  });

  console.info([
    'Arcaia Tooltip Comparison Probeを開始しました。',
    '1. 右ペインのネイティブ「ダウンロード」ボタンへ約2秒ホバーしてください。',
    '2. 次にArcaiaの「コピー」ボタンへ約2秒ホバーしてください。',
    '両方を観測するとJSONが自動ダウンロードされます。手動終了: __ARCAIA_FILE_PREVIEW_TOOLTIP_PROBE__.finish()'
  ].join('\n'));
})();
