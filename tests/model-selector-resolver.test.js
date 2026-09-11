const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('../tools/playwright_browser');

const source = fs.readFileSync(path.join(__dirname, '..', 'content_model_selector.js'), 'utf8');
const diagnosticSource = fs.readFileSync(path.join(__dirname, '..', 'tools', 'model_selector_dom_diagnostic.js'), 'utf8');

test('model selector exposes a privacy-bounded internal probe snapshot for new Chat resolution', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button id="chat" role="radio" data-state="on">Chat</button>
        <button id="work" role="radio" data-state="off">Work</button>
        <form data-type="unified-composer">
          <button id="model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      window.__ARCAIA_MODEL_SELECTOR_UI__.start();
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('probe_snapshot_test');
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-version') === 'GPT-5.6');

    const snapshot = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot());
    assert.equal(snapshot.activeSurfaceModePresent, true);
    assert.equal(snapshot.activeSurfaceMode, 'chatgpt');
    assert.equal(snapshot.newChatModelConfigPresent, true);
    assert.equal(snapshot.newChatStateCandidateFound, true);
    assert.equal(snapshot.resolvedContextKind, 'new_chat_cookie');
    assert.equal(snapshot.triggerFound, true);
    assert.equal(snapshot.currentStatePresent, true);
    assert.equal(snapshot.modelSource, 'new_chat_cookie_last_model_config');
    assert.equal(snapshot.thinkingEffort, 'extended');
    assert.equal(snapshot.performance, '高い');
    assert.equal(snapshot.triggerApplied, true);
    assert.equal(snapshot.currentTriggerInComposer, true);
    assert.match(snapshot.scanReason, /^(?:probe_snapshot_test|startup)$/);
    assert.equal(snapshot.scanOutcome, 'resolved_state_applied');
    assert.doesNotMatch(JSON.stringify(snapshot), /gpt-5-6-thinking|oai-last-model-config/);
  } finally {
    await browser.close();
  }
});

test('new Chat cold start decorates a performance trigger with extra native label text', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button role="radio" data-state="on">Chat</button>
        <button role="radio" data-state="off">Work</button>
        <form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" data-state="closed"><span>&#39640;&#12356;</span> <span>&#12514;&#12487;&#12523;</span><svg></svg></button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForTimeout(80);

    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-version'), 'GPT-5.6');
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-performance'), '高い');
  } finally {
    await browser.close();
  }
});

test('model selector follows new Chat and Work authoritative state without cross-surface carryover', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button id="chat" role="radio" data-state="on">Chat</button>
              <button id="work" role="radio" data-state="off">Work</button>
              <form data-type="unified-composer">
                <button id="model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
              </form>
              <script>
                try {
                  const mode = JSON.parse(localStorage.getItem('oai/apps/tpp/chat-surface-mode') || '"chatgpt"');
                  document.getElementById('chat').setAttribute('data-state', mode === 'work' ? 'off' : 'on');
                  document.getElementById('work').setAttribute('data-state', mode === 'work' ? 'on' : 'off');
                } catch {}
              </script>
            </body>
          </html>
        `
      });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      localStorage.setItem('oai/apps/tpp/model-settings', JSON.stringify({ lastUsedModelSlug: 'gpt-5.6-sol-wm' }));
      localStorage.setItem('oai/apps/tpp/thinking-effort', JSON.stringify('xhigh'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());

    const readState = () => page.evaluate(() => {
      const button = document.getElementById('model');
      const status = window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus();
      return {
        model: button.getAttribute('data-arcaia-model-version'),
        performance: button.getAttribute('data-arcaia-model-performance'),
        richText: button.querySelector('[data-arcaia-model-rich-content="true"]')?.textContent || '',
        source: status.modelSource,
        surface: status.activeSurfaceMode
      };
    });

    await page.waitForFunction(() => {
      const button = document.getElementById('model');
      const status = window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus();
      return button?.getAttribute('data-arcaia-model-performance') === '高い'
        && status.modelSource === 'new_chat_cookie_last_model_config'
        && status.activeSurfaceMode === 'chatgpt';
    });
    assert.deepEqual(await readState(), {
      model: 'GPT-5.6',
      performance: '高い',
      richText: '✦GPT-5.6Solhigh',
      source: 'new_chat_cookie_last_model_config',
      surface: 'chatgpt'
    });

    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
      document.getElementById('chat').setAttribute('data-state', 'off');
      document.getElementById('work').setAttribute('data-state', 'on');
    });
    await page.waitForFunction(() => {
      const button = document.getElementById('model');
      const status = window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus();
      return button?.getAttribute('data-arcaia-model-performance') === '非常に高い'
        && status.modelSource === 'work_local_storage_current'
        && status.activeSurfaceMode === 'work';
    });
    assert.deepEqual(await readState(), {
      model: 'GPT-5.6',
      performance: '非常に高い',
      richText: '✦GPT-5.6Solvery high',
      source: 'work_local_storage_current',
      surface: 'work'
    });

    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/model-settings', JSON.stringify({ lastUsedModelSlug: 'gpt-5.6-terra-wm' }));
      localStorage.setItem('oai/apps/tpp/thinking-effort', JSON.stringify('standard'));
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('work_storage_test');
    });
    assert.deepEqual(await readState(), {
      model: 'GPT-5.6',
      performance: '中程度',
      richText: '✦GPT-5.6Terramedium',
      source: 'work_local_storage_current',
      surface: 'work'
    });

    await page.reload();
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => {
      const button = document.getElementById('model');
      const status = window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus();
      return button?.getAttribute('data-arcaia-model-performance') === '中程度'
        && status.modelSource === 'work_local_storage_current'
        && status.activeSurfaceMode === 'work';
    });
    assert.deepEqual(await readState(), {
      model: 'GPT-5.6',
      performance: '中程度',
      richText: '✦GPT-5.6Terramedium',
      source: 'work_local_storage_current',
      surface: 'work'
    });

    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.getElementById('chat').setAttribute('data-state', 'on');
      document.getElementById('work').setAttribute('data-state', 'off');
    });
    await page.waitForFunction(() => {
      const button = document.getElementById('model');
      const status = window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus();
      return button?.getAttribute('data-arcaia-model-performance') === '高い'
        && status.modelSource === 'new_chat_cookie_last_model_config'
        && status.activeSurfaceMode === 'chatgpt';
    });
    assert.deepEqual(await readState(), {
      model: 'GPT-5.6',
      performance: '高い',
      richText: '✦GPT-5.6Solhigh',
      source: 'new_chat_cookie_last_model_config',
      surface: 'chatgpt'
    });
  } finally {
    await browser.close();
  }
});

test('model selector prefers native Work pre-picker authority over stale storage and fails closed on unknown values', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button id="chat" role="radio" data-state="off">Chat</button>
              <button id="work" role="radio" data-state="on">Work</button>
              <form data-type="unified-composer">
                <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed">
                  <span data-animated-slider-trigger="true">
                    <span class="hash_SliderTriggerModelLabel">5.6 Sol</span>
                    <span class="hash_SliderTriggerEffortLabel">&#38750;&#24120;&#12395;&#39640;&#12356;</span>
                  </span>
                  <svg></svg>
                </button>
              </form>
            </body>
          </html>
        `
      });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
      localStorage.setItem('oai/apps/tpp/model-settings', JSON.stringify({ lastUsedModelSlug: 'gpt-5.6-terra-wm' }));
      localStorage.setItem('oai/apps/tpp/thinking-effort', JSON.stringify('standard'));
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      window.__ARCAIA_MODEL_SELECTOR_UI__.start();
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('work_native_pre_picker_test');
    });

    await page.waitForFunction(() => {
      const button = document.getElementById('model');
      const status = window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus();
      return button?.getAttribute('data-arcaia-model-performance') === '非常に高い'
        && status.modelSource === 'work_native_trigger_current';
    });
    assert.deepEqual(await page.evaluate(() => {
      const button = document.getElementById('model');
      const status = window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus();
      return {
        model: button.getAttribute('data-arcaia-model-version'),
        suffix: status.modelSuffix,
        performance: status.performance,
        thinkingEffort: status.thinkingEffort,
        source: status.modelSource,
        contextKind: window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot().resolvedContextKind
      };
    }), {
      model: 'GPT-5.6',
      suffix: 'Sol',
      performance: '非常に高い',
      thinkingEffort: 'xhigh',
      source: 'work_native_trigger_current',
      contextKind: 'new_work_native_trigger'
    });

    await page.evaluate(() => {
      document.querySelector('[class*="_SliderTriggerModelLabel"]').textContent = 'Claude Sonnet 4.5';
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('work_native_non_gpt_test');
    });
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), null);
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), null);

    await page.evaluate(() => {
      document.querySelector('[class*="_SliderTriggerModelLabel"]').textContent = '5.6 Sol';
      document.querySelector('[class*="_SliderTriggerEffortLabel"]').textContent = 'UNKNOWN_EFFORT';
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('work_native_unknown_effort_test');
    });
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), null);
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), null);
    assert.deepEqual(await page.evaluate(() => {
      const snapshot = window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot();
      return { contextKind: snapshot.resolvedContextKind, outcome: snapshot.scanOutcome };
    }), {
      contextKind: 'new_work_native_trigger',
      outcome: 'resolved_state_unavailable'
    });
  } finally {
    await browser.close();
  }
});

