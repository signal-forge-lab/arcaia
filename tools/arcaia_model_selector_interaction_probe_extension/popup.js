(() => {
  'use strict';

  const statusElement = document.getElementById('status');

  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function send(message) {
    const tab = await activeTab();
    if (!tab?.id || !String(tab.url || '').startsWith('https://chatgpt.com/')) {
      throw new Error('ChatGPTタブを開いてください。');
    }
    return chrome.tabs.sendMessage(tab.id, message);
  }

  function renderStatus(response) {
    const summary = response?.summary || response?.report?.summary || {};
    statusElement.textContent = [
      `状態: ${response?.running === false ? '停止' : '監視中'}`,
      `記録: ${summary.recordCount ?? 0}`,
      `文字重なり: ${summary.snapshotsWithTextOverlap ?? 0}`,
      `装飾内部重なり: ${summary.snapshotsWithInternalDecorationOverlap ?? 0}`,
      `Picker/装飾 subtype不一致: ${summary.pickerDecorationSubtypeMismatchCount ?? 0}`,
      `Authority/装飾 family不一致: ${summary.authorityDecorationFamilyMismatchCount ?? 0}`
    ].join('\n');
  }

  async function refresh() {
    try {
      renderStatus(await send({ action: 'status' }));
    } catch (error) {
      statusElement.textContent = String(error?.message || error);
    }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    button.disabled = true;
    try {
      const action = button.dataset.action;
      const response = await send({ action, scenario: button.dataset.scenario || null });
      if (!response?.ok && action !== 'status') throw new Error(response?.error || '操作に失敗しました。');
      await refresh();
    } catch (error) {
      statusElement.textContent = String(error?.message || error);
    } finally {
      button.disabled = false;
    }
  });

  refresh();
})();
