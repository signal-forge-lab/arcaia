(() => {
  'use strict';

  const SOURCE = 'arcaia-assistant-render-gap-watch-v1';
  const VERSION = '1.0.0';
  const GLOBAL_KEY = '__arcaiaAssistantRenderGapWatchProbeContent';
  const MAX_LOCAL_EVENTS = 24;
  const SHRINK_MIN_BASELINE = 240;
  const SHRINK_MIN_DELTA = 160;
  const SHRINK_MAX_RATIO = 0.65;
  if (globalThis[GLOBAL_KEY]?.started) return;

  const sessionId = `render-gap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let stopped = false;
  let rootObserver = null;
  let bootstrapObserver = null;
  let observedRoot = null;
  let evaluateQueued = false;
  let lastDomSnapshot = null;
  let lastRawSummary = null;
  let lastConstructedSummary = null;
  let lastArcaiaRewrite = null;
  let latestTurnOrdinal = 0;
  let maxFinishedAssistantTextLength = 0;
  let shrinkIncidentTurnOrdinal = null;
  const recentEvents = [];

  function nowIso() {
    return new Date().toISOString();
  }

  function navigationType() {
    const value = performance.getEntriesByType?.('navigation')?.[0]?.type;
    return ['navigate', 'reload', 'back_forward', 'prerender'].includes(value) ? value : 'other';
  }

  function routeKind() {
    const path = String(location.pathname || '');
    if (/^\/c\//.test(path)) return 'conversation';
    if (/^\/(?:g|gg)\//.test(path)) return 'gpt_surface';
    if (path === '/' || path === '') return 'new_chat';
    return 'other';
  }

  function rememberLocal(event) {
    recentEvents.push(event);
    if (recentEvents.length > MAX_LOCAL_EVENTS) recentEvents.splice(0, recentEvents.length - MAX_LOCAL_EVENTS);
  }

  function emit(type, details = {}) {
    const event = {
      type,
      sessionId,
      atIso: nowIso(),
      routeKind: routeKind(),
      ...details
    };
    rememberLocal(event);
    try {
      const result = chrome.runtime.sendMessage({ source: SOURCE, type: 'PROBE_EVENT', event });
      result?.catch?.(() => {});
    } catch {}
    return event;
  }

  function topLevelSections() {
    return Array.from(document.querySelectorAll('section[data-testid^="conversation-turn-"]'))
      .filter((section) => !section.parentElement?.closest?.('section[data-testid^="conversation-turn-"]'));
  }

  function roleNodeFor(section, role) {
    return Array.from(section?.querySelectorAll?.(`[data-message-author-role="${role}"]`) || [])
      .find((node) => node.closest?.('section[data-testid^="conversation-turn-"]') === section) || null;
  }

  function textLength(element) {
    return String(element?.innerText || element?.textContent || '').trim().length;
  }

  function visibilityCategory(element) {
    if (!(element instanceof Element) || !element.isConnected) return 'missing';
    const style = getComputedStyle(element);
    if (style.display === 'none') return 'display_none';
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return 'visibility_hidden';
    if (Number(style.opacity) === 0) return 'opacity_zero';
    return 'visible';
  }

  function collectDomSnapshot() {
    const sections = topLevelSections();
    const userSections = sections.filter((section) => Boolean(roleNodeFor(section, 'user')));
    const latestAssistantSection = [...sections].reverse().find((section) => Boolean(roleNodeFor(section, 'assistant'))) || null;
    const assistantRole = roleNodeFor(latestAssistantSection, 'assistant');
    const latestUserSection = userSections.at(-1) || null;
    const latestUserIndex = latestUserSection ? sections.indexOf(latestUserSection) : -1;
    const rolelessAfterLatestUserCount = latestUserIndex >= 0
      ? sections.slice(latestUserIndex + 1).filter((section) => !roleNodeFor(section, 'user') && !roleNodeFor(section, 'assistant')).length
      : 0;
    const streamRoot = document.querySelector('[data-scroll-root]');
    const streamActive = Boolean(streamRoot?.hasAttribute?.('data-stream-active'));
    return {
      capturedAtIso: nowIso(),
      routeKind: routeKind(),
      topLevelSectionCount: sections.length,
      userTurnCount: userSections.length,
      latestAssistantPresent: Boolean(latestAssistantSection),
      assistantRolePresent: Boolean(assistantRole),
      assistantTextLength: textLength(assistantRole),
      assistantTurnTextLength: textLength(latestAssistantSection),
      assistantSectionVisibility: visibilityCategory(latestAssistantSection),
      assistantRoleVisibility: visibilityCategory(assistantRole),
      latestAssistantArcaiaHidden: latestAssistantSection?.getAttribute?.('data-arcaia-lite-rolling-hidden') === 'true',
      arcaiaHiddenSectionCount: document.querySelectorAll('section[data-testid^="conversation-turn-"][data-arcaia-lite-rolling-hidden="true"]').length,
      rolelessAfterLatestUserCount,
      streamActive,
      assistantStreamingStatusPresent: Boolean(latestAssistantSection?.querySelector?.('[data-streaming-response-status]'))
    };
  }

  function snapshotChangedEnough(previous, next) {
    if (!previous) return true;
    if (previous.userTurnCount !== next.userTurnCount) return true;
    if (previous.topLevelSectionCount !== next.topLevelSectionCount) return true;
    if (previous.streamActive !== next.streamActive) return true;
    if (previous.latestAssistantArcaiaHidden !== next.latestAssistantArcaiaHidden) return true;
    if (previous.assistantRoleVisibility !== next.assistantRoleVisibility) return true;
    if (Math.abs(previous.assistantTextLength - next.assistantTextLength) >= 64) return true;
    if (!next.streamActive && previous.assistantTextLength !== next.assistantTextLength) return true;
    return false;
  }

  function evaluateDom(reason = 'dom_event', force = false) {
    if (stopped) return null;
    const snapshot = collectDomSnapshot();
    if (snapshot.userTurnCount !== latestTurnOrdinal) {
      latestTurnOrdinal = snapshot.userTurnCount;
      maxFinishedAssistantTextLength = snapshot.streamActive ? 0 : snapshot.assistantTextLength;
      shrinkIncidentTurnOrdinal = null;
    }
    if (!snapshot.streamActive) {
      if (
        shrinkIncidentTurnOrdinal !== snapshot.userTurnCount
        && maxFinishedAssistantTextLength >= SHRINK_MIN_BASELINE
        && maxFinishedAssistantTextLength - snapshot.assistantTextLength >= SHRINK_MIN_DELTA
        && snapshot.assistantTextLength <= maxFinishedAssistantTextLength * SHRINK_MAX_RATIO
      ) {
        shrinkIncidentTurnOrdinal = snapshot.userTurnCount;
        emit('incident', {
          incident: {
            kind: 'assistant_text_shrank_after_render',
            beforeAssistantTextLength: maxFinishedAssistantTextLength,
            afterAssistantTextLength: snapshot.assistantTextLength,
            userTurnCount: snapshot.userTurnCount,
            latestAssistantArcaiaHidden: snapshot.latestAssistantArcaiaHidden,
            assistantRoleVisibility: snapshot.assistantRoleVisibility
          },
          snapshot
        });
      }
      maxFinishedAssistantTextLength = Math.max(maxFinishedAssistantTextLength, snapshot.assistantTextLength);
    }
    if (force || snapshotChangedEnough(lastDomSnapshot, snapshot)) {
      lastDomSnapshot = snapshot;
      emit('dom_snapshot', { reason, snapshot });
    } else {
      lastDomSnapshot = snapshot;
    }
    return snapshot;
  }

  function scheduleEvaluate(reason = 'dom_event') {
    if (stopped || evaluateQueued) return;
    evaluateQueued = true;
    const run = () => {
      evaluateQueued = false;
      refreshObserverBinding();
      evaluateDom(reason);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else queueMicrotask(run);
  }

  function findObserverRoot() {
    return document.querySelector('main#main') || document.querySelector('[data-scroll-root]') || null;
  }

  function refreshObserverBinding() {
    if (stopped) return;
    const root = findObserverRoot();
    if (!root || root === observedRoot) return;
    try { rootObserver?.disconnect?.(); } catch {}
    observedRoot = root;
    rootObserver = new MutationObserver(() => scheduleEvaluate('conversation_dom_mutation'));
    rootObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-stream-active', 'data-message-author-role', 'data-arcaia-lite-rolling-hidden', 'style']
    });
    try { bootstrapObserver?.disconnect?.(); } catch {}
    bootstrapObserver = null;
    scheduleEvaluate('observer_bound');
  }

  function startObserver() {
    refreshObserverBinding();
    if (observedRoot || !document.documentElement) return;
    bootstrapObserver = new MutationObserver(() => refreshObserverBinding());
    bootstrapObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function sanitizeMainSummary(value) {
    const source = value && typeof value === 'object' ? value : {};
    const counts = source.pathRoleCounts && typeof source.pathRoleCounts === 'object' ? source.pathRoleCounts : {};
    return {
      sequence: Number.isFinite(Number(source.sequence)) ? Number(source.sequence) : null,
      mappingNodeCount: Number.isFinite(Number(source.mappingNodeCount)) ? Number(source.mappingNodeCount) : null,
      selectedPathNodeCount: Number.isFinite(Number(source.selectedPathNodeCount)) ? Number(source.selectedPathNodeCount) : null,
      pathRoleCounts: {
        user: Number(counts.user) || 0,
        assistant: Number(counts.assistant) || 0,
        tool: Number(counts.tool) || 0,
        system: Number(counts.system) || 0,
        other: Number(counts.other) || 0
      },
      userTurnCount: Number(source.userTurnCount) || 0,
      visibleAssistantCount: Number(source.visibleAssistantCount) || 0,
      toolLikeNodeCount: Number(source.toolLikeNodeCount) || 0,
      thinkingLikeNodeCount: Number(source.thinkingLikeNodeCount) || 0,
      finalAssistantTextLength: Number(source.finalAssistantTextLength) || 0,
      finalAssistantStatus: ['finished_successfully', 'in_progress', 'other', 'none'].includes(source.finalAssistantStatus) ? source.finalAssistantStatus : 'other',
      currentNodeRole: ['user', 'assistant', 'tool', 'system', 'other', 'none'].includes(source.currentNodeRole) ? source.currentNodeRole : 'other',
      bodyBytes: Number.isFinite(Number(source.bodyBytes)) ? Number(source.bodyBytes) : null,
      nearArcaiaRewrite: source.nearArcaiaRewrite === true
    };
  }

  function handleWindowMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.source !== SOURCE) return;
    if (data.type === 'RAW_CONVERSATION_SUMMARY') {
      lastRawSummary = sanitizeMainSummary(data.payload);
      emit('raw_payload_summary', { summary: lastRawSummary });
    } else if (data.type === 'CONSTRUCTED_CONVERSATION_SUMMARY') {
      lastConstructedSummary = sanitizeMainSummary(data.payload);
      emit('rewritten_payload_summary', { summary: lastConstructedSummary });
    } else if (data.type === 'ARCAIA_LITE_REWRITE_SUMMARY') {
      const source = data.payload || {};
      lastArcaiaRewrite = {
        beforeBytes: Number.isFinite(Number(source.beforeBytes)) ? Number(source.beforeBytes) : null,
        afterBytes: Number.isFinite(Number(source.afterBytes)) ? Number(source.afterBytes) : null,
        retainedTurnCount: Number.isFinite(Number(source.retainedTurnCount)) ? Number(source.retainedTurnCount) : null,
        totalTurnCount: Number.isFinite(Number(source.totalTurnCount)) ? Number(source.totalTurnCount) : null,
        turnCount: Number.isFinite(Number(source.turnCount)) ? Number(source.turnCount) : null
      };
      emit('arcaia_rewrite_summary', { summary: lastArcaiaRewrite });
    }
  }

  function buildManualSnapshot(reason = 'manual') {
    return {
      capturedAtIso: nowIso(),
      reason,
      sessionId,
      navigationType: navigationType(),
      dom: evaluateDom(reason, true) || collectDomSnapshot(),
      rawConversation: lastRawSummary,
      rewrittenConversation: lastConstructedSummary,
      arcaiaRewrite: lastArcaiaRewrite
    };
  }

  function resetSessionState() {
    lastDomSnapshot = null;
    lastRawSummary = null;
    lastConstructedSummary = null;
    lastArcaiaRewrite = null;
    latestTurnOrdinal = 0;
    maxFinishedAssistantTextLength = 0;
    shrinkIncidentTurnOrdinal = null;
    recentEvents.length = 0;
    evaluateDom('probe_reset', true);
  }

  function cleanup() {
    if (stopped) return;
    const snapshot = collectDomSnapshot();
    emit('probe_stopped', { snapshot });
    stopped = true;
    try { rootObserver?.disconnect?.(); } catch {}
    try { bootstrapObserver?.disconnect?.(); } catch {}
    rootObserver = null;
    bootstrapObserver = null;
    observedRoot = null;
    window.removeEventListener('message', handleWindowMessage);
    window.removeEventListener('pagehide', handlePageHide);
    window.postMessage({ source: SOURCE, type: 'STOP_MAIN' }, '*');
    try { globalThis[GLOBAL_KEY].started = false; } catch {}
  }

  function handlePageHide() {
    if (stopped) return;
    emit('pagehide_snapshot', { snapshot: collectDomSnapshot() });
  }

  window.addEventListener('message', handleWindowMessage);
  window.addEventListener('pagehide', handlePageHide);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.source !== SOURCE) return false;
    if (message.type === 'PING_PROBE') {
      sendResponse({ ok: true, version: VERSION, stopped });
      return false;
    }
    if (message.type === 'CAPTURE_NOW') {
      const snapshot = buildManualSnapshot('toolbar_manual_capture');
      emit('manual_snapshot', { snapshot });
      sendResponse({ ok: true, snapshot, events: recentEvents.slice(-MAX_LOCAL_EVENTS) });
      return false;
    }
    if (message.type === 'RESET_PROBE_SESSION') {
      resetSessionState();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'STOP_PROBE') {
      cleanup();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  globalThis[GLOBAL_KEY] = { started: true, version: VERSION, cleanup };
  emit('probe_started', { navigationType: navigationType() });
  if (document.documentElement) startObserver();
  else window.addEventListener('DOMContentLoaded', startObserver, { once: true });
})();