test('route transition preserves confirmed GPT-5.6 on the same trigger until the new conversation authority resolves', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="on">Chat</button>
              <button role="radio" data-state="off">Work</button>
              <form data-type="unified-composer">
                <button id="model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
              </form>
            </body>
          </html>
        `
      });
    });

    await page.goto('https://chatgpt.test/g/test-gpt');
    await page.evaluate(() => {
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');

    const sameContextReset = await page.evaluate(() => (
      window.__ARCAIA_MODEL_SELECTOR_UI__.resetForNavigation({ reason: 'same_gpt_surface_test' })
    ));
    await page.waitForTimeout(40);
    assert.equal(sameContextReset, false);
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), 'true');
    assert.match(
      await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().lastReason),
      /navigation_same_context:same_gpt_surface_test$/
    );

    await page.goto('https://chatgpt.test/c/first-conversation');
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      window.__ARCAIA_MODEL_SELECTOR_UI__.start();
      window.__ARCAIA_MODEL_SELECTOR_UI__.applyConversationModelConfig({
        conversationId: 'first-conversation',
        modelSlug: 'gpt-5.6-sol-wm',
        thinkingEffort: 'extended',
        source: 'conversation_detail_current_branch'
      }, 'test_first_conversation');
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');

    const sameConversationReset = await page.evaluate(() => (
      window.__ARCAIA_MODEL_SELECTOR_UI__.resetForNavigation({ reason: 'same_conversation_test' })
    ));
    await page.waitForTimeout(40);
    assert.equal(sameConversationReset, false);
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), 'true');

    const changedContextReset = await page.evaluate(() => {
      history.pushState({}, '', '/c/second-conversation');
      return window.__ARCAIA_MODEL_SELECTOR_UI__.resetForNavigation({ reason: 'different_conversation_test' });
    });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.scan('conversation_detail_gap_test'));
    assert.equal(changedContextReset, false);
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), 'true');
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), 'GPT-5.6');

    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.applyConversationModelConfig({
      conversationId: 'second-conversation',
      modelSlug: 'gpt-5-5-thinking',
      thinkingEffort: 'extended',
      source: 'conversation_detail_current_branch'
    }, 'explicit_gpt55_after_navigation'));
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), null);
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), null);

    await page.evaluate(() => {
      window.__ARCAIA_MODEL_SELECTOR_UI__.applyConversationModelConfig({
        conversationId: 'second-conversation',
        modelSlug: 'gpt-5.6-sol-wm',
        thinkingEffort: 'extended',
        source: 'conversation_detail_current_branch'
      }, 'confirmed_gpt56_before_new_chat');
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-5-thinking', effort: 'extended' }))}; path=/`;
      history.pushState({}, '', '/');
      window.__ARCAIA_MODEL_SELECTOR_UI__.resetForNavigation({ reason: 'new_chat_explicit_gpt55_test' });
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('new_chat_explicit_gpt55_test');
    });
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), null);
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), null);
  } finally {
    await browser.close();
  }
});

test('route transition decorates the replacement composer even while the previous composer is still connected', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="on">Chat</button>
              <button role="radio" data-state="off">Work</button>
              <div id="composer-host">
                <form id="old-composer" data-type="unified-composer">
                  <button id="old-model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
                </form>
              </div>
            </body>
          </html>
        `
      });
    });

    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('old-model')?.getAttribute('data-arcaia-model-rich') === 'true');

    await page.evaluate(() => {
      const host = document.getElementById('composer-host');
      const next = document.createElement('form');
      next.id = 'new-composer';
      next.setAttribute('data-type', 'unified-composer');
      next.innerHTML = '<button id="new-model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>';
      host.insertBefore(next, document.getElementById('old-composer'));
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('replacement_composer_while_old_connected');
    });

    await page.waitForTimeout(80);
    assert.equal(await page.locator('#new-model').getAttribute('data-arcaia-model-rich'), 'true');
    assert.equal(await page.locator('#old-model').getAttribute('data-arcaia-model-rich'), null);
  } finally {
    await browser.close();
  }
});

test('model selector automatically rebinds when the composer parent is replaced', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="on">Chat</button>
              <button role="radio" data-state="off">Work</button>
              <div id="composer-shell">
                <div id="composer-host">
                  <form id="old-composer" data-type="unified-composer">
                    <button id="old-model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
                  </form>
                </div>
              </div>
            </body>
          </html>
        `
      });
    });

    await page.goto('https://chatgpt.test/g/test-gpt');
    await page.evaluate(() => {
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('old-model')?.getAttribute('data-arcaia-model-rich') === 'true');

    await page.evaluate(() => {
      document.getElementById('composer-host').outerHTML = `
        <div id="composer-host-next">
          <form id="new-composer" data-type="unified-composer">
            <button id="new-model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
          </form>
        </div>
      `;
    });

    await page.waitForFunction(() => document.getElementById('new-model')?.getAttribute('data-arcaia-model-rich') === 'true', null, { timeout: 1200 });
    assert.equal(await page.locator('#new-model').getAttribute('data-arcaia-model-rich'), 'true');
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), 'GPT-5.6');
  } finally {
    await browser.close();
  }
});

