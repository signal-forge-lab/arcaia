(() => {
  'use strict';

  const REPORT_KEY = 'arcaiaInitialRenderProbeReportV1';
  const elements = {
    status: document.getElementById('status'),
    eventCount: document.getElementById('event-count'),
    arcaiaVersion: document.getElementById('arcaia-version'),
    turnMarkdown: document.getElementById('turn-markdown'),
    headerMarkdown: document.getElementById('header-markdown'),
    recentControls: document.getElementById('recent-controls'),
    download: document.getElementById('download'),
    reset: document.getElementById('reset')
  };
  let currentReport = null;

  function yesNo(value) {
    if (value == null) return '未確認';
    return value ? 'あり' : 'なし';
  }

  function render(report) {
    currentReport = report || null;
    const snapshot = report?.latestSnapshot || null;
    elements.status.textContent = !report
      ? '未取得'
      : (report.probe?.stopped ? '記録完了' : '記録中');
    elements.eventCount.textContent = String(report?.events?.length || 0);
    elements.arcaiaVersion.textContent = snapshot?.mainStatus?.appVersion || '未確認';
    elements.turnMarkdown.textContent = snapshot
      ? `${snapshot.arcaia?.turnMarkdownButtonCount || 0}個`
      : '未確認';
    elements.headerMarkdown.textContent = snapshot
      ? yesNo(snapshot.arcaia?.headerMarkdownPresent)
      : '未確認';
    elements.recentControls.textContent = snapshot
      ? yesNo(snapshot.arcaia?.recentViewControlsPresent)
      : '未確認';
    elements.download.disabled = !report;
  }

  async function load() {
    const data = await chrome.storage.local.get(REPORT_KEY);
    render(data?.[REPORT_KEY] || null);
  }

  function downloadReport() {
    if (!currentReport) return;
    const blob = new Blob([`${JSON.stringify(currentReport, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `arcaia-initial-render-probe-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function reset() {
    await chrome.storage.local.remove(REPORT_KEY);
    render(null);
  }

  elements.download.addEventListener('click', downloadReport);
  elements.reset.addEventListener('click', () => { void reset(); });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[REPORT_KEY]) return;
    render(changes[REPORT_KEY].newValue || null);
  });
  void load();
})();
