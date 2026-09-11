(() => {
  'use strict';

  const SOURCE = 'arcaia-model-decoration-watch-v1';
  const PROBE_VERSION = '1.0.28';
  const RUNTIME_KEY = '__arcaiaModelDecorationWatchProbeMain';
  const REQUEST = 'ARCAIA_MODEL_DECORATION_MAIN_SURVEY_REQUEST';
  const RESPONSE = 'ARCAIA_MODEL_DECORATION_MAIN_SURVEY_RESPONSE';
  const REARM_CONVERSATION_CAPTURE = 'ARCAIA_MODEL_DECORATION_REARM_CONVERSATION_CAPTURE';
  const COMPOSER_SELECTOR = 'form[data-type="unified-composer"]';
  const MAX_REACT_DOM_ANCESTORS = 6;
  const MAX_SEMANTIC_PATHS = 24;
  const MAX_OBJECTS_SCANNED = 96;
  const MAX_GLOBAL_MATCHES = 16;
  const MAX_INDEXED_DB_DATABASES = 4;
  const MAX_INDEXED_DB_STORES = 12;
  const MAX_INDEXED_DB_RECORD_SAMPLES = 8;
  const MAX_INDEXED_DB_SEMANTIC_RECORDS = 16;
  const MAX_NETWORK_RESPONSE_SAMPLES = 12;
  const MAX_NETWORK_SEMANTIC_RESPONSES = 12;
  const NETWORK_CAPTURE_WINDOW_MS = 2500;
  const CONVERSATION_MODEL_FIELD_CAPTURE_WINDOW_MS = 8000;
  const SEMANTIC_KEY_PATTERN = /model|slug|thinking|effort|intelligence|tier|reasoning/i;
  const EFFORT_KEY_PATTERN = /thinking|effort|intelligence|reasoning/i;
  const PERFORMANCE_LABELS = new Set([
    '軽', '最速', '中程度', '高い', '非常に高い', '最大',
    'Light', 'Fastest', 'Medium', 'High', 'Very high', 'Maximum'
  ]);
  const THINKING_EFFORTS = new Set([
    'none', 'minimal', 'low', 'medium', 'standard', 'high', 'extended', 'xhigh', 'max'
  ]);
  const GRAPH_KEYS_TO_SKIP = new Set([
    'children', '_owner', 'owner', 'stateNode', 'return', 'child', 'sibling', 'alternate',
    'dependencies', 'deletions', 'updateQueue'
  ]);
  const KNOWN_STATE_GLOBALS = new Set(['__remixContext', '__NEXT_DATA__', '__reactRouterContext']);
  let networkCaptureUntil = 0;
  let networkResponsesInspected = 0;
  let networkSemanticResponses = [];
  let networkFetchRestoreTimer = null;
  let downstreamFetch = null;
  if (globalThis[RUNTIME_KEY]?.version === PROBE_VERSION) return;
  globalThis[RUNTIME_KEY] = { version: PROBE_VERSION };

  let conversationModelFieldCaptureUntil = 0;
  let conversationModelFieldObservation = null;
  let conversationModelFieldFetchRestoreTimer = null;
  let conversationModelFieldDownstreamFetch = null;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function safeIdentifier(value, max = 96) {
    const normalized = normalizeText(value);
    return new RegExp(`^[a-z0-9_.:\\-]{1,${max}}$`, 'i').test(normalized) ? normalized : null;
  }

  function sanitizePathSegment(value) {
    const normalized = normalizeText(value);
    return /^[a-z_$][a-z0-9_$.-]{0,63}$/i.test(normalized) ? normalized : null;
  }

  function activeSurfaceMode() {
    const active = Array.from(document.querySelectorAll('button[role="radio"][data-state="on"]'))
      .find((button) => /^(Chat|Work)$/i.test(normalizeText(button.textContent)));
    const label = normalizeText(active?.textContent).toLowerCase();
    if (label === 'work') return 'work';
    if (label === 'chat') return 'chatgpt';
    return null;
  }

  function createSignals() {
    return {
      gpt56SignalPresent: false,
      workFamily: null,
      performance: null,
      thinkingEffort: null
    };
  }

  function mergeValue(signals, value) {
    const normalized = normalizeText(value);
    if (!normalized) return signals;
    if (/(?:^|[-_.])gpt[-_]?5(?:[-_.]?6)(?:[-_]|$)/i.test(normalized) || /\bGPT[-\u2011\u2013\s]?5\.6\b/i.test(normalized)) {
      signals.gpt56SignalPresent = true;
    }
    if (!signals.workFamily) {
      if (/(?:^|[-_.\s])sol(?:[-_.\s]|$)/i.test(normalized)) signals.workFamily = 'Sol';
      else if (/(?:^|[-_.\s])terra(?:[-_.\s]|$)/i.test(normalized)) signals.workFamily = 'Terra';
      else if (/(?:^|[-_.\s])luna(?:[-_.\s]|$)/i.test(normalized)) signals.workFamily = 'Luna';
    }
    if (!signals.performance) {
      for (const label of PERFORMANCE_LABELS) {
        if (normalized === label || normalized.startsWith(`${label} `) || normalized.endsWith(` ${label}`)) {
          signals.performance = label;
          break;
        }
      }
    }
    if (!signals.thinkingEffort) {
      const effort = normalized.toLowerCase();
      if (THINKING_EFFORTS.has(effort)) signals.thinkingEffort = effort;
    }
    return signals;
  }

  function mergeSignals(target, source) {
    if (!source) return target;
    if (source.gpt56SignalPresent) target.gpt56SignalPresent = true;
    if (!target.workFamily && source.workFamily) target.workFamily = source.workFamily;
    if (!target.performance && source.performance) target.performance = source.performance;
    if (!target.thinkingEffort && source.thinkingEffort) target.thinkingEffort = source.thinkingEffort;
    return target;
  }

  function createSemanticScanState() {
    return {
      semanticPaths: [],
      ...createSignals(),
      seen: new WeakSet(),
      objectsScanned: 0
    };
  }

  function scanSemanticObject(value, prefix = '', depth = 0, state = null) {
    const output = state || createSemanticScanState();
    if (!value || typeof value !== 'object' || depth > 3 || output.objectsScanned >= MAX_OBJECTS_SCANNED) return output;
    if (output.seen.has(value)) return output;
    output.seen.add(value);
    output.objectsScanned += 1;

    if (Array.isArray(value)) {
      for (let index = 0; index < Math.min(value.length, 8); index += 1) {
        scanSemanticObject(value[index], `${prefix}[${index}]`, depth + 1, output);
      }
      return output;
    }

    let entries = [];
    try { entries = Object.entries(value); } catch { return output; }
    for (const [rawKey, child] of entries) {
      if (output.semanticPaths.length >= MAX_SEMANTIC_PATHS || output.objectsScanned >= MAX_OBJECTS_SCANNED) break;
      const key = sanitizePathSegment(rawKey);
      if (!key) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const semantic = SEMANTIC_KEY_PATTERN.test(key);
      if (semantic) {
        if (!output.semanticPaths.includes(path)) output.semanticPaths.push(path);
        if (typeof child === 'string' || typeof child === 'number') mergeValue(output, child);
      }
      if (
        child
        && typeof child === 'object'
        && !GRAPH_KEYS_TO_SKIP.has(key)
      ) scanSemanticObject(child, path, depth + 1, output);
    }
    return output;
  }

  function publicScanResult(result) {
    return {
      semanticPaths: result.semanticPaths.slice(0, MAX_SEMANTIC_PATHS),
      gpt56SignalPresent: result.gpt56SignalPresent === true,
      workFamily: ['Sol', 'Terra', 'Luna'].includes(result.workFamily) ? result.workFamily : null,
      performance: PERFORMANCE_LABELS.has(result.performance) ? result.performance : null,
      thinkingEffort: THINKING_EFFORTS.has(result.thinkingEffort) ? result.thinkingEffort : null
    };
  }

  function findWorkModelButton() {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    if (!(composer instanceof Element)) return null;
    const buttons = Array.from(composer.querySelectorAll('button[aria-haspopup="menu"]'));
    const nonPerformanceButtons = buttons.filter((button) => {
      const signals = createSignals();
      mergeValue(signals, button.textContent);
      mergeValue(signals, button.getAttribute('aria-label'));
      mergeValue(signals, button.getAttribute('title'));
      return !signals.performance;
    });
    return buttons.find((button) => button.querySelector('[data-animated-slider-trigger="true"]'))
      || buttons.find((button) => (
      /GPT[-\u2011\u2013\s]?5(?:\.6)?/i.test(normalizeText(button.textContent))
      || /model|thinking|intelligence/i.test(String(button.getAttribute('data-testid') || ''))
    ))
      || (nonPerformanceButtons.length === 1 ? nonPerformanceButtons[0] : null)
      || (activeSurfaceMode() === 'work' && buttons.length === 1 ? buttons[0] : null);
  }

  function summarizeModelButton(button) {
    if (!(button instanceof Element)) {
      return {
        present: false,
        ariaExpanded: null,
        dataState: null,
        ariaControlsPresent: false,
        controlledElementPresent: false
      };
    }
    const controls = normalizeText(button.getAttribute('aria-controls'));
    return {
      present: true,
      ariaExpanded: ['true', 'false'].includes(button.getAttribute('aria-expanded')) ? button.getAttribute('aria-expanded') : null,
      dataState: ['open', 'closed'].includes(button.getAttribute('data-state')) ? button.getAttribute('data-state') : null,
      ariaControlsPresent: Boolean(controls),
      controlledElementPresent: Boolean(controls && document.getElementById(controls))
    };
  }

  function summarizeReact(button) {
    const result = createSemanticScanState();
    let reactOwnerCount = 0;
    let inspectedDomNodeCount = 0;
    let node = button instanceof Element ? button : null;
    while (node && inspectedDomNodeCount < MAX_REACT_DOM_ANCESTORS) {
      inspectedDomNodeCount += 1;
      let props = null;
      let fiber = null;
      try {
        for (const key of Object.keys(node)) {
          if (!props && key.startsWith('__reactProps$')) props = node[key];
          if (!fiber && key.startsWith('__reactFiber$')) fiber = node[key];
        }
      } catch {}
      if (props || fiber) reactOwnerCount += 1;
      if (props && typeof props === 'object') scanSemanticObject(props, `dom${inspectedDomNodeCount}.props`, 0, result);
      if (fiber && typeof fiber === 'object') {
        scanSemanticObject(fiber.memoizedProps, `dom${inspectedDomNodeCount}.fiber.memoizedProps`, 0, result);
        scanSemanticObject(fiber.pendingProps, `dom${inspectedDomNodeCount}.fiber.pendingProps`, 0, result);
        let hook = fiber.memoizedState;
        for (let hookIndex = 0; hook && typeof hook === 'object' && hookIndex < 10; hookIndex += 1) {
          scanSemanticObject(hook.memoizedState, `dom${inspectedDomNodeCount}.fiber.hook${hookIndex}.memoizedState`, 0, result);
          scanSemanticObject(hook.baseState, `dom${inspectedDomNodeCount}.fiber.hook${hookIndex}.baseState`, 0, result);
          hook = hook.next;
        }
      }
      if (node.matches?.(COMPOSER_SELECTOR)) break;
      node = node.parentElement;
    }
    return {
      inspectedDomNodeCount,
      reactOwnerCount,
      triggerDescendants: summarizeTriggerDescendantReact(button),
      ...publicScanResult(result)
    };
  }

  function summarizeTriggerDescendantReact(button) {
    const result = createSemanticScanState();
    const wrapper = button instanceof Element
      ? button.querySelector('[data-animated-slider-trigger="true"]')
      : null;
    const nodes = wrapper
      ? [wrapper, ...Array.from(wrapper.querySelectorAll('*'))].slice(0, 12)
      : [];
    let reactOwnerCount = 0;
    const effortReactPropNames = new Set();
    const effortDomAttributeNames = new Set();
    let dataMaxEffort = null;

    function collectEffortProps(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      let entries = [];
      try { entries = Object.entries(value); } catch { return; }
      for (const [rawKey, child] of entries) {
        const key = sanitizePathSegment(rawKey);
        if (!key || !EFFORT_KEY_PATTERN.test(key)) continue;
        effortReactPropNames.add(key);
        if (!dataMaxEffort && key.toLowerCase() === 'data-max-effort') {
          const type = child === null ? 'null' : typeof child;
          dataMaxEffort = {
            valueType: ['boolean', 'number', 'string', 'null'].includes(type) ? type : 'other',
            booleanValue: typeof child === 'boolean' ? child : null,
            numberValue: typeof child === 'number' && Number.isFinite(child) && Math.abs(child) <= 1000 ? child : null,
            identifierValue: typeof child === 'string' ? safeIdentifier(child, 32) : null
          };
        }
      }
    }

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      try {
        for (const rawName of node.getAttributeNames?.() || []) {
          const name = sanitizePathSegment(rawName);
          if (name && EFFORT_KEY_PATTERN.test(name)) effortDomAttributeNames.add(name);
        }
      } catch {}
      let props = null;
      let fiber = null;
      try {
        for (const key of Object.keys(node)) {
          if (!props && key.startsWith('__reactProps$')) props = node[key];
          if (!fiber && key.startsWith('__reactFiber$')) fiber = node[key];
        }
      } catch {}
      if (props || fiber) reactOwnerCount += 1;
      if (props && typeof props === 'object') {
        collectEffortProps(props);
        scanSemanticObject(props, `trigger${index}.props`, 0, result);
      }
      if (fiber && typeof fiber === 'object') {
        collectEffortProps(fiber.memoizedProps);
        collectEffortProps(fiber.pendingProps);
        scanSemanticObject(fiber.memoizedProps, `trigger${index}.fiber.memoizedProps`, 0, result);
        scanSemanticObject(fiber.pendingProps, `trigger${index}.fiber.pendingProps`, 0, result);
      }
    }
    return {
      inspectedDomNodeCount: nodes.length,
      reactOwnerCount,
      effortReactPropNames: Array.from(effortReactPropNames).sort().slice(0, 12),
      effortDomAttributeNames: Array.from(effortDomAttributeNames).sort().slice(0, 12),
      dataMaxEffort,
      ...publicScanResult(result)
    };
  }

  function valueShape(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'other';
  }

  function summarizeGlobals() {
    const matches = [];
    let scannedCount = 0;
    let names = [];
    try { names = Object.getOwnPropertyNames(window); } catch {}
    for (const rawName of names) {
      if (matches.length >= MAX_GLOBAL_MATCHES) break;
      const name = safeIdentifier(rawName, 64);
      if (!name || (!SEMANTIC_KEY_PATTERN.test(name) && !KNOWN_STATE_GLOBALS.has(name))) continue;
      scannedCount += 1;
      let value;
      try { value = window[rawName]; } catch { continue; }
      const result = createSemanticScanState();
      if (typeof value === 'string' || typeof value === 'number') mergeValue(result, value);
      else if (value && typeof value === 'object') scanSemanticObject(value, name, 0, result);
      const publicResult = publicScanResult(result);
      if (!publicResult.semanticPaths.length && !publicResult.gpt56SignalPresent && !publicResult.workFamily && !publicResult.performance && !publicResult.thinkingEffort) continue;
      matches.push({ name, valueShape: valueShape(value), ...publicResult });
    }
    return { scannedCount, matches };
  }

  function summarizeHistoryState() {
    let state = null;
    try { state = history.state; } catch {}
    return publicScanResult(scanSemanticObject(state, 'history.state'));
  }

  function summarizeNavigationState() {
    let state = null;
    try { state = window.navigation?.currentEntry?.getState?.(); } catch {}
    return publicScanResult(scanSemanticObject(state, 'navigation.state'));
  }

  function classifyName(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (/model|slug/.test(normalized)) return 'model';
    if (/thinking|effort|reasoning/.test(normalized)) return 'thinking';
    if (/intelligence/.test(normalized)) return 'intelligence';
    if (/setting|config/.test(normalized)) return 'settings';
    if (/state/.test(normalized)) return 'state';
    if (/cache/.test(normalized)) return 'cache';
    if (/chat|conversation|thread/.test(normalized)) return 'chat';
    return 'other';
  }

  function openDatabase(name) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => finish(null), 700);
      let request;
      try { request = indexedDB.open(name); } catch { finish(null); return; }
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
      request.onsuccess = () => finish(request.result);
    });
  }

  function scanObjectStore(db, storeName, databaseCategory, storeCategory, budget) {
    return new Promise((resolve) => {
      const semanticRecords = [];
      let samples = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ samples, semanticRecords });
      };
      const timeout = setTimeout(finish, 700);
      let transaction;
      try { transaction = db.transaction(storeName, 'readonly'); } catch { finish(); return; }
      let request;
      try { request = transaction.objectStore(storeName).openCursor(); } catch { finish(); return; }
      request.onerror = finish;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || samples >= MAX_INDEXED_DB_RECORD_SAMPLES || budget.remaining <= 0) {
          finish();
          return;
        }
        samples += 1;
        budget.remaining -= 1;
        const result = publicScanResult(scanSemanticObject(cursor.value));
        if (result.semanticPaths.length || result.gpt56SignalPresent || result.workFamily || result.performance || result.thinkingEffort) {
          semanticRecords.push({
            databaseCategory,
            storeCategory,
            valueShape: valueShape(cursor.value),
            ...result
          });
        }
        cursor.continue();
      };
    });
  }

  async function summarizeIndexedDb(includeIndexedDb) {
    const base = {
      supported: typeof indexedDB?.databases === 'function',
      requested: includeIndexedDb === true,
      databaseCount: null,
      scannedDatabaseCount: 0,
      scannedStoreCount: 0,
      recordSamplesScanned: 0,
      semanticRecords: []
    };
    if (!includeIndexedDb || !base.supported) return base;
    let databases = [];
    try {
      databases = await Promise.race([
        indexedDB.databases(),
        new Promise((resolve) => setTimeout(() => resolve([]), 700))
      ]);
    } catch { return base; }
    base.databaseCount = databases.length;
    const budget = { remaining: MAX_INDEXED_DB_DATABASES * MAX_INDEXED_DB_STORES * MAX_INDEXED_DB_RECORD_SAMPLES };
    for (const info of databases.slice(0, MAX_INDEXED_DB_DATABASES)) {
      if (!info?.name) continue;
      const db = await openDatabase(info.name);
      if (!db) continue;
      base.scannedDatabaseCount += 1;
      const databaseCategory = classifyName(info.name);
      try {
        for (const storeName of Array.from(db.objectStoreNames).slice(0, Math.max(0, MAX_INDEXED_DB_STORES - base.scannedStoreCount))) {
          if (base.scannedStoreCount >= MAX_INDEXED_DB_STORES) break;
          base.scannedStoreCount += 1;
          const result = await scanObjectStore(db, storeName, databaseCategory, classifyName(storeName), budget);
          base.recordSamplesScanned += result.samples;
          for (const record of result.semanticRecords) {
            if (base.semanticRecords.length >= MAX_INDEXED_DB_SEMANTIC_RECORDS) break;
            base.semanticRecords.push(record);
          }
        }
      } finally {
        try { db.close(); } catch {}
      }
      if (base.scannedStoreCount >= MAX_INDEXED_DB_STORES) break;
    }
    return base;
  }

  function summarizeResources() {
    const categories = { model: 0, settings: 0, conversation: 0, tpp: 0, work: 0, backendApi: 0 };
    let matchedCount = 0;
    let entries = [];
    try { entries = performance.getEntriesByType('resource').slice(-120); } catch {}
    for (const entry of entries) {
      let pathname = '';
      try { pathname = new URL(entry.name, location.origin).pathname.toLowerCase(); } catch { continue; }
      const matched = [];
      if (/model|slug/.test(pathname)) matched.push('model');
      if (/setting|config/.test(pathname)) matched.push('settings');
      if (/conversation|thread/.test(pathname)) matched.push('conversation');
      if (/\/tpp\//.test(pathname)) matched.push('tpp');
      if (/work/.test(pathname)) matched.push('work');
      if (/backend-api/.test(pathname)) matched.push('backendApi');
      if (!matched.length) continue;
      matchedCount += 1;
      for (const category of new Set(matched)) categories[category] += 1;
    }
    return { matchedCount, categories };
  }

  function classifyResourceCategories(url) {
    const categories = [];
    let pathname = '';
    try { pathname = new URL(url, location.origin).pathname.toLowerCase(); } catch { return categories; }
    if (/model|slug/.test(pathname)) categories.push('model');
    if (/setting|config/.test(pathname)) categories.push('settings');
    if (/conversation|thread/.test(pathname)) categories.push('conversation');
    if (/\/tpp\//.test(pathname)) categories.push('tpp');
    if (/work/.test(pathname)) categories.push('work');
    if (/backend-api/.test(pathname)) categories.push('backendApi');
    return Array.from(new Set(categories));
  }

  function classifyModelSlugStructure(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
      return {
        present: false,
        slugLength: 0,
        tokenCount: 0,
        separatorPattern: 'none',
        gpt5Present: false,
        version6Present: false,
        thinkingAlias: false,
        knownFamily: 'none'
      };
    }
    const separators = new Set();
    if (normalized.includes('-')) separators.add('hyphen');
    if (normalized.includes('_')) separators.add('underscore');
    if (normalized.includes('.')) separators.add('dot');
    const tokens = normalized.split(/[-_.]+/).filter(Boolean);
    const gpt5Present = /(?:^|[-_.])gpt(?:[-_.]?5)(?:[-_.]|$)/i.test(normalized);
    const version6Present = tokens.includes('6') || /(?:^|[-_.])5(?:[-_.]?6)(?:[-_.]|$)/i.test(normalized);
    const thinkingAlias = tokens.includes('thinking');
    const explicitGpt56 = /(?:^|[-_.])gpt(?:[-_.]?5)(?:[-_.]?6)(?:[-_.]|$)/i.test(normalized);
    return {
      present: true,
      slugLength: Math.min(normalized.length, 160),
      tokenCount: Math.min(tokens.length, 24),
      separatorPattern: separators.size === 0 ? 'none' : separators.size === 1 ? Array.from(separators)[0] : 'mixed',
      gpt5Present,
      version6Present,
      thinkingAlias,
      knownFamily: explicitGpt56
        ? 'explicit_gpt56'
        : gpt5Present && thinkingAlias
          ? 'gpt5_thinking_alias'
          : gpt5Present
            ? 'gpt5_generic'
            : 'other'
    };
  }

  function findConversationModelMetadata(body) {
    if (!body || typeof body !== 'object') return null;
    if (body.mapping && typeof body.mapping === 'object' && body.current_node) {
      let nodeId = body.current_node;
      for (let distance = 0; distance < 64 && nodeId; distance += 1) {
        const node = body.mapping[nodeId];
        const metadata = node?.message?.metadata;
        if (metadata && typeof metadata === 'object') {
          const hasModelField = ['resolved_model_slug', 'model_slug', 'default_model_slug']
            .some((key) => normalizeText(metadata[key]));
          if (hasModelField) return { metadata, sourceShape: 'mapping_current_branch', selectedMessageDistanceFromLeaf: distance };
        }
        nodeId = node?.parent || null;
      }
    }
    if (Array.isArray(body.messages)) {
      for (let distance = 0; distance < Math.min(body.messages.length, 64); distance += 1) {
        const message = body.messages[body.messages.length - 1 - distance];
        const metadata = message?.metadata;
        if (!metadata || typeof metadata !== 'object') continue;
        const hasModelField = ['resolved_model_slug', 'model_slug', 'default_model_slug']
          .some((key) => normalizeText(metadata[key]));
        if (hasModelField) return { metadata, sourceShape: 'flat_messages', selectedMessageDistanceFromLeaf: distance };
      }
    }
    return null;
  }

  function summarizeConversationModelFields(body) {
    const found = findConversationModelMetadata(body);
    if (!found) return null;
    const fields = {
      resolvedModelSlug: classifyModelSlugStructure(found.metadata.resolved_model_slug),
      modelSlug: classifyModelSlugStructure(found.metadata.model_slug),
      defaultModelSlug: classifyModelSlugStructure(found.metadata.default_model_slug)
    };
    const precedence = [
      ['resolved_model_slug', fields.resolvedModelSlug],
      ['model_slug', fields.modelSlug],
      ['default_model_slug', fields.defaultModelSlug]
    ];
    const first = precedence.find(([, summary]) => summary.present) || null;
    const alternateExplicitGpt56FieldPresent = Boolean(
      first
      && first[1].knownFamily !== 'explicit_gpt56'
      && precedence.some(([name, summary]) => name !== first[0] && summary.knownFamily === 'explicit_gpt56')
    );
    return {
      sourceShape: found.sourceShape,
      selectedMessageDistanceFromLeaf: found.selectedMessageDistanceFromLeaf,
      thinkingEffortPresent: Boolean(normalizeText(found.metadata.thinking_effort || found.metadata.thinkingEffort)),
      arcaiaPrecedenceField: first?.[0] || null,
      alternateExplicitGpt56FieldPresent,
      fields
    };
  }

  function inspectConversationModelFieldResponse(response) {
    if (
      conversationModelFieldObservation
      || !(response instanceof Response)
      || performance.now() > conversationModelFieldCaptureUntil
    ) return;
    let pathname = '';
    try { pathname = new URL(response.url, location.origin).pathname.toLowerCase(); } catch { return; }
    if (!/^\/backend-api\/conversations?\//.test(pathname)) return;
    const contentType = normalizeText(response.headers.get('content-type')).toLowerCase();
    if (!contentType.includes('json')) return;
    let clone;
    try { clone = response.clone(); } catch { return; }
    void clone.json().then((body) => {
      const summary = summarizeConversationModelFields(body);
      if (summary) conversationModelFieldObservation = summary;
    }).catch(() => {});
  }

  function summarizeNetworkBuffer() {
    return {
      captureWindowMs: NETWORK_CAPTURE_WINDOW_MS,
      responsesInspected: networkResponsesInspected,
      semanticResponses: networkSemanticResponses.slice(0, MAX_NETWORK_SEMANTIC_RESPONSES)
    };
  }

  function armNetworkCapture() {
    networkCaptureUntil = performance.now() + NETWORK_CAPTURE_WINDOW_MS;
    networkResponsesInspected = 0;
    networkSemanticResponses = [];
    installNetworkFetchHook();
  }

  function inspectFetchResponse(response) {
    if (!(response instanceof Response) || performance.now() > networkCaptureUntil) return;
    if (networkResponsesInspected >= MAX_NETWORK_RESPONSE_SAMPLES) return;
    const contentType = normalizeText(response.headers.get('content-type')).toLowerCase();
    if (!contentType.includes('json')) return;
    networkResponsesInspected += 1;
    let clone;
    try { clone = response.clone(); } catch { return; }
    void clone.json().then((body) => {
      const result = publicScanResult(scanSemanticObject(body, 'response'));
      if (!result.semanticPaths.length && !result.gpt56SignalPresent && !result.workFamily && !result.performance && !result.thinkingEffort) return;
      if (networkSemanticResponses.length >= MAX_NETWORK_SEMANTIC_RESPONSES) return;
      networkSemanticResponses.push({
        statusClass: response.status >= 200 && response.status < 300 ? '2xx' : response.status >= 400 ? '4xx_or_5xx' : 'other',
        resourceCategories: classifyResourceCategories(response.url),
        ...result
      });
    }).catch(() => {});
  }

  async function diagnosticFetch(...args) {
    const response = await downstreamFetch.apply(this, args);
    inspectFetchResponse(response);
    return response;
  }

  function installNetworkFetchHook() {
    if (typeof window.fetch !== 'function') return;
    if (window.fetch !== diagnosticFetch) downstreamFetch = window.fetch;
    if (typeof downstreamFetch !== 'function') return;
    window.fetch = diagnosticFetch;
    if (networkFetchRestoreTimer) clearTimeout(networkFetchRestoreTimer);
    networkFetchRestoreTimer = setTimeout(() => {
      networkFetchRestoreTimer = null;
      if (window.fetch === diagnosticFetch && typeof downstreamFetch === 'function') window.fetch = downstreamFetch;
    }, NETWORK_CAPTURE_WINDOW_MS + 100);
  }

  async function conversationModelFieldFetch(...args) {
    const response = await conversationModelFieldDownstreamFetch.apply(this, args);
    inspectConversationModelFieldResponse(response);
    return response;
  }

  function installConversationModelFieldFetchHook() {
    if (typeof window.fetch !== 'function') return;
    if (window.fetch !== conversationModelFieldFetch) {
      conversationModelFieldDownstreamFetch = window.fetch;
      if (typeof conversationModelFieldDownstreamFetch !== 'function') return;
      window.fetch = conversationModelFieldFetch;
    }
    if (conversationModelFieldFetchRestoreTimer) clearTimeout(conversationModelFieldFetchRestoreTimer);
    conversationModelFieldFetchRestoreTimer = setTimeout(() => {
      conversationModelFieldFetchRestoreTimer = null;
      if (
        window.fetch === conversationModelFieldFetch
        && typeof conversationModelFieldDownstreamFetch === 'function'
      ) window.fetch = conversationModelFieldDownstreamFetch;
    }, CONVERSATION_MODEL_FIELD_CAPTURE_WINDOW_MS + 100);
  }

  function armConversationModelFieldCapture() {
    conversationModelFieldObservation = null;
    conversationModelFieldCaptureUntil = performance.now() + CONVERSATION_MODEL_FIELD_CAPTURE_WINDOW_MS;
    installConversationModelFieldFetchHook();
  }

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest?.('button[role="radio"]') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    if (normalizeText(button.textContent).toLowerCase() === 'work') armNetworkCapture();
  }, true);

  async function buildSurvey(phase, includeIndexedDb) {
    const button = findWorkModelButton();
    return {
      probeVersion: PROBE_VERSION,
      phase: safeIdentifier(phase) || 'unspecified',
      activeSurfaceMode: activeSurfaceMode(),
      modelButton: summarizeModelButton(button),
      react: summarizeReact(button),
      globals: summarizeGlobals(),
      historyState: summarizeHistoryState(),
      navigationState: summarizeNavigationState(),
      indexedDb: await summarizeIndexedDb(includeIndexedDb),
      resources: summarizeResources(),
      network: summarizeNetworkBuffer(),
      conversationModelFields: conversationModelFieldObservation
    };
  }

  armConversationModelFieldCapture();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.source === SOURCE && data.type === REARM_CONVERSATION_CAPTURE) {
      armConversationModelFieldCapture();
      return;
    }
    if (
      !data
      || data.source !== SOURCE
      || data.type !== REQUEST
      || typeof data.requestId !== 'string'
    ) return;
    const requestId = data.requestId;
    void buildSurvey(data.phase, data.includeIndexedDb === true).then((payload) => {
      window.postMessage({ source: SOURCE, type: RESPONSE, requestId, payload }, '*');
    });
  });
})();