test('model selector repairs decoration stripped from the connected model trigger', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="on">Chat</button>
              <button role="radio" data-state="off">Work</button>
              <form data-type="unified-composer">
                <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed"><span>&#39640;&#12356;</span><svg></svg></button>
              </form>
            </body>
          </html>
        `
      });
    });

    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');

    await page.evaluate(() => {
      const button = document.getElementById('model');
      button.removeAttribute('data-arcaia-model-rich');
      button.removeAttribute('data-arcaia-model-version');
      button.removeAttribute('data-arcaia-model-performance');
      button.querySelector('[data-arcaia-model-rich-content="true"]')?.remove();
    });

    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true', null, { timeout: 1200 });
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-performance'), '高い');
  } finally {
    await browser.close();
  }
});

test('Work New Chat keeps confirmed GPT-5.6 across a replacement composer when legacy Work storage is absent', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="off">Chat</button>
              <button role="radio" data-state="on">Work</button>
              <div id="composer-host">
                <form id="old-composer" data-type="unified-composer">
                  <button id="old-model" aria-haspopup="menu"><span>&#38750;&#24120;&#12395;&#39640;&#12356;</span><svg></svg></button>
                </form>
              </div>
            </body>
          </html>
        `
      });
    });

    await page.goto('https://chatgpt.test/g/test-gpt');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
      localStorage.removeItem('oai/apps/tpp/model-settings');
      localStorage.removeItem('oai/apps/tpp/thinking-effort');
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      window.__ARCAIA_MODEL_SELECTOR_UI__.start();
      window.__ARCAIA_MODEL_SELECTOR_UI__.applyConversationModelConfig({
        modelSlug: 'gpt-5.6-sol-wm',
        thinkingEffort: 'xhigh',
        source: 'conversation_detail_current_branch'
      }, 'confirmed_work_before_new_chat');
    });
    await page.waitForFunction(() => document.getElementById('old-model')?.getAttribute('data-arcaia-model-rich') === 'true');

    await page.evaluate(() => {
      history.pushState({}, '', '/');
      window.__ARCAIA_MODEL_SELECTOR_UI__.resetForNavigation({ reason: 'work_new_chat_without_legacy_storage' });
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('work_new_chat_before_replacement');
      document.getElementById('composer-host').innerHTML = `
        <form id="new-composer" data-type="unified-composer">
          <button id="new-model" aria-haspopup="menu" aria-expanded="false" data-state="closed">
            <span data-animated-slider-trigger="true">
              <span class="hash_SliderTriggerModelLabel">5.6 Sol</span>
              <span class="hash_SliderTriggerEffortLabel">軽</span>
            </span>
            <svg></svg>
          </button>
        </form>
      `;
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('work_new_chat_after_replacement');
    });

    assert.equal(await page.locator('#new-model').getAttribute('data-arcaia-model-rich'), 'true');
    assert.equal(await page.locator('#new-model').getAttribute('data-arcaia-model-version'), 'GPT-5.6');
    assert.equal(await page.locator('#new-model').getAttribute('data-arcaia-model-performance'), '非常に高い');
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), 'GPT-5.6');
    assert.notEqual(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelSource), 'work_native_trigger_current');

    await page.evaluate(() => {
      window.__ARCAIA_MODEL_SELECTOR_UI__.applyConversationModelConfig({
        modelSlug: 'gpt-5.5-thinking',
        thinkingEffort: 'xhigh',
        source: 'conversation_detail_current_branch'
      }, 'explicit_model_config_replaces_navigation_carry');
      document.querySelector('[class*="_SliderTriggerModelLabel"]').textContent = 'GPT-5.5';
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('after_explicit_model_config');
    });
    assert.equal(await page.locator('#new-model').getAttribute('data-arcaia-model-rich'), null);
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), null);
  } finally {
    await browser.close();
  }
});

test('Chat New Chat state is not carried into Work when Work authority is absent', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button id="chat" role="radio" data-state="on">Chat</button>
              <button id="work" role="radio" data-state="off">Work</button>
              <div id="composer-host">
                <form data-type="unified-composer">
                  <button id="model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
                </form>
              </div>
            </body>
          </html>
        `
      });
    });

    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
      localStorage.removeItem('oai/apps/tpp/model-settings');
      localStorage.removeItem('oai/apps/tpp/thinking-effort');
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');

    await page.evaluate(() => {
      document.getElementById('chat').setAttribute('data-state', 'off');
      document.getElementById('work').setAttribute('data-state', 'on');
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
      window.__ARCAIA_MODEL_SELECTOR_UI__.resetForNavigation({ reason: 'chat_to_work_without_work_authority' });
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('chat_to_work_without_work_authority');
    });

    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), null);
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), null);
    assert.notEqual(
      await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot().resolvedContextKind),
      'new_work_navigation_carry'
    );
  } finally {
    await browser.close();
  }
});

test('new Chat promotion keeps confirmed GPT-5.6 across a replacement composer until conversation detail arrives', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="on">Chat</button>
              <button role="radio" data-state="off">Work</button>
              <div id="composer-host">
                <form id="new-chat-composer" data-type="unified-composer">
                  <button id="new-chat-model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
                </form>
              </div>
            </body>
          </html>
        `
      });
    });

    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('new-chat-model')?.getAttribute('data-arcaia-model-rich') === 'true');

    const resetResult = await page.evaluate(() => {
      document.getElementById('new-chat-composer').outerHTML = `
        <form id="conversation-composer" data-type="unified-composer">
          <button id="conversation-model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
        </form>
      `;
      const chatSurface = Array.from(document.querySelectorAll('button[role="radio"]'))
        .find((button) => button.textContent.trim() === 'Chat');
      chatSurface.setAttribute('data-state', 'off');
      localStorage.removeItem('oai/apps/tpp/chat-surface-mode');
      history.pushState({}, '', '/c/created-conversation');
      const result = window.__ARCAIA_MODEL_SELECTOR_UI__.resetForNavigation({ reason: 'new_chat_promoted_to_conversation' });
      chatSurface.setAttribute('data-state', 'on');
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('new_chat_promoted_without_conversation_detail');
      return result;
    });

    await page.waitForTimeout(80);
    assert.equal(resetResult, false);
    assert.equal(await page.locator('#conversation-model').getAttribute('data-arcaia-model-rich'), 'true');
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), 'GPT-5.6');

    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.applyConversationModelConfig({
      conversationId: 'created-conversation',
      modelSlug: 'gpt-5-5-thinking',
      thinkingEffort: 'extended',
      source: 'conversation_detail_current_branch'
    }, 'created_conversation_explicit_gpt55'));
    assert.equal(await page.locator('#conversation-model').getAttribute('data-arcaia-model-rich'), null);
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), null);
  } finally {
    await browser.close();
  }
});

