(() => {
  'use strict';

  const SOURCE = 'arcaia-backend-contract-probe-v1';
  const VERSION = '1.0.8';
  const MAIN_SOURCE = 'aice-probe-main-v159';
  const CONTENT_SOURCE = 'aice-probe-content-v159';
  const GLOBAL_KEY = '__arcaiaBackendContractProbeContentV1';
  const WATCH_DURATION_MS = 180000;
  const MAX_EVENTS = 320;
  const MAX_DOM_PATTERN = 48;
  const CONTENT_READ_ONLY_TIMEOUT_MS = 5000;
  const SECTION_SELECTOR = 'section[data-testid^="conversation-turn-"]';
  const ROLE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
  const BADGE_SELECTOR = '[data-arcaia-message-time-badge="true"]';
  if (globalThis[GLOBAL_KEY]?.started) return;

  const startedAt = Date.now();
  const sessionId = `backend-contract-${startedAt}-${Math.random().toString(16).slice(2, 8)}`;
  const events = /** @type {Array<{atMs:number,type:string,payload:any}>} */ ([]);
  let observer = /** @type {MutationObserver|null} */ (null);
  let stopped = false;
  let scanQueued = false;
  let fullDisplayClickCount = 0;
  let scrollSampleCount = 0;
  let lastScrollSampleAt = 0;
  let latestDom = /** @type {any} */ (null);
  const readOnlyPendingByRequestId = new Map();
  const chromeApi = /** @type {any} */ (globalThis).chrome;

  function pushEvent(type, payload = {}) {
    events.push({ atMs: Date.now() - startedAt, type, payload });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  }

  function currentConversationId() {
    return String(location.pathname || '').match(/\/c\/([^/?#]+)/)?.[1] || null;
  }

  function topLevelSections() {
    return Array.from(document.querySelectorAll(SECTION_SELECTOR)).filter((section) => !section.parentElement?.closest?.(SECTION_SELECTOR));
  }

  function sectionRole(section) {
    const roles = Array.from(section.querySelectorAll(ROLE_SELECTOR)).map((node) => node instanceof Element ? node.getAttribute('data-message-author-role') : null).filter(Boolean);
    const unique = Array.from(new Set(roles));
    if (!unique.length) return 'roleless';
    if (unique.length > 1) return 'mixed';
    return unique[0] === 'user' || unique[0] === 'assistant' ? unique[0] : 'other';
  }

  function buildDomSnapshot() {
    const sections = topLevelSections();
    const roles = Array.from(document.querySelectorAll(ROLE_SELECTOR));
    latestDom = {
      topLevelSectionCount: sections.length,
      visibleTopLevelSectionCount: sections.filter((section) => section.getAttribute('data-arcaia-lite-rolling-hidden') !== 'true' && (!(section instanceof HTMLElement) || section.style.display !== 'none')).length,
      arcaiaHiddenSectionCount: sections.filter((section) => section.getAttribute('data-arcaia-lite-rolling-hidden') === 'true').length,
      userRoleCount: roles.filter((node) => node.getAttribute('data-message-author-role') === 'user').length,
      assistantRoleCount: roles.filter((node) => node.getAttribute('data-message-author-role') === 'assistant').length,
      sectionRolePattern: sections.slice(0, MAX_DOM_PATTERN).map(sectionRole),
      timestampBadgeCount: document.querySelectorAll(BADGE_SELECTOR).length,
      recentViewControlsPresent: Boolean(document.getElementById('arcaia-recent-view-history-controls')),
      fullDisplayButtonPresent: Boolean(document.querySelector('#arcaia-recent-view-history-controls button[data-action="full"]')),
      readOnlyRootPresent: Boolean(document.getElementById('arcaia-recent-view-read-only-root')),
      readOnlyTurnCount: document.querySelectorAll('#arcaia-recent-view-read-only-root .arcaia-ror-turn').length,
      readOnlyUserMessageCount: document.querySelectorAll('#arcaia-recent-view-read-only-root .arcaia-ror-message-user').length,
      readOnlyAssistantMessageCount: document.querySelectorAll('#arcaia-recent-view-read-only-root .arcaia-ror-message-assistant').length,
      nativeContentHiddenByReadOnlyCount: document.querySelectorAll('[data-arcaia-read-only-native-hidden="true"]').length,
      readOnlyTurnNumbers: Array.from(document.querySelectorAll('#arcaia-recent-view-read-only-root .arcaia-ror-turn')).map((turn) => Number(turn.getAttribute('data-turn-number') || turn.dataset?.turnNumber)).filter((value) => Number.isInteger(value) && value > 0).slice(0, 80),
      liteStylePresent: Boolean(document.getElementById('arcaia-lite-display-style'))
    };
    return latestDom;
  }

  function scheduleDomSnapshot(reason) {
    if (scanQueued || stopped) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      pushEvent('DOM_SNAPSHOT', { reason, dom: buildDomSnapshot() });
    });
  }

  function startDomObserver() {
    const root = document.documentElement;
    if (!root) return;
    observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        if (mutation.type === 'attributes') return true;
        return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node instanceof Element && (
          node.matches?.(`${SECTION_SELECTOR}, ${ROLE_SELECTOR}, ${BADGE_SELECTOR}, #arcaia-recent-view-read-only-root, .arcaia-ror-turn, [data-arcaia-read-only-native-hidden]`)
          || node.querySelector?.(`${SECTION_SELECTOR}, ${ROLE_SELECTOR}, ${BADGE_SELECTOR}, #arcaia-recent-view-read-only-root, .arcaia-ror-turn, [data-arcaia-read-only-native-hidden]`)
        ));
      });
      if (relevant) scheduleDomSnapshot('relevant_dom_mutation');
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-message-author-role', 'data-arcaia-lite-rolling-hidden', 'data-arcaia-message-time-badge', 'data-arcaia-read-only-native-hidden', 'style']
    });
  }

  function requestMain(type, responseType, payload = {}, timeoutMs = 900) {
    const requestId = `${SOURCE}-${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
        if (data?.source !== MAIN_SOURCE || data.type !== responseType || data.requestId !== requestId) return;
        finish(data.payload || null);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      window.addEventListener('message', onMessage);
      window.postMessage({ source: CONTENT_SOURCE, type, requestId, payload }, '*');
    });
  }

  function extractConversationIdFromRewrite(lastRewrite) {
    const pathname = String(lastRewrite?.url?.pathname || '');
    return pathname.match(/\/backend-api\/conversation\/([^/?#]+)/)?.[1] || null;
  }

  function sanitizeLiteResult(payload, currentId) {
    const lite = payload?.liteDisplay || payload?.mainWorldHook?.liteDisplay || null;
    if (!lite) return { responseReceived: Boolean(payload), appVersion: payload?.appVersion || null, statePresent: false };
    const lastRewrite = lite.lastRewrite || lite.liteDisplayLastRewrite || null;
    const summary = lastRewrite?.summary || null;
    const liteConversationId = typeof lite.conversationId === 'string' ? lite.conversationId : null;
    const rewriteConversationId = extractConversationIdFromRewrite(lastRewrite);
    return {
      responseReceived: true,
      appVersion: payload?.appVersion || null,
      statePresent: true,
      extensionEnabled: typeof lite.extensionEnabled === 'boolean' ? lite.extensionEnabled : null,
      enabled: typeof lite.enabled === 'boolean' ? lite.enabled : null,
      backendRewriteEnabled: typeof lite.backendRewriteEnabled === 'boolean' ? lite.backendRewriteEnabled : null,
      configuredTurnCount: Number.isFinite(Number(lite.turnCount)) ? Number(lite.turnCount) : null,
      rewriteCount: Number.isFinite(Number(lite.rewriteCount ?? lite.liteDisplayRewriteCount)) ? Number(lite.rewriteCount ?? lite.liteDisplayRewriteCount) : null,
      conversationMatchesCurrent: currentId && liteConversationId ? currentId === liteConversationId : null,
      lastRewrite: lastRewrite ? {
        present: true,
        ok: typeof lastRewrite.ok === 'boolean' ? lastRewrite.ok : null,
        skipped: Boolean(lastRewrite.skipped),
        reason: typeof lastRewrite.reason === 'string' ? lastRewrite.reason.slice(0, 100) : null,
        conversationMatchesCurrent: currentId && rewriteConversationId ? currentId === rewriteConversationId : null,
        beforeBytes: Number.isFinite(Number(lastRewrite.beforeBytes)) ? Number(lastRewrite.beforeBytes) : null,
        afterBytes: Number.isFinite(Number(lastRewrite.afterBytes)) ? Number(lastRewrite.afterBytes) : null,
        totalTurnCount: Number.isFinite(Number(summary?.totalTurnCount)) ? Number(summary.totalTurnCount) : null,
        retainedTurnCount: Number.isFinite(Number(summary?.retainedTurnCount)) ? Number(summary.retainedTurnCount) : null,
        displayTargetTurnCount: Number.isFinite(Number(summary?.displayTargetTurnCount)) ? Number(summary.displayTargetTurnCount) : null,
        skipReason: typeof summary?.skipReason === 'string' ? summary.skipReason.slice(0, 100) : null
      } : { present: false },
      timestampIndexSummary: lite.messageTimestampIndexSummary ? {
        messageCount: Number.isFinite(Number(lite.messageTimestampIndexSummary.messageCount)) ? Number(lite.messageTimestampIndexSummary.messageCount) : null,
        updateCount: Number.isFinite(Number(lite.messageTimestampIndexSummary.updateCount)) ? Number(lite.messageTimestampIndexSummary.updateCount) : null
      } : null
    };
  }

  function sanitizeTimestampResult(payload) {
    const index = payload?.messageTimestampIndex || null;
    if (!index) return { responseReceived: Boolean(payload), present: false, updateCount: Number.isFinite(Number(payload?.updateCount)) ? Number(payload.updateCount) : null };
    return {
      responseReceived: true,
      present: true,
      messageCount: Number.isFinite(Number(index.messageCount)) ? Number(index.messageCount) : null,
      updateCount: Number.isFinite(Number(payload?.updateCount)) ? Number(payload.updateCount) : null,
      roleEntries: (Array.isArray(index.roleOrder) ? index.roleOrder : []).slice(0, 80).map((item) => ({
        role: item?.role === 'user' || item?.role === 'assistant' ? item.role : 'other',
        timestampPresent: Boolean(item?.iso || item?.createTimeIso || item?.updateTimeIso)
      }))
    };
  }

  async function collectArcaiaState() {
    const conversationId = currentConversationId();
    const [litePayload, timestampPayload] = await Promise.all([
      requestMain('GET_LITE_DISPLAY_CONFIG', 'LITE_DISPLAY_CONFIG_RESULT'),
      requestMain('GET_MESSAGE_TIMESTAMP_INDEX', 'MESSAGE_TIMESTAMP_INDEX_RESULT', { conversationId })
    ]);
    return {
      lite: sanitizeLiteResult(litePayload, conversationId),
      timestampIndex: sanitizeTimestampResult(timestampPayload)
    };
  }

  function sanitizeReadOnlyModelResult(payload) {
    const model = payload?.model || null;
    const turns = Array.isArray(model?.turns) ? model.turns : [];
    return {
      responseReceived: Boolean(payload),
      ok: payload?.ok === true,
      appVersion: typeof payload?.appVersion === 'string' ? payload.appVersion : null,
      errorCode: typeof payload?.error === 'string' && /^[a-z0-9_:-]{1,100}$/i.test(payload.error) ? payload.error : null,
      modelPresent: Boolean(model),
      conversationMatchesCurrent: model?.conversationId && currentConversationId() ? model.conversationId === currentConversationId() : null,
      totalTurnCount: Number.isFinite(Number(model?.totalTurnCount)) ? Number(model.totalTurnCount) : null,
      visibleTurnCount: Number.isFinite(Number(model?.visibleTurnCount)) ? Number(model.visibleTurnCount) : null,
      firstVisibleTurnNumber: Number.isFinite(Number(model?.firstVisibleTurnNumber)) ? Number(model.firstVisibleTurnNumber) : null,
      returnedTurnArrayCount: turns.length,
      userMessagePresentCount: turns.filter((turn) => Boolean(turn?.user)).length,
      assistantMessagePresentCount: turns.filter((turn) => Boolean(turn?.assistant)).length,
      maxTurnNumber: turns.reduce((max, turn) => Number.isFinite(Number(turn?.turnNumber)) ? Math.max(max, Number(turn.turnNumber)) : max, 0) || null
    };
  }

  function buildFullDisplaySummary(dom) {
    const clickEvents = events.filter((event) => event.type === 'FULL_DISPLAY_CLICK');
    const requestEvents = events.filter((event) => event.type === 'READ_ONLY_MODEL_REQUEST');
    const resultEvents = events.filter((event) => event.type === 'READ_ONLY_MODEL_RESULT');
    const firstClickAtMs = clickEvents[0]?.atMs ?? null;
    const fetchAfterClick = firstClickAtMs == null ? [] : events.filter((event) => event.type === 'FETCH_CALL_OBSERVED' && event.atMs >= firstClickAtMs && event.payload?.endpoint?.conversationLike);
    const responseAfterClick = firstClickAtMs == null ? [] : events.filter((event) => event.type === 'CONVERSATION_RESPONSE_SUMMARY' && event.atMs >= firstClickAtMs);
    const pending = Array.from(readOnlyPendingByRequestId.values());
    const oldestPendingReadOnlyElapsedMs = pending.length
      ? Math.max(...pending.map((item) => Math.max(0, Date.now() - item.startedAt)))
      : null;
    return {
      clickCount: clickEvents.length,
      readOnlyRequestCount: requestEvents.length,
      readOnlyResultCount: resultEvents.length,
      lastReadOnlyRequest: requestEvents.length ? requestEvents[requestEvents.length - 1].payload : null,
      lastReadOnlyResult: resultEvents.length ? resultEvents[resultEvents.length - 1].payload : null,
      contentReadOnlyTimeoutMs: CONTENT_READ_ONLY_TIMEOUT_MS,
      pendingReadOnlyRequestCount: pending.length,
      oldestPendingReadOnlyElapsedMs,
      pendingRequestExceededContentTimeout: oldestPendingReadOnlyElapsedMs != null
        ? oldestPendingReadOnlyElapsedMs > CONTENT_READ_ONLY_TIMEOUT_MS
        : false,
      conversationFetchCountAfterFirstClick: fetchAfterClick.length,
      conversationResponseCountAfterFirstClick: responseAfterClick.length,
      fetchObservation: !clickEvents.length ? 'not_observed' : fetchAfterClick.length ? 'conversation_fetch_observed_after_click' : 'no_conversation_fetch_observed_after_click',
      renderer: {
        mounted: Boolean(dom?.readOnlyRootPresent),
        turnCount: Number(dom?.readOnlyTurnCount || 0),
        userMessageCount: Number(dom?.readOnlyUserMessageCount || 0),
        assistantMessageCount: Number(dom?.readOnlyAssistantMessageCount || 0),
        nativeContentHiddenCount: Number(dom?.nativeContentHiddenByReadOnlyCount || 0),
        turnNumbers: Array.isArray(dom?.readOnlyTurnNumbers) ? dom.readOnlyTurnNumbers : []
      }
    };
  }

  function conversationResponseSummaries() {
    return events.filter((event) => event.type === 'CONVERSATION_RESPONSE_SUMMARY').map((event) => event.payload);
  }

  function conversationDetailSummaries() {
    return conversationResponseSummaries().filter((item) => item?.contract?.pagedMessagesResponse !== true && item?.endpoint?.pathnamePattern === '/backend-api/conversations/<id>');
  }

  function initialResponseSummary() {
    const details = conversationDetailSummaries();
    return details[0] || conversationResponseSummaries()[0] || null;
  }

  function fullDisplayResponseSummary() {
    const clickIndex = events.findIndex((event) => event.type === 'FULL_DISPLAY_CLICK');
    if (clickIndex < 0) return null;
    const ordinals = new Set(events.slice(clickIndex + 1).filter((event) => (event.type === 'FETCH_CALL_OBSERVED' || event.type === 'XHR_CALL_OBSERVED') && event.payload?.endpoint?.pathnamePattern === '/backend-api/conversations/<id>').map((event) => event.payload?.requestOrdinal));
    return conversationDetailSummaries().find((item) => ordinals.has(item?.requestOrdinal)) || null;
  }

  function buildPaginationSummary() {
    const summaries = conversationResponseSummaries();
    const pageResponses = summaries.filter((item) => item?.contract?.pagedMessagesResponse === true);
    const withPageInfo = summaries.filter((item) => item?.contract?.pageInfo?.present === true);
    const primary = initialResponseSummary();
    const primaryPageInfo = primary?.contract?.pageInfo || null;
    return {
      responseCount: summaries.length,
      pagedMessagesResponseCount: pageResponses.length,
      pageInfoResponseCount: withPageInfo.length,
      initialPageInfo: primaryPageInfo,
      initialPageLocalUserTurnCount: Number.isFinite(Number(primary?.messages?.userRoleCandidateCount))
        ? Number(primary.messages.userRoleCandidateCount)
        : Number.isFinite(Number(primary?.messages?.userTurnCount)) ? Number(primary.messages.userTurnCount) : null,
      initialPageRenderableUserTurnCount: Number.isFinite(Number(primary?.messages?.userTurnCount)) ? Number(primary.messages.userTurnCount) : null,
      pageLocalUserTurnCounts: pageResponses.slice(0, 12).map((item) => Number.isFinite(Number(item?.messages?.userRoleCandidateCount))
        ? Number(item.messages.userRoleCandidateCount)
        : Number.isFinite(Number(item?.messages?.userTurnCount)) ? Number(item.messages.userTurnCount) : null),
      pageRenderableUserTurnCounts: pageResponses.slice(0, 12).map((item) => Number.isFinite(Number(item?.messages?.userTurnCount)) ? Number(item.messages.userTurnCount) : null),
      metadataParentOutsidePageCounts: summaries.slice(0, 12).map((item) => Number.isFinite(Number(item?.messages?.metadataParentIdOutsidePageCount)) ? Number(item.messages.metadataParentIdOutsidePageCount) : null),
      metadataParentImmediatePreviousCounts: summaries.slice(0, 12).map((item) => Number.isFinite(Number(item?.messages?.metadataParentImmediatePreviousCount)) ? Number(item.messages.metadataParentImmediatePreviousCount) : null),
      metadataParentEarlierSamePageCounts: summaries.slice(0, 12).map((item) => Number.isFinite(Number(item?.messages?.metadataParentEarlierSamePageCount)) ? Number(item.messages.metadataParentEarlierSamePageCount) : null),
      metadataParentLaterSamePageCounts: summaries.slice(0, 12).map((item) => Number.isFinite(Number(item?.messages?.metadataParentLaterSamePageCount)) ? Number(item.messages.metadataParentLaterSamePageCount) : null),
      metadataParentSiblingGroupCounts: summaries.slice(0, 12).map((item) => Number.isFinite(Number(item?.messages?.metadataParentSiblingGroupCount)) ? Number(item.messages.metadataParentSiblingGroupCount) : null),
      metadataParentSiblingMessageCounts: summaries.slice(0, 12).map((item) => Number.isFinite(Number(item?.messages?.metadataParentSiblingMessageCount)) ? Number(item.messages.metadataParentSiblingMessageCount) : null),
      includeHasVersionsObserved: summaries.some((item) => item?.endpoint?.includeHasVersions === true),
      backendIdentityMismatchObserved: summaries.some((item) => item?.identity?.responseConversationMatchesRequest === false || item?.identity?.requestConversationMatchesCurrent === false),
      nonLinearSamePageParentObserved: summaries.some((item) => {
        const earlier = Number(item?.messages?.metadataParentEarlierSamePageCount || 0);
        const immediate = Number(item?.messages?.metadataParentImmediatePreviousCount || 0);
        const siblings = Number(item?.messages?.metadataParentSiblingGroupCount || 0);
        return siblings > 0 || earlier > immediate;
      }),
      absoluteTurnCountStatus: primaryPageInfo?.hasPreviousPage === true
        ? 'initial_page_has_previous_page'
        : primaryPageInfo?.hasPreviousPage === false
          ? 'initial_page_complete_from_start'
          : 'unknown'
    };
  }

  function buildNetworkSummary() {
    const fetchEvents = events.filter((event) => event.type === 'FETCH_CALL_OBSERVED');
    const xhrEvents = events.filter((event) => event.type === 'XHR_CALL_OBSERVED');
    const requestEvents = [...fetchEvents, ...xhrEvents];
    const endpoints = requestEvents.map((event) => event.payload?.endpoint).filter(Boolean);
    return {
      fetchCallCount: fetchEvents.length,
      xhrCallCount: xhrEvents.length,
      backendApiCallCount: endpoints.filter((endpoint) => endpoint.backendApi).length,
      conversationLikeCallCount: endpoints.filter((endpoint) => endpoint.conversationLike).length,
      backendResponseSummaryCount: events.filter((event) => event.type === 'BACKEND_RESPONSE_SUMMARY').length,
      backendResponseParseFailureCount: events.filter((event) => event.type === 'BACKEND_RESPONSE_PARSE_FAILED').length,
      conversationResponseSummaryCount: events.filter((event) => event.type === 'CONVERSATION_RESPONSE_SUMMARY').length,
      conversationResponseParseFailureCount: events.filter((event) => event.type === 'CONVERSATION_RESPONSE_PARSE_FAILED').length,
      endpointPatterns: Array.from(new Set(endpoints.map((endpoint) => endpoint.pathnamePattern).filter(Boolean))).slice(0, 60)
    };
  }

  function buildApiResponsibilityEvidence() {
    const requestEvents = events.filter((event) => event.type === 'FETCH_CALL_OBSERVED' || event.type === 'XHR_CALL_OBSERVED');
    const responseEvents = events.filter((event) => event.type === 'BACKEND_RESPONSE_SUMMARY');
    const responseByOrdinal = new Map(responseEvents.map((event) => [event.payload?.requestOrdinal, event]));
    const requestBodyUpdates = new Map(events.filter((event) => event.type === 'REQUEST_BODY_SHAPE_OBSERVED').map((event) => [event.payload?.requestOrdinal, event.payload?.body]));
    const groups = new Map();
    for (const requestEvent of requestEvents) {
      const request = requestEvent.payload || {};
      const endpoint = request.endpoint || {};
      if (!endpoint.backendApi) continue;
      const querySignature = Array.isArray(endpoint.queryKeys) && endpoint.queryKeys.length ? endpoint.queryKeys.join(',') : '(no-query)';
      const key = `${endpoint.method || 'GET'} ${endpoint.pathnamePattern || 'unknown'} ?${querySignature}`;
      if (!groups.has(key)) groups.set(key, {
        method: endpoint.method || null,
        pathnamePattern: endpoint.pathnamePattern || null,
        querySignature,
        transports: new Set(),
        callCount: 0,
        responseCount: 0,
        statusCodes: new Set(),
        queryKeys: new Set(),
        queryNumericHints: [],
        requestBodyTopLevelKeys: new Set(),
        responseTopLevelKeys: new Set(),
        responseCountLikePaths: new Set(),
        responseEnumPaths: new Set(),
        scrollProximateCallCount: 0,
        fullDisplayProximateCallCount: 0
      });
      const group = groups.get(key);
      group.callCount += 1;
      group.transports.add(requestEvent.type === 'XHR_CALL_OBSERVED' ? 'xhr' : 'fetch');
      for (const queryKey of endpoint.queryKeys || []) group.queryKeys.add(queryKey);
      for (const hint of endpoint.queryNumericHints || []) group.queryNumericHints.push(hint);
      const requestBody = requestBodyUpdates.get(request.requestOrdinal) || request.requestBody;
      for (const bodyKey of requestBody?.jsonShape?.topLevelKeys || []) group.requestBodyTopLevelKeys.add(bodyKey);
      const recentScroll = [...events].reverse().find((event) => event.type === 'SCROLL_MARKER' && event.atMs <= requestEvent.atMs && requestEvent.atMs - event.atMs <= 1500);
      if (recentScroll) group.scrollProximateCallCount += 1;
      const recentFullDisplay = [...events].reverse().find((event) => event.type === 'FULL_DISPLAY_CLICK' && event.atMs <= requestEvent.atMs && requestEvent.atMs - event.atMs <= 1500);
      if (recentFullDisplay) group.fullDisplayProximateCallCount += 1;
      const responseEvent = responseByOrdinal.get(request.requestOrdinal);
      if (!responseEvent) continue;
      group.responseCount += 1;
      const response = responseEvent.payload || {};
      if (Number.isFinite(Number(response.status))) group.statusCodes.add(Number(response.status));
      for (const responseKey of response.json?.topLevelKeys || []) group.responseTopLevelKeys.add(responseKey);
      for (const hint of response.json?.structuralHints?.countLikeScalars || []) group.responseCountLikePaths.add(hint.path);
      for (const hint of response.json?.structuralHints?.enumScalars || []) group.responseEnumPaths.add(hint.path);
    }
    return Array.from(groups.values()).map((group) => ({
      method: group.method,
      pathnamePattern: group.pathnamePattern,
      querySignature: group.querySignature,
      transports: Array.from(group.transports).sort(),
      callCount: group.callCount,
      responseCount: group.responseCount,
      statusCodes: Array.from(group.statusCodes).sort((a, b) => a - b),
      queryKeys: Array.from(group.queryKeys).sort(),
      queryNumericHints: group.queryNumericHints.slice(0, 24),
      requestBodyTopLevelKeys: Array.from(group.requestBodyTopLevelKeys).sort(),
      responseTopLevelKeys: Array.from(group.responseTopLevelKeys).sort(),
      responseCountLikePaths: Array.from(group.responseCountLikePaths).sort(),
      responseEnumPaths: Array.from(group.responseEnumPaths).sort(),
      scrollProximateCallCount: group.scrollProximateCallCount,
      fullDisplayProximateCallCount: group.fullDisplayProximateCallCount,
      proofStatus: group.responseCount > 0 ? 'request_and_response_shape_observed' : 'request_only_observed'
    }));
  }

  function buildAbsoluteTurnDiscovery(pagination) {
    const responseEvents = events.filter((event) => event.type === 'BACKEND_RESPONSE_SUMMARY');
    const candidates = [];
    const relevantPath = (path) => path === '/backend-api/conversations/<id>' || path === '/backend-api/conversations/<id>/messages' || path === '/backend-api/conversation/<id>';
    for (const event of responseEvents) {
      const response = event.payload || {};
      if (!relevantPath(response.endpoint?.pathnamePattern)) continue;
      for (const hint of response.json?.structuralHints?.countLikeScalars || []) {
        if (hint.type !== 'number' && hint.type !== 'numeric_string') continue;
        candidates.push({
          requestOrdinal: response.requestOrdinal ?? null,
          method: response.endpoint?.method || null,
          pathnamePattern: response.endpoint?.pathnamePattern || null,
          source: 'response_json_scalar',
          path: hint.path,
          value: hint.value
        });
      }
      for (const header of response.responseHeaderHints || []) {
        if (header.name === 'content-length' || !Array.isArray(header.numberValues) || !header.numberValues.length) continue;
        candidates.push({
          requestOrdinal: response.requestOrdinal ?? null,
          method: response.endpoint?.method || null,
          pathnamePattern: response.endpoint?.pathnamePattern || null,
          source: 'response_header_numbers',
          path: header.name,
          value: header.numberValues.slice(0, 6)
        });
      }
    }
    for (const summary of conversationResponseSummaries()) {
      if (!relevantPath(summary?.endpoint?.pathnamePattern)) continue;
      for (const hint of summary?.messages?.numericMetadataHints || []) {
        if (!/turn/i.test(String(hint.key || ''))) continue;
        candidates.push({
          requestOrdinal: summary.requestOrdinal ?? null,
          method: summary.endpoint?.method || null,
          pathnamePattern: summary.endpoint?.pathnamePattern || null,
          source: 'message_metadata_numeric',
          path: `messages.metadata.${hint.key}`,
          value: { count: hint.count, min: hint.min, max: hint.max, distinctValues: hint.distinctValues }
        });
      }
    }
    return {
      initialPageHasPreviousPage: pagination?.initialPageInfo?.hasPreviousPage ?? null,
      initialPageLocalUserCount: pagination?.initialPageLocalUserTurnCount ?? null,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 80),
      proofStatus: 'unresolved',
      observationStatus: candidates.length
        ? 'numeric_candidates_observed_requires_semantic_validation'
        : 'no_numeric_total_or_position_metadata_observed',
      absoluteTurnCountProvenWithoutPagination: false
    };
  }

  function classifyResponsePhase(responseSummary, lite) {
    if (!responseSummary || !lite?.lastRewrite?.present) return 'unknown';
    if (responseSummary.bodyBytes != null && responseSummary.bodyBytes === lite.lastRewrite.beforeBytes) return 'pre_rewrite';
    if (responseSummary.bodyBytes != null && responseSummary.bodyBytes === lite.lastRewrite.afterBytes) return 'post_rewrite';
    return 'unknown';
  }

  function buildDiagnosis(responseSummary, arcaia, dom, network, pagination, fullDisplay, conversationRoute, absoluteTurnDiscovery) {
    const issues = /** @type {string[]} */ ([]);
    for (const code of responseSummary?.contract?.issueCodes || []) issues.push(`backend_contract:${code}`);
    const apiPageUserCount = Number.isFinite(Number(responseSummary?.path?.userTurnCount))
      ? Number(responseSummary.path.userTurnCount)
      : Number.isFinite(Number(responseSummary?.messages?.userRoleCandidateCount))
        ? Number(responseSummary.messages.userRoleCandidateCount)
        : Number.isFinite(Number(responseSummary?.messages?.userTurnCount))
          ? Number(responseSummary.messages.userTurnCount)
          : null;
    const apiTurnCountComparable = pagination?.absoluteTurnCountStatus !== 'initial_page_has_previous_page';
    const rewriteTurnCount = Number.isFinite(Number(arcaia?.lite?.lastRewrite?.totalTurnCount)) ? Number(arcaia.lite.lastRewrite.totalTurnCount) : null;
    if (!apiTurnCountComparable) issues.push('turn_count:absolute_turn_count_unresolved_due_to_previous_page');
    if (apiTurnCountComparable && apiPageUserCount != null && rewriteTurnCount != null && apiPageUserCount !== rewriteTurnCount) issues.push('turn_count:api_vs_recent_view_rewrite_mismatch');
    if (responseSummary && arcaia?.timestampIndex?.responseReceived && !arcaia.timestampIndex.present) issues.push('timestamp:index_missing');
    if (absoluteTurnDiscovery?.initialPageHasPreviousPage === true) {
      issues.push(absoluteTurnDiscovery.candidateCount > 0
        ? 'absolute_turn:candidate_metadata_requires_validation'
        : 'absolute_turn:no_nonpagination_count_metadata_observed');
    }
    if (
      arcaia?.lite?.enabled === true
      && arcaia?.lite?.backendRewriteEnabled === true
      && responseSummary
      && Number(arcaia?.lite?.rewriteCount || 0) === 0
      && arcaia?.lite?.lastRewrite?.present !== true
    ) issues.push('recent_view:rewrite_not_observed');
    const readOnlyEligibleUserCount = Number.isFinite(Number(responseSummary?.messages?.readOnlyUserEligibleCount)) ? Number(responseSummary.messages.readOnlyUserEligibleCount) : null;
    const userRoleCandidateCount = Number.isFinite(Number(responseSummary?.messages?.userRoleCandidateCount)) ? Number(responseSummary.messages.userRoleCandidateCount) : null;
    const readOnlyModelTotalTurnCount = Number.isFinite(Number(fullDisplay?.lastReadOnlyResult?.totalTurnCount)) ? Number(fullDisplay.lastReadOnlyResult.totalTurnCount) : null;
    if (userRoleCandidateCount != null && readOnlyEligibleUserCount != null && userRoleCandidateCount > readOnlyEligibleUserCount) issues.push('full_display:read_only_user_filter_excludes_backend_user_roles');
    if (fullDisplay?.clickCount > 0 && fullDisplay.readOnlyRequestCount === 0) issues.push('full_display:button_clicked_but_no_read_only_request');
    if (fullDisplay?.readOnlyRequestCount > 0 && fullDisplay.readOnlyResultCount === 0) issues.push('full_display:read_only_request_without_result');
    if (fullDisplay?.pendingRequestExceededContentTimeout === true) issues.push('full_display:read_only_request_exceeded_content_timeout_without_result');
    if (fullDisplay?.lastReadOnlyResult?.arrivedAfterContentTimeout === true) issues.push('full_display:main_result_arrived_after_content_timeout');
    if (fullDisplay?.readOnlyResultCount > 0 && fullDisplay?.lastReadOnlyResult?.ok === true && !fullDisplay?.renderer?.mounted) issues.push('full_display:model_returned_but_renderer_not_mounted');
    if (readOnlyModelTotalTurnCount != null && userRoleCandidateCount != null && readOnlyModelTotalTurnCount < userRoleCandidateCount) issues.push('full_display:read_only_model_has_fewer_turns_than_backend_user_roles');
    if (readOnlyModelTotalTurnCount != null && fullDisplay?.renderer?.mounted && Number(fullDisplay.renderer.turnCount) < readOnlyModelTotalTurnCount) issues.push('full_display:renderer_has_fewer_turns_than_read_only_model');
    if (fullDisplay?.clickCount > 0 && pagination?.initialPageInfo?.hasPreviousPage === true) issues.push('full_display:initial_payload_has_previous_page');
    if (pagination?.backendIdentityMismatchObserved === true) issues.push('full_display:backend_conversation_identity_mismatch');
    if (pagination?.includeHasVersionsObserved === true && pagination?.nonLinearSamePageParentObserved === true) {
      issues.push('full_display:include_has_versions_with_non_linear_parent_relations');
    }
    if (conversationRoute && network?.backendApiCallCount > 0 && network?.conversationLikeCallCount === 0) {
      issues.push('backend_contract:conversation_endpoint_not_observed');
    } else if (conversationRoute && network?.conversationLikeCallCount > 0 && network?.conversationResponseSummaryCount === 0) {
      issues.push('backend_contract:conversation_response_not_observed');
    }
    return {
      issueCodes: issues,
      apiObservedPageUserCount: apiPageUserCount,
      apiObservedTurnCountScope: apiTurnCountComparable ? 'absolute_or_complete_initial_page' : 'initial_page_local_only',
      arcaiaRewriteTotalTurnCount: rewriteTurnCount,
      observedResponsePhase: classifyResponsePhase(responseSummary, arcaia?.lite),
      backendUserRoleCandidateCount: userRoleCandidateCount,
      backendReadOnlyEligibleUserCount: readOnlyEligibleUserCount,
      readOnlyModelTotalTurnCount,
      fullDisplayRendererTurnCount: fullDisplay?.renderer?.turnCount ?? null,
      absoluteTurnDiscoveryStatus: absoluteTurnDiscovery?.observationStatus || 'unknown'
    };
  }

  function onWindowMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.source === CONTENT_SOURCE && data.type === 'GET_READ_ONLY_CONVERSATION_MODEL') {
      if (data.requestId) {
        readOnlyPendingByRequestId.set(data.requestId, {
          startedAt: Date.now(),
          conversationMatchesCurrent: data.payload?.conversationId && currentConversationId()
            ? data.payload.conversationId === currentConversationId()
            : null
        });
      }
      pushEvent('READ_ONLY_MODEL_REQUEST', {
        requestedAll: data.payload?.requestedTurnCount === 'all',
        conversationMatchesCurrent: data.payload?.conversationId && currentConversationId() ? data.payload.conversationId === currentConversationId() : null,
        contentTimeoutMs: CONTENT_READ_ONLY_TIMEOUT_MS
      });
      return;
    }
    if (data?.source === MAIN_SOURCE && data.type === 'READ_ONLY_CONVERSATION_MODEL_RESULT') {
      const pending = data.requestId ? readOnlyPendingByRequestId.get(data.requestId) : null;
      if (data.requestId) readOnlyPendingByRequestId.delete(data.requestId);
      const requestLatencyMs = pending ? Math.max(0, Date.now() - pending.startedAt) : null;
      pushEvent('READ_ONLY_MODEL_RESULT', {
        ...sanitizeReadOnlyModelResult(data.payload || null),
        requestLatencyMs,
        arrivedAfterContentTimeout: requestLatencyMs != null ? requestLatencyMs > CONTENT_READ_ONLY_TIMEOUT_MS : null,
        requestConversationMatchedCurrentAtStart: pending?.conversationMatchesCurrent ?? null
      });
      scheduleDomSnapshot('read_only_model_result');
      return;
    }
    if (data?.source !== SOURCE) return;
    if (['MAIN_STARTED', 'FETCH_CALL_OBSERVED', 'XHR_CALL_OBSERVED', 'REQUEST_BODY_SHAPE_OBSERVED', 'BACKEND_RESPONSE_SUMMARY', 'BACKEND_RESPONSE_PARSE_FAILED', 'CONVERSATION_RESPONSE_SUMMARY', 'CONVERSATION_RESPONSE_PARSE_FAILED', 'ARCAIA_MAIN_EVENT'].includes(data.type)) {
      pushEvent(data.type, data.payload || {});
      if (data.type === 'FETCH_CALL_OBSERVED' || data.type === 'XHR_CALL_OBSERVED') scheduleDomSnapshot(`backend_request_${data.payload?.requestOrdinal ?? 'unknown'}`);
      if (data.type === 'BACKEND_RESPONSE_SUMMARY') scheduleDomSnapshot(`backend_response_${data.payload?.requestOrdinal ?? 'unknown'}`);
    }
  }

  function onDocumentClick(event) {
    const target = event.target instanceof Element ? event.target.closest('#arcaia-recent-view-history-controls button[data-action=\"full\"]') : null;
    if (!target) return;
    fullDisplayClickCount += 1;
    pushEvent('FULL_DISPLAY_CLICK', { clickOrdinal: fullDisplayClickCount, domBefore: buildDomSnapshot() });
    scheduleDomSnapshot('full_display_clicked');
  }

  function onScroll(event) {
    if (stopped || scrollSampleCount >= 40) return;
    const now = Date.now();
    if (now - lastScrollSampleAt < 200) return;
    lastScrollSampleAt = now;
    scrollSampleCount += 1;
    const target = event.target === document ? document.scrollingElement : event.target;
    const scrollTop = Number(target?.scrollTop ?? window.scrollY ?? 0);
    const scrollHeight = Number(target?.scrollHeight ?? document.documentElement?.scrollHeight ?? 0);
    const clientHeight = Number(target?.clientHeight ?? window.innerHeight ?? 0);
    pushEvent('SCROLL_MARKER', {
      ordinal: scrollSampleCount,
      targetKind: event.target === document ? 'document' : event.target === window ? 'window' : 'element',
      scrollTop: Number.isFinite(scrollTop) ? Math.round(scrollTop) : null,
      scrollHeight: Number.isFinite(scrollHeight) ? Math.round(scrollHeight) : null,
      clientHeight: Number.isFinite(clientHeight) ? Math.round(clientHeight) : null,
      nearTop: Number.isFinite(scrollTop) ? scrollTop <= 160 : null,
      nearBottom: Number.isFinite(scrollTop + clientHeight) && Number.isFinite(scrollHeight) ? scrollTop + clientHeight >= scrollHeight - 160 : null
    });
  }

  async function buildReport() {
    const dom = buildDomSnapshot();
    const arcaia = await collectArcaiaState();
    const response = initialResponseSummary();
    const fullDisplayResponse = fullDisplayResponseSummary();
    const network = buildNetworkSummary();
    const pagination = buildPaginationSummary();
    const fullDisplay = buildFullDisplaySummary(dom);
    const apiResponsibilityEvidence = buildApiResponsibilityEvidence();
    const absoluteTurnDiscovery = buildAbsoluteTurnDiscovery(pagination);
    const conversationRoute = Boolean(currentConversationId());
    return {
      probe: { name: 'Arcaia Backend Contract Probe', version: VERSION, sessionId, generatedAtIso: new Date().toISOString() },
      privacy: {
        conversationTextCollected: false,
        conversationIdsCollected: false,
        urlsCollected: false,
        cookiesCollected: false,
        authorizationCollected: false,
        responseBodiesCollected: false,
        requestBodyTextCollected: false,
        countLikeNumericMetadataCollected: true,
        htmlCollected: false
      },
      page: { conversationRoute, readyState: document.readyState },
      network,
      response,
      conversationFetchPhases: { initialDetail: response, fullDisplayDetail: fullDisplayResponse },
      pagination,
      apiResponsibilityEvidence,
      absoluteTurnDiscovery,
      fullDisplay,
      arcaia,
      dom,
      diagnosis: buildDiagnosis(response, arcaia, dom, network, pagination, fullDisplay, conversationRoute, absoluteTurnDiscovery),
      events: events.slice(-MAX_EVENTS)
    };
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    readOnlyPendingByRequestId.clear();
    try { observer?.disconnect?.(); } catch {}
    observer = null;
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('message', onWindowMessage);
    window.postMessage({ source: SOURCE, type: 'STOP_MAIN' }, '*');
  }

  window.addEventListener('message', onWindowMessage);
  document.addEventListener('click', onDocumentClick, true);
  document.addEventListener('scroll', onScroll, true);
  startDomObserver();
  scheduleDomSnapshot('probe_started');
  setTimeout(stop, WATCH_DURATION_MS);

  chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.source !== SOURCE) return false;
    if (message.type === 'PING_PROBE') {
      sendResponse({ ok: true, version: VERSION, stopped });
      return false;
    }
    if (message.type === 'EXPORT_REPORT') {
      void buildReport().then((report) => sendResponse({ ok: true, report }), (error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    return false;
  });

  globalThis[GLOBAL_KEY] = { started: true, version: VERSION, stop };
})();
