(() => {
  'use strict';

  const API_KEY = '__ARCAIA_RECENT_VIEW_DOM_PROBE__';
  const MESSAGE_SECTION_SELECTOR = 'section[data-testid^="conversation-turn-"]';
  const MESSAGE_ROLE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
  const STREAM_ROOT_SELECTOR = '[data-scroll-root]';
  const STREAM_ACTIVE_ATTR = 'data-stream-active';
  const MAX_RECORDS = 480;
  const WATCHDOG_INTERVAL_MS = 1000;
  const startedAt = performance.now();
  const records = [];
  const elementKeys = new WeakMap();
  const candidateStats = new Map();
  const candidateObservers = new Map();
  let nextElementKey = 1;
  let stopped = false;
  let currentChain = [];
  let currentChainSignature = '';
  let currentMain = null;
  let currentStreamRoot = null;
  let discoveryObserver = null;
  let streamObserver = null;
  let watchdogTimer = null;
  let rebindQueued = false;
  let rebindCount = 0;
  let semanticChangeCount = 0;
  let timeOnlySemanticChangeCount = 0;
  let currentSemanticSignature = '';

  if (window[API_KEY]?.stop) {
    try { window[API_KEY].stop(); } catch {}
  }

  function elapsedMs() {
    return Math.round((performance.now() - startedAt) * 10) / 10;
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

  function normalizeTestId(value) {
    const text = String(value || '');
    if (/^conversation-turn-/i.test(text)) return 'conversation-turn-*';
    return text ? 'other-present' : null;
  }

  function getTopLevelMessageSections(root = document) {
    return Array.from(root.querySelectorAll?.(MESSAGE_SECTION_SELECTOR) || []).filter((section) => {
      const parentSection = section.parentElement?.closest?.(MESSAGE_SECTION_SELECTOR);
      return !parentSection;
    });
  }

  function findNearestCommonAncestor(elements) {
    const candidates = elements.filter((element) => element instanceof Element && element.isConnected);
    if (!candidates.length) return null;
    let ancestor = candidates[0];
    while (ancestor && !candidates.every((element) => ancestor === element || ancestor.contains(element))) {
      ancestor = ancestor.parentElement;
    }
    return ancestor instanceof Element ? ancestor : null;
  }

  function findConversationMutationRoot() {
    const sections = getTopLevelMessageSections();
    if (!sections.length) return null;
    const sectionParents = sections.map((section) => section.parentElement || section);
    return findNearestCommonAncestor(sectionParents);
  }

  function getCurrentMain() {
    return document.querySelector('main#main') || document.querySelector('main') || null;
  }

  function getCurrentStreamRoot(main = getCurrentMain()) {
    return main?.closest?.(STREAM_ROOT_SELECTOR)
      || main?.querySelector?.(STREAM_ROOT_SELECTOR)
      || document.querySelector(STREAM_ROOT_SELECTOR)
      || null;
  }

  function levelLabel(index) {
    return ['D', 'C', 'B', 'A'][index] || `A-${index - 3}`;
  }

  function buildCandidateChain() {
    const main = getCurrentMain();
    const deepest = findConversationMutationRoot();
    if (!deepest) return { main, deepest: null, chain: [] };
    const chain = [];
    let node = deepest;
    while (node instanceof Element && chain.length < 8) {
      chain.push(node);
      if (node === main) break;
      node = node.parentElement;
    }
    if (main && !chain.includes(main) && main.contains(deepest)) chain.push(main);
    return { main, deepest, chain };
  }

  function describeElement(element) {
    if (!(element instanceof Element)) return null;
    return {
      key: getElementKey(element),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      dataTestId: normalizeTestId(element.getAttribute('data-testid')),
      isMain: element.matches('main'),
      isScrollRoot: element.matches(STREAM_ROOT_SELECTOR),
      connected: Boolean(element.isConnected),
      directChildCount: element.children?.length || 0,
      sectionDescendantCount: element.querySelectorAll?.(MESSAGE_SECTION_SELECTOR)?.length || 0,
      roleDescendantCount: element.querySelectorAll?.(MESSAGE_ROLE_SELECTOR)?.length || 0,
      parentKey: getElementKey(element.parentElement)
    };
  }

  function nodeContainsRelevantStructure(node) {
    if (!(node instanceof Element)) return false;
    return Boolean(
      node.matches?.(MESSAGE_SECTION_SELECTOR)
      || node.matches?.(MESSAGE_ROLE_SELECTOR)
      || node.querySelector?.(MESSAGE_SECTION_SELECTOR)
      || node.querySelector?.(MESSAGE_ROLE_SELECTOR)
    );
  }

  function mutationSummary(mutation, candidate) {
    const added = Array.from(mutation.addedNodes || []);
    const removed = Array.from(mutation.removedNodes || []);
    const structureRelevant = [...added, ...removed].some(nodeContainsRelevantStructure);
    const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
    const targetSection = target?.closest?.(MESSAGE_SECTION_SELECTOR) || null;
    return {
      structureRelevant,
      atCandidateRoot: mutation.target === candidate,
      targetInsideMessageSection: Boolean(targetSection),
      addedElementCount: added.filter((node) => node instanceof Element).length,
      removedElementCount: removed.filter((node) => node instanceof Element).length,
      addedRelevantNodeCount: added.filter(nodeContainsRelevantStructure).length,
      removedRelevantNodeCount: removed.filter(nodeContainsRelevantStructure).length
    };
  }

  function captureSemanticState() {
    const hierarchy = buildCandidateChain();
    const sections = getTopLevelMessageSections();
    const sectionState = sections.map((section) => {
      const roles = Array.from(section.querySelectorAll(MESSAGE_ROLE_SELECTOR))
        .filter((roleNode) => roleNode.closest(MESSAGE_SECTION_SELECTOR) === section)
        .map((roleNode) => roleNode.getAttribute('data-message-author-role'))
        .filter(Boolean);
      return [
        getElementKey(section),
        Array.from(new Set(roles)).join('+') || 'roleless',
        Boolean(String(section.textContent || '').trim())
      ];
    });
    const streamRoot = getCurrentStreamRoot(hierarchy.main);
    const summary = {
      conversationPage: /\/c\/[^/?#]+/i.test(String(window.location.pathname || '')),
      mainKey: getElementKey(hierarchy.main),
      deepestRootKey: getElementKey(hierarchy.deepest),
      sectionCount: sections.length,
      roleCount: document.querySelectorAll(MESSAGE_ROLE_SELECTOR).length,
      generating: Boolean(streamRoot?.hasAttribute?.(STREAM_ACTIVE_ATTR)),
      sectionState
    };
    return {
      signature: JSON.stringify(summary),
      summary: {
        conversationPage: summary.conversationPage,
        mainKey: summary.mainKey,
        deepestRootKey: summary.deepestRootKey,
        sectionCount: summary.sectionCount,
        roleCount: summary.roleCount,
        generating: summary.generating,
        roleShape: sectionState.map((item) => item[1]),
        meaningfulSectionCount: sectionState.filter((item) => item[2]).length
      }
    };
  }

  function recordSemanticChange(source, level = null) {
    const next = captureSemanticState();
    if (next.signature === currentSemanticSignature) return false;
    currentSemanticSignature = next.signature;
    semanticChangeCount += 1;
    if (source === 'time_watchdog') timeOnlySemanticChangeCount += 1;
    push({
      type: 'semantic_change',
      source,
      level,
      timeOnly: source === 'time_watchdog',
      state: next.summary
    });
    return true;
  }

  function createCandidateStats(element, level, index) {
    const key = getElementKey(element);
    const existing = candidateStats.get(key);
    if (existing) {
      existing.level = level;
      existing.index = index;
      existing.connected = Boolean(element.isConnected);
      return existing;
    }
    const stats = {
      key,
      level,
      index,
      element: describeElement(element),
      connected: Boolean(element.isConnected),
      observerInstallCount: 0,
      callbackCount: 0,
      mutationCount: 0,
      relevantMutationCount: 0,
      irrelevantMutationCount: 0,
      relevantAtCandidateRootCount: 0,
      relevantBelowCandidateRootCount: 0,
      semanticChangeCallbackCount: 0,
      disconnectedCallbackCount: 0,
      replacementObservedCount: 0,
      firstCallbackAtMs: null,
      lastCallbackAtMs: null,
      lastSemanticSignature: currentSemanticSignature
    };
    candidateStats.set(key, stats);
    return stats;
  }

  function observeCandidate(element, level, index) {
    const stats = createCandidateStats(element, level, index);
    const observer = new MutationObserver((mutations) => {
      if (stopped) return;
      const summaries = mutations.map((mutation) => mutationSummary(mutation, element));
      const relevant = summaries.filter((item) => item.structureRelevant);
      stats.callbackCount += 1;
      stats.mutationCount += mutations.length;
      stats.relevantMutationCount += relevant.length;
      stats.irrelevantMutationCount += mutations.length - relevant.length;
      stats.relevantAtCandidateRootCount += relevant.filter((item) => item.atCandidateRoot).length;
      stats.relevantBelowCandidateRootCount += relevant.filter((item) => !item.atCandidateRoot).length;
      stats.connected = Boolean(element.isConnected);
      if (!stats.connected) stats.disconnectedCallbackCount += 1;
      if (stats.firstCallbackAtMs == null) stats.firstCallbackAtMs = elapsedMs();
      stats.lastCallbackAtMs = elapsedMs();

      const semantic = captureSemanticState();
      if (semantic.signature !== stats.lastSemanticSignature) {
        stats.semanticChangeCallbackCount += 1;
        stats.lastSemanticSignature = semantic.signature;
      }
      if (relevant.length || semantic.signature !== currentSemanticSignature || !element.isConnected) {
        push({
          type: 'candidate_mutation',
          level,
          candidateKey: stats.key,
          mutationCount: mutations.length,
          relevantMutationCount: relevant.length,
          relevantAtCandidateRootCount: relevant.filter((item) => item.atCandidateRoot).length,
          relevantBelowCandidateRootCount: relevant.filter((item) => !item.atCandidateRoot).length,
          candidateConnected: Boolean(element.isConnected)
        });
      }
      recordSemanticChange('candidate_mutation', level);
      if (!element.isConnected || relevant.length) queueRebind('candidate_mutation');
    });
    observer.observe(element, { childList: true, subtree: true });
    stats.observerInstallCount += 1;
    candidateObservers.set(element, observer);
  }

  function refreshStreamObserver() {
    const nextStreamRoot = getCurrentStreamRoot(currentMain);
    if (nextStreamRoot === currentStreamRoot && streamObserver) return;
    try { streamObserver?.disconnect?.(); } catch {}
    streamObserver = null;
    currentStreamRoot = nextStreamRoot;
    if (!nextStreamRoot) return;
    streamObserver = new MutationObserver((mutations) => {
      if (!mutations.some((mutation) => mutation.attributeName === STREAM_ACTIVE_ATTR)) return;
      push({
        type: 'stream_state_mutation',
        streamRootKey: getElementKey(nextStreamRoot),
        generatingAfter: Boolean(nextStreamRoot.hasAttribute(STREAM_ACTIVE_ATTR))
      });
      recordSemanticChange('stream_attribute_mutation', 'stream-root');
    });
    streamObserver.observe(nextStreamRoot, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [STREAM_ACTIVE_ATTR]
    });
  }

  function refreshBindings(reason = 'manual') {
    if (stopped) return;
    const hierarchy = buildCandidateChain();
    const signature = hierarchy.chain.map(getElementKey).join('>');
    currentMain = hierarchy.main;
    refreshStreamObserver();
    if (signature === currentChainSignature && currentChain.every((element) => element.isConnected)) return;

    for (const element of currentChain) {
      const stats = candidateStats.get(getElementKey(element));
      if (!stats) continue;
      stats.connected = Boolean(element.isConnected);
      if (!element.isConnected) stats.replacementObservedCount += 1;
    }
    for (const observer of candidateObservers.values()) {
      try { observer.disconnect(); } catch {}
    }
    candidateObservers.clear();
    currentChain = hierarchy.chain;
    currentChainSignature = signature;
    rebindCount += 1;

    hierarchy.chain.forEach((element, index) => observeCandidate(element, levelLabel(index), index));
    push({
      type: 'bindings_refreshed',
      reason,
      rebindCount,
      deepestRootFound: Boolean(hierarchy.deepest),
      mainFound: Boolean(hierarchy.main),
      chain: hierarchy.chain.map((element, index) => ({
        level: levelLabel(index),
        ...describeElement(element)
      }))
    });
  }

  function queueRebind(reason) {
    if (stopped || rebindQueued) return;
    rebindQueued = true;
    queueMicrotask(() => {
      rebindQueued = false;
      refreshBindings(reason);
    });
  }

  function discoveryMutationRelevant(mutation) {
    if (currentMain && !currentMain.isConnected) return true;
    if (currentChain[0] && !currentChain[0].isConnected) return true;
    const nodes = [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])];
    return nodes.some((node) => (
      node instanceof Element
      && (
        node.matches?.('main')
        || node.querySelector?.('main')
        || nodeContainsRelevantStructure(node)
      )
    ));
  }

  function installDiscoveryObserver() {
    const root = document.documentElement;
    if (!root) return false;
    discoveryObserver = new MutationObserver((mutations) => {
      if (!mutations.some(discoveryMutationRelevant)) return;
      recordSemanticChange('discovery_rebind_mutation', 'document-root');
      queueRebind('discovery_rebind_mutation');
    });
    discoveryObserver.observe(root, { childList: true, subtree: true });
    return true;
  }

  function runWatchdog() {
    if (stopped) return;
    recordSemanticChange('time_watchdog', 'diagnostic-only');
    if (
      currentMain !== getCurrentMain()
      || (currentChain[0] && !currentChain[0].isConnected)
      || (!currentChain.length && getTopLevelMessageSections().length)
    ) {
      refreshBindings('time_watchdog_rebind');
    }
  }

  function getCandidateSummary() {
    return Array.from(candidateStats.values()).map((stats) => ({
      key: stats.key,
      level: stats.level,
      index: stats.index,
      element: stats.element,
      connected: stats.connected,
      observerInstallCount: stats.observerInstallCount,
      callbackCount: stats.callbackCount,
      mutationCount: stats.mutationCount,
      relevantMutationCount: stats.relevantMutationCount,
      irrelevantMutationCount: stats.irrelevantMutationCount,
      relevantAtCandidateRootCount: stats.relevantAtCandidateRootCount,
      relevantBelowCandidateRootCount: stats.relevantBelowCandidateRootCount,
      semanticChangeCallbackCount: stats.semanticChangeCallbackCount,
      disconnectedCallbackCount: stats.disconnectedCallbackCount,
      replacementObservedCount: stats.replacementObservedCount,
      firstCallbackAtMs: stats.firstCallbackAtMs,
      lastCallbackAtMs: stats.lastCallbackAtMs
    }));
  }

  function snapshot(reason = 'manual') {
    if (stopped) return null;
    const state = captureSemanticState();
    const hierarchy = buildCandidateChain();
    const record = {
      type: 'manual_snapshot',
      reason,
      state: state.summary,
      chain: hierarchy.chain.map((element, index) => ({
        level: levelLabel(index),
        ...describeElement(element)
      }))
    };
    push(record);
    return record;
  }

  function dump() {
    return {
      generatedAt: new Date().toISOString(),
      probeDurationMs: elapsedMs(),
      stopped,
      note: 'Recent View observer-scope diagnostic. Conversation text, conversation IDs, URLs, element IDs, raw HTML, cookies, and storage values are not collected.',
      interpretation: {
        candidateLevels: 'D is the nearest common parent of current top-level conversation-turn sections. C/B/A are successive ancestors up to main.',
        relevantAtCandidateRootCount: 'If D captures all required structural changes here, subtree:false may be sufficient. Otherwise D-local subtree observation is required.',
        replacementObservedCount: 'A non-zero value means rebind logic confirmed that this candidate instance was disconnected. bindings_refreshed records show the replacement chain.',
        timeOnlySemanticChangeCount: 'A non-zero value means the diagnostic watchdog found a grouping-relevant state change not first seen by candidate/stream/discovery mutation paths.',
        warning: 'The 1-second watchdog and document-root discovery observer are diagnostic-only and must not be copied into Debug-OFF runtime.'
      },
      summary: {
        rebindCount,
        semanticChangeCount,
        timeOnlySemanticChangeCount,
        currentChainLength: currentChain.length,
        currentMainConnected: Boolean(currentMain?.isConnected),
        currentDeepestRootConnected: Boolean(currentChain[0]?.isConnected)
      },
      candidateStats: getCandidateSummary(),
      records: records.slice()
    };
  }

  function json() {
    return JSON.stringify(dump(), null, 2);
  }

  function stop() {
    if (stopped) return dump();
    try { discoveryObserver?.disconnect?.(); } catch {}
    try { streamObserver?.disconnect?.(); } catch {}
    for (const observer of candidateObservers.values()) {
      try { observer.disconnect(); } catch {}
    }
    candidateObservers.clear();
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = null;
    stopped = true;
    push({ type: 'stopped' });
    return dump();
  }

  function download() {
    const result = stop();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `arcaia-recent-view-dom-probe-${timestamp}.json`;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.hidden = true;
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    queueMicrotask(() => URL.revokeObjectURL(objectUrl));
    return result;
  }

  currentSemanticSignature = captureSemanticState().signature;
  installDiscoveryObserver();
  refreshBindings('installed');
  watchdogTimer = setInterval(runWatchdog, WATCHDOG_INTERVAL_MS);
  window[API_KEY] = Object.freeze({ stop, download, dump, json, snapshot, refreshBindings });
  snapshot('installed');
  console.info('[Arcaia] Recent View DOM observer probe installed. Change conversations and send/complete a response, then run: window.__ARCAIA_RECENT_VIEW_DOM_PROBE__.download()');
})();