test('new Chat promotion survives a trigger-disconnected scan that runs before navigation reset', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="on">Chat</button>
              <button role="radio" data-state="off">Work</button>
              <div id="composer-host">
                <form id="new-chat-composer" data-type="unified-composer">
                  <button id="new-chat-model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
                </form>
              </div>
            </body>
          </html>
        `
      });
    });

    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('new-chat-model')?.getAttribute('data-arcaia-model-rich') === 'true');

    const beforeReset = await page.evaluate(() => {
      document.getElementById('new-chat-composer').outerHTML = `
        <form id="conversation-composer" data-type="unified-composer">
          <button id="conversation-model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
        </form>
      `;
      history.pushState({}, '', '/c/created-conversation-race');
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('trigger_disconnected');
      return {
        status: window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus(),
        probe: window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot()
      };
    });

    assert.equal(beforeReset.status.modelVersion, 'GPT-5.6');
    assert.notEqual(beforeReset.probe.lastStateMutation?.sourceReason, 'trigger_disconnected');

    const resetResult = await page.evaluate(() => {
      const result = window.__ARCAIA_MODEL_SELECTOR_UI__.resetForNavigation({ reason: 'new_chat_promoted_after_trigger_disconnect' });
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('new_chat_promoted_after_trigger_disconnect');
      return result;
    });

    assert.equal(resetResult, false);
    assert.equal(await page.locator('#conversation-model').getAttribute('data-arcaia-model-rich'), 'true');
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), 'GPT-5.6');
    const probe = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot());
    assert.equal(probe.lastNavigationResetPreserved, true);
    assert.equal(probe.navigationResetHistory.at(-1)?.decisionReason, 'new_chat_promotion');
  } finally {
    await browser.close();
  }
});

test('GPT surface promotion keeps confirmed GPT-5.6 until conversation detail arrives', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="on">Chat</button>
              <button role="radio" data-state="off">Work</button>
              <div id="composer-host">
                <form id="new-chat-composer" data-type="unified-composer">
                  <button id="new-chat-model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
                </form>
              </div>
            </body>
          </html>
        `
      });
    });

    await page.goto('https://chatgpt.test/g/test-gpt');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('new-chat-model')?.getAttribute('data-arcaia-model-rich') === 'true');

    const resetResult = await page.evaluate(() => {
      document.getElementById('new-chat-composer').outerHTML = `
        <form id="conversation-composer" data-type="unified-composer">
          <button id="conversation-model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
        </form>
      `;
      history.pushState({}, '', '/c/created-from-gpt-surface');
      const result = window.__ARCAIA_MODEL_SELECTOR_UI__.resetForNavigation({ reason: 'gpt_surface_promoted_to_conversation' });
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('gpt_surface_promoted_without_conversation_detail');
      return result;
    });

    await page.waitForTimeout(80);
    assert.equal(resetResult, false);
    assert.equal(await page.locator('#conversation-model').getAttribute('data-arcaia-model-rich'), 'true');
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), 'GPT-5.6');
    const probe = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot());
    assert.equal(probe.currentContextKind, 'conversation');
    assert.equal(probe.currentStateContextKind, 'conversation');
    assert.equal(probe.currentStateContextMatchesCurrent, true);
    assert.equal(probe.lastNavigationResetPresent, true);
    assert.equal(probe.lastNavigationResetPreserved, true);
    assert.equal(probe.navigationResetHistory.length, 1);
    assert.deepEqual(probe.navigationResetHistory[0].conditions, {
      sameContext: false,
      normalNewChatPromotion: false,
      gptSurfaceChatPromotion: true,
      promotedConversationRekey: false,
      workNewChatCarry: false,
      confirmedDecoration: false,
      crossingChatToWork: false
    });
    assert.equal(probe.navigationResetHistory[0].previousContextKind, 'gpt_surface_chat');
    assert.equal(probe.navigationResetHistory[0].nextContextKind, 'conversation');
    assert.equal(probe.navigationResetHistory[0].decision, 'preserve');
    assert.equal(probe.navigationResetHistory[0].decisionReason, 'gpt_surface_chat_promotion');
    assert.equal(probe.confirmedComposerStatePresent, true);
    assert.equal(probe.confirmedComposerContextMatchesCurrent, true);

    const cleared = await page.evaluate(() => {
      document.getElementById('conversation-composer').outerHTML = `
        <form id="conversation-composer-next" data-type="unified-composer">
          <button id="conversation-model-next" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
        </form>
      `;
      history.pushState({}, '', '/c/second-conversation');
      const result = window.__ARCAIA_MODEL_SELECTOR_UI__.resetForNavigation({ reason: 'conversation_changed_without_decoration' });
      return {
        result,
        probe: window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot()
      };
    });

    assert.equal(cleared.result, true);
    assert.equal(cleared.probe.navigationResetHistory.length, 2);
    const clearReset = cleared.probe.navigationResetHistory[1];
    assert.equal(clearReset.previousContextKind, 'conversation');
    assert.equal(clearReset.nextContextKind, 'conversation');
    assert.equal(clearReset.contextKeyChanged, true);
    assert.equal(clearReset.decision, 'clear');
    assert.equal(clearReset.decisionReason, 'no_preserve_condition');
    assert.deepEqual(clearReset.conditions, {
      sameContext: false,
      normalNewChatPromotion: false,
      gptSurfaceChatPromotion: false,
      promotedConversationRekey: false,
      workNewChatCarry: false,
      confirmedDecoration: false,
      crossingChatToWork: false
    });
    assert.equal(cleared.probe.lastStateMutation.kind, 'clear');
    assert.equal(cleared.probe.lastStateMutation.reason, 'navigation_reset');
    assert.equal(cleared.probe.lastStateMutation.currentContextKind, 'conversation');
    assert.equal(cleared.probe.lastStateMutation.previousContextKind, 'conversation');
    assert.equal(cleared.probe.lastStateMutation.previousModelVersion, 'GPT-5.6');
    assert.equal(cleared.probe.lastStateMutation.nextModelVersion, null);
  } finally {
    await browser.close();
  }
});

