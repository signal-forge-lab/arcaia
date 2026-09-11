const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { launchBrowser } = require('../tools/playwright_browser');

const root = path.join(__dirname, '..', 'tools', 'arcaia_assistant_render_gap_watch_probe_extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

const SOURCE = 'arcaia-assistant-render-gap-watch-v1';

function conversationPayload(finalText) {
  return {
    current_node: 'a2',
    mapping: {
      root: { id: 'root', parent: null, children: ['u1'], message: null },
      u1: {
        id: 'u1', parent: 'root', children: ['think'],
        message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['USER PRIVATE'] }, recipient: 'all' }
      },
      think: {
        id: 'think', parent: 'u1', children: ['tool'],
        message: { author: { role: 'assistant' }, content: { content_type: 'thoughts', parts: ['THINKING PRIVATE'] }, recipient: 'tool' }
      },
      tool: {
        id: 'tool', parent: 'think', children: ['a2'],
        message: { author: { role: 'tool' }, content: { content_type: 'tool_result', parts: ['TOOL PRIVATE'] }, recipient: 'all' }
      },
      a2: {
        id: 'a2', parent: 'tool', children: [],
        message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: [finalText] }, recipient: 'all', status: 'finished_successfully' }
      }
    }
  };
}

test('assistant render-gap watch probe is a persistent standalone extension with bounded privacy', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.icons['128'], 'icons/main/icon128.png');
  assert.equal(manifest.action.default_icon['32'], 'icons/toolbar/icon32.png');
  for (const kind of ['main', 'toolbar']) {
    for (const size of [16, 32, 48, 128]) {
      const png = fs.readFileSync(path.join(root, 'icons', kind, `icon${size}.png`));
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
    }
  }
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.deepEqual(manifest.content_scripts[0].js, ['main.js']);
  assert.equal(manifest.content_scripts[1].run_at, 'document_start');
  assert.deepEqual(manifest.content_scripts[1].js, ['content.js']);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.match(mainSource, /Response\.prototype\.text/);
  assert.match(mainSource, /Response\.prototype\.json/);
  assert.match(mainSource, /lite_rewrite_success/);
  assert.match(contentSource, /MutationObserver/);
  assert.doesNotMatch(`${mainSource}\n${contentSource}`, /setInterval\s*\(/);
  assert.match(backgroundSource, /MAX_EVENTS = 80/);
  assert.match(backgroundSource, /MAX_INCIDENTS = 8/);
  assert.match(readme, /会話本文/);
  assert.match(readme, /会話ID/);
  assert.match(readme, /URL全文/);
  assert.match(popupSource, /JSON保存/);
});

test('MAIN probe summarizes raw and rewritten conversation payloads without retaining text', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    const rawFinal = 'R'.repeat(720);
    const rewrittenFinal = 'R'.repeat(120);
    await page.route('https://chatgpt.test/**', (route) => {
      const url = route.request().url();
      if (url.includes('/backend-api/conversation/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(conversationPayload(rawFinal))
        });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate((sourceName) => {
      window.__renderGapMainEvents = [];
      window.addEventListener('message', (event) => {
        if (event.source === window && event.data?.source === sourceName) window.__renderGapMainEvents.push(event.data);
      });
    }, SOURCE);
    await page.addScriptTag({ content: mainSource });

    await page.evaluate(async ({ rewritten }) => {
      const response = await fetch('/backend-api/conversation/private-conversation-id');
      await response.text();
      new Response(JSON.stringify(rewritten), { headers: { 'content-type': 'application/json' } });
      await new Promise((resolve) => setTimeout(resolve, 30));
    }, { rewritten: conversationPayload(rewrittenFinal) });

    const events = await page.evaluate(() => window.__renderGapMainEvents);
    const raw = events.find((entry) => entry.type === 'RAW_CONVERSATION_SUMMARY')?.payload;
    const rewritten = events.find((entry) => entry.type === 'CONSTRUCTED_CONVERSATION_SUMMARY')?.payload;
    assert.equal(raw.finalAssistantTextLength, rawFinal.length);
    assert.equal(raw.toolLikeNodeCount >= 2, true);
    assert.equal(raw.thinkingLikeNodeCount >= 1, true);
    assert.equal(raw.userTurnCount, 1);
    assert.equal(rewritten.finalAssistantTextLength, rewrittenFinal.length);
    assert.equal(rewritten.mappingNodeCount, 5);
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes('USER PRIVATE'), false);
    assert.equal(serialized.includes('THINKING PRIVATE'), false);
    assert.equal(serialized.includes('TOOL PRIVATE'), false);
    assert.equal(serialized.includes('private-conversation-id'), false);
  } finally {
    await browser.close();
  }
});

