(() => {
  'use strict';

  const SOURCE = 'arcaia-model-decoration-watch-v1';
  const REPORT_KEY = 'arcaiaModelDecorationWatchReportV1';
  const PROBE_VERSION = '1.0.28';
  const elements = {
    statusCard: document.getElementById('status-card'),
    statusTitle: document.getElementById('status-title'),
    statusDetail: document.getElementById('status-detail'),
    baseline: document.getElementById('baseline'),
    incidentCount: document.getElementById('incident-count'),
    lastIncident: document.getElementById('last-incident'),
    updatedAt: document.getElementById('updated-at'),
    modelState: document.getElementById('model-state'),
    nativeValue: document.getElementById('native-value'),
    arcaiaValue: document.getElementById('arcaia-value'),
    download: document.getElementById('download')
  };
  let activeTabId = null;
  let currentTabReport = null;
  let currentManualSnapshot = null;
  let currentManualEvents = [];
  let probeConnectionState = 'unknown';

  function formatTime(iso) {
    if (!iso) return '未取得';
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '未取得';
    return date.toLocaleString('ja-JP');
  }

  function statusCopy(status) {
    if (status === 'lost') return ['再現検出', 'MODEL DECORATION LOST'];
    if (status === 'recovered_marked') return ['復旧済み・マーク保持', '検出時の記録を保存できます'];
    if (status === 'acknowledged') return ['確認済み', '記録は保持されています'];
    if (status === 'watching') return ['監視中', '異常時だけツールバーへ「!」を表示します'];
    if (status === 'manual_snapshot_ready') return ['手動記録済み', 'JSON保存できます'];
    if (status === 'connected_waiting') return ['接続済み', 'probeは起動済みです。記録待ちです'];
    if (status === 'repair_failed') return ['未接続', '再注入後もprobeへ接続できません。ChatGPTタブを再読み込みしてください'];
    if (status === 'not_chatgpt') return ['対象外', 'ChatGPTタブでProbeを開いてください'];
    return ['未接続', '対象ChatGPTタブでprobeが起動していません'];
  }

  function modelStatusCopy(displayState) {
    if (displayState?.comparison === 'performance_mismatch') return '表示不一致';
    if (displayState?.comparison === 'missing_decoration') return '装飾なし';
    if (displayState?.comparison === 'match') return '正常';
    return '判定待ち';
  }

  function render(tabReport) {
    currentTabReport = tabReport || null;
    let status = tabReport?.status || 'waiting';
    if (probeConnectionState === 'connected' && !tabReport) {
      status = currentManualSnapshot ? 'manual_snapshot_ready' : 'connected_waiting';
    }
    else if (probeConnectionState === 'repair_failed') status = 'repair_failed';
    else if (probeConnectionState === 'not_chatgpt') status = 'not_chatgpt';
    const [title, detail] = statusCopy(status);
    elements.statusCard.dataset.state = status;
    elements.statusTitle.textContent = title;
    elements.statusDetail.textContent = detail;
    elements.baseline.textContent = tabReport?.baseline
      ? `${tabReport.baseline.modelVersion || 'GPT-5.6'}${tabReport.baseline.performance ? ` / ${tabReport.baseline.performance}` : ''}`
      : '未取得';
    elements.incidentCount.textContent = String(tabReport?.incidentCount || 0);
    elements.lastIncident.textContent = tabReport?.lastIncident
      ? `${tabReport.lastIncident.kind} / ${formatTime(tabReport.lastIncident.detectedAtIso)}`
      : 'なし';
    elements.updatedAt.textContent = formatTime(tabReport?.updatedAtIso);
    const displayState = currentManualSnapshot?.displayState
      || tabReport?.latestSnapshot?.displayState
      || tabReport?.lastIncident?.displayState
      || null;
    elements.modelState.textContent = modelStatusCopy(displayState);
    elements.nativeValue.textContent = displayState?.native?.performance || '未確定';
    elements.arcaiaValue.textContent = displayState?.arcaia?.performance
      || (displayState?.decoration === 'missing' ? '装飾なし' : '未確定');
    elements.download.disabled = !tabReport
      && !currentManualSnapshot
      && probeConnectionState !== 'connected';
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function load() {
    const tab = await getActiveTab();
    activeTabId = Number.isInteger(tab?.id) ? tab.id : null;
    if (!Number.isInteger(activeTabId)) {
      probeConnectionState = 'not_chatgpt';
      render(null);
      return;
    }
    probeConnectionState = await ensureProbeConnection(tab);
    const data = await chrome.storage.local.get(REPORT_KEY);
    render(data?.[REPORT_KEY]?.tabs?.[String(activeTabId)] || null);
  }

  function isChatGptTab(tab) {
    try {
      return new URL(tab?.url || '').origin === 'https://chatgpt.com';
    } catch {
      return false;
    }
  }

  async function ensureProbeConnection(tab) {
    if (!Number.isInteger(activeTabId) || !isChatGptTab(tab)) return 'not_chatgpt';
    const current = await sendToActiveTab('PING_PROBE');
    if (current?.ok === true && current.version === PROBE_VERSION) return 'connected';
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['main.js'],
        world: 'MAIN'
      });
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['content.js']
      });
    } catch {
      return 'repair_failed';
    }
    const repaired = await sendToActiveTab('PING_PROBE');
    return repaired?.ok === true && repaired.version === PROBE_VERSION ? 'connected' : 'repair_failed';
  }

  async function sendToActiveTab(type) {
    if (!Number.isInteger(activeTabId)) return null;
    try {
      return await chrome.tabs.sendMessage(activeTabId, { source: SOURCE, type });
    } catch {
      return null;
    }
  }

  function downloadReport() {
    const tabReport = currentTabReport
      ? {
          ...currentTabReport,
          updatedAtIso: currentManualSnapshot?.capturedAtIso || currentTabReport.updatedAtIso || null,
          latestSnapshot: currentManualSnapshot || currentTabReport?.latestSnapshot || null
        }
      : (currentManualSnapshot ? {
          status: 'manual_snapshot_only',
          updatedAtIso: currentManualSnapshot.capturedAtIso || null,
          baseline: currentManualSnapshot.baseline || null,
          latestSnapshot: currentManualSnapshot,
          lastIncident: null,
          incidentCount: 0,
          incidents: [],
          events: currentManualEvents
        } : null);
    if (!tabReport) return;
    const exportPayload = {
      probe: {
        name: 'Arcaia Model Decoration Watch Probe',
        version: PROBE_VERSION,
        generatedAtIso: new Date().toISOString()
      },
      privacy: {
        conversationTextCollected: false,
        conversationIdsCollected: false,
        urlsCollected: false,
        cookiesCollected: false,
        authorizationCollected: false,
        pageStorageValuesCollected: false,
        pageStorageKeyNamesCollected: true,
        htmlCollected: false,
        otherExtensionStorageCollected: false
      },
      limitations: {
        arcaiaIsolatedWorldVariablesVisible: false,
        arcaiaExtensionStorageVisible: false,
        arcaiaContentScriptExceptionsVisible: false
      },
      tabReport
    };
    const blob = new Blob([`${JSON.stringify(exportPayload, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `arcaia-model-decoration-watch-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function captureCurrentState() {
    const result = await sendToActiveTab('CAPTURE_NOW');
    currentManualSnapshot = result?.ok === true && result.snapshot ? result.snapshot : null;
    currentManualEvents = result?.ok === true && Array.isArray(result.events)
      ? result.events.slice(-24)
      : [];
    return result?.ok === true;
  }

  elements.download.addEventListener('click', () => {
    void (async () => {
      await captureCurrentState();
      downloadReport();
    })();
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[REPORT_KEY]) return;
    const report = changes[REPORT_KEY].newValue;
    render(report?.tabs?.[String(activeTabId)] || null);
  });
  void load();
})();
