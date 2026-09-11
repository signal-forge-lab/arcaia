const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('../tools/playwright_browser');

const injectedSource = fs.readFileSync(path.join(__dirname, '..', 'injected-main.js'), 'utf8');
const conversationId = '6a53d9a3-6718-83ee-8165-6f4441d06014';
const projectId = 'g-p-6a3d50e8b5248191a2441ce6173c5641';

function conversationPayload() {
  const mapping = {
    root: {
      id: 'root',
      parent: null,
      children: ['user-1'],
      message: null
    }
  };
  let previousId = 'root';
  for (let turn = 1; turn <= 8; turn += 1) {
    const userId = `user-${turn}`;
    const assistantId = `assistant-${turn}`;
    mapping[userId] = {
      id: userId,
      parent: previousId,
      children: [assistantId],
      message: {
        id: `${userId}-message`,
        author: { role: 'user' },
        create_time: 1700000000 + turn * 2,
        content: { content_type: 'text', parts: [`question ${turn}`] },
        metadata: {}
      }
    };
    mapping[assistantId] = {
      id: assistantId,
      parent: userId,
      children: turn < 8 ? [`user-${turn + 1}`] : [],
      message: {
        id: `${assistantId}-message`,
        author: { role: 'assistant' },
        create_time: 1700000001 + turn * 2,
        content: { content_type: 'text', parts: [`answer ${turn}`] },
        metadata: {
          model_slug: 'gpt-5-6-thinking',
          thinking_effort: 'extended'
        },
        recipient: 'all'
      }
    };
    previousId = assistantId;
  }
  return {
    conversation_id: conversationId,
    current_node: 'assistant-8',
    mapping
  };
}

test('history search bypass keeps the full response and restores Lite after the query is removed', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    const payload = conversationPayload();
    await page.route('https://chatgpt.com/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/backend-api/conversation/')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
        return;
      }
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><main>history search test</main></body></html>'
      });
    });

    const searchPath = `/g/${projectId}/c/${conversationId}?src=history_search&messageId=message-1&historySearchQuery=test`;
    await page.goto(`https://chatgpt.com${searchPath}`);
    await page.evaluate((id) => {
      sessionStorage.setItem('__AICE_LITE_DISPLAY_CONFIG__', JSON.stringify({
        appVersion: '0.1.242',
        enabled: true,
        conversationId: id,
        userDisabled: false,
        backendRewriteEnabled: true,
        liteShowImages: true,
        turnCount: 3,
        configSource: 'popup_enable'
      }));
    }, conversationId);
    await page.addScriptTag({ content: injectedSource });

    const historySearchResult = await page.evaluate(async (id) => {
      const response = await fetch(`/backend-api/conversation/${id}`);
      const body = await response.json();
      const state = window.__AICE_PROBE_MAIN_STATE_V40__;
      return {
        mappingNodeCount: Object.keys(body.mapping || {}).length,
        liteDisplay: state.publicSnapshot().mainWorldHook.liteDisplay,
        stored: JSON.parse(sessionStorage.getItem('__AICE_LITE_DISPLAY_CONFIG__'))
      };
    }, conversationId);

    assert.equal(historySearchResult.mappingNodeCount, Object.keys(payload.mapping).length);
    assert.equal(historySearchResult.liteDisplay.enabled, false);
    assert.equal(historySearchResult.liteDisplay.historySearchBypass, true);
    assert.equal(historySearchResult.liteDisplay.configSource, 'history_search_bypass');
    assert.equal(historySearchResult.stored.userDisabled, false);
    assert.equal(historySearchResult.stored.enabled, true);

    await page.evaluate((pathWithoutSearch) => {
      history.replaceState({}, '', pathWithoutSearch);
    }, `/g/${projectId}/c/${conversationId}`);
    await page.waitForTimeout(30);

    const normalResult = await page.evaluate(async (id) => {
      const state = window.__AICE_PROBE_MAIN_STATE_V40__;
      const beforeFetch = state.publicSnapshot().mainWorldHook.liteDisplay;
      const response = await fetch(`/backend-api/conversation/${id}`);
      const body = await response.json();
      return {
        beforeFetch,
        mappingNodeCount: Object.keys(body.mapping || {}).length,
        stored: JSON.parse(sessionStorage.getItem('__AICE_LITE_DISPLAY_CONFIG__'))
      };
    }, conversationId);

    assert.equal(normalResult.beforeFetch.enabled, true);
    assert.equal(normalResult.beforeFetch.historySearchBypass, false);
    assert.ok(normalResult.mappingNodeCount < Object.keys(payload.mapping).length);
    assert.equal(normalResult.stored.enabled, true);
    assert.equal(normalResult.stored.userDisabled, false);
  } finally {
    await browser.close();
  }
});
