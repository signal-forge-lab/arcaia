(() => {
  'use strict';

  const PROBE_NAME = 'Arcaia Initial Render Probe';
  const PROBE_VERSION = '1.0.0';
  const REPORT_KEY = 'arcaiaInitialRenderProbeReportV1';
  const WATCH_DURATION_MS = 15000;
  const MAX_EVENTS = 240;
  const MAIN_PROTOCOL_SOURCE = 'aice-probe-main-v159';
  const CONTENT_PROTOCOL_SOURCE = 'aice-probe-content-v159';
  const MESSAGE_SECTION_SELECTOR = 'section[data-testid^="conversation-turn-"]';
  const NATIVE_COPY_BUTTON_SELECTOR = 'button[data-testid="copy-turn-action-button"]';
  const TURN_MARKDOWN_SELECTOR = '[data-arcaia-turn-export-button="true"]';
  const HEADER_MARKDOWN_SELECTOR = '#arcaia-header-markdown-button';
  const RECENT_VIEW_CONTROLS_SELECTOR = '#arcaia-recent-view-history-controls';
  const LITE_STYLE_SELECTOR = '#arcaia-lite-display-style';
  const TIMESTAMP_SELECTOR = '[data-arcaia-message-time-badge="true"]';
  const MODEL_RICH_SELECTOR = '[data-arcaia-model-rich="true"]';
  const MODEL_STYLE_SELECTOR = '#arcaia-model-selector-rich-style';
  const PINNED_SORT_STYLE_SELECTOR = '#arcaia-pinned-sort-style';
  const PINNED_SORT_BOUND_SELECTOR = '[data-arcaia-pinned-sort-bound="true"]';
  const MAIN_SCRIPT_SELECTOR = 'script[id^="aice-probe-injected-main-script"]';
  const startedAt = performance.now();
  const sessionId = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const events = [];
  const timers = new Set();
  let observer = null;
  let stopped = false;
  let persistTimer = null;
  let scanQueued = false;
  let lastSnapshotSignature = '';
  let latestSnapshot = null;
  let mainStatus = {
    requested: false,
    responseReceived: false,
    timedOut: false,
    appVersion: null,
    extensionEnabled: null,
    liteEnabled: null,
    backendRewriteEnabled: null,
    rewriteCount: null,
    lastRewritePresent: null,
    lastRewriteOk: null,
    lastRewriteSummaryPresent: null,
    totalTurnCount: null,
    retainedTurnCount: null
  };

  function elapsedMs() {
    return Math.round((performance.now() - startedAt) * 10) / 10;
  }

  function boundedPush(event) {
    events.push({ atMs: elapsedMs(), ...event });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    schedulePersist();
  }

  function setProbeTimer(callback, delay) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function classifyRoute() {
    const pathname = String(location.pathname || '');
    if (/^\/c\/[^/]+/i.test(pathname)) return 'conversation';
    if (pathname === '/' || pathname === '') return 'new_chat';
    if (/^\/(?:g|gg)\/[^/]+/i.test(pathname)) return 'gpt_surface';
    if (/^\/share\/[^/]+/i.test(pathname)) return 'shared_conversation';
    return 'other';
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findNativeShareButton() {
    const buttons = Array.from(document.querySelectorAll('header button'));
    return buttons.find((button) => {
      const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = String(button.getAttribute('aria-label') || '').trim();
      const testId = String(button.getAttribute('data-testid') || '');
      return /^(共有する|共有|Share)$/i.test(text)
        || /^(共有する|共有|Share)$/i.test(aria)
        || /share/i.test(testId);
    }) || null;
  }

  function findComposer() {
    return document.querySelector('#prompt-textarea')
      || document.querySelector('textarea')
      || document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
      || document.querySelector('form [contenteditable="true"]')
      || null;
  }

  function countVisible(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(isVisible).length;
  }

  function captureSnapshot(source) {
    const header = document.querySelector('header');
    const composer = findComposer();
    const shareButton = findNativeShareButton();
    const headerMarkdown = document.querySelector(HEADER_MARKDOWN_SELECTOR);
    const recentControls = document.querySelector(RECENT_VIEW_CONTROLS_SELECTOR);
    const snapshot = {
      source,
      readyState: document.readyState,
      routeKind: classifyRoute(),
      dom: {
        documentElementPresent: Boolean(document.documentElement),
        bodyPresent: Boolean(document.body),
        mainPresent: Boolean(document.querySelector('main')),
        headerPresent: Boolean(header),
        composerPresent: Boolean(composer),
        composerVisible: isVisible(composer),
        conversationSectionCount: document.querySelectorAll(MESSAGE_SECTION_SELECTOR).length,
        visibleConversationSectionCount: countVisible(MESSAGE_SECTION_SELECTOR),
        userRoleCount: document.querySelectorAll('[data-message-author-role="user"]').length,
        assistantRoleCount: document.querySelectorAll('[data-message-author-role="assistant"]').length,
        nativeCopyButtonCount: document.querySelectorAll(NATIVE_COPY_BUTTON_SELECTOR).length,
        visibleNativeCopyButtonCount: countVisible(NATIVE_COPY_BUTTON_SELECTOR),
        nativeSharePresent: Boolean(shareButton),
        nativeShareVisible: isVisible(shareButton)
      },
      arcaia: {
        mainScriptElementCount: document.querySelectorAll(MAIN_SCRIPT_SELECTOR).length,
        liteStylePresent: Boolean(document.querySelector(LITE_STYLE_SELECTOR)),
        recentViewControlsPresent: Boolean(recentControls),
        recentViewControlsVisible: isVisible(recentControls),
        turnMarkdownButtonCount: document.querySelectorAll(TURN_MARKDOWN_SELECTOR).length,
        visibleTurnMarkdownButtonCount: countVisible(TURN_MARKDOWN_SELECTOR),
        headerMarkdownPresent: Boolean(headerMarkdown),
        headerMarkdownVisible: isVisible(headerMarkdown),
        timestampBadgeCount: document.querySelectorAll(TIMESTAMP_SELECTOR).length,
        modelRichCount: document.querySelectorAll(MODEL_RICH_SELECTOR).length,
        modelStylePresent: Boolean(document.querySelector(MODEL_STYLE_SELECTOR)),
        pinnedSortStylePresent: Boolean(document.querySelector(PINNED_SORT_STYLE_SELECTOR)),
        pinnedSortBoundCount: document.querySelectorAll(PINNED_SORT_BOUND_SELECTOR).length
      },
      mainStatus: { ...mainStatus }
    };
    latestSnapshot = snapshot;
    const signature = JSON.stringify({
      readyState: snapshot.readyState,
      routeKind: snapshot.routeKind,
      dom: snapshot.dom,
      arcaia: snapshot.arcaia,
      mainStatus: snapshot.mainStatus
    });
    if (signature !== lastSnapshotSignature) {
      lastSnapshotSignature = signature;
      boundedPush({ type: 'snapshot_change', snapshot });
    }
    return snapshot;
  }

  function scheduleScan(source) {
    if (stopped || scanQueued) return;
    scanQueued = true;
    queueMicrotask(() => {
      scanQueued = false;
      if (!stopped) captureSnapshot(source);
    });
  }

  function sanitizeMainStatus(payload) {
    const lite = payload?.liteDisplay || payload?.mainWorldHook?.liteDisplay || null;
    const rewrite = lite?.liteDisplayLastRewrite || lite?.lastRewrite || null;
    const summary = rewrite?.summary || null;
    return {
      requested: true,
      responseReceived: Boolean(payload),
      timedOut: !payload,
      appVersion: typeof payload?.appVersion === 'string' ? payload.appVersion : null,
      extensionEnabled: typeof lite?.extensionEnabled === 'boolean' ? lite.extensionEnabled : null,
      liteEnabled: typeof lite?.enabled === 'boolean' ? lite.enabled : null,
      backendRewriteEnabled: typeof lite?.backendRewriteEnabled === 'boolean' ? lite.backendRewriteEnabled : null,
      rewriteCount: Number.isFinite(Number(lite?.rewriteCount)) ? Number(lite.rewriteCount) : null,
      lastRewritePresent: Boolean(rewrite),
      lastRewriteOk: typeof rewrite?.ok === 'boolean' ? rewrite.ok : null,
      lastRewriteSummaryPresent: Boolean(summary),
      totalTurnCount: Number.isFinite(Number(summary?.totalTurnCount)) ? Number(summary.totalTurnCount) : null,
      retainedTurnCount: Number.isFinite(Number(summary?.retainedTurnCount)) ? Number(summary.retainedTurnCount) : null
    };
  }

  function requestMainStatus(label, timeoutMs = 1500) {
    const requestId = `arcaia-initial-render-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    mainStatus = { ...mainStatus, requested: true, timedOut: false };
    schedulePersist();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        mainStatus = sanitizeMainStatus(payload);
        boundedPush({ type: 'main_status_result', label, status: { ...mainStatus } });
        captureSnapshot(`main_status:${label}`);
        resolve(mainStatus);
      };
      const timeout = setProbeTimer(() => finish(null), timeoutMs);
      function onMessage(event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== MAIN_PROTOCOL_SOURCE) return;
        if (data.type !== 'LITE_DISPLAY_CONFIG_RESULT' || data.requestId !== requestId) return;
        clearTimeout(timeout);
        timers.delete(timeout);
        finish(data.payload || null);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({
        source: CONTENT_PROTOCOL_SOURCE,
        type: 'GET_LITE_DISPLAY_CONFIG',
        requestId,
        payload: {}
      }, '*');
    });
  }

  function onWindowMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== MAIN_PROTOCOL_SOURCE) return;
    boundedPush({
      type: 'arcaia_main_message',
      messageType: typeof data.type === 'string' ? data.type : null,
      eventType: typeof data.eventType === 'string'
        ? data.eventType
        : (typeof data.payload?.event === 'string' ? data.payload.event : null)
    });
    scheduleScan('arcaia_main_message');
  }

  function buildReport() {
    return {
      probe: {
        name: PROBE_NAME,
        version: PROBE_VERSION,
        sessionId,
        startedAtIso: new Date(Date.now() - Math.round(performance.now() - startedAt)).toISOString(),
        generatedAtIso: new Date().toISOString(),
        watchDurationMs: WATCH_DURATION_MS,
        stopped
      },
      privacy: {
        conversationTextCollected: false,
        conversationIdsCollected: false,
        urlsCollected: false,
        cookiesCollected: false,
        authorizationCollected: false,
        pageStorageValuesCollected: false,
        htmlCollected: false,
        otherExtensionStorageCollected: false
      },
      limitations: {
        arcaiaIsolatedWorldVariablesVisible: false,
        arcaiaExtensionStorageVisible: false,
        arcaiaContentScriptExceptionsVisible: false
      },
      latestSnapshot,
      events: events.slice(-MAX_EVENTS)
    };
  }

  function persistNow() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try {
      chrome.storage.local.set({ [REPORT_KEY]: buildReport() });
    } catch {}
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(persistNow, 80);
  }

  function stop(reason = 'watch_duration_complete') {
    if (stopped) return buildReport();
    stopped = true;
    try { observer?.disconnect?.(); } catch {}
    observer = null;
    window.removeEventListener('message', onWindowMessage);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    captureSnapshot(`stop:${reason}`);
    boundedPush({ type: 'stopped', reason });
    persistNow();
    return buildReport();
  }

  function startObserver() {
    observer = new MutationObserver(() => scheduleScan('dom_mutation'));
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-testid',
        'data-message-author-role',
        'data-stream-active',
        'data-arcaia-turn-export-button',
        'data-arcaia-message-time-badge',
        'data-arcaia-model-rich',
        'style',
        'hidden'
      ]
    });
  }

  window.addEventListener('message', onWindowMessage);
  document.addEventListener('DOMContentLoaded', () => {
    boundedPush({ type: 'lifecycle', name: 'DOMContentLoaded' });
    captureSnapshot('DOMContentLoaded');
  }, { once: true });
  window.addEventListener('load', () => {
    boundedPush({ type: 'lifecycle', name: 'window.load' });
    captureSnapshot('window.load');
  }, { once: true });

  boundedPush({ type: 'lifecycle', name: 'document_start' });
  captureSnapshot('document_start');
  startObserver();

  for (const delay of [100, 250, 500, 1000, 2000, 3000, 5000, 10000]) {
    setProbeTimer(() => captureSnapshot(`scheduled_${delay}ms`), delay);
  }
  setProbeTimer(() => { void requestMainStatus('1000ms'); }, 1000);
  setProbeTimer(() => { void requestMainStatus('5000ms'); }, 5000);
  setProbeTimer(() => stop('watch_duration_complete'), WATCH_DURATION_MS);
  persistNow();
})();
