(() => {
  'use strict';

  const API_KEY = '__ARCAIA_RECENT_VIEW_HISTORY_CONTROLS_PROBE__';
  const PROBE_VERSION = '1.0.0';
  const MAIN_PROTOCOL_SOURCE = 'aice-probe-main-v159';
  const CONTENT_PROTOCOL_SOURCE = 'aice-probe-content-v159';
  const MESSAGE_SECTION_SELECTOR = 'section[data-testid^="conversation-turn-"]';
  const ROLLING_HIDE_ATTR = 'data-arcaia-lite-rolling-hidden';
  const CONTROLS_ID = 'arcaia-recent-view-history-controls';
  const LITE_STYLE_ID = 'arcaia-lite-display-style';
  const FULL_LOAD_MODE_STORAGE_KEY = 'arcaia_full_load_mode_v1';
  const RECENT_VIEW_EXPANSION_STORAGE_KEY = 'arcaia_recent_view_expansion_v1';
  const WATCH_DURATION_MS = 10000;
  const MAX_EVENTS = 120;

  if (window[API_KEY]?.stop) {
    try { window[API_KEY].stop(); } catch {}
  }

  const startedAt = Date.now();
  const events = [];
  let observer = null;
  let stopTimer = null;
  let stopped = false;
  let lastSnapshot = null;
  let scanQueued = false;
  let controlAddedCount = 0;
  let controlRemovedCount = 0;

  function nowIso() {
    return new Date().toISOString();
  }

  function elapsedMs() {
    return Date.now() - startedAt;
  }

  function pushEvent(event) {
    events.push({ atMs: elapsedMs(), ...event });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  }

  function getConversationIdFromPathname(pathname = window.location.pathname) {
    return String(pathname || '').match(/\/c\/([^/?#]+)/)?.[1] || null;
  }

  function getConversationIdFromRewrite(lastRewrite) {
    const pathname = String(lastRewrite?.url?.pathname || '');
    return pathname.match(/\/backend-api\/conversation\/([^/?#]+)/)?.[1] || null;
  }

  function getTopLevelSections(root = document) {
    return Array.from(root.querySelectorAll?.(MESSAGE_SECTION_SELECTOR) || []).filter((section) => {
      const parentSection = section.parentElement?.closest?.(MESSAGE_SECTION_SELECTOR);
      return !parentSection;
    });
  }

  function isSectionVisibleByRuntimeGate(section) {
    return Boolean(
      section?.isConnected
      && section.getAttribute(ROLLING_HIDE_ATTR) !== 'true'
      && section.style.display !== 'none'
    );
  }

  function getFirstVisibleSection() {
    return getTopLevelSections().find(isSectionVisibleByRuntimeGate) || null;
  }

  function getComputedVisibility(element) {
    if (!(element instanceof Element)) return null;
    try {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        hasArea: rect.width > 0 && rect.height > 0,
        inViewport: rect.bottom > 0 && rect.top < window.innerHeight
      };
    } catch {
      return null;
    }
  }

  function readSessionState(key, currentConversationId) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return { present: false };
      const parsed = JSON.parse(raw);
      const storedConversationId = typeof parsed?.conversationId === 'string'
        ? parsed.conversationId
        : null;
      return {
        present: true,
        active: Boolean(parsed?.active),
        conversationMatches: Boolean(
          currentConversationId
          && storedConversationId
          && currentConversationId === storedConversationId
        ),
        turnCount: Number.isFinite(Number(parsed?.turnCount))
          ? Math.floor(Number(parsed.turnCount))
          : null,
        reason: typeof parsed?.reason === 'string'
          ? String(parsed.reason).slice(0, 80)
          : null
      };
    } catch (error) {
      return {
        present: true,
        parseError: error instanceof Error ? error.message : String(error)
      };
    }
  }

  function requestMainLiteStatus(timeoutMs = 2500) {
    const requestId = `recent-view-controls-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(value);
      };
      const onMessage = (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== MAIN_PROTOCOL_SOURCE) return;
        if (data.type !== 'LITE_DISPLAY_CONFIG_RESULT' || data.requestId !== requestId) return;
        finish(data.payload || null);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      window.addEventListener('message', onMessage);
      window.postMessage({
        source: CONTENT_PROTOCOL_SOURCE,
        type: 'GET_LITE_DISPLAY_CONFIG',
        requestId,
        payload: {}
      }, '*');
    });
  }

  function summarizeLastRewrite(lastRewrite, currentConversationId) {
    if (!lastRewrite || typeof lastRewrite !== 'object') {
      return {
        present: false,
        conversationMatches: null,
        summaryPresent: false,
        totalTurnCount: null
      };
    }
    const rewriteConversationId = getConversationIdFromRewrite(lastRewrite);
    const summary = lastRewrite.summary && typeof lastRewrite.summary === 'object'
      ? lastRewrite.summary
      : null;
    const totalRaw = Number(summary?.totalTurnCount);
    return {
      present: true,
      ok: typeof lastRewrite.ok === 'boolean' ? lastRewrite.ok : null,
      skipped: Boolean(lastRewrite.skipped),
      reason: typeof lastRewrite.reason === 'string'
        ? String(lastRewrite.reason).slice(0, 100)
        : null,
      endpointKind: lastRewrite?.url?.endpointKind || null,
      conversationMatches: rewriteConversationId && currentConversationId
        ? rewriteConversationId === currentConversationId
        : null,
      summaryPresent: Boolean(summary),
      totalTurnCount: Number.isFinite(totalRaw) && totalRaw > 0
        ? Math.floor(totalRaw)
        : null,
      retainedTurnCount: Number.isFinite(Number(summary?.retainedTurnCount))
        ? Math.floor(Number(summary.retainedTurnCount))
        : null,
      displayTargetTurnCount: Number.isFinite(Number(summary?.displayTargetTurnCount))
        ? Math.floor(Number(summary.displayTargetTurnCount))
        : null,
      skipReason: typeof summary?.skipReason === 'string'
        ? String(summary.skipReason).slice(0, 100)
        : null
    };
  }

  function determineObservableDecision(snapshot) {
    const reasons = [];
    if (!snapshot.page.conversationRoute) reasons.push('conversation_id_missing');
    if (!snapshot.main.responseReceived) reasons.push('main_status_timeout');
    if (snapshot.main.responseReceived && snapshot.main.extensionEnabled === false) {
      reasons.push('main_extension_disabled');
    }
    if (snapshot.main.responseReceived && snapshot.main.liteEnabled !== true) {
      reasons.push('lite_state_disabled_or_missing');
    }
    if (snapshot.page.historySearchNavigation) reasons.push('history_search_navigation');
    if (snapshot.session.fullLoadMode.active && snapshot.session.fullLoadMode.conversationMatches) {
      reasons.push('full_load_mode_active_for_current_conversation');
    }
    if (!snapshot.dom.firstVisibleSectionPresent) reasons.push('first_visible_section_missing');
    if (snapshot.main.lastRewrite.present && snapshot.main.lastRewrite.conversationMatches === false) {
      reasons.push('rewrite_summary_conversation_mismatch');
    }
    if (!snapshot.main.lastRewrite.present) reasons.push('last_rewrite_missing');
    if (snapshot.main.lastRewrite.present && !snapshot.main.lastRewrite.summaryPresent) {
      reasons.push('rewrite_summary_missing');
    }
    if (snapshot.main.lastRewrite.summaryPresent && snapshot.main.lastRewrite.totalTurnCount == null) {
      reasons.push('total_turn_count_missing');
    }
    if (
      snapshot.calculated.remainingTurnCount != null
      && snapshot.calculated.remainingTurnCount <= 0
    ) reasons.push('no_remaining_turns');
    if (snapshot.dom.controlsPresent) reasons.push('controls_present');
    if (!snapshot.dom.controlsPresent && controlAddedCount > controlRemovedCount) {
      reasons.push('controls_added_but_currently_missing');
    }
    if (!snapshot.dom.controlsPresent && controlRemovedCount > 0) {
      reasons.push('controls_inserted_then_removed');
    }
    if (!reasons.length) reasons.push('observable_conditions_pass_but_controls_missing');
    return reasons;
  }

  async function buildSnapshot(source = 'manual_scan') {
    const currentConversationId = getConversationIdFromPathname();
    const mainResult = await requestMainLiteStatus();
    const lite = mainResult?.liteDisplay || mainResult?.mainWorldHook?.liteDisplay || null;
    const lastRewrite = summarizeLastRewrite(
      lite?.liteDisplayLastRewrite || lite?.lastRewrite || null,
      currentConversationId
    );
    const targetTurnCountRaw = Number(lite?.turnCount);
    const targetTurnCount = Number.isFinite(targetTurnCountRaw) && targetTurnCountRaw > 0
      ? Math.floor(targetTurnCountRaw)
      : null;
    const remainingTurnCount = lastRewrite.totalTurnCount != null && targetTurnCount != null
      ? Math.max(0, lastRewrite.totalTurnCount - targetTurnCount)
      : null;
    const sections = getTopLevelSections();
    const firstVisibleSection = getFirstVisibleSection();
    const controls = document.getElementById(CONTROLS_ID);
    const snapshot = {
      atIso: nowIso(),
      source,
      page: {
        conversationRoute: Boolean(currentConversationId),
        historySearchNavigation: (() => {
          try { return new URL(location.href).searchParams.get('src') === 'history_search'; }
          catch { return false; }
        })()
      },
      main: {
        responseReceived: Boolean(mainResult),
        appVersion: mainResult?.appVersion || null,
        extensionEnabled: typeof lite?.extensionEnabled === 'boolean'
          ? lite.extensionEnabled
          : null,
        liteEnabled: typeof lite?.enabled === 'boolean' ? lite.enabled : null,
        backendRewriteEnabled: typeof lite?.backendRewriteEnabled === 'boolean'
          ? lite.backendRewriteEnabled
          : null,
        rewriteCount: Number.isFinite(Number(lite?.liteDisplayRewriteCount ?? lite?.rewriteCount))
          ? Math.floor(Number(lite?.liteDisplayRewriteCount ?? lite?.rewriteCount))
          : null,
        turnCount: targetTurnCount,
        baseTurnCount: Number.isFinite(Number(lite?.baseTurnCount))
          ? Math.floor(Number(lite.baseTurnCount))
          : null,
        overridePresent: lite?.turnCountOverride != null
          && Number.isFinite(Number(lite.turnCountOverride)),
        overrideConversationMatches: Boolean(
          currentConversationId
          && lite?.turnCountOverrideConversationId
          && currentConversationId === lite.turnCountOverrideConversationId
        ),
        conversationMatchesPage: Boolean(
          currentConversationId
          && lite?.pageConversationId
          && currentConversationId === lite.pageConversationId
        ),
        configuredConversationMatchesPage: lite?.conversationId && currentConversationId
          ? lite.conversationId === currentConversationId
          : null,
        lastRewrite
      },
      session: {
        fullLoadMode: readSessionState(FULL_LOAD_MODE_STORAGE_KEY, currentConversationId),
        expansion: readSessionState(RECENT_VIEW_EXPANSION_STORAGE_KEY, currentConversationId)
      },
      dom: {
        topLevelSectionCount: sections.length,
        runtimeVisibleSectionCount: sections.filter(isSectionVisibleByRuntimeGate).length,
        rollingHiddenSectionCount: sections.filter(
          (section) => section.getAttribute(ROLLING_HIDE_ATTR) === 'true'
        ).length,
        firstVisibleSectionPresent: Boolean(firstVisibleSection),
        firstVisibleSectionHasParent: Boolean(firstVisibleSection?.parentElement),
        firstVisibleSectionComputed: getComputedVisibility(firstVisibleSection),
        controlsPresent: Boolean(controls),
        controlsConnected: Boolean(controls?.isConnected),
        controlsComputed: getComputedVisibility(controls),
        liteStylePresent: Boolean(document.getElementById(LITE_STYLE_ID)),
        controlAddedCount,
        controlRemovedCount
      },
      calculated: {
        targetTurnCount,
        totalTurnCount: lastRewrite.totalTurnCount,
        remainingTurnCount
      },
      unobservableContentOnlyConditions: [
        'isArcaiaFeatureEnabled(liteView)',
        'recentViewRefreshState.active'
      ]
    };
    snapshot.observableDecision = determineObservableDecision(snapshot);
    lastSnapshot = snapshot;
    pushEvent({
      type: 'snapshot',
      source,
      observableDecision: snapshot.observableDecision,
      controlsPresent: snapshot.dom.controlsPresent,
      totalTurnCount: snapshot.calculated.totalTurnCount,
      remainingTurnCount: snapshot.calculated.remainingTurnCount
    });
    return snapshot;
  }

  function nodeContainsControls(node) {
    if (!(node instanceof Element)) return false;
    return node.id === CONTROLS_ID || Boolean(node.querySelector?.(`#${CONTROLS_ID}`));
  }

  function queueScan(source) {
    if (stopped || scanQueued) return;
    scanQueued = true;
    queueMicrotask(async () => {
      scanQueued = false;
      if (stopped) return;
      try { await buildSnapshot(source); } catch (error) {
        pushEvent({
          type: 'scan_error',
          source,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  function startWatch() {
    if (observer || stopped) return;
    observer = new MutationObserver((mutations) => {
      let relevant = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (nodeContainsControls(node)) {
            controlAddedCount += 1;
            relevant = true;
            pushEvent({ type: 'controls_added' });
          }
        }
        for (const node of mutation.removedNodes || []) {
          if (nodeContainsControls(node)) {
            controlRemovedCount += 1;
            relevant = true;
            pushEvent({ type: 'controls_removed' });
          }
        }
      }
      if (relevant) queueScan('control_dom_mutation');
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    stopTimer = setTimeout(() => {
      stop('watch_duration_complete');
    }, WATCH_DURATION_MS);
  }

  function stop(reason = 'manual_stop') {
    if (stopped) return getReport();
    stopped = true;
    try { observer?.disconnect?.(); } catch {}
    observer = null;
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
    pushEvent({ type: 'stopped', reason });
    return getReport();
  }

  function getReport() {
    return {
      probe: {
        name: 'Arcaia Recent View history controls probe',
        version: PROBE_VERSION,
        startedAtIso: new Date(startedAt).toISOString(),
        generatedAtIso: nowIso(),
        watchDurationMs: WATCH_DURATION_MS,
        stopped
      },
      privacy: {
        conversationTextCollected: false,
        conversationIdsCollected: false,
        urlsCollected: false,
        cookiesCollected: false,
        localStorageValuesCollected: false,
        sessionStorageRawValuesCollected: false,
        htmlCollected: false
      },
      snapshot: lastSnapshot,
      events: events.slice()
    };
  }

  async function scan() {
    return buildSnapshot('manual_scan');
  }

  function download() {
    const report = getReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `arcaia-recent-view-history-controls-probe-${Date.now()}.json`;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    return report;
  }

  window[API_KEY] = Object.freeze({
    scan,
    stop,
    getReport,
    download
  });

  buildSnapshot('initial').catch((error) => {
    pushEvent({
      type: 'initial_scan_error',
      error: error instanceof Error ? error.message : String(error)
    });
  });
  startWatch();
  console.info(
    '[Arcaia probe] Recent View history controls probe started. '
    + 'Wait about 10 seconds, then run window.__ARCAIA_RECENT_VIEW_HISTORY_CONTROLS_PROBE__.download().'
  );
})();
