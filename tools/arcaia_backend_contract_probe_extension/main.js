(() => {
  'use strict';

  const SOURCE = 'arcaia-backend-contract-probe-v1';
  const VERSION = '1.0.8';
  const GLOBAL_KEY = '__arcaiaBackendContractProbeMainV1';
  const ARCAIA_SOURCE = 'aice-probe-main-v159';
  const WATCH_DURATION_MS = 180000;
  const MAX_SCHEMA_KEYS = 48;
  const MAX_STRUCTURAL_HINTS = 48;
  const MAX_MESSAGE_NUMERIC_HINT_KEYS = 24;
  if (window[GLOBAL_KEY]?.installed) return;

  const nativeFetch = window.fetch;
  const nativeXHROpen = XMLHttpRequest.prototype.open;
  const nativeXHRSend = XMLHttpRequest.prototype.send;
  const xhrMeta = new WeakMap();
  let requestOrdinal = 0;
  let stopped = false;

  function post(type, payload = {}) {
    if (!stopped) window.postMessage({ source: SOURCE, type, payload }, '*');
  }

  function safeKeyList(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.keys(value)
      .filter((key) => /^[A-Za-z0-9_.$-]{1,64}$/.test(key))
      .sort()
      .slice(0, MAX_SCHEMA_KEYS);
  }

  function safeEndpointInfo(value, method = 'GET') {
    try {
      const url = new URL(typeof value === 'string' ? value : value?.url || '', location.href);
      const rawSegments = url.pathname.split('/').filter(Boolean);
      const segments = rawSegments.map((segment, index) => {
        if (/^conversations?$/i.test(rawSegments[index - 1] || '')) return '<id>';
        if (/^[0-9a-f]{8,}$/i.test(segment) || /^[0-9]{4,}$/.test(segment) || segment.length > 40) return '<id>';
        if (/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(segment)) return segment;
        return '<segment>';
      });
      const queryKeys = Array.from(url.searchParams.keys()).filter((key) => /^[A-Za-z0-9_.-]{1,48}$/.test(key)).sort().slice(0, 24);
      const queryNumericHints = [];
      for (const key of queryKeys) {
        if (!/(?:count|total|turn|message|offset|limit|page|index|position|num)/i.test(key)) continue;
        const valueText = url.searchParams.get(key);
        if (!/^-?\d+(?:\.\d+)?$/.test(String(valueText || ''))) continue;
        queryNumericHints.push({ key, value: Number(valueText) });
      }
      return {
        method: String(method || 'GET').toUpperCase().slice(0, 12),
        pathnamePattern: `/${segments.join('/')}`,
        queryKeys,
        queryNumericHints,
        includeHasVersions: url.searchParams.has('include_has_versions')
          ? url.searchParams.get('include_has_versions') === 'true'
          : null,
        conversationLike: /conversation/i.test(url.pathname),
        backendApi: url.pathname.startsWith('/backend-api/')
      };
    } catch {
      return { method: String(method || 'GET').toUpperCase().slice(0, 12), pathnamePattern: 'unparseable', queryKeys: [], queryNumericHints: [], conversationLike: false, backendApi: false };
    }
  }

  function rawConversationIdFromRequest(value) {
    try {
      const url = new URL(typeof value === 'string' ? value : value?.url || '', location.href);
      return url.pathname.match(/^\/backend-api\/conversations?\/([^/?#]+)(?:\/messages)?\/?$/)?.[1] || null;
    } catch {
      return null;
    }
  }

  function currentPageConversationId() {
    return String(location.pathname || '').match(/\/c\/([^/?#]+)/)?.[1] || null;
  }

  function valueType(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
  }

  function safeEnumScalar(key, value) {
    if (!/^(?:action|type|mode|event|operation|kind|status|source)$/i.test(String(key || ''))) return null;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,48}$/.test(value)) return null;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || /^[0-9a-f]{16,}$/i.test(value) || /^\d{4,}$/.test(value)) return null;
    return value;
  }

  function safeStructuralPathKey(key) {
    const text = String(key || '');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return '<id>';
    if (/^[0-9a-f]{16,}$/i.test(text) || /^\d{4,}$/.test(text)) return '<id>';
    if (text.length > 40 && /^[A-Za-z0-9-]+$/.test(text) && /\d/.test(text)) return '<id>';
    return text;
  }

  function summarizeStructuralHints(value) {
    const countLikeScalars = [];
    const enumScalars = [];
    const arrayLengths = [];
    const skipDeepKeys = new Set(['messages', 'mapping', 'content', 'parts', 'text', 'title', 'prompt']);
    const seen = new Set();
    const visit = (node, path = '', depth = 0) => {
      if (node == null || depth > 4 || countLikeScalars.length + enumScalars.length + arrayLengths.length >= MAX_STRUCTURAL_HINTS) return;
      if (typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        if (path) arrayLengths.push({ path, length: node.length });
        return;
      }
      for (const [key, child] of Object.entries(node)) {
        if (!/^[A-Za-z0-9_.$-]{1,64}$/.test(key)) continue;
        const pathKey = safeStructuralPathKey(key);
        const nextPath = path ? `${path}.${pathKey}` : pathKey;
        const keyLooksCountLike = /(?:count|total|turn|message|offset|limit|page|index|position|num|size|length)/i.test(key);
        if (keyLooksCountLike && (typeof child === 'number' || typeof child === 'boolean')) {
          countLikeScalars.push({ path: nextPath, type: typeof child, value: child });
        } else if (keyLooksCountLike && typeof child === 'string' && /^-?\d+(?:\.\d+)?$/.test(child)) {
          countLikeScalars.push({ path: nextPath, type: 'numeric_string', value: Number(child) });
        }
        const enumValue = safeEnumScalar(key, child);
        if (enumValue != null) enumScalars.push({ path: nextPath, value: enumValue });
        if (Array.isArray(child)) {
          arrayLengths.push({ path: nextPath, length: child.length });
          continue;
        }
        if (child && typeof child === 'object' && !skipDeepKeys.has(key)) visit(child, nextPath, depth + 1);
      }
    };
    visit(value);
    return {
      countLikeScalars: countLikeScalars.slice(0, MAX_STRUCTURAL_HINTS),
      enumScalars: enumScalars.slice(0, MAX_STRUCTURAL_HINTS),
      arrayLengths: arrayLengths.slice(0, MAX_STRUCTURAL_HINTS)
    };
  }

  function summarizeJsonShape(raw) {
    const topLevelKeys = raw && typeof raw === 'object' && !Array.isArray(raw) ? safeKeyList(raw) : [];
    const topLevelTypes = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const key of topLevelKeys) topLevelTypes[key] = valueType(raw[key]);
    }
    return {
      rootType: valueType(raw),
      topLevelKeys,
      topLevelTypes,
      rootArrayLength: Array.isArray(raw) ? raw.length : null,
      structuralHints: summarizeStructuralHints(raw)
    };
  }

  function summarizeResponseHeaderHints(headers) {
    const out = [];
    try {
      const pairs = typeof headers === 'string'
        ? headers.split(/\r?\n/).map((line) => { const index = line.indexOf(':'); return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : null; }).filter(Boolean)
        : Array.from(headers?.entries?.() || []);
      for (const [name, value] of pairs) {
        if (!/(?:count|total|range|page|turn|message|offset|limit|length)/i.test(name)) continue;
        const numbers = String(value || '').match(/\d+(?:\.\d+)?/g)?.slice(0, 6).map(Number) || [];
        out.push({ name: String(name).toLowerCase().slice(0, 64), numberValues: numbers, wildcardPresent: String(value || '').includes('*') });
      }
    } catch {}
    return out.slice(0, 24);
  }

  function summarizeRequestBody(body) {
    if (body == null) return { present: false, type: 'none' };
    let raw = null;
    let type = typeof body;
    let bytes = null;
    if (typeof body === 'string') {
      bytes = byteLength(body);
      type = 'string';
      try { raw = JSON.parse(body); } catch {}
    } else if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      type = 'url_search_params';
      const obj = {};
      for (const key of body.keys()) obj[key] = null;
      raw = obj;
    } else if (body && typeof body === 'object' && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
      type = body.constructor?.name || 'object';
      if (Object.getPrototypeOf(body) === Object.prototype || Array.isArray(body)) raw = body;
    }
    return {
      present: true,
      type: String(type).slice(0, 48),
      bytes,
      jsonShape: raw == null ? null : summarizeJsonShape(raw)
    };
  }

  function roleCategory(value) {
    const role = String(value || '').toLowerCase();
    return ['user', 'assistant', 'tool', 'system'].includes(role) ? role : role ? 'other' : 'none';
  }

  function hasRenderableContent(message) {
    const content = message?.content;
    const type = String(content?.content_type || '').toLowerCase();
    if (type === 'text' || type === 'multimodal_text') {
      return (Array.isArray(content?.parts) ? content.parts : []).some((part) => {
        if (typeof part === 'string') return part.trim().length > 0;
        return Boolean(part && typeof part === 'object' && typeof part.text === 'string' && part.text.trim());
      });
    }
    return /image|file|attachment/.test(type);
  }

  function isVisibleTurnMessage(message) {
    const role = message?.author?.role;
    if (role !== 'user' && role !== 'assistant') return false;
    if (message?.metadata?.is_visually_hidden_from_conversation) return false;
    if (role === 'assistant' && message.recipient && message.recipient !== 'all') return false;
    return hasRenderableContent(message);
  }

  function findRoot(mapping) {
    for (const node of Object.values(mapping)) {
      if (node && typeof node === 'object' && /** @type {any} */ (node).parent === null) return node;
    }
    return null;
  }

  function buildPath(mapping, root, leaf) {
    if (!root?.id || !leaf?.id) return [];
    const path = /** @type {string[]} */ ([]);
    const seen = new Set();
    let id = leaf.id;
    while (id && !seen.has(id)) {
      const node = mapping[id];
      if (!node) return [];
      seen.add(id);
      path.push(id);
      if (id === root.id) return path.reverse();
      id = node.parent || null;
    }
    return [];
  }

  function summarizePageInfo(pageInfo) {
    if (!pageInfo || typeof pageInfo !== 'object' || Array.isArray(pageInfo)) {
      return { present: false, keys: [] };
    }
    const boolOrNull = (value) => typeof value === 'boolean' ? value : null;
    const presentString = (value) => typeof value === 'string' && value.length > 0;
    return {
      present: true,
      keys: safeKeyList(pageInfo),
      hasPreviousPage: boolOrNull(pageInfo.has_previous_page),
      hasNextPage: boolOrNull(pageInfo.has_next_page),
      hasMore: boolOrNull(pageInfo.has_more),
      startCursorPresent: presentString(pageInfo.start_cursor),
      endCursorPresent: presentString(pageInfo.end_cursor),
      cursorPresent: presentString(pageInfo.cursor)
    };
  }

  function summarizeMessagesArray(raw) {
    const messagesValue = raw?.messages;
    const messagesFieldType = Array.isArray(messagesValue)
      ? 'array'
      : messagesValue && typeof messagesValue === 'object'
        ? 'object'
        : messagesValue == null
          ? 'missing'
          : typeof messagesValue;
    const messages = Array.isArray(messagesValue)
      ? messagesValue
      : messagesValue && typeof messagesValue === 'object'
        ? Object.values(messagesValue)
        : null;
    const pageInfo = raw?.page_info && typeof raw.page_info === 'object' && !Array.isArray(raw.page_info)
      ? raw.page_info
      : null;
    const pageInfoSummary = summarizePageInfo(pageInfo);
    if (!messages) {
      return {
        present: messagesValue != null,
        fieldType: messagesFieldType,
        itemCount: 0,
        pageInfo: pageInfoSummary
      };
    }

    const itemKeys = new Set();
    const messageKeys = new Set();
    const contentKeys = new Set();
    const authorKeys = new Set();
    const metadataKeys = new Set();
    const numericMetadataHints = new Map();
    const roleCounts = { user: 0, assistant: 0, tool: 0, system: 0, other: 0, none: 0 };
    const contentTypes = {};
    const userContentTypes = {};
    const readOnlyExcludedUserContentTypes = {};
    let nestedMessageCount = 0;
    let directMessageShapeCount = 0;
    let candidateMessageCount = 0;
    let parentFieldCount = 0;
    let metadataParentIdCount = 0;
    let metadataParentIdOutsidePageCount = 0;
    let childrenArrayCount = 0;
    let idFieldCount = 0;
    let currentNodeFound = false;
    let currentNodeArrayIndex = -1;
    const messageNodeIds = new Set(messages
      .map((item) => item && typeof item === 'object' && !Array.isArray(item) ? item.id ?? item.node_id ?? item.nodeId : null)
      .filter((id) => typeof id === 'string' && id));
    const seenMessageIds = new Set();
    const parentReferenceCounts = new Map();
    let previousMessageId = null;
    let metadataParentImmediatePreviousCount = 0;
    let metadataParentEarlierSamePageCount = 0;
    let metadataParentLaterSamePageCount = 0;
    let roleCandidateCount = 0;
    let userRoleCandidateCount = 0;
    let assistantRoleCandidateCount = 0;
    let readOnlyUserEligibleCount = 0;
    let readOnlyAssistantEligibleCount = 0;
    let readOnlyUserExcludedByContentTypeCount = 0;
    let visibleMessageCount = 0;
    let userTurnCount = 0;
    let visibleAssistantCount = 0;

    for (let arrayIndex = 0; arrayIndex < messages.length; arrayIndex += 1) {
      const item = messages[arrayIndex];
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      safeKeyList(item).forEach((key) => itemKeys.add(key));
      const itemId = item.id ?? item.node_id ?? item.nodeId ?? null;
      if (typeof itemId === 'string' && itemId) {
        idFieldCount += 1;
        if (typeof raw.current_node === 'string' && raw.current_node === itemId) {
          currentNodeFound = true;
          currentNodeArrayIndex = arrayIndex;
        }
      }
      if (Object.prototype.hasOwnProperty.call(item, 'parent') || Object.prototype.hasOwnProperty.call(item, 'parent_id')) parentFieldCount += 1;
      if (Array.isArray(item.children)) childrenArrayCount += 1;

      const nested = item.message && typeof item.message === 'object' && !Array.isArray(item.message) ? item.message : null;
      const direct = !nested && (item.author || item.content || item.role || item.metadata) ? item : null;
      const message = nested || direct;
      if (nested) nestedMessageCount += 1;
      if (direct) directMessageShapeCount += 1;
      if (!message) continue;
      candidateMessageCount += 1;
      safeKeyList(message).forEach((key) => messageKeys.add(key));
      safeKeyList(message.content).forEach((key) => contentKeys.add(key));
      safeKeyList(message.author).forEach((key) => authorKeys.add(key));
      safeKeyList(message.metadata).forEach((key) => metadataKeys.add(key));
      if (message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)) {
        for (const [key, value] of Object.entries(message.metadata)) {
          if (!/^[A-Za-z0-9_.$-]{1,64}$/.test(key) || !/(?:turn|count|total|index|position|offset|num)/i.test(key)) continue;
          if (/(?:^|_)id(?:_|$)/i.test(key)) continue;
          const numericValue = typeof value === 'number' && Number.isFinite(value)
            ? value
            : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
          if (numericValue == null) continue;
          if (!numericMetadataHints.has(key) && numericMetadataHints.size >= MAX_MESSAGE_NUMERIC_HINT_KEYS) continue;
          const hint = numericMetadataHints.get(key) || { count: 0, min: numericValue, max: numericValue, distinctValues: new Set() };
          hint.count += 1;
          hint.min = Math.min(hint.min, numericValue);
          hint.max = Math.max(hint.max, numericValue);
          if (hint.distinctValues.size < 16) hint.distinctValues.add(numericValue);
          numericMetadataHints.set(key, hint);
        }
      }
      const metadataParentId = typeof message?.metadata?.parent_id === 'string' && message.metadata.parent_id
        ? message.metadata.parent_id
        : null;
      if (metadataParentId) {
        metadataParentIdCount += 1;
        parentReferenceCounts.set(metadataParentId, (parentReferenceCounts.get(metadataParentId) || 0) + 1);
        if (previousMessageId && metadataParentId === previousMessageId) metadataParentImmediatePreviousCount += 1;
        if (seenMessageIds.has(metadataParentId)) metadataParentEarlierSamePageCount += 1;
        else if (messageNodeIds.has(metadataParentId)) metadataParentLaterSamePageCount += 1;
        else metadataParentIdOutsidePageCount += 1;
      }
      const messageId = message.id ?? null;
      if (!currentNodeFound && typeof messageId === 'string' && typeof raw.current_node === 'string' && raw.current_node === messageId) {
        currentNodeFound = true;
        currentNodeArrayIndex = arrayIndex;
      }
      if (typeof messageId === 'string' && messageId) {
        seenMessageIds.add(messageId);
        previousMessageId = messageId;
      }

      const role = roleCategory(message.author?.role ?? message.role);
      roleCounts[role] = (roleCounts[role] || 0) + 1;
      const contentType = String(message.content?.content_type || 'none').toLowerCase().slice(0, 48);
      contentTypes[contentType] = (contentTypes[contentType] || 0) + 1;
      if (role === 'user') userContentTypes[contentType] = (userContentTypes[contentType] || 0) + 1;
      const hidden = message?.metadata?.is_visually_hidden_from_conversation === true;
      const recipientAllowed = role !== 'assistant' || !message.recipient || message.recipient === 'all';
      const roleCandidate = !hidden && recipientAllowed && (role === 'user' || role === 'assistant');
      const readOnlyUserEligible = !hidden && role === 'user' && (contentType === 'text' || contentType === 'multimodal_text');
      const readOnlyAssistantEligible = !hidden && role === 'assistant' && contentType === 'text' && message.end_turn === true && recipientAllowed;
      if (readOnlyUserEligible) readOnlyUserEligibleCount += 1;
      if (readOnlyAssistantEligible) readOnlyAssistantEligibleCount += 1;
      if (roleCandidate && role === 'user' && !readOnlyUserEligible) {
        readOnlyUserExcludedByContentTypeCount += 1;
        readOnlyExcludedUserContentTypes[contentType] = (readOnlyExcludedUserContentTypes[contentType] || 0) + 1;
      }
      if (roleCandidate) {
        roleCandidateCount += 1;
        if (role === 'user') userRoleCandidateCount += 1;
        if (role === 'assistant') assistantRoleCandidateCount += 1;
      }
      const visible = roleCandidate && hasRenderableContent(message);
      if (visible) {
        visibleMessageCount += 1;
        if (role === 'user') userTurnCount += 1;
        if (role === 'assistant') visibleAssistantCount += 1;
      }
    }

    const siblingParentCounts = Array.from(parentReferenceCounts.values()).filter((count) => count > 1);
    return {
      present: true,
      fieldType: messagesFieldType,
      itemCount: messages.length,
      itemKeys: Array.from(itemKeys).sort().slice(0, MAX_SCHEMA_KEYS),
      nestedMessageCount,
      directMessageShapeCount,
      candidateMessageCount,
      messageKeys: Array.from(messageKeys).sort().slice(0, MAX_SCHEMA_KEYS),
      contentKeys: Array.from(contentKeys).sort().slice(0, MAX_SCHEMA_KEYS),
      authorKeys: Array.from(authorKeys).sort().slice(0, MAX_SCHEMA_KEYS),
      metadataKeys: Array.from(metadataKeys).sort().slice(0, MAX_SCHEMA_KEYS),
      numericMetadataHints: Array.from(numericMetadataHints.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, hint]) => ({
        key,
        count: hint.count,
        min: hint.min,
        max: hint.max,
        distinctValues: Array.from(hint.distinctValues).sort((a, b) => a - b)
      })),
      parentFieldCount,
      metadataParentIdCount,
      metadataParentIdOutsidePageCount,
      metadataParentImmediatePreviousCount,
      metadataParentEarlierSamePageCount,
      metadataParentLaterSamePageCount,
      metadataParentSiblingGroupCount: siblingParentCounts.length,
      metadataParentSiblingMessageCount: siblingParentCounts.reduce((sum, count) => sum + count, 0),
      childrenArrayCount,
      idFieldCount,
      currentNodeFound,
      currentNodeArrayIndex: currentNodeArrayIndex >= 0 ? currentNodeArrayIndex : null,
      currentNodePositionFromEnd: currentNodeArrayIndex >= 0 ? messages.length - 1 - currentNodeArrayIndex : null,
      roleCounts,
      contentTypes,
      userContentTypes,
      roleCandidateCount,
      userRoleCandidateCount,
      assistantRoleCandidateCount,
      readOnlyUserEligibleCount,
      readOnlyAssistantEligibleCount,
      readOnlyUserExcludedByContentTypeCount,
      readOnlyExcludedUserContentTypes,
      visibleMessageCount,
      userTurnCount,
      visibleAssistantCount,
      pageInfo: pageInfoSummary
    };
  }

  function summarizeConversation(raw, meta = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const mapping = raw.mapping && typeof raw.mapping === 'object' && !Array.isArray(raw.mapping)
      ? /** @type {Record<string, any>} */ (raw.mapping)
      : null;
    const currentNodePresent = typeof raw.current_node === 'string' && raw.current_node.length > 0;
    const messages = summarizeMessagesArray(raw);
    const pagedMessagesResponse = /\/messages$/.test(String(meta?.endpoint?.pathnamePattern || ''));
    const transportFormat = mapping ? 'mapping' : messages.present ? 'messages' : 'unknown';
    const issueCodes = /** @type {string[]} */ ([]);
    if (!mapping && !messages.present) issueCodes.push('conversation_payload_unrecognized');
    if (!currentNodePresent && !pagedMessagesResponse) issueCodes.push('current_node_missing');
    if (!mapping && messages.present && currentNodePresent && !messages.currentNodeFound) issueCodes.push('current_node_not_in_messages');
    const contract = {
      topLevelKeys: safeKeyList(raw),
      transportFormat,
      pagedMessagesResponse,
      mappingPresent: Boolean(mapping),
      messagesPresent: messages.present,
      messagesFieldType: messages.fieldType,
      messagesItemCount: messages.itemCount,
      currentNodePresent,
      currentNodeFoundInMapping: Boolean(mapping && currentNodePresent && mapping[raw.current_node]),
      currentNodeFoundInMessages: Boolean(messages.present && currentNodePresent && messages.currentNodeFound),
      conversationIdFieldPresent: typeof raw.conversation_id === 'string' || typeof raw.id === 'string',
      pageInfo: messages.pageInfo,
      issueCodes
    };
    if (!mapping) return { ...meta, contract, messages, graph: null, path: null };
    if (currentNodePresent && !mapping[raw.current_node]) issueCodes.push('current_node_not_in_mapping');

    const entries = /** @type {[string, any][]} */ (Object.entries(mapping));
    const root = findRoot(mapping);
    if (!root) issueCodes.push('root_missing');
    let leaf = currentNodePresent ? mapping[raw.current_node] || null : null;
    if (!leaf) {
      for (const [, node] of entries) {
        if (node && Array.isArray(node.children) && node.children.length === 0) { leaf = node; break; }
      }
    }
    const selectedPath = buildPath(mapping, root, leaf);
    if (!selectedPath.length) issueCodes.push('selected_path_unresolved');

    let missingParentReferenceCount = 0;
    let missingChildReferenceCount = 0;
    let messageNodeCount = 0;
    let rootCount = 0;
    let leafCount = 0;
    const nodeKeys = new Set();
    const messageKeys = new Set();
    const contentKeys = new Set();
    for (const [, node] of entries) {
      if (!node || typeof node !== 'object') continue;
      safeKeyList(node).forEach((key) => nodeKeys.add(key));
      if (node.parent === null) rootCount += 1;
      if (Array.isArray(node.children) && node.children.length === 0) leafCount += 1;
      if (node.parent && !mapping[node.parent]) missingParentReferenceCount += 1;
      for (const child of Array.isArray(node.children) ? node.children : []) if (!mapping[child]) missingChildReferenceCount += 1;
      if (node.message && typeof node.message === 'object') {
        messageNodeCount += 1;
        safeKeyList(node.message).forEach((key) => messageKeys.add(key));
        safeKeyList(node.message.content).forEach((key) => contentKeys.add(key));
      }
    }
    if (missingParentReferenceCount) issueCodes.push('parent_reference_missing');
    if (missingChildReferenceCount) issueCodes.push('child_reference_missing');

    const pathRoleCounts = { user: 0, assistant: 0, tool: 0, system: 0, other: 0, none: 0 };
    let userTurnCount = 0;
    let visibleAssistantCount = 0;
    let visibleMessageCount = 0;
    const pathContentTypes = {};
    for (const id of selectedPath) {
      const message = mapping[id]?.message;
      if (!message) continue;
      const role = roleCategory(message.author?.role);
      pathRoleCounts[role] = (pathRoleCounts[role] || 0) + 1;
      const contentType = String(message.content?.content_type || 'none').toLowerCase().slice(0, 48);
      pathContentTypes[contentType] = (pathContentTypes[contentType] || 0) + 1;
      if (!isVisibleTurnMessage(message)) continue;
      visibleMessageCount += 1;
      if (role === 'user') userTurnCount += 1;
      if (role === 'assistant') visibleAssistantCount += 1;
    }

    return {
      ...meta,
      contract,
      messages,
      graph: {
        mappingNodeCount: entries.length,
        rootCount,
        leafCount,
        messageNodeCount,
        missingParentReferenceCount,
        missingChildReferenceCount,
        nodeKeys: Array.from(nodeKeys).sort().slice(0, MAX_SCHEMA_KEYS),
        messageKeys: Array.from(messageKeys).sort().slice(0, MAX_SCHEMA_KEYS),
        contentKeys: Array.from(contentKeys).sort().slice(0, MAX_SCHEMA_KEYS)
      },
      path: {
        selectedPathNodeCount: selectedPath.length,
        pathRoleCounts,
        pathContentTypes,
        visibleMessageCount,
        userTurnCount,
        visibleAssistantCount
      }
    };
  }

  function byteLength(text) {
    try { return new TextEncoder().encode(text).length; } catch { return String(text || '').length; }
  }

  function inspectParsedPayload(raw, meta, requestConversationId = null, pageConversationIdAtRequest = null) {
    const responseConversationId = typeof raw?.conversation_id === 'string'
      ? raw.conversation_id
      : typeof raw?.id === 'string' ? raw.id : null;
    const identity = meta?.endpoint?.conversationLike ? {
      requestConversationMatchesCurrent: requestConversationId && pageConversationIdAtRequest
        ? requestConversationId === pageConversationIdAtRequest
        : null,
      responseConversationIdPresent: Boolean(responseConversationId),
      responseConversationMatchesRequest: responseConversationId && requestConversationId
        ? responseConversationId === requestConversationId
        : null,
      responseConversationMatchesCurrentAtRequest: responseConversationId && pageConversationIdAtRequest
        ? responseConversationId === pageConversationIdAtRequest
        : null
    } : null;
    const generic = {
      ...meta,
      identity,
      jsonParsed: true,
      json: summarizeJsonShape(raw)
    };
    post('BACKEND_RESPONSE_SUMMARY', generic);
    if (!meta?.endpoint?.conversationLike) return;
    if (!raw?.mapping && !Array.isArray(raw?.messages) && !Object.prototype.hasOwnProperty.call(raw || {}, 'current_node')) return;
    const summary = summarizeConversation(raw, meta);
    if (summary) post('CONVERSATION_RESPONSE_SUMMARY', { ...summary, identity });
  }

  async function inspectResponse(response, endpoint, ordinal, startedAt, transport = 'fetch', requestConversationId = null, pageConversationIdAtRequest = null) {
    if (!response || !endpoint.backendApi) return;
    const meta = {
      requestOrdinal: ordinal,
      transport,
      endpoint,
      status: Number.isFinite(Number(response.status)) ? Number(response.status) : null,
      contentType: String(response.headers?.get?.('content-type') || '').split(';')[0].slice(0, 64) || null,
      responseHeaderHints: summarizeResponseHeaderHints(response.headers),
      durationMs: Math.max(0, Date.now() - startedAt)
    };
    try {
      const text = await response.clone().text();
      meta.bodyBytes = byteLength(text);
      if (!/^[\s]*[\[{]/.test(text)) {
        post('BACKEND_RESPONSE_SUMMARY', { ...meta, jsonParsed: false, json: null });
        return;
      }
      inspectParsedPayload(JSON.parse(text), meta, requestConversationId, pageConversationIdAtRequest);
    } catch {
      post('BACKEND_RESPONSE_PARSE_FAILED', meta);
      if (endpoint.conversationLike) post('CONVERSATION_RESPONSE_PARSE_FAILED', { endpoint, status: meta.status, requestOrdinal: ordinal });
    }
  }

  async function inspectFetchRequestBody(input, init, ordinal) {
    if (!ordinal || init?.body != null || !input || typeof input !== 'object' || typeof input.clone !== 'function') return;
    try {
      const clone = input.clone();
      const contentType = String(clone.headers?.get?.('content-type') || '').toLowerCase();
      if (!/(?:application|text)\/(?:[a-z0-9.+-]*\+)?json(?:;|$)/i.test(contentType)) return;
      const text = await clone.text();
      if (!text) return;
      let raw = null;
      try { raw = JSON.parse(text); } catch {}
      post('REQUEST_BODY_SHAPE_OBSERVED', {
        requestOrdinal: ordinal,
        body: {
          present: true,
          type: 'request_clone',
          bytes: byteLength(text),
          jsonShape: raw == null ? null : summarizeJsonShape(raw)
        }
      });
    } catch {}
  }

  async function probeFetch(input, init) {
    if (stopped) return nativeFetch.apply(this, arguments);
    const method = init?.method || (typeof input === 'object' && input?.method) || 'GET';
    const endpoint = safeEndpointInfo(input, method);
    const requestConversationId = rawConversationIdFromRequest(input);
    const pageConversationIdAtRequest = currentPageConversationId();
    const ordinal = endpoint.backendApi ? ++requestOrdinal : null;
    const startedAt = Date.now();
    if (endpoint.backendApi || endpoint.conversationLike) post('FETCH_CALL_OBSERVED', {
      requestOrdinal: ordinal,
      endpoint,
      requestBody: summarizeRequestBody(init?.body ?? (typeof input === 'object' ? input?.body : null))
    });
    void inspectFetchRequestBody(input, init, ordinal);
    const response = await nativeFetch.apply(this, arguments);
    if (endpoint.backendApi) void inspectResponse(response, endpoint, ordinal, startedAt, 'fetch', requestConversationId, pageConversationIdAtRequest);
    return response;
  }

  function probeXHROpen(method, url) {
    const endpoint = safeEndpointInfo(url, method);
    xhrMeta.set(this, {
      endpoint,
      requestConversationId: rawConversationIdFromRequest(url),
      pageConversationIdAtRequest: currentPageConversationId()
    });
    return nativeXHROpen.apply(this, arguments);
  }

  function probeXHRSend(body) {
    const meta = xhrMeta.get(this) || { endpoint: safeEndpointInfo('', 'GET') };
    const endpoint = meta.endpoint;
    const ordinal = endpoint.backendApi ? ++requestOrdinal : null;
    const startedAt = Date.now();
    if (endpoint.backendApi || endpoint.conversationLike) post('XHR_CALL_OBSERVED', {
      requestOrdinal: ordinal,
      endpoint,
      requestBody: summarizeRequestBody(body)
    });
    if (endpoint.backendApi) {
      this.addEventListener('loadend', () => {
        const responseMeta = {
          requestOrdinal: ordinal,
          transport: 'xhr',
          endpoint,
          status: Number.isFinite(Number(this.status)) ? Number(this.status) : null,
          contentType: String(this.getResponseHeader?.('content-type') || '').split(';')[0].slice(0, 64) || null,
          responseHeaderHints: summarizeResponseHeaderHints(this.getAllResponseHeaders?.() || ''),
          durationMs: Math.max(0, Date.now() - startedAt),
          bodyBytes: null
        };
        try {
          if (this.responseType === 'json' && this.response && typeof this.response === 'object') {
            inspectParsedPayload(this.response, responseMeta, meta.requestConversationId, meta.pageConversationIdAtRequest);
            return;
          }
          const text = typeof this.responseText === 'string' ? this.responseText : '';
          responseMeta.bodyBytes = byteLength(text);
          if (/^[\s]*[\[{]/.test(text)) inspectParsedPayload(JSON.parse(text), responseMeta, meta.requestConversationId, meta.pageConversationIdAtRequest);
          else post('BACKEND_RESPONSE_SUMMARY', { ...responseMeta, jsonParsed: false, json: null });
        } catch {
          post('BACKEND_RESPONSE_PARSE_FAILED', responseMeta);
        }
      }, { once: true });
    }
    return nativeXHRSend.apply(this, arguments);
  }

  function sanitizeArcaiaEvent(eventType, payload) {
    if (eventType === 'lite_rewrite_success') return {
      eventType,
      beforeBytes: Number.isFinite(Number(payload?.beforeBytes)) ? Number(payload.beforeBytes) : null,
      afterBytes: Number.isFinite(Number(payload?.afterBytes)) ? Number(payload.afterBytes) : null,
      retainedTurnCount: Number.isFinite(Number(payload?.retainedTurnCount)) ? Number(payload.retainedTurnCount) : null,
      totalTurnCount: Number.isFinite(Number(payload?.totalTurnCount)) ? Number(payload.totalTurnCount) : null,
      turnCount: Number.isFinite(Number(payload?.turnCount)) ? Number(payload.turnCount) : null
    };
    if (eventType === 'lite_rewrite_failure') return { eventType, errorPresent: Boolean(payload?.error) };
    if (eventType === 'message_timestamp_index_updated') return {
      eventType,
      reason: typeof payload?.reason === 'string' ? payload.reason.slice(0, 80) : null,
      messageCount: Number.isFinite(Number(payload?.messageCount)) ? Number(payload.messageCount) : null,
      changedMessageCount: Array.isArray(payload?.changedMessageIds) ? payload.changedMessageIds.length : null,
      updateCount: Number.isFinite(Number(payload?.updateCount)) ? Number(payload.updateCount) : null
    };
    if (eventType === 'lite_config_set_runtime') return {
      eventType,
      resultingEnabled: typeof payload?.resultingEnabled === 'boolean' ? payload.resultingEnabled : null,
      backendRewriteEnabled: typeof payload?.backendRewriteEnabled === 'boolean' ? payload.backendRewriteEnabled : null,
      turnCount: Number.isFinite(Number(payload?.turnCount)) ? Number(payload.turnCount) : null
    };
    if (eventType === 'page_navigation') return { eventType };
    return null;
  }

  function onWindowMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.source === ARCAIA_SOURCE && data.type === 'AICE_MAIN_EVENT') {
      const summary = sanitizeArcaiaEvent(data.eventType, data.payload || {});
      if (summary) post('ARCAIA_MAIN_EVENT', summary);
      return;
    }
    if (data?.source === SOURCE && data.type === 'STOP_MAIN') cleanup();
  }

  function cleanup() {
    if (stopped) return;
    stopped = true;
    if (window.fetch === probeFetch) window.fetch = nativeFetch;
    if (XMLHttpRequest.prototype.open === probeXHROpen) XMLHttpRequest.prototype.open = nativeXHROpen;
    if (XMLHttpRequest.prototype.send === probeXHRSend) XMLHttpRequest.prototype.send = nativeXHRSend;
    window.removeEventListener('message', onWindowMessage);
    try { window[GLOBAL_KEY].installed = false; } catch {}
  }

  window.fetch = probeFetch;
  XMLHttpRequest.prototype.open = probeXHROpen;
  XMLHttpRequest.prototype.send = probeXHRSend;
  window.addEventListener('message', onWindowMessage);
  window[GLOBAL_KEY] = { installed: true, version: VERSION, cleanup };
  post('MAIN_STARTED', { version: VERSION });
  setTimeout(cleanup, WATCH_DURATION_MS);
})();
