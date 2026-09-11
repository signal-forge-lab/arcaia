(() => {
  'use strict';

  const SOURCE = 'arcaia-assistant-render-gap-watch-v1';
  const VERSION = '1.0.0';
  const GLOBAL_KEY = '__arcaiaAssistantRenderGapWatchProbeMain';
  const ARCAIA_SOURCE = 'aice-probe-main-v159';
  const CONVERSATION_PATH = '/backend-api/conversation/';
  if (window[GLOBAL_KEY]?.installed) return;

  const NativeResponse = window.Response;
  const nativeText = NativeResponse.prototype.text;
  const nativeJson = NativeResponse.prototype.json;
  let stopped = false;
  let sequence = 0;
  let lastRawFingerprint = '';
  let lastRawAt = 0;
  let lastRewriteAt = 0;

  function post(type, payload = {}) {
    if (stopped) return;
    window.postMessage({ source: SOURCE, type, payload }, '*');
  }

  function isConversationUrl(value) {
    try {
      return String(value || '').includes(CONVERSATION_PATH);
    } catch {
      return false;
    }
  }

  function textLengthFromContent(content) {
    if (!content || typeof content !== 'object') return 0;
    const parts = Array.isArray(content.parts) ? content.parts : [];
    let total = 0;
    for (const part of parts) {
      if (typeof part === 'string') total += part.length;
      else if (part && typeof part === 'object' && typeof part.text === 'string') total += part.text.length;
    }
    return total;
  }

  function roleCategory(value) {
    const role = String(value || '').toLowerCase();
    if (role === 'user' || role === 'assistant' || role === 'tool' || role === 'system') return role;
    return role ? 'other' : 'none';
  }

  function statusCategory(value) {
    const status = String(value || '');
    if (status === 'finished_successfully' || status === 'in_progress') return status;
    return status ? 'other' : 'none';
  }

  function findRoot(raw) {
    return Object.values(raw?.mapping || {}).find((node) => node?.parent === null) || null;
  }

  function findLeaf(raw) {
    if (raw?.current_node && raw?.mapping?.[raw.current_node]) return raw.mapping[raw.current_node];
    let latest = null;
    for (const node of Object.values(raw?.mapping || {})) {
      if (!node || (Array.isArray(node.children) && node.children.length)) continue;
      if (!latest || Number(node.message?.create_time || 0) >= Number(latest.message?.create_time || 0)) latest = node;
    }
    return latest;
  }

  function buildPath(raw, root, leaf) {
    const ids = [];
    const seen = new Set();
    let id = leaf?.id || null;
    while (id && !seen.has(id)) {
      const node = raw?.mapping?.[id];
      if (!node) break;
      seen.add(id);
      ids.push(id);
      if (id === root?.id) break;
      id = node.parent || null;
    }
    return ids.reverse();
  }

  function summarizeConversation(raw, bodyBytes = null) {
    if (!raw || typeof raw !== 'object' || !raw.mapping || typeof raw.mapping !== 'object') return null;
    const root = findRoot(raw);
    const leaf = findLeaf(raw);
    const path = buildPath(raw, root, leaf);
    if (!root || !path.length) return null;

    const pathRoleCounts = { user: 0, assistant: 0, tool: 0, system: 0, other: 0 };
    let userTurnCount = 0;
    let toolLikeNodeCount = 0;
    let thinkingLikeNodeCount = 0;
    let visibleAssistantCount = 0;
    let finalAssistantTextLength = 0;
    let finalAssistantStatus = 'none';
    for (const id of path) {
      const message = raw.mapping?.[id]?.message;
      if (!message) continue;
      const role = roleCategory(message.author?.role);
      pathRoleCounts[role === 'none' ? 'other' : role] = (pathRoleCounts[role === 'none' ? 'other' : role] || 0) + 1;
      if (role === 'user') userTurnCount += 1;
      const contentType = String(message.content?.content_type || '').toLowerCase();
      const recipient = String(message.recipient || 'all').toLowerCase();
      const thinkingLike = /thought|reason|analysis/.test(contentType) || String(message.channel || '').toLowerCase() === 'analysis';
      const toolLike = role === 'tool' || (role === 'assistant' && recipient !== 'all') || /tool|computer|execution/.test(contentType);
      if (thinkingLike) thinkingLikeNodeCount += 1;
      if (toolLike) toolLikeNodeCount += 1;
      if (role === 'assistant' && recipient === 'all') {
        const length = textLengthFromContent(message.content);
        if (length > 0) {
          visibleAssistantCount += 1;
          finalAssistantTextLength = length;
          finalAssistantStatus = statusCategory(message.status);
        }
      }
    }

    return {
      sequence: ++sequence,
      mappingNodeCount: Object.keys(raw.mapping).length,
      selectedPathNodeCount: path.length,
      pathRoleCounts,
      userTurnCount,
      visibleAssistantCount,
      toolLikeNodeCount,
      thinkingLikeNodeCount,
      finalAssistantTextLength,
      finalAssistantStatus,
      currentNodeRole: roleCategory(raw.mapping?.[raw.current_node]?.message?.author?.role),
      bodyBytes: Number.isFinite(Number(bodyBytes)) ? Number(bodyBytes) : null
    };
  }

  function summarizeTextBody(text) {
    if (typeof text !== 'string' || !text.startsWith('{')) return null;
    try {
      const raw = JSON.parse(text);
      const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length;
      return summarizeConversation(raw, bytes);
    } catch {
      return null;
    }
  }

  function emitRawSummary(summary) {
    if (!summary) return;
    const fingerprint = `${summary.bodyBytes}:${summary.mappingNodeCount}:${summary.selectedPathNodeCount}:${summary.finalAssistantTextLength}:${summary.userTurnCount}`;
    const now = Date.now();
    if (fingerprint === lastRawFingerprint && now - lastRawAt < 1500) return;
    lastRawFingerprint = fingerprint;
    lastRawAt = now;
    post('RAW_CONVERSATION_SUMMARY', summary);
  }

  async function probeText(...args) {
    const text = await nativeText.apply(this, args);
    if (isConversationUrl(this?.url)) emitRawSummary(summarizeTextBody(text));
    return text;
  }

  async function probeJson(...args) {
    const value = await nativeJson.apply(this, args);
    if (isConversationUrl(this?.url)) emitRawSummary(summarizeConversation(value));
    return value;
  }

  function ProbeResponse(body, init) {
    const response = Reflect.construct(NativeResponse, [body, init], NativeResponse);
    if (typeof body === 'string') {
      const summary = summarizeTextBody(body);
      if (summary) {
        post('CONSTRUCTED_CONVERSATION_SUMMARY', {
          ...summary,
          nearArcaiaRewrite: Date.now() - lastRewriteAt < 1500
        });
      }
    }
    return response;
  }
  Object.setPrototypeOf(ProbeResponse, NativeResponse);
  ProbeResponse.prototype = NativeResponse.prototype;

  function handleWindowMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.source === ARCAIA_SOURCE && data.type === 'AICE_MAIN_EVENT' && data.eventType === 'lite_rewrite_success') {
      lastRewriteAt = Date.now();
      const payload = data.payload || {};
      post('ARCAIA_LITE_REWRITE_SUMMARY', {
        beforeBytes: Number.isFinite(Number(payload.beforeBytes)) ? Number(payload.beforeBytes) : null,
        afterBytes: Number.isFinite(Number(payload.afterBytes)) ? Number(payload.afterBytes) : null,
        retainedTurnCount: Number.isFinite(Number(payload.retainedTurnCount)) ? Number(payload.retainedTurnCount) : null,
        totalTurnCount: Number.isFinite(Number(payload.totalTurnCount)) ? Number(payload.totalTurnCount) : null,
        turnCount: Number.isFinite(Number(payload.turnCount)) ? Number(payload.turnCount) : null
      });
      return;
    }
    if (data?.source === SOURCE && data.type === 'STOP_MAIN') cleanup();
  }

  function cleanup() {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('message', handleWindowMessage);
    if (NativeResponse.prototype.text === probeText) NativeResponse.prototype.text = nativeText;
    if (NativeResponse.prototype.json === probeJson) NativeResponse.prototype.json = nativeJson;
    if (window.Response === ProbeResponse) window.Response = NativeResponse;
    try { window[GLOBAL_KEY].installed = false; } catch {}
  }

  NativeResponse.prototype.text = probeText;
  NativeResponse.prototype.json = probeJson;
  window.Response = ProbeResponse;
  window.addEventListener('message', handleWindowMessage);
  window[GLOBAL_KEY] = { installed: true, version: VERSION, cleanup };
  post('MAIN_PROBE_READY', { version: VERSION });
})();
