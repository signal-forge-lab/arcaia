(function () {
  'use strict';

  const REQUIRED_TOOLBAR_DEPS = [
    'appVersion',
    'extractChatGPTInternal',
    'makeBaseExportName',
    'downloadText'
  ];

  function normalizeToolbarDeps(deps) {
    if (!deps || typeof deps !== 'object') {
      throw new Error('Arcaia toolbar dependencies are missing.');
    }
    for (const key of REQUIRED_TOOLBAR_DEPS) {
      if (key === 'appVersion') {
        if (!deps[key]) throw new Error(`Arcaia toolbar dependency ${key} is missing.`);
      } else if (typeof deps[key] !== 'function') {
        throw new Error(`Arcaia toolbar dependency ${key} is missing.`);
      }
    }
    return deps;
  }

  let toolbarPageJobRunning = false;
  let toolbarPageJobId = null;
  const TOOLBAR_MODAL_ID = 'arcaia-toolbar-operation-modal-v1';
  const TOOLBAR_TOAST_ID = 'arcaia-toolbar-operation-toast-v1';
  function showToolbarOperationModal(title, detail = '', options = {}) {
    hideToolbarOperationToast();
    let modal = document.getElementById(TOOLBAR_MODAL_ID);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = TOOLBAR_MODAL_ID;
      modal.setAttribute('role', 'status');
      modal.setAttribute('aria-live', 'polite');
      modal.innerHTML = `<div class="arcaia-toolbar-modal-card"><div class="arcaia-toolbar-modal-icon arcaia-toolbar-modal-spinner" aria-hidden="true"></div><div><div class="arcaia-toolbar-modal-title"></div><div class="arcaia-toolbar-modal-detail"></div></div></div><style>#${TOOLBAR_MODAL_ID}{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#${TOOLBAR_MODAL_ID} .arcaia-toolbar-modal-card{min-width:280px;max-width:min(440px,calc(100vw - 32px));border-radius:16px;padding:20px 22px;background:rgba(22,22,24,.94);color:#fff;box-shadow:0 18px 48px rgba(0,0,0,.35);display:flex;gap:14px;align-items:center}#${TOOLBAR_MODAL_ID} .arcaia-toolbar-modal-icon{width:24px;height:24px;flex:0 0 auto;display:flex;align-items:center;justify-content:center}#${TOOLBAR_MODAL_ID} .arcaia-toolbar-modal-spinner{border-radius:50%;border:3px solid rgba(255,255,255,.28);border-top-color:#fff;animation:arcaiaToolbarSpin .85s linear infinite}#${TOOLBAR_MODAL_ID} .arcaia-toolbar-modal-check{border-radius:50%;border:3px solid rgba(255,255,255,.9);animation:none;font-size:15px;font-weight:800;line-height:1}#${TOOLBAR_MODAL_ID} .arcaia-toolbar-modal-title{font-weight:700;font-size:15px;line-height:1.4}#${TOOLBAR_MODAL_ID} .arcaia-toolbar-modal-detail{margin-top:3px;opacity:.84;font-size:14px;line-height:1.45}@keyframes arcaiaToolbarSpin{to{transform:rotate(360deg)}}</style>`;
      document.documentElement.appendChild(modal);
    }
    const iconEl = modal.querySelector('.arcaia-toolbar-modal-icon');
    const titleEl = modal.querySelector('.arcaia-toolbar-modal-title');
    const detailEl = modal.querySelector('.arcaia-toolbar-modal-detail');
    if (iconEl) {
      const done = options.icon === 'check';
      iconEl.classList.toggle('arcaia-toolbar-modal-check', done);
      iconEl.classList.toggle('arcaia-toolbar-modal-spinner', !done);
      iconEl.textContent = done ? '✓' : '';
    }
    if (titleEl) titleEl.textContent = title || 'Arcaia';
    if (detailEl) detailEl.textContent = detail || '';
  }

  function showToolbarOperationCompleteModal(title, detail = '', delayMs = 1400) {
    showToolbarOperationModal(title, detail, { icon: 'check' });
    setTimeout(() => hideToolbarOperationModal(), Math.max(600, Number(delayMs) || 1400));
  }
  function hideToolbarOperationModal() {
    const modal = document.getElementById(TOOLBAR_MODAL_ID);
    if (modal) modal.remove();
  }

  function hideToolbarOperationToast() {
    const toast = document.getElementById(TOOLBAR_TOAST_ID);
    if (toast) toast.remove();
  }

  function showToolbarOperationToast(message, isError = false) {
    hideToolbarOperationToast();
    const toast = document.createElement('div');
    toast.id = TOOLBAR_TOAST_ID;
    toast.textContent = message;
    toast.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:min(520px,calc(100vw - 40px));padding:12px 14px;border-radius:12px;font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.28);background:${isError ? 'rgba(125,24,24,.96)' : 'rgba(22,22,24,.94)'};color:#fff`;
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), isError ? 4200 : 2200);
  }

  function startToolbarPageJob(deps) {
    deps = normalizeToolbarDeps(deps);
    if (toolbarPageJobRunning) {
      throw new Error('toolbar_page_job_already_running');
    }
    const jobId = `markdown-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    toolbarPageJobRunning = true;
    toolbarPageJobId = jobId;
    setTimeout(() => {
      runToolbarMarkdownSave(jobId, deps).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        hideToolbarOperationModal();
        showToolbarOperationToast(`Arcaia: ${message}`, true);
      }).finally(() => {
        toolbarPageJobRunning = false;
        toolbarPageJobId = null;
      });
    }, 0);
    return { ok: true, appVersion: deps.appVersion, action: 'toolbar_markdown_start', started: true, jobId };
  }

  async function runToolbarMarkdownSave(jobId, deps) {
    showToolbarOperationModal('Arcaia', 'Markdownを保存中です…');
    try {
      const result = await deps.extractChatGPTInternal(false);
      const markdown = result?.exportPlan?.markdownDraft || '';
      if (!markdown) throw new Error('Markdown本文を生成できませんでした。');
      const filename = `${deps.makeBaseExportName(result)}.md`;
      deps.downloadText(filename, markdown, 'text/markdown;charset=utf-8');
      hideToolbarOperationModal();
      showToolbarOperationToast(`Arcaia: Markdownを保存しました。${filename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hideToolbarOperationModal();
      showToolbarOperationToast(`Arcaia: Markdown保存に失敗しました: ${message}`, true);
    }
  }

  function startToolbarMarkdownSaveFromPopup(deps) {
    return startToolbarPageJob(deps);
  }


  window.ArcaiaContentToolbar = Object.freeze({
    startToolbarMarkdownSaveFromPopup,
    showToolbarOperationModal,
    hideToolbarOperationModal,
    showToolbarOperationToast,
    showToolbarOperationCompleteModal
  });
})();