test('explicit GPT-5.5 picker candidate clears GPT-5.6 decoration instead of falling back to current state', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="on">Chat</button>
              <button role="radio" data-state="off">Work</button>
              <form data-type="unified-composer">
                <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed"><span>&#39640;&#12356;</span><svg></svg></button>
              </form>
            </body>
          </html>
        `
      });
    });

    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');

    await page.evaluate(() => {
      const trigger = document.getElementById('model');
      trigger.setAttribute('aria-expanded', 'true');
      trigger.setAttribute('data-state', 'open');
      const menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-labelledby', 'model');
      menu.setAttribute('data-state', 'open');
      menu.innerHTML = `
        <div data-testid="composer-intelligence-picker-content">
          <div id="gpt56" role="menuitem" data-has-submenu>GPT-5.6 Sol</div>
          <div id="gpt55" role="menuitem" data-state="open">GPT-5.5</div>
          <div role="menuitemradio" aria-checked="true"><span class="truncate">&#39640;&#12356;</span></div>
        </div>
      `;
      document.body.appendChild(menu);
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('explicit_gpt55_picker_candidate');
    });

    await page.waitForTimeout(80);
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), null);
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), null);
  } finally {
    await browser.close();
  }
});

test('model selector does not promote click intent until the picker confirms the checked state', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="on">Chat</button>
              <button role="radio" data-state="off">Work</button>
              <form data-type="unified-composer">
                <button id="model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
              </form>
              <div role="menu" aria-labelledby="model" data-state="open">
                <div data-testid="composer-intelligence-picker-content">
                  <div role="menuitem" data-has-submenu>GPT-5.6 Sol</div>
                  <div id="high" role="menuitemradio" aria-checked="true"><span class="truncate">&#39640;&#12356;</span></div>
                  <div id="light" role="menuitemradio" aria-checked="false"><span class="truncate">&#36605;</span></div>
                </div>
              </div>
            </body>
          </html>
        `
      });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-performance') === '高い');

    await page.evaluate(() => {
      const light = document.getElementById('light');
      light.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      light.dispatchEvent(new CustomEvent('menu.itemSelect', { bubbles: true, composed: true }));
    });
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator('#model').getAttribute('data-arcaia-model-performance'),
      '高い',
      'selection events alone must not become confirmed model state'
    );

    await page.evaluate(() => {
      document.getElementById('high').setAttribute('aria-checked', 'false');
      document.getElementById('light').setAttribute('aria-checked', 'true');
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-performance') === '軽');
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-performance'), '軽');
  } finally {
    await browser.close();
  }
});

test('confirmed GPT-5.5 selection from a closing picker clears stale GPT-5.6 decoration before cookie catches up', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="on">Chat</button>
              <button role="radio" data-state="off">Work</button>
              <form data-type="unified-composer">
                <button id="model" type="button" aria-haspopup="menu" aria-expanded="true" data-state="open">
                  <span id="native-model">GPT-5.6</span><svg></svg>
                </button>
              </form>
              <div id="picker-menu" role="menu" aria-labelledby="model" data-state="open">
                <div data-testid="composer-intelligence-picker-content">
                  <div id="model-56" role="menuitemradio" aria-checked="true" data-state="checked">GPT-5.6</div>
                  <div id="model-55" role="menuitemradio" aria-checked="false" data-state="unchecked">GPT-5.5</div>
                </div>
              </div>
            </body>
          </html>
        `
      });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');

    await page.evaluate(() => {
      const model56 = document.getElementById('model-56');
      const model55 = document.getElementById('model-55');
      const trigger = document.getElementById('model');
      const menu = document.getElementById('picker-menu');
      model56.setAttribute('aria-checked', 'false');
      model56.setAttribute('data-state', 'unchecked');
      model55.setAttribute('aria-checked', 'true');
      model55.setAttribute('data-state', 'checked');
      document.getElementById('native-model').textContent = 'GPT-5.5';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('data-state', 'closed');
      menu.setAttribute('data-state', 'closed');
      menu.remove();
    });

    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') == null);
    const result = await page.evaluate(() => {
      const trigger = document.getElementById('model');
      const nativeModel = document.getElementById('native-model');
      const status = window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus();
      return {
        nativeText: nativeModel.textContent,
        nativeHidden: nativeModel.hasAttribute('data-arcaia-model-native-label'),
        richContentPresent: Boolean(trigger.querySelector('[data-arcaia-model-rich-content="true"]')),
        modelVersion: status.modelVersion,
        reason: status.lastReason
      };
    });
    assert.deepEqual(result, {
      nativeText: 'GPT-5.5',
      nativeHidden: false,
      richContentPresent: false,
      modelVersion: null,
      reason: 'non_5_6:picker_confirmed_selection'
    });

    await page.evaluate(() => {
      const trigger = document.getElementById('model');
      const menu = document.createElement('div');
      menu.id = 'picker-menu-return';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-labelledby', 'model');
      menu.setAttribute('data-state', 'open');
      menu.innerHTML = `
        <div data-testid="composer-intelligence-picker-content">
          <div id="return-55" role="menuitemradio" aria-checked="true" data-state="checked">GPT-5.5</div>
          <div id="return-56" role="menuitemradio" aria-checked="false" data-state="unchecked">GPT-5.6</div>
        </div>
      `;
      document.body.appendChild(menu);
      trigger.setAttribute('aria-expanded', 'true');
      trigger.setAttribute('data-state', 'open');
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    });
    await page.waitForFunction(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().pickerObserved === true);

    await page.evaluate(() => {
      const model55 = document.getElementById('return-55');
      const model56 = document.getElementById('return-56');
      const trigger = document.getElementById('model');
      const menu = document.getElementById('picker-menu-return');
      model55.setAttribute('aria-checked', 'false');
      model55.setAttribute('data-state', 'unchecked');
      model56.setAttribute('aria-checked', 'true');
      model56.setAttribute('data-state', 'checked');
      document.getElementById('native-model').textContent = 'GPT-5.6';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('data-state', 'closed');
      menu.setAttribute('data-state', 'closed');
      menu.remove();
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-version'), 'GPT-5.6');
  } finally {
    await browser.close();
  }
});

test('Work thinking slider commits on picker focusout and survives the close rescan', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html lang="ja">
            <body>
              <button role="radio" data-state="off">Chat</button>
              <button role="radio" data-state="on">Work</button>
              <form data-type="unified-composer">
                <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed"><span>&#20013;&#31243;&#24230;</span><svg></svg></button>
              </form>
              <span id="unrelated-slider" role="slider" aria-valuenow="2"></span>
              <div id="picker-menu" role="menu" aria-labelledby="model" data-state="closed">
                <div data-testid="composer-intelligence-picker-content">
                  <div role="menuitem" data-has-submenu>GPT-5.6 Sol</div>
                  <div data-testid="composer-model-picker-slider-simple-view">
                    <span id="thinking-slider" role="slider" aria-valuemin="0" aria-valuemax="4" aria-valuenow="3"></span>
                  </div>
                </div>
              </div>
            </body>
          </html>
        `
      });
    });
    await page.goto('https://chatgpt.test/c/work-conversation');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
      localStorage.removeItem('oai/apps/tpp/model-settings');
      localStorage.removeItem('oai/apps/tpp/thinking-effort');
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.applyConversationModelConfig({
      conversationId: 'work-conversation',
      modelSlug: 'gpt-5.6-sol-wm',
      thinkingEffort: 'xhigh',
      source: 'conversation_detail_current_branch'
    }, 'test_initial_conversation'));
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-performance') === '非常に高い');
    await page.evaluate(() => {
      const model = document.getElementById('model');
      model.setAttribute('aria-expanded', 'true');
      model.setAttribute('data-state', 'open');
      document.getElementById('picker-menu').setAttribute('data-state', 'open');
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('work_picker_opened');
    });
    await page.waitForTimeout(80);

    await page.evaluate(() => {
      document.getElementById('unrelated-slider').setAttribute('aria-valuenow', '1');
    });
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator('#model').getAttribute('data-arcaia-model-performance'),
      '非常に高い',
      'a slider outside the observed picker must not trigger an update'
    );

    await page.evaluate(() => {
      document.getElementById('thinking-slider').setAttribute('aria-valuenow', '2');
    });
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator('#model').getAttribute('data-arcaia-model-performance'),
      '非常に高い',
      'slider DOM intent alone must not become confirmed state'
    );

    await page.evaluate(() => {
      document.getElementById('thinking-slider').setAttribute('aria-valuenow', '1');
    });
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator('#model').getAttribute('data-arcaia-model-performance'),
      '非常に高い',
      'confirmed slider DOM is staged while the picker remains open'
    );

    await page.evaluate(() => {
      const model = document.getElementById('model');
      model.setAttribute('aria-expanded', 'false');
      model.setAttribute('data-state', 'closed');
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-performance') === '中程度');
    await page.evaluate(() => document.querySelector('[role="menu"]')?.remove());
    await page.waitForTimeout(80);
    const result = await page.evaluate(() => {
      const status = window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus();
      return {
        performance: document.getElementById('model')?.getAttribute('data-arcaia-model-performance'),
        thinkingEffort: status.thinkingEffort,
        source: status.modelSource,
        reason: status.lastReason
      };
    });
    assert.equal(result.performance, '中程度');
    assert.equal(result.thinkingEffort, 'standard');
  } finally {
    await browser.close();
  }
});

