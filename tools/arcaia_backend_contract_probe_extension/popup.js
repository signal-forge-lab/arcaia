(() => {
  'use strict';

  const SOURCE = 'arcaia-backend-contract-probe-v1';
  const button = document.getElementById('download');
  const status = document.getElementById('status');

  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function isChatGpt(tab) {
    try { return new URL(tab?.url || '').origin === 'https://chatgpt.com'; } catch { return false; }
  }

  function download(report) {
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `arcaia-backend-contract-probe-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = '採取中…';
    try {
      const tab = await activeTab();
      if (!Number.isInteger(tab?.id) || !isChatGpt(tab)) throw new Error('ChatGPTタブで実行してください');
      const result = await chrome.tabs.sendMessage(tab.id, { source: SOURCE, type: 'EXPORT_REPORT' });
      if (!result?.ok || !result.report) throw new Error('Probeが未起動です。ChatGPTページを再読み込みしてください');
      download(result.report);
      status.textContent = '保存しました';
    } catch (error) {
      status.textContent = String(error?.message || error);
    } finally {
      button.disabled = false;
    }
  });
})();
