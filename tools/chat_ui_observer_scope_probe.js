(() => {
  'use strict';

  const API_KEY = '__ARCAIA_CHAT_UI_OBSERVER_SCOPE_PROBE__';
  const MAX_RECORDS = 720;
  const MAX_CHAIN_DEPTH = 8;
  const WATCHDOG_INTERVAL_MS = 1000;
  const HEADER_MARKDOWN_BUTTON_SELECTOR = '#arcaia-header-markdown-button';
  const TURN_COPY_BUTTON_SELECTOR = 'button[data-testid="copy-turn-action-button"]';
  const TURN_EXPORT_BUTTON_SELECTOR = '[data-arcaia-turn-export-button]';
  const ASSISTANT_TURN_SELECTOR = 'section[data-turn="assistant"]';
  const CODE_OUTER_SELECTOR = 'pre[data-start][data-end]';
  const WRITING_OUTER_SELECTOR = '[data-writing-block-fullscreen-fallback-target="inline"]';
  const WRITING_BLOCK_SELECTOR = '[data-writing-block]';
  const CODE_PROCESSED_SELECTOR = '[data-arcaia-code-block-collapser-processed="true"]';
  const WRITING_PROCESSED_SELECTOR = '[data-arcaia-writing-block-collapser-processed="true"]';
  const CODE_TOGGLE_SELECTOR = '[data-arcaia-code-block-toggle-bound="true"]';
  const CODE_COLLAPSED_SELECTOR = '[data-arcaia-code-block-collapsed="true"]';
  const MESSAGE_ROLE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
  const MESSAGE_TIME_BADGE_SELECTOR = '[data-arcaia-message-time-badge="true"]';
  const MESSAGE_TIME_APPLIED_SELECTOR = '[data-arcaia-message-time-applied="true"]';
  const MESSAGE_TIME_PROVISIONAL_SELECTOR =
    '[data-arcaia-message-time-badge="true"][data-arcaia-timestamp-provisional="true"]';
  const OBSERVED_ATTRIBUTES = [
    'aria-label',
    'data-testid',
    'data-start',
    'data-end',
    'data-writing-block',
    'data-writing-block-fullscreen-fallback-target',
    'data-writing-block-fullscreen-header-chrome',
    'data-message-author-role',
    'data-turn',
    'data-arcaia-turn-export-button',
    'data-arcaia-code-block-collapser-processed',
    'data-arcaia-writing-block-collapser-processed',
    'data-arcaia-code-block-toggle-bound',
    'data-arcaia-code-block-collapsed',
    'data-arcaia-message-time-badge',
    'data-arcaia-message-time-applied',
    'data-arcaia-timestamp-provisional'
  ];

  if (window[API_KEY]?.stop) {
    try { window[API_KEY].stop(); } catch {}
  }

  const startedAt = performance.now();
  const startedAtIso = new Date().toISOString();
  const records = [];
  const elementKeys = new WeakMap();
  const observedNodes = new Map();
  const candidateStats = new Map();
  const lastLevelElementKeys = new Map();
  let nextElementKey = 1;
  let stopped = false;
  let discoveryObserver = null;
  let watchdogTimer = null;
  let rebindQueued = false;
  let rebindCount = 0;
  let currentChains = new Map();
  let currentSemanticSnapshot = null;
  let currentSemanticSignature = '';
  let semanticChangeCount = 0;
  let timeOnlySemanticChangeCount = 0;
  const timeOnlySemanticChangeByFeature = Object.fromEntries(
    ['header_markdown', 'turn_download', 'code_folding', 'message_timestamp']
      .map((feature) => [feature, 0])
  );
  let discoveryCallbackCount = 0;
  let discoveryRelevantCallbackCount = 0;
  let peakCandidateObserverCount = 0;

  function elapsedMs() {
    return Math.round((performance.now() - startedAt) * 10) / 10;
  }

  function push(record) {
    records.push({ atMs: elapsedMs(), ...record });
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  }

  function getElementKey(element) {
    if (!(element instanceof Element)) return null;
    if (!elementKeys.has(element)) {
      elementKeys.set(element, 'node-' + String(nextElementKey++));
    }
    return elementKeys.get(element);
  }

  function normalizeTestId(value) {
    const text = String(value || '');
    if (!text) return null;
    if (/^conversation-turn-/i.test(text)) return 'conversation-turn-*';
    if (text === 'copy-turn-action-button') return text;
    if (/share/i.test(text)) return 'share-like';
    return 'other-present';
  }

  function describeElement(element) {
    if (!(element instanceof Element)) return null;
    const role = element.getAttribute('role');
    const authorRole = element.getAttribute('data-message-author-role');
    const turnRole = element.getAttribute('data-turn');
    return {
      key: getElementKey(element),
      tag: element.tagName.toLowerCase(),
      role: role && /^[a-z-]+$/i.test(role) ? role : null,
      dataTestId: normalizeTestId(element.getAttribute('data-testid')),
      authorRole: /^(user|assistant)$/.test(authorRole || '') ? authorRole : null,
      turnRole: /^(user|assistant)$/.test(turnRole || '') ? turnRole : null,
      isMain: element.matches('main'),
      isHeader: element.matches('header'),
      insideHeader: Boolean(element.closest('header')),
      insideMain: Boolean(element.closest('main')),
      connected: Boolean(element.isConnected),
      directChildCount: element.children?.length || 0,
      parentKey: getElementKey(element.parentElement)
    };
  }

  function isHeaderShareButton(button) {
    if (!(button instanceof HTMLButtonElement) || !button.isConnected) return false;
    const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
    const aria = String(button.getAttribute('aria-label') || '').trim();
    const testId = String(button.getAttribute('data-testid') || '');
    return /^(共有する|共有|Share)$/i.test(text)
      || /^(共有する|共有|Share)$/i.test(aria)
      || /share/i.test(testId);
  }

  function getHeaderShareButtons(root = document) {
    return Array.from(root.querySelectorAll?.('button') || []).filter(isHeaderShareButton);
  }

  function getCodeRoots(root = document) {
    const candidates = [
      ...Array.from(root.querySelectorAll?.(CODE_OUTER_SELECTOR) || []),
      ...Array.from(root.querySelectorAll?.(WRITING_OUTER_SELECTOR) || [])
    ];
    return Array.from(new Set(candidates))
      .filter((element) => element instanceof Element)
      .sort((left, right) => {
        if (left === right) return 0;
        return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
  }

  function lastConnected(elements) {
    const connected = elements.filter((element) => element instanceof Element && element.isConnected);
    return connected.length ? connected[connected.length - 1] : null;
  }

  const featureDefinitions = {
    header_markdown: {
      getTarget() {
        const shareButton = lastConnected(getHeaderShareButtons());
        return shareButton?.parentElement || shareButton || null;
      },
      nodeRelevant(node) {
        if (!(node instanceof Element)) return false;
        return isHeaderShareButton(node)
          || node.matches(HEADER_MARKDOWN_BUTTON_SELECTOR)
          || Boolean(getHeaderShareButtons(node).length)
          || Boolean(node.querySelector?.(HEADER_MARKDOWN_BUTTON_SELECTOR));
      },
      attributeRelevant(mutation) {
        return mutation.attributeName === 'aria-label' || mutation.attributeName === 'data-testid';
      },
      snapshot() {
        const shareButtons = getHeaderShareButtons();
        const reference = lastConnected(shareButtons);
        const target = reference?.parentElement || reference || null;
        const output = document.querySelector(HEADER_MARKDOWN_BUTTON_SELECTOR);
        return {
          nativeReferenceCount: shareButtons.length,
          nativeReferenceKey: getElementKey(reference),
          targetKey: getElementKey(target),
          outputPresent: Boolean(output),
          outputInsideTarget: Boolean(output && target?.contains(output)),
          outputAdjacentToReference: Boolean(output && reference && output.parentElement === reference.parentElement)
        };
      }
    },
    turn_download: {
      getTarget() {
        const copyButton = lastConnected(Array.from(document.querySelectorAll(TURN_COPY_BUTTON_SELECTOR)));
        return copyButton?.parentElement || copyButton || null;
      },
      nodeRelevant(node) {
        if (!(node instanceof Element)) return false;
        return node.matches(TURN_COPY_BUTTON_SELECTOR)
          || node.matches(TURN_EXPORT_BUTTON_SELECTOR)
          || Boolean(node.querySelector?.(TURN_COPY_BUTTON_SELECTOR))
          || Boolean(node.querySelector?.(TURN_EXPORT_BUTTON_SELECTOR));
      },
      attributeRelevant(mutation) {
        return mutation.attributeName === 'data-testid'
          || mutation.attributeName === 'data-arcaia-turn-export-button';
      },
      snapshot() {
        const copyButtons = Array.from(document.querySelectorAll(TURN_COPY_BUTTON_SELECTOR));
        const reference = lastConnected(copyButtons);
        const target = reference?.parentElement || reference || null;
        const outputs = Array.from(document.querySelectorAll(TURN_EXPORT_BUTTON_SELECTOR));
        return {
          nativeCopyButtonCount: copyButtons.length,
          assistantCopyButtonCount: copyButtons.filter((button) => Boolean(button.closest(ASSISTANT_TURN_SELECTOR))).length,
          nativeReferenceKey: getElementKey(reference),
          targetKey: getElementKey(target),
          outputCount: outputs.length,
          outputInsideReferenceToolbarCount: outputs.filter((button) => {
            const copyButton = button.parentElement?.querySelector?.(TURN_COPY_BUTTON_SELECTOR);
            return Boolean(copyButton);
          }).length
        };
      }
    },
    code_folding: {
      getTarget() {
        return lastConnected(getCodeRoots());
      },
      nodeRelevant(node) {
        if (!(node instanceof Element)) return false;
        const selector = [
          CODE_OUTER_SELECTOR,
          WRITING_OUTER_SELECTOR,
          WRITING_BLOCK_SELECTOR,
          CODE_PROCESSED_SELECTOR,
          WRITING_PROCESSED_SELECTOR,
          CODE_TOGGLE_SELECTOR
        ].join(', ');
        return node.matches(selector) || Boolean(node.querySelector?.(selector));
      },
      attributeRelevant(mutation) {
        return [
          'data-start',
          'data-end',
          'data-writing-block',
          'data-writing-block-fullscreen-fallback-target',
          'data-writing-block-fullscreen-header-chrome',
          'data-arcaia-code-block-collapser-processed',
          'data-arcaia-writing-block-collapser-processed',
          'data-arcaia-code-block-toggle-bound',
          'data-arcaia-code-block-collapsed'
        ].includes(mutation.attributeName);
      },
      snapshot() {
        const codeRoots = Array.from(document.querySelectorAll(CODE_OUTER_SELECTOR));
        const writingRoots = Array.from(document.querySelectorAll(WRITING_OUTER_SELECTOR));
        const target = lastConnected([...codeRoots, ...writingRoots]);
        return {
          nativeCodeRootCount: codeRoots.length,
          nativeWritingRootCount: writingRoots.length,
          targetKey: getElementKey(target),
          processedCodeCount: document.querySelectorAll(CODE_PROCESSED_SELECTOR).length,
          processedWritingCount: document.querySelectorAll(WRITING_PROCESSED_SELECTOR).length,
          boundToggleCount: document.querySelectorAll(CODE_TOGGLE_SELECTOR).length,
          collapsedCount: document.querySelectorAll(CODE_COLLAPSED_SELECTOR).length
        };
      }
    },
    message_timestamp: {
      getTarget() {
        return lastConnected(Array.from(document.querySelectorAll(MESSAGE_ROLE_SELECTOR)));
      },
      nodeRelevant(node) {
        if (!(node instanceof Element)) return false;
        const selector = [
          MESSAGE_ROLE_SELECTOR,
          MESSAGE_TIME_BADGE_SELECTOR,
          MESSAGE_TIME_APPLIED_SELECTOR
        ].join(', ');
        return node.matches(selector) || Boolean(node.querySelector?.(selector));
      },
      attributeRelevant(mutation) {
        return [
          'data-message-author-role',
          'data-turn',
          'data-arcaia-message-time-badge',
          'data-arcaia-message-time-applied',
          'data-arcaia-timestamp-provisional'
        ].includes(mutation.attributeName);
      },
      snapshot() {
        const roleNodes = Array.from(document.querySelectorAll(MESSAGE_ROLE_SELECTOR));
        const target = lastConnected(roleNodes);
        return {
          userRoleCount: roleNodes.filter((node) => node.getAttribute('data-message-author-role') === 'user').length,
          assistantRoleCount: roleNodes.filter((node) => node.getAttribute('data-message-author-role') === 'assistant').length,
          targetKey: getElementKey(target),
          badgeCount: document.querySelectorAll(MESSAGE_TIME_BADGE_SELECTOR).length,
          appliedContainerCount: document.querySelectorAll(MESSAGE_TIME_APPLIED_SELECTOR).length,
          provisionalBadgeCount: document.querySelectorAll(MESSAGE_TIME_PROVISIONAL_SELECTOR).length
        };
      }
    }
  };

  function snapshotAllFeatures() {
    return Object.fromEntries(
      Object.entries(featureDefinitions).map(([name, definition]) => [name, definition.snapshot()])
    );
  }

  function semanticSignature(snapshot) {
    return JSON.stringify(snapshot);
  }

  function recordSemanticState(source) {
    const snapshot = snapshotAllFeatures();
    const nextSignature = semanticSignature(snapshot);
    if (nextSignature === currentSemanticSignature) return false;
    const previousSignature = currentSemanticSignature;
    const previousSnapshot = currentSemanticSnapshot;
    const changedFeatures = Object.keys(featureDefinitions).filter((feature) => {
      return semanticSignature(previousSnapshot?.[feature]) !== semanticSignature(snapshot[feature]);
    });
    currentSemanticSnapshot = snapshot;
    currentSemanticSignature = nextSignature;
    semanticChangeCount += 1;
    if (source === 'watchdog' && previousSignature) {
      timeOnlySemanticChangeCount += 1;
      for (const feature of changedFeatures) timeOnlySemanticChangeByFeature[feature] += 1;
    }
    push({
      type: 'semantic_change',
      source,
      timeOnly: source === 'watchdog' && Boolean(previousSignature),
      changedFeatures,
      snapshot
    });
    return true;
  }

  function levelLabel(index) {
    return ['D', 'C', 'B', 'A'][index] || 'A-' + String(index - 3);
  }

  function buildChain(target) {
    if (!(target instanceof Element) || !target.isConnected) return [];
    const chain = [];
    let node = target;
    while (node instanceof Element && chain.length < MAX_CHAIN_DEPTH) {
      chain.push(node);
      if (node.matches('main') || node === document.body || node === document.documentElement) break;
      node = node.parentElement;
    }
    const main = target.closest('main');
    if (main && !chain.includes(main) && chain.length < MAX_CHAIN_DEPTH) chain.push(main);
    return chain;
  }

  function getCandidateStat(featureName, level) {
    const key = featureName + ':' + level;
    if (!candidateStats.has(key)) {
      candidateStats.set(key, {
        feature: featureName,
        level,
        observerInstallCount: 0,
        elementChangeCount: 0,
        callbackCount: 0,
        mutationRecordCount: 0,
        relevantCallbackCount: 0,
        relevantMutationRecordCount: 0,
        mutationAtCandidateRootCount: 0,
        mutationBelowCandidateCount: 0,
        semanticChangeCallbackCount: 0
      });
    }
    return candidateStats.get(key);
  }

  function mutationRelevantToFeature(mutation, definition) {
    if (mutation.type === 'attributes') {
      return definition.attributeRelevant(mutation)
        && definition.nodeRelevant(mutation.target);
    }
    const nodes = [
      ...Array.from(mutation.addedNodes || []),
      ...Array.from(mutation.removedNodes || [])
    ];
    return nodes.some((node) => definition.nodeRelevant(node));
  }

  function handleCandidateMutations(element, entry, mutations) {
    if (stopped) return;
    const semanticChanged = recordSemanticState('candidate_mutation');
    let shouldRebind = false;
    for (const binding of entry.bindings.values()) {
      const definition = featureDefinitions[binding.feature];
      const stat = getCandidateStat(binding.feature, binding.level);
      stat.callbackCount += 1;
      stat.mutationRecordCount += mutations.length;
      const relevant = mutations.filter((mutation) => mutationRelevantToFeature(mutation, definition));
      if (relevant.length) {
        stat.relevantCallbackCount += 1;
        stat.relevantMutationRecordCount += relevant.length;
        stat.mutationAtCandidateRootCount += relevant.filter((mutation) => mutation.target === element).length;
        stat.mutationBelowCandidateCount += relevant.filter((mutation) => mutation.target !== element).length;
        shouldRebind = true;
      }
      if (semanticChanged) stat.semanticChangeCallbackCount += 1;
    }
    if (shouldRebind || !element.isConnected) queueRebind('candidate_mutation');
  }

  function reconcileCandidateObservers(desiredNodes) {
    for (const [element, entry] of observedNodes) {
      if (desiredNodes.has(element) && element.isConnected) continue;
      entry.observer.disconnect();
      observedNodes.delete(element);
    }

    for (const [element, bindings] of desiredNodes) {
      let entry = observedNodes.get(element);
      if (!entry) {
        entry = { bindings: new Map(), observer: null };
        entry.observer = new MutationObserver((mutations) => {
          handleCandidateMutations(element, entry, mutations);
        });
        entry.observer.observe(element, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: OBSERVED_ATTRIBUTES
        });
        observedNodes.set(element, entry);
      }
      entry.bindings = bindings;
    }
    peakCandidateObserverCount = Math.max(peakCandidateObserverCount, observedNodes.size);
  }

  function rebind(reason) {
    if (stopped) return;
    rebindCount += 1;
    const desiredNodes = new Map();
    const nextChains = new Map();

    for (const [featureName, definition] of Object.entries(featureDefinitions)) {
      const chain = buildChain(definition.getTarget());
      nextChains.set(featureName, chain);
      chain.forEach((element, index) => {
        const level = levelLabel(index);
        const stat = getCandidateStat(featureName, level);
        const levelKey = featureName + ':' + level;
        const elementKey = getElementKey(element);
        if (lastLevelElementKeys.get(levelKey) !== elementKey) {
          stat.elementChangeCount += 1;
          stat.observerInstallCount += 1;
          lastLevelElementKeys.set(levelKey, elementKey);
        }
        if (!desiredNodes.has(element)) desiredNodes.set(element, new Map());
        desiredNodes.get(element).set(featureName, { feature: featureName, level });
      });
    }

    currentChains = nextChains;
    reconcileCandidateObservers(desiredNodes);
    push({
      type: 'rebind',
      reason,
      chains: Object.fromEntries(
        Array.from(currentChains, ([feature, chain]) => [
          feature,
          chain.map((element, index) => ({ level: levelLabel(index), element: describeElement(element) }))
        ])
      )
    });
  }

  function queueRebind(reason) {
    if (stopped || rebindQueued) return;
    rebindQueued = true;
    queueMicrotask(() => {
      rebindQueued = false;
      rebind(reason);
    });
  }

  function handleDiscoveryMutations(mutations) {
    if (stopped) return;
    discoveryCallbackCount += 1;
    let relevant = false;
    for (const mutation of mutations) {
      const nodes = [
        ...Array.from(mutation.addedNodes || []),
        ...Array.from(mutation.removedNodes || [])
      ];
      if (nodes.some((node) => Object.values(featureDefinitions).some((definition) => definition.nodeRelevant(node)))) {
        relevant = true;
        break;
      }
    }
    if (relevant) discoveryRelevantCallbackCount += 1;
    const semanticChanged = recordSemanticState('discovery_mutation');
    if (relevant || semanticChanged) queueRebind('discovery_mutation');
  }

  function handleNavigationSignal(event) {
    if (stopped) return;
    recordSemanticState('dom_navigation_event');
    queueRebind(event?.type || 'dom_navigation_event');
  }

  function candidateSummary() {
    return Array.from(candidateStats.values())
      .map((stat) => ({ ...stat }))
      .sort((left, right) => {
        const featureOrder = left.feature.localeCompare(right.feature);
        return featureOrder || left.level.localeCompare(right.level);
      });
  }

  function currentChainSummary() {
    return Object.fromEntries(
      Array.from(currentChains, ([feature, chain]) => [
        feature,
        chain.map((element, index) => ({ level: levelLabel(index), element: describeElement(element) }))
      ])
    );
  }

  function report() {
    return {
      schemaVersion: 1,
      probe: 'arcaia-chat-ui-observer-scope',
      diagnosticOnly: true,
      warning: 'This probe intentionally uses broad DOM observation and a watchdog. Do not copy those mechanisms into normal runtime code.',
      privacy: {
        conversationTextCollected: false,
        htmlCollected: false,
        urlCollected: false,
        elementIdsCollected: false,
        genericClassesCollected: false,
        storageOrCookieAccess: false
      },
      startedAt: startedAtIso,
      durationMs: elapsedMs(),
      stopped,
      watchdogIntervalMs: WATCHDOG_INTERVAL_MS,
      counters: {
        rebindCount,
        semanticChangeCount,
        timeOnlySemanticChangeCount,
        timeOnlySemanticChangeByFeature: { ...timeOnlySemanticChangeByFeature },
        discoveryCallbackCount,
        discoveryRelevantCallbackCount,
        activeCandidateObserverCount: observedNodes.size,
        peakCandidateObserverCount
      },
      currentSnapshots: snapshotAllFeatures(),
      currentChains: currentChainSummary(),
      candidateSummary: candidateSummary(),
      records: records.slice()
    };
  }

  function stop() {
    if (stopped) return report();
    stopped = true;
    discoveryObserver?.disconnect();
    discoveryObserver = null;
    for (const entry of observedNodes.values()) entry.observer.disconnect();
    observedNodes.clear();
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = null;
    window.removeEventListener('popstate', handleNavigationSignal);
    window.removeEventListener('hashchange', handleNavigationSignal);
    window.removeEventListener('pageshow', handleNavigationSignal);
    push({ type: 'stopped' });
    return report();
  }

  function download() {
    const output = stop();
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = objectUrl;
    anchor.download = 'arcaia-chat-ui-observer-scope-probe-' + timestamp + '.json';
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    return output;
  }

  currentSemanticSnapshot = snapshotAllFeatures();
  currentSemanticSignature = semanticSignature(currentSemanticSnapshot);
  rebind('startup');
  discoveryObserver = new MutationObserver(handleDiscoveryMutations);
  discoveryObserver.observe(document.documentElement, { childList: true, subtree: true });
  watchdogTimer = setInterval(() => {
    if (stopped) return;
    const changed = recordSemanticState('watchdog');
    const disconnected = Array.from(currentChains.values())
      .flat()
      .some((element) => !element.isConnected);
    if (changed || disconnected) queueRebind(changed ? 'watchdog_semantic_change' : 'watchdog_disconnected');
  }, WATCHDOG_INTERVAL_MS);
  window.addEventListener('popstate', handleNavigationSignal);
  window.addEventListener('hashchange', handleNavigationSignal);
  window.addEventListener('pageshow', handleNavigationSignal);

  window[API_KEY] = Object.freeze({
    report,
    rebind: () => rebind('manual'),
    stop,
    download
  });

  push({
    type: 'started',
    diagnosticOnly: true,
    features: Object.keys(featureDefinitions),
    initialSnapshots: snapshotAllFeatures()
  });
  console.info(
    '[Arcaia] Chat UI observer scope probe installed. Exercise header Markdown, per-turn download, code folding, and timestamps; then run window.'
      + API_KEY
      + '.download()'
  );
})();