test('Work family-only picker items update Sol Terra Luna decoration without GPT prefix or storage authority', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button role="radio" data-state="off">Chat</button>
        <button role="radio" data-state="on">Work</button>
        <form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" aria-expanded="true" data-state="open"><span>GPT-5.6 Sol</span><svg></svg></button>
        </form>
        <div role="menu" aria-labelledby="model" data-state="open">
          <div data-testid="composer-intelligence-picker-content">
            <div id="sol-family" role="menuitem" aria-expanded="true">Sol</div>
            <div id="luna-family" role="menuitem" aria-expanded="false">Luna</div>
            <div id="terra-family" role="menuitem" aria-expanded="false">Terra</div>
          </div>
        </div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/c/work-family-conversation');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
      localStorage.removeItem('oai/apps/tpp/model-settings');
      localStorage.removeItem('oai/apps/tpp/thinking-effort');
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      const api = window.__ARCAIA_MODEL_SELECTOR_UI__;
      api.start();
      api.applyConversationModelConfig({
        conversationId: 'work-family-conversation',
        modelSlug: 'gpt-5.6-sol-wm',
        thinkingEffort: 'extended'
      }, 'work_family_fixture');
      api.scan('family_only_picker');
    });
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.arcaia-model-suffix').textContent(), 'Sol');
    await page.evaluate(() => {
      document.getElementById('sol-family').setAttribute('aria-expanded', 'false');
      document.getElementById('luna-family').setAttribute('aria-expanded', 'true');
    });
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.arcaia-model-suffix').textContent(), 'Sol');
    await page.evaluate(() => {
      const model = document.getElementById('model');
      model.setAttribute('aria-expanded', 'false');
      model.setAttribute('data-state', 'closed');
      document.querySelector('[role="menu"]')?.remove();
    });
    await page.waitForFunction(() => document.querySelector('.arcaia-model-suffix')?.textContent === 'Luna');
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.scan('after_family_picker_removed'));
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.arcaia-model-suffix').textContent(), 'Luna');
    assert.match(await page.locator('[data-arcaia-model-rich-content="true"]').textContent(), /GPT-5\.6Luna/);
  } finally {
    await browser.close();
  }
});

test('Work picker first open derives performance from confirmed slider when legacy storage is absent', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button role="radio" data-state="off">Chat</button>
        <button role="radio" data-state="on">Work</button>
        <form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" aria-expanded="true" data-state="open"><span></span><svg></svg></button>
        </form>
        <div role="menu" aria-labelledby="model" data-state="open">
          <div data-testid="composer-intelligence-picker-content">
            <div role="menuitem" data-has-submenu>GPT-5.6</div>
            <div data-testid="composer-model-picker-slider-simple-view">
              <span id="thinking-slider" role="slider" aria-valuemin="0" aria-valuemax="4" aria-valuenow="4"></span>
            </div>
          </div>
        </div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
      localStorage.removeItem('oai/apps/tpp/model-settings');
      localStorage.removeItem('oai/apps/tpp/thinking-effort');
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      window.__ARCAIA_MODEL_SELECTOR_UI__.start();
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('work_picker_first_open_without_legacy_storage');
    });

    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-version') === 'GPT-5.6');
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-performance'), '最大');
    const status = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus());
    assert.equal(status.thinkingEffort, 'max');
    assert.equal(status.modelSource, 'model_candidate');
  } finally {
    await browser.close();
  }
});

