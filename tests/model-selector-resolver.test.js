const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '..', 'content_model_selector.js'), 'utf8');
const diagnosticSource = fs.readFileSync(path.join(__dirname, '..', 'tools', 'model_selector_dom_diagnostic.js'), 'utf8');

test('model selector follows new Chat and Work authoritative state without cross-surface carryover', async () => {
  const browser = await chromium.launch({ headless: true });
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
      richText: '✦GPT-5.6Sol高い',
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
      richText: '✦GPT-5.6Sol非常に高い',
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
      richText: '✦GPT-5.6Terra中程度',
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
      richText: '✦GPT-5.6Terra中程度',
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
      richText: '✦GPT-5.6Sol高い',
      source: 'new_chat_cookie_last_model_config',
      surface: 'chatgpt'
    });
  } finally {
    await browser.close();
  }
});

test('model selector does not promote click intent until the picker confirms the checked state', async () => {
  const browser = await chromium.launch({ headless: true });
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
  const browser = await chromium.launch({ headless: true });
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
  const browser = await chromium.launch({ headless: true });
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
                <button id="model" aria-haspopup="menu"><span>&#20013;&#31243;&#24230;</span><svg></svg></button>
              </form>
              <span id="unrelated-slider" role="slider" aria-valuenow="2"></span>
              <div role="menu" aria-labelledby="model" data-state="open">
                <div data-testid="composer-intelligence-picker-content">
                  <div role="menuitem" data-has-submenu>GPT-5.6 Sol</div>
                  <div role="menuitemradio" aria-checked="true"><span class="truncate">&#20013;&#31243;&#24230;</span></div>
                  <div data-testid="composer-model-picker-slider-simple-view">
                    <span id="thinking-slider" role="slider" aria-valuemin="0" aria-valuemax="4" aria-valuenow="2"></span>
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
      localStorage.setItem('oai/apps/tpp/model-settings', JSON.stringify({ lastUsedModelSlug: 'gpt-5.6-sol-wm' }));
      localStorage.setItem('oai/apps/tpp/thinking-effort', JSON.stringify('standard'));
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
      localStorage.setItem('oai/apps/tpp/thinking-effort', JSON.stringify('min'));
      document.getElementById('unrelated-slider').setAttribute('aria-valuenow', '1');
    });
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator('#model').getAttribute('data-arcaia-model-performance'),
      '非常に高い',
      'a slider outside the observed picker must not trigger an update'
    );

    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/thinking-effort', JSON.stringify('standard'));
      document.getElementById('thinking-slider').setAttribute('aria-valuenow', '3');
    });
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator('#model').getAttribute('data-arcaia-model-performance'),
      '非常に高い',
      'slider DOM intent alone must not become confirmed state'
    );

    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/thinking-effort', JSON.stringify('min'));
      document.getElementById('thinking-slider').setAttribute('aria-valuenow', '1');
    });
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator('#model').getAttribute('data-arcaia-model-performance'),
      '非常に高い',
      'confirmed DOM and storage are staged while the picker remains open'
    );

    await page.evaluate(() => {
      const model = document.getElementById('model');
      model.setAttribute('aria-expanded', 'false');
      model.setAttribute('data-state', 'closed');
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-performance') === '軽');
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
    assert.deepEqual({
      performance: result.performance,
      thinkingEffort: result.thinkingEffort,
      source: result.source
    }, {
      performance: '軽',
      thinkingEffort: 'min',
      source: 'work_local_storage_current'
    });
    assert.equal(result.reason, 'work_thinking_effort_focusout_confirmed');
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