test('DOM watcher marks a finished latest assistant whose visible text shrinks sharply', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>
      <main id="main"><div data-scroll-root>
        <section data-testid="conversation-turn-1"><div data-message-author-role="user">question</div></section>
        <section data-testid="conversation-turn-2" data-turn="assistant"><div id="answer" data-message-author-role="assistant">${'A'.repeat(700)}</div></section>
      </div></main>
    </body></html>`);
    await page.evaluate((sourceName) => {
      window.__renderGapMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__renderGapMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      window.__probeSourceName = sourceName;
    }, SOURCE);
    await page.addScriptTag({ content: contentSource });
    await page.waitForFunction(() => window.__renderGapMessages.some((entry) => entry?.event?.type === 'dom_snapshot'));
    await page.evaluate(() => { document.getElementById('answer').textContent = 'A'.repeat(90); });
    await page.waitForFunction(() => window.__renderGapMessages.some((entry) => entry?.event?.type === 'incident'));
    const messages = await page.evaluate(() => window.__renderGapMessages);
    const incident = messages.find((entry) => entry?.event?.type === 'incident')?.event?.incident;
    assert.equal(incident.kind, 'assistant_text_shrank_after_render');
    assert.equal(incident.beforeAssistantTextLength, 700);
    assert.equal(incident.afterAssistantTextLength, 90);
    assert.equal(JSON.stringify(messages).includes('A'.repeat(90)), false);
  } finally {
    await browser.close();
  }
});

test('background marks a reload that restores substantially more text for the same latest turn', async () => {
  let stored = {};
  let messageListener = null;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const chrome = {
    storage: {
      local: {
        async get(key) { return key in stored ? { [key]: clone(stored[key]) } : {}; },
        async set(values) { stored = { ...stored, ...clone(values) }; }
      }
    },
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText() {},
      async setTitle() {}
    },
    runtime: {
      onMessage: { addListener(listener) { messageListener = listener; } },
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} }
    }
  };
  vm.runInNewContext(backgroundSource, { chrome, console, setTimeout, clearTimeout });
  assert.equal(typeof messageListener, 'function');

  async function send(event) {
    await new Promise((resolve, reject) => {
      const keepAlive = messageListener({ source: SOURCE, type: 'PROBE_EVENT', event }, { tab: { id: 44 } }, (response) => {
        if (response?.ok) resolve();
        else reject(new Error(response?.error || 'send failed'));
      });
      assert.equal(keepAlive, true);
    });
  }

  await send({ type: 'probe_started', sessionId: 'before-reload', navigationType: 'navigate', atIso: '2026-08-17T01:44:00.000Z' });
  await send({ type: 'dom_snapshot', sessionId: 'before-reload', atIso: '2026-08-17T01:45:00.000Z', snapshot: { userTurnCount: 44, assistantTextLength: 150, assistantTurnTextLength: 210, streamActive: false } });
  await send({ type: 'probe_started', sessionId: 'after-reload', navigationType: 'reload', atIso: '2026-08-17T01:46:00.000Z' });
  await send({ type: 'dom_snapshot', sessionId: 'after-reload', atIso: '2026-08-17T01:46:01.000Z', snapshot: { userTurnCount: 44, assistantTextLength: 920, assistantTurnTextLength: 980, streamActive: false } });

  const tab = stored.arcaiaAssistantRenderGapWatchReportV1.tabs['44'];
  assert.equal(tab.marked, true);
  assert.equal(tab.lastIncident.kind, 'reload_restored_assistant_content');
  assert.equal(tab.lastIncident.beforeAssistantTextLength, 150);
  assert.equal(tab.lastIncident.afterAssistantTextLength, 920);
  assert.equal(tab.incidents.length, 1);
});