test('Work picker explicit selected performance label overrides stale slider index mapping', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button role="radio" data-state="off">Chat</button>
        <button role="radio" data-state="on">Work</button>
        <form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" aria-expanded="true" data-state="open"><span>GPT-5.6 Sol</span><svg></svg></button>
        </form>
        <div role="menu" aria-labelledby="model" data-state="open">
          <div data-testid="composer-intelligence-picker-content">
            <div role="menuitem" aria-expanded="true">Sol</div>
            <div role="radio" id="high" aria-checked="false"><span class="truncate">&#39640;&#12356;</span></div>
            <div role="radio" id="xhigh" aria-checked="false"><span class="truncate">&#38750;&#24120;&#12395;&#39640;&#12356;</span></div>
            <div role="radio" id="max" aria-checked="true"><span class="truncate">&#26368;&#22823;</span></div>
            <div data-testid="composer-model-picker-slider-simple-view">
              <span id="thinking-slider" role="slider" aria-valuemin="0" aria-valuemax="4" aria-valuenow="4"></span>
            </div>
          </div>
        </div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
      localStorage.removeItem('oai/apps/tpp/model-settings');
      localStorage.removeItem('oai/apps/tpp/thinking-effort');
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      const api = window.__ARCAIA_MODEL_SELECTOR_UI__;
      api.start();
      api.applyConversationModelConfig({
        conversationId: null,
        modelSlug: 'gpt-5.6-sol-wm',
        thinkingEffort: 'max'
      }, 'work_explicit_performance_fixture');
      api.scan('work_explicit_performance_open');
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-performance') === '最大');

    await page.evaluate(() => {
      document.getElementById('max').setAttribute('aria-checked', 'false');
      document.getElementById('xhigh').setAttribute('aria-checked', 'true');
    });
    await page.waitForTimeout(100);

    assert.equal(
      await page.locator('#model').getAttribute('data-arcaia-model-performance'),
      '非常に高い'
    );
    assert.equal(
      await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().thinkingEffort),
      'xhigh'
    );
  } finally {
    await browser.close();
  }
});

test('Work conversation cold start uses live native trigger authority while conversation detail is unavailable', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button role="radio" data-state="off">Chat</button>
        <button role="radio" data-state="on">Work</button>
        <form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed">
            <span data-animated-slider-trigger="true">
              <span class="foo_SliderTriggerModelLabel_bar">GPT-5.6 Sol</span>
              <span class="foo_SliderTriggerEffortLabel_bar">&#38750;&#24120;&#12395;&#39640;&#12356;</span>
            </span>
            <svg></svg>
          </button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/g/custom-gpt/c/work-cold-start');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
      localStorage.removeItem('oai/apps/tpp/model-settings');
      localStorage.removeItem('oai/apps/tpp/thinking-effort');
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForTimeout(100);

    assert.equal(
      await page.locator('#model').getAttribute('data-arcaia-model-performance'),
      '非常に高い'
    );
    assert.equal(
      await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().thinkingEffort),
      'xhigh'
    );
    const probe = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot());
    assert.equal(probe.resolvedContextKind, 'conversation_work_native_trigger');
    assert.equal(probe.currentStatePresent, true);
    assert.equal(probe.triggerApplied, true);
  } finally {
    await browser.close();
  }
});

test('GPT surface conversation cold start uses matching native performance plus GPT-5.6 cookie while detail is unavailable', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button role="radio" data-state="on">Chat</button>
        <button role="radio" data-state="off">Work</button>
        <form id="composer" data-type="unified-composer">
          <button aria-haspopup="menu"><svg></svg></button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/g/custom-gpt/c/gpt-surface-cold-start');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForTimeout(40);

    await page.evaluate(() => {
      const button = document.createElement('button');
      button.id = 'model';
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('data-state', 'closed');
      button.innerHTML = '<span>&#39640;&#12356;</span><svg></svg>';
      document.getElementById('composer').appendChild(button);
    });

    await page.waitForTimeout(100);
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-version'), 'GPT-5.6');
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-performance'), '高い');
    const probe = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot());
    assert.equal(probe.resolvedContextKind, 'conversation_gpt_surface_cookie_native_match');
    assert.equal(probe.currentStatePresent, true);
    assert.equal(probe.triggerApplied, true);
  } finally {
    await browser.close();
  }
});

test('GPT surface conversation cold start does not use stale GPT-5.6 cookie when native performance disagrees', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button role="radio" data-state="on">Chat</button>
        <button role="radio" data-state="off">Work</button>
        <form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed"><span>&#38750;&#24120;&#12395;&#39640;&#12356;</span><svg></svg></button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/g/custom-gpt/c/gpt-surface-cold-start-mismatch');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForTimeout(100);

    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-version'), null);
    const probe = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot());
    assert.equal(probe.resolvedContextKind, 'conversation_waiting_for_detail');
    assert.equal(probe.currentStatePresent, false);
    assert.equal(probe.triggerApplied, false);
  } finally {
    await browser.close();
  }
});

test('Work thinking slider uses confirmed aria-valuenow when legacy Work storage no longer updates', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button role="radio" data-state="off">Chat</button>
        <button role="radio" data-state="on">Work</button>
        <form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" aria-expanded="true" data-state="open"><span>GPT-5.6 Sol</span><svg></svg></button>
        </form>
        <div role="menu" aria-labelledby="model" data-state="open">
          <div data-testid="composer-intelligence-picker-content">
            <div role="menuitem" aria-expanded="true">Sol</div>
            <div data-testid="composer-model-picker-slider-simple-view">
              <span id="thinking-slider" role="slider" aria-valuemin="0" aria-valuemax="4" aria-valuenow="3"></span>
            </div>
          </div>
        </div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
      localStorage.removeItem('oai/apps/tpp/model-settings');
      localStorage.removeItem('oai/apps/tpp/thinking-effort');
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      const api = window.__ARCAIA_MODEL_SELECTOR_UI__;
      api.start();
      api.applyConversationModelConfig({
        conversationId: null,
        modelSlug: 'gpt-5.6-sol-wm',
        thinkingEffort: 'xhigh'
      }, 'work_slider_fixture');
      api.scan('work_slider_open');
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-performance') === '非常に高い');

    await page.evaluate(() => document.getElementById('thinking-slider').setAttribute('aria-valuenow', '1'));
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator('#model').getAttribute('data-arcaia-model-performance'),
      '非常に高い',
      'slider changes are staged while the picker remains open'
    );
    await page.evaluate(() => {
      const model = document.getElementById('model');
      model.setAttribute('aria-expanded', 'false');
      model.setAttribute('data-state', 'closed');
      document.querySelector('[role="menu"]')?.remove();
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-performance') === '中程度');
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.scan('after_work_picker_removed'));
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-performance'), '中程度');
    const status = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus());
    assert.equal(status.thinkingEffort, 'standard');
  } finally {
    await browser.close();
  }
});

