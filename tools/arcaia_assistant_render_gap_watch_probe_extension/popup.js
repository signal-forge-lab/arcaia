(() => {
  'use strict';

  const SOURCE = 'arcaia-assistant-render-gap-watch-v1';
  const VERSION = '1.0.0';
  const JSON_SAVE_LABEL = 'JSON保存';
  let tabId = null;
  let tabReport = null;
  let manualSnapshot = null;

  const elements = {
    status: document.getElementById('status'),
    domLength: document.getElementById('dom-length'),
    payloadLength: document.getElementById('payload-length'),
    incident: document.getElementById('incident'),
    capture: document.getElementById('capture'),
    download: document.getElementById('download'),
    ack: document.getElementById('ack'),
    reset: document.getElementById('reset'),
    stop: document.getElementById('stop')
  };
  elements.download.title = JSON_SAVE_LABEL;

  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function sendToTab(type) {
    if (!Number.isInteger(tabId)) return null;
    try { return await chrome.tabs.sendMessage(tabId, { source: SOURCE, type }); }
    catch { return null; }
  }

  async function getReport() {
    if (!Number.isInteger(tabId)) return null;
    try {
      const response = await chrome.runtime.sendMessage({ source: SOURCE, type: 'GET_TAB', tabId });
      return response?.ok ? response.tab : null;
    } catch {
      return null;
    }
  }

  function render(connected) {
    const dom = tabReport?.lastDom || manualSnapshot?.dom || null;
    const raw = tabReport?.lastRaw || manualSnapshot?.rawConversation || null;
    const rewritten = tabReport?.lastRewritten || manualSnapshot?.rewrittenConversation || null;
    elements.status.textContent = connected
      ? (tabReport?.marked ? '再現候補を検出しました' : tabReport?.status === 'stopped' ? 'このページでは停止中です' : '監視中です')
      : '未接続です。ChatGPTタブを再読み込みしてください';
    elements.domLength.textContent = dom ? String(dom.assistantTextLength ?? '-') : '-';
    elements.payloadLength.textContent = `${raw?.finalAssistantTextLength ?? '-'} / ${rewritten?.finalAssistantTextLength ?? '-'}`;
    elements.incident.textContent = tabReport?.lastIncident?.kind || 'なし';
    elements.download.disabled = !tabReport && !manualSnapshot;
    elements.ack.disabled = !tabReport?.marked;
  }

  async function load() {
    const tab = await activeTab();
    tabId = Number.isInteger(tab?.id) ? tab.id : null;
    const ping = await sendToTab('PING_PROBE');
    tabReport = await getReport();
    render(ping?.ok === true && ping.version === VERSION && ping.stopped !== true);
  }

  function download() {
    const report = tabReport || (manualSnapshot ? {
      status: 'manual_snapshot_only',
      latestSnapshot: manualSnapshot,
      lastDom: manualSnapshot.dom || null,
      lastRaw: manualSnapshot.rawConversation || null,
      lastRewritten: manualSnapshot.rewrittenConversation || null,
      lastArcaiaRewrite: manualSnapshot.arcaiaRewrite || null,
      incidents: [],
      incidentCount: 0,
      events: []
    } : null);
    if (!report) return;
    const payload = {
      probe: { name: 'Arcaia Assistant Render Gap Watch Probe', version: VERSION, generatedAtIso: new Date().toISOString() },
      privacy: {
        conversationTextCollected: false,
        conversationIdsCollected: false,
        urlsCollected: false,
        cookiesCollected: false,
        authorizationCollected: false,
        htmlCollected: false
      },
      tabReport: report
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `arcaia-assistant-render-gap-watch-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  elements.capture.addEventListener('click', async () => {
    const response = await sendToTab('CAPTURE_NOW');
    manualSnapshot = response?.ok ? response.snapshot : null;
    await load();
  });
  elements.download.addEventListener('click', download);
  elements.ack.addEventListener('click', async () => {
    if (Number.isInteger(tabId)) await chrome.runtime.sendMessage({ source: SOURCE, type: 'ACK_TAB', tabId });
    await load();
  });
  elements.reset.addEventListener('click', async () => {
    manualSnapshot = null;
    if (Number.isInteger(tabId)) await chrome.runtime.sendMessage({ source: SOURCE, type: 'RESET_TAB', tabId });
    await sendToTab('RESET_PROBE_SESSION');
    await load();
  });
  elements.stop.addEventListener('click', async () => {
    await sendToTab('STOP_PROBE');
    await load();
  });
  void load();
})();