test('Chat thinking slider uses the same confirmed aria-valuenow path', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button role="radio" data-state="on">Chat</button>
        <button role="radio" data-state="off">Work</button>
        <form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" aria-expanded="true" data-state="open"><span>GPT-5.6 Sol</span><svg></svg></button>
        </form>
        <div role="menu" aria-labelledby="model" data-state="open">
          <div data-testid="composer-intelligence-picker-content">
            <div role="menuitem" data-has-submenu>GPT-5.6 Sol</div>
            <div data-testid="composer-model-picker-slider-simple-view">
              <span id="thinking-slider" role="slider" aria-valuemin="0" aria-valuemax="4" aria-valuenow="3"></span>
            </div>
          </div>
        </div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'xhigh' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      const api = window.__ARCAIA_MODEL_SELECTOR_UI__;
      api.start();
      api.applyConversationModelConfig({
        conversationId: null,
        modelSlug: 'gpt-5.6-sol-wm',
        thinkingEffort: 'xhigh'
      }, 'chat_slider_fixture');
      api.scan('chat_slider_open');
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-performance') === '非常に高い');

    await page.evaluate(() => document.getElementById('thinking-slider').setAttribute('aria-valuenow', '1'));
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-performance'), '非常に高い');
    await page.evaluate(() => {
      const model = document.getElementById('model');
      model.setAttribute('aria-expanded', 'false');
      model.setAttribute('data-state', 'closed');
      document.querySelector('[role="menu"]')?.remove();
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-performance') === '中程度');
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.scan('after_chat_picker_removed'));
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-performance'), '中程度');
    const status = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus());
    assert.equal(status.thinkingEffort, 'standard');
    assert.equal(status.modelSuffix, 'Sol');
  } finally {
    await browser.close();
  }
});

test('ambiguous GPT-5 conversation detail preserves confirmed GPT-5.6 until an explicit model replaces it', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <form data-type="unified-composer">
          <button id="model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg></svg></button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/c/ambiguous-model-conversation');
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      window.__ARCAIA_MODEL_SELECTOR_UI__.start();
      window.__ARCAIA_MODEL_SELECTOR_UI__.applyConversationModelConfig({
        conversationId: 'ambiguous-model-conversation',
        modelSlug: 'gpt-5.6-sol-wm',
        thinkingEffort: 'extended'
      }, 'confirmed_gpt56');
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');

    for (const modelSlug of ['gpt-5-thinking-alias', 'gpt-5-sol-wm']) {
      await page.evaluate((slug) => window.__ARCAIA_MODEL_SELECTOR_UI__.applyConversationModelConfig({
        conversationId: 'ambiguous-model-conversation',
        modelSlug: slug,
        thinkingEffort: 'extended'
      }, 'ambiguous_detail'), modelSlug);
      assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), 'true');
      assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), 'GPT-5.6');
    }

    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.applyConversationModelConfig({
      conversationId: 'ambiguous-model-conversation',
      modelSlug: 'gpt-5-5-thinking',
      thinkingEffort: 'extended'
    }, 'explicit_gpt55'));
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), null);
    assert.equal(await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getStatus().modelVersion), null);
  } finally {
    await browser.close();
  }
});

test('new unlabeled Chat model trigger is identified structurally without touching the plus menu', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button role="radio" data-state="on">Chat</button>
        <button role="radio" data-state="off">Work</button>
        <form data-type="unified-composer">
          <button id="plus" aria-haspopup="menu" aria-label="Add" data-testid="composer-plus-button"><svg></svg></button>
          <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed"><span></span><svg></svg></button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');

    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-version'), 'GPT-5.6');
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-performance'), '高い');
    assert.equal(await page.locator('#plus').getAttribute('data-arcaia-model-rich'), null);
    const probe = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot());
    assert.equal(probe.triggerFound, true);
    assert.equal(probe.triggerApplied, true);
  } finally {
    await browser.close();
  }
});

test('new Chat promotion survives one immediate conversation rekey from history.replaceState before detail arrives', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <button role="radio" data-state="on">Chat</button>
        <button role="radio" data-state="off">Work</button>
        <div id="composer-host">
          <form data-type="unified-composer">
            <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed"><span></span><svg></svg></button>
          </form>
        </div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'high' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');

    const results = await page.evaluate(() => {
      const api = window.__ARCAIA_MODEL_SELECTOR_UI__;
      history.replaceState({}, '', '/c/provisional-conversation');
      const promoted = api.resetForNavigation({ reason: 'history_replaceState' });
      api.scan('after_initial_promotion');
      history.replaceState({}, '', '/c/final-conversation');
      const rekeyed = api.resetForNavigation({ reason: 'history_replaceState' });
      api.scan('after_conversation_rekey');
      return { promoted, rekeyed, probe: api.getProbeSnapshot() };
    });

    assert.equal(results.promoted, false);
    assert.equal(results.rekeyed, false);
    assert.equal(results.probe.currentStatePresent, true);
    assert.equal(results.probe.currentStateContextMatchesCurrent, true);
    assert.equal(results.probe.confirmedComposerStatePresent, true);
    assert.equal(results.probe.confirmedComposerContextMatchesCurrent, true);
    assert.equal(results.probe.navigationResetHistory.at(-2)?.decisionReason, 'new_chat_promotion');
    assert.equal(results.probe.navigationResetHistory.at(-1)?.decisionReason, 'new_chat_promotion_rekey');
    assert.equal(results.probe.navigationResetHistory.at(-1)?.conditions?.promotedConversationRekey, true);
    assert.equal(await page.locator('#model').getAttribute('data-arcaia-model-rich'), 'true');

    const unrelated = await page.evaluate(() => {
      document.getElementById('composer-host').innerHTML = `
        <form data-type="unified-composer">
          <button id="other-model" aria-haspopup="menu" aria-expanded="false" data-state="closed"><span></span><svg></svg></button>
        </form>
      `;
      history.replaceState({}, '', '/c/unrelated-conversation');
      return {
        reset: window.__ARCAIA_MODEL_SELECTOR_UI__.resetForNavigation({ reason: 'history_replaceState' }),
        probe: window.__ARCAIA_MODEL_SELECTOR_UI__.getProbeSnapshot()
      };
    });
    assert.equal(unrelated.reset, true);
    assert.equal(unrelated.probe.currentStatePresent, false);
    assert.equal(unrelated.probe.navigationResetHistory.at(-1)?.decisionReason, 'no_preserve_condition');
  } finally {
    await browser.close();
  }
});

test('model selector diagnostic correlates events with sanitized authoritative sources', () => {
  assert.match(diagnosticSource, /const CHATGPT_LAST_MODEL_COOKIE = 'oai-last-model-config'/);
  assert.match(diagnosticSource, /const WORK_MODEL_SETTINGS_STORAGE_KEY = 'oai\/apps\/tpp\/model-settings'/);
  assert.match(diagnosticSource, /data\.eventType !== 'current_conversation_model_config'/);
  assert.match(diagnosticSource, /type: 'authoritative_state_event'/);
  assert.match(diagnosticSource, /authorities: getAuthoritySnapshot\(\)/);
  assert.match(diagnosticSource, /Raw cookie\/storage values, conversation IDs, and conversation text are not collected/);
});
