const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { launchBrowser } = require('../tools/playwright_browser');

const root = path.join(__dirname, '..', 'tools', 'arcaia_model_decoration_watch_probe_extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const runtimeContentSource = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const modelSelectorSource = fs.readFileSync(path.join(__dirname, '..', 'content_model_selector.js'), 'utf8');

function featureMessages(messages, type) {
  return messages
    .map((entry) => entry?.event)
    .filter((event) => event?.type === type);
}

test('watch probe is a standalone document_start extension with toolbar-only marking', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.0.28');
  assert.equal(manifest.icons['128'], 'icons/main/icon128.png');
  assert.equal(manifest.action.default_icon['32'], 'icons/toolbar/icon32.png');
  for (const kind of ['main', 'toolbar']) {
    for (const size of [16, 32, 48, 128]) {
      const png = fs.readFileSync(path.join(root, 'icons', kind, `icon${size}.png`));
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
    }
  }
  assert.equal(manifest.permissions.includes('scripting'), true);
  assert.equal(manifest.permissions.includes('activeTab'), true);
  assert.match(backgroundSource, /const PROBE_VERSION = '1\.0\.28'/);
  assert.match(popupSource, /const PROBE_VERSION = '1\.0\.28'/);
  assert.match(mainSource, /REARM_CONVERSATION_CAPTURE/);
  assert.match(contentSource, /REARM_CONVERSATION_CAPTURE/);
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
  assert.deepEqual(manifest.content_scripts[0].js, ['main.js']);
  assert.equal(manifest.content_scripts[1].run_at, 'document_start');
  assert.deepEqual(manifest.content_scripts[1].js, ['content.js']);
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.match(backgroundSource, /chrome\.action\.setBadgeText/);
  assert.match(backgroundSource, /text: marked \? '!' : ''/);
  assert.match(backgroundSource, /chrome\.runtime\.onStartup\.addListener/);
  assert.match(backgroundSource, /restoreMarkedBadges/);
  assert.match(popupSource, /MODEL DECORATION LOST/);
  assert.match(popupHtml, /ページ上にはマークを表示しません/);
  assert.doesNotMatch(contentSource, /MODEL DECORATION LOST|position:\s*fixed|appendChild\([^)]*marker/i);
});

test('watch probe records native versus Arcaia performance mismatch in one diagnostic state', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><style id="arcaia-model-selector-rich-style"></style></head><body>
        <form data-type="unified-composer">
          <button id="model" type="button" aria-haspopup="menu" aria-expanded="true" data-state="open"
            data-arcaia-model-rich="true" data-arcaia-model-version="GPT-5.6" data-arcaia-model-performance="&#26368;&#22823;">
            <span data-arcaia-model-native-label="true">&#39640;&#12356;</span>
            <span data-arcaia-model-rich-content="true"><span>GPT-5.6</span><span>&#26368;&#22823;</span></span>
          </button>
        </form>
        <div role="menu" data-state="open" aria-labelledby="model">
          <div data-testid="composer-intelligence-picker-content">
            <div role="menuitemradio" aria-checked="true">&#39640;&#12356;</div>
          </div>
        </div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => {
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      (0, eval)(source);
    }, contentSource);
    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.type === 'incident'
      && entry?.event?.incident?.kind === 'wrong_decoration_value'
    )));
    const incident = featureMessages(await page.evaluate(() => window.__probeMessages), 'incident')
      .find((item) => item.incident?.kind === 'wrong_decoration_value');
    assert.equal(incident.incident.displayState.native.performance, '高い');
    assert.equal(incident.incident.displayState.arcaia.performance, '最大');
    assert.equal(incident.incident.displayState.decoration, 'applied');
    assert.equal(incident.incident.displayState.comparison, 'performance_mismatch');
  } finally {
    await browser.close();
  }
});

test('watch probe captures privacy-bounded plain conversation cold-start model authority candidates', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <form data-type="unified-composer">
          <button id="model-mode" aria-haspopup="menu" data-testid="composer-model-button"><span>5.6</span><svg></svg></button>
          <button id="performance" aria-haspopup="menu" data-state="closed"><span>&#39640;&#12356;</span><svg></svg></button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/c/plain-conversation');
    const result = await page.evaluate(async (source) => {
      localStorage.setItem('oai/apps/tpp/model-view', JSON.stringify({
        currentModelSlug: 'gpt-5.6-thinking',
        thinkingEffort: 'extended',
        privateValue: 'PRIVATE MODEL VIEW CONTENT'
      }));
      let listener = null;
      window.chrome = {
        runtime: {
          sendMessage() { return Promise.resolve({ ok: true }); },
          onMessage: { addListener(fn) { listener = fn; } }
        }
      };
      (0, eval)(source);
      return await new Promise((resolve) => {
        listener(
          { source: 'arcaia-model-decoration-watch-v1', type: 'CAPTURE_NOW' },
          {},
          resolve
        );
      });
    }, contentSource);

    assert.equal(result.ok, true);
    const authority = result.snapshot.conversationColdStartAuthority;
    assert.equal(authority.eligible, true);
    assert.equal(authority.menuButtonSignals.some((item) => item.bareGpt56SignalPresent), true);
    assert.equal(authority.menuButtonSignals.some((item) => item.performance === '高い'), true);
    assert.equal(authority.storageSignals.some((item) => (
      item.keyName === 'oai/apps/tpp/model-view'
      && item.gpt56SignalPresent
      && item.thinkingEffort === 'extended'
    )), true);
    assert.equal(authority.modelSignalFound, true);
    assert.equal(authority.thinkingSignalFound, true);
    assert.equal(authority.authoritySignalFound, true);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /gpt-5\.6-thinking|PRIVATE MODEL VIEW CONTENT|privateValue/);
  } finally {
    await browser.close();
  }
});

test('plain conversation catalog entries are not treated as current model authority', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <form data-type="unified-composer">
          <button id="mode" aria-haspopup="menu" data-testid="composer-mode"><svg></svg></button>
          <button id="performance" aria-haspopup="menu" data-state="closed"><span>&#39640;&#12356;</span><svg></svg></button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/c/plain-conversation');
    const result = await page.evaluate(async (source) => {
      localStorage.setItem(
        'cache/user-Ka5cQVXIyQDRucYsJOIrGvan/0075038d-d9dd-4353-bcde-0c40eb795e75/models',
        JSON.stringify({ value: { defaultModelSlug: 'gpt-5.6-thinking', models: ['gpt-5.6-thinking'] } })
      );
      let listener = null;
      window.chrome = {
        runtime: {
          sendMessage() { return Promise.resolve({ ok: true }); },
          onMessage: { addListener(fn) { listener = fn; } }
        }
      };
      (0, eval)(source);
      return await new Promise((resolve) => {
        listener(
          { source: 'arcaia-model-decoration-watch-v1', type: 'CAPTURE_NOW' },
          {},
          resolve
        );
      });
    }, contentSource);

    const authority = result.snapshot.conversationColdStartAuthority;
    assert.equal(authority.menuButtonSignals.some((item) => item.performance === '高い'), true);
    assert.equal(authority.storageSignals.some((item) => item.gpt56SignalPresent), true);
    assert.equal(authority.modelSignalFound, false);
    assert.equal(authority.thinkingSignalFound, true);
    assert.equal(authority.authoritySignalFound, false);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /Ka5cQVXIyQDRucYsJOIrGvan|0075038d-d9dd-4353-bcde-0c40eb795e75/);
  } finally {
    await browser.close();
  }
});

test('plain conversation manual capture waits for MAIN-world current model survey', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <form data-type="unified-composer">
          <button id="mode" aria-haspopup="menu"><span>Mode</span><svg></svg></button>
          <button id="performance" aria-haspopup="menu" data-state="closed"><span>&#39640;&#12356;</span><svg></svg></button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/c/plain-conversation');
    await page.evaluate(() => {
      document.getElementById('mode').__reactProps$probe = {
        currentModelSlug: 'gpt-5.6-thinking',
        thinkingEffort: 'extended',
        privateValue: 'PRIVATE REACT CONTENT'
      };
    });
    await page.addScriptTag({ content: mainSource });
    const result = await page.evaluate(async (source) => {
      let listener = null;
      window.chrome = {
        runtime: {
          sendMessage() { return Promise.resolve({ ok: true }); },
          onMessage: { addListener(fn) { listener = fn; } }
        }
      };
      (0, eval)(source);
      const response = new Promise((resolve) => {
        const keepAlive = listener(
          { source: 'arcaia-model-decoration-watch-v1', type: 'CAPTURE_NOW' },
          {},
          resolve
        );
        window.__captureKeepAlive = keepAlive;
      });
      const value = await response;
      return { value, keepAlive: window.__captureKeepAlive };
    }, contentSource);

    assert.equal(result.keepAlive, true);
    assert.equal(result.value.ok, true);
    assert.equal(result.value.snapshot.mainWorldAuthority.react.gpt56SignalPresent, true);
    assert.equal(result.value.snapshot.mainWorldAuthority.react.thinkingEffort, 'extended');
    assert.doesNotMatch(JSON.stringify(result), /gpt-5\.6-thinking|PRIVATE REACT CONTENT|privateValue/);
  } finally {
    await browser.close();
  }
});

test('popup repairs a missing static content-script connection on the active ChatGPT tab', () => {
  assert.match(popupSource, /PING_PROBE/);
  assert.match(popupSource, /chrome\.scripting\.executeScript/);
  assert.match(popupSource, /files:\s*\['main\.js'\]/);
  assert.match(popupSource, /world:\s*'MAIN'/);
  assert.match(popupSource, /files:\s*\['content\.js'\]/);
  assert.match(contentSource, /PING_PROBE/);
  assert.match(contentSource, /__arcaiaModelDecorationWatchProbeContent/);
  assert.match(mainSource, /__arcaiaModelDecorationWatchProbeMain/);
  assert.match(popupSource, /let probeConnectionState = 'unknown'/);
  assert.match(popupSource, /probeConnectionState = await ensureProbeConnection\(tab\)/);
  assert.match(popupSource, /current\?\.ok === true && current\.version === PROBE_VERSION/);
  assert.match(popupSource, /repaired\?\.ok === true && repaired\.version === PROBE_VERSION/);
  assert.match(popupSource, /probeConnectionState === 'connected' && !tabReport/);
  assert.match(popupSource, /status = 'repair_failed'/);
  assert.match(popupSource, /probeは起動済みです。記録待ちです/);
  assert.match(popupSource, /再注入後もprobeへ接続できません/);
});

test('probe background preserves concurrent events instead of losing read-modify-write updates', async () => {
  let stored = {};
  let messageListener = null;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const chrome = {
    storage: {
      local: {
        async get(key) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          return key in stored ? { [key]: clone(stored[key]) } : {};
        },
        async set(values) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          stored = { ...stored, ...clone(values) };
        }
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

  const send = (sequence) => new Promise((resolve, reject) => {
    const keepAlive = messageListener({
      source: 'arcaia-model-decoration-watch-v1',
      type: 'PROBE_EVENT',
      event: {
        type: `event_${sequence}`,
        sequence,
        sessionId: 'concurrent-test',
        atIso: `2026-08-12T13:21:3${sequence}.000Z`
      }
    }, { tab: { id: 77 } }, (response) => {
      if (response?.ok) resolve(response);
      else reject(new Error(response?.error || 'probe event failed'));
    });
    assert.equal(keepAlive, true);
  });

  await Promise.all([send(1), send(2), send(3)]);
  const report = stored.arcaiaModelDecorationWatchReportV1;
  assert.deepEqual(report.tabs['77'].events.map((event) => event.sequence), [1, 2, 3]);
});

test('MAIN-world survey captures React ancestry, bounded IndexedDB semantics, and resource categories without raw values', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => {
      const isApi = route.request().url().endsWith('/api/work-state');
      return route.fulfill({
        status: 200,
        contentType: isApi ? 'application/json' : 'text/html',
        body: isApi
          ? JSON.stringify({ currentModelSlug: 'gpt-5.6-sol-wm', thinkingEffort: 'max', privateValue: 'PRIVATE NETWORK CONTENT' })
          : `<!doctype html><html><body>
        <button role="radio" data-state="off">Chat</button>
        <button role="radio" data-state="on">Work</button>
        <div><form id="composer" data-type="unified-composer">
          <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed">
            <span data-animated-slider-trigger="true"><span id="effort-label" class="hash_SliderTriggerEffortLabel"></span></span><svg></svg>
          </button>
        </form></div>
      </body></html>`
      });
    });
    await page.goto('https://chatgpt.test/');

    await page.evaluate(async () => {
      const model = document.getElementById('model');
      const effortLabel = document.getElementById('effort-label');
      const ancestor = document.getElementById('composer');
      model.__reactProps$probe = {
        presentation: { modelSlug: 'gpt-5.6-sol-wm' },
        children: 'PRIVATE REACT CHILD CONTENT'
      };
      effortLabel.__reactProps$probe = { thinkingEffort: 'xhigh', privateValue: 'PRIVATE DESCENDANT CONTENT' };
      ancestor.__reactFiber$probe = {
        memoizedProps: { config: { thinkingEffort: 'max' } },
        memoizedState: { privateValue: 'PRIVATE FIBER CONTENT' }
      };
      window.workModelRuntimeState = {
        currentModelSlug: 'gpt-5.6-sol-wm',
        thinkingEffort: 'max',
        privateValue: 'PRIVATE GLOBAL CONTENT'
      };
      history.replaceState({ modelSlug: 'gpt-5.6-sol-wm', thinkingEffort: 'max', privateValue: 'PRIVATE HISTORY CONTENT' }, '', '/');

      await new Promise((resolve, reject) => {
        const request = indexedDB.open('probe-authority-db', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('cache');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('cache', 'readwrite');
          tx.objectStore('cache').put({
            nested: {
              modelSlug: 'gpt-5.6-sol-wm',
              thinkingEffort: 'max',
              privateValue: 'PRIVATE INDEXEDDB CONTENT'
            }
          }, 'row-1');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });

      performance.mark('probe-resource-marker');
    });

    await page.addScriptTag({ content: mainSource });
    await page.evaluate(() => {
      const downstreamFetch = window.fetch;
      window.__downstreamFetchCalls = 0;
      window.fetch = async function (...args) {
        window.__downstreamFetchCalls += 1;
        return downstreamFetch.apply(this, args);
      };
    });
    await page.click('button[role="radio"]:has-text("Work")');
    await page.evaluate(() => fetch('/api/work-state').then((response) => response.json()));
    await page.waitForTimeout(30);
    const result = await page.evaluate(() => new Promise((resolve) => {
      const requestId = `survey-${Date.now()}`;
      const listener = (event) => {
        if (
          event.source !== window
          || event.data?.source !== 'arcaia-model-decoration-watch-v1'
          || event.data?.type !== 'ARCAIA_MODEL_DECORATION_MAIN_SURVEY_RESPONSE'
          || event.data?.requestId !== requestId
        ) return;
        window.removeEventListener('message', listener);
        resolve(event.data.payload);
      };
      window.addEventListener('message', listener);
      window.postMessage({
        source: 'arcaia-model-decoration-watch-v1',
        type: 'ARCAIA_MODEL_DECORATION_MAIN_SURVEY_REQUEST',
        requestId,
        phase: 'test_deep',
        includeIndexedDb: true
      }, '*');
    }));

    assert.equal(result.activeSurfaceMode, 'work');
    assert.equal(result.modelButton.present, true);
    assert.equal(result.react.reactOwnerCount >= 2, true);
    assert.equal(result.react.gpt56SignalPresent, true);
    assert.equal(result.react.thinkingEffort, 'max');
    assert.equal(result.react.triggerDescendants.reactOwnerCount >= 1, true);
    assert.equal(result.react.triggerDescendants.thinkingEffort, 'xhigh');
    assert.equal(result.globals.matches.some((item) => item.gpt56SignalPresent && item.thinkingEffort === 'max'), true);
    assert.equal(result.historyState.gpt56SignalPresent, true);
    assert.equal(result.historyState.thinkingEffort, 'max');
    assert.equal(result.indexedDb.supported, true);
    assert.equal(result.indexedDb.scannedStoreCount >= 1, true);
    assert.equal(result.indexedDb.semanticRecords.some((item) => item.gpt56SignalPresent && item.thinkingEffort === 'max'), true);
    assert.equal(result.network.responsesInspected >= 1, true);
    assert.equal(result.network.semanticResponses.some((item) => item.gpt56SignalPresent && item.thinkingEffort === 'max'), true);
    assert.equal(await page.evaluate(() => window.__downstreamFetchCalls), 1, 'diagnostic fetch must preserve later page/Arcaia wrappers');
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /gpt-5\.6-sol-wm|PRIVATE REACT CHILD CONTENT|PRIVATE DESCENDANT CONTENT|PRIVATE FIBER CONTENT|PRIVATE GLOBAL CONTENT|PRIVATE HISTORY CONTENT|PRIVATE INDEXEDDB CONTENT|PRIVATE NETWORK CONTENT|privateValue|probe-authority-db|row-1|api\/work-state/);
  } finally {
    await browser.close();
  }
});

test('MAIN-world survey classifies conversation model field precedence without exporting raw model values', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => {
      const isConversation = route.request().url().includes('/backend-api/conversation/current-route-token');
      return route.fulfill({
        status: 200,
        contentType: isConversation ? 'application/json' : 'text/html',
        body: isConversation
          ? JSON.stringify({
              current_node: 'leaf',
              mapping: {
                root: { id: 'root', parent: null, message: null },
                leaf: {
                  id: 'leaf',
                  parent: 'root',
                  message: {
                    metadata: {
                      resolved_model_slug: 'gpt-5-thinking-alias',
                      model_slug: 'gpt-5-6-thinking',
                      default_model_slug: 'gpt-5.6-sol-wm',
                      thinking_effort: 'xhigh',
                      privateValue: 'PRIVATE MODEL METADATA'
                    }
                  }
                }
              }
            })
          : '<!doctype html><html><body><form data-type="unified-composer"></form></body></html>'
      });
    });
    await page.goto('https://chatgpt.test/c/current-route-token');
    await page.addScriptTag({ content: mainSource });
    await page.evaluate(() => {
      window.postMessage({
        source: 'arcaia-model-decoration-watch-v1',
        type: 'ARCAIA_MODEL_DECORATION_REARM_CONVERSATION_CAPTURE'
      }, '*');
      window.postMessage({
        source: 'arcaia-model-decoration-watch-v1',
        type: 'ARCAIA_MODEL_DECORATION_REARM_CONVERSATION_CAPTURE'
      }, '*');
    });
    await page.evaluate(() => fetch('/backend-api/conversation/current-route-token').then((response) => response.json()));
    await page.waitForTimeout(30);
    const result = await page.evaluate(() => new Promise((resolve) => {
      const requestId = `survey-${Date.now()}`;
      const listener = (event) => {
        if (
          event.source !== window
          || event.data?.source !== 'arcaia-model-decoration-watch-v1'
          || event.data?.type !== 'ARCAIA_MODEL_DECORATION_MAIN_SURVEY_RESPONSE'
          || event.data?.requestId !== requestId
        ) return;
        window.removeEventListener('message', listener);
        resolve(event.data.payload);
      };
      window.addEventListener('message', listener);
      window.postMessage({
        source: 'arcaia-model-decoration-watch-v1',
        type: 'ARCAIA_MODEL_DECORATION_MAIN_SURVEY_REQUEST',
        requestId,
        phase: 'conversation_field_precedence',
        includeIndexedDb: false
      }, '*');
    }));

    const observation = result.conversationModelFields;
    assert.equal(observation.sourceShape, 'mapping_current_branch');
    assert.equal(observation.selectedMessageDistanceFromLeaf, 0);
    assert.equal(observation.thinkingEffortPresent, true);
    assert.equal(observation.arcaiaPrecedenceField, 'resolved_model_slug');
    assert.equal(observation.alternateExplicitGpt56FieldPresent, true);
    assert.equal(observation.fields.resolvedModelSlug.knownFamily, 'gpt5_thinking_alias');
    assert.equal(observation.fields.modelSlug.knownFamily, 'explicit_gpt56');
    assert.equal(observation.fields.defaultModelSlug.knownFamily, 'explicit_gpt56');
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /gpt-5-thinking-alias|gpt-5-6-thinking|gpt-5\.6-sol-wm|xhigh|PRIVATE MODEL METADATA/);
  } finally {
    await browser.close();
  }
});

test('watch probe captures privacy-bounded Work pre-picker authority candidates without opening the picker', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><style id="arcaia-model-selector-rich-style"></style></head><body>
        <button id="chat" type="button" role="radio" data-state="on">Chat</button>
        <button id="work" type="button" role="radio" data-state="off">Work</button>
        <div id="host"><div><form data-type="unified-composer">
          <button id="model" type="button" aria-haspopup="menu" aria-expanded="false" data-state="closed"
            data-arcaia-model-rich="true" data-arcaia-model-version="GPT-5.6" data-arcaia-model-performance="高い">
            <span data-arcaia-model-native-label="true">高い</span>
            <span data-arcaia-model-rich-content="true"><span>GPT-5.6</span><span>高い</span></span>
            <svg></svg>
          </button>
        </form></div></div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => {
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      (0, eval)(source);

      document.getElementById('work').addEventListener('click', () => {
        document.getElementById('chat').setAttribute('data-state', 'off');
        document.getElementById('work').setAttribute('data-state', 'on');
        document.querySelector('[data-type="unified-composer"]').innerHTML = `
          <button id="work-model" type="button" aria-haspopup="menu" aria-expanded="false" data-state="closed"
            data-model-slug="gpt-5.6-sol-wm" data-thinking-effort="max"><span></span><svg></svg></button>
        `;
        sessionStorage.setItem('oai/apps/tpp/model-view-state', JSON.stringify({
          currentModelSlug: 'gpt-5.6-sol-wm',
          thinkingEffort: 'max',
          privateValue: 'PRIVATE STORAGE CONTENT'
        }));
        document.body.insertAdjacentHTML('beforeend', `
          <div role="menu" data-state="closed" aria-labelledby="work-model" hidden>
            <div data-testid="composer-intelligence-picker-content">
              <div data-testid="composer-model-picker-slider-simple-view"><div role="slider" aria-valuenow="4"></div></div>
            </div>
          </div>
        `);
      }, { once: true });
    }, contentSource);

    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'baseline_armed'));
    await page.click('#work');
    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.type === 'work_pre_picker_authority_observed'
      && entry?.event?.snapshot?.workPrePickerAuthority?.eligible === true
    )));

    const messages = await page.evaluate(() => window.__probeMessages);
    const event = featureMessages(messages, 'work_pre_picker_authority_observed').at(-1);
    const survey = event.snapshot.workPrePickerAuthority;
    assert.equal(survey.eligible, true);
    assert.equal(survey.nativePickerOpen, false);
    assert.equal(survey.modelButtonPresent, true);
    assert.equal(survey.dormantPicker.pickerCount, 1);
    assert.equal(survey.dormantPicker.openPickerCount, 0);
    assert.deepEqual(survey.dormantPicker.sliderValues, [4]);
    assert.equal(survey.domSignals.some((item) => item.gpt56SignalPresent && item.thinkingEffort === 'max'), true);
    assert.equal(survey.storageSignals.some((item) => (
      item.storageArea === 'session'
      && item.gpt56SignalPresent
      && item.thinkingEffort === 'max'
    )), true);
    assert.equal(survey.authoritySignalFound, true);
    const serialized = JSON.stringify(messages);
    assert.doesNotMatch(serialized, /gpt-5\.6-sol-wm|PRIVATE STORAGE CONTENT|privateValue/);
  } finally {
    await browser.close();
  }
});

test('watch probe observes the native Work trigger structure without timed rechecks', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <button id="chat" type="button" role="radio" data-state="on">Chat</button>
        <button id="work" type="button" role="radio" data-state="off">Work</button>
        <form data-type="unified-composer">
          <button id="other-menu" type="button" aria-haspopup="menu"><span>PRIVATE OTHER MENU</span></button>
          <button id="model" type="button" aria-haspopup="menu" aria-expanded="false" data-state="closed"><svg></svg></button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.addScriptTag({ content: mainSource });
    await page.evaluate((source) => {
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      (0, eval)(source);
      document.getElementById('work').addEventListener('click', () => {
        document.getElementById('chat').setAttribute('data-state', 'off');
        document.getElementById('work').setAttribute('data-state', 'on');
      }, { once: true });
    }, contentSource);

    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'composer_bound'));
    await page.click('#work');
    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'surface_control_transition_observed'));

    await page.evaluate(() => {
      document.getElementById('model').innerHTML = `
        <span data-animated-slider-trigger="true">
          <span class="hash_SliderTriggerContent">
            <span class="hash_SliderTriggerLabel">
              <span class="hash_SliderTriggerModelLabel">5.6 Sol</span>
              <span class="hash_SliderTriggerEffortLabel">非常に高い</span>
            </span>
          </span>
        </span>
        <svg></svg>
      `;
      document.querySelector('[class*="_SliderTriggerEffortLabel"]').__reactProps$probe = {
        thinkingEffort: 'xhigh',
        'data-max-effort': true,
        'data-thinking-mode': 'PRIVATE_UNKNOWN_EFFORT_VALUE',
        privateValue: 'PRIVATE DESCENDANT CONTENT'
      };
      document.querySelector('[class*="_SliderTriggerEffortLabel"]').setAttribute(
        'data-thinking-slot',
        'PRIVATE_DOM_EFFORT_VALUE'
      );
    });

    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.type === 'work_pre_picker_authority_observed'
      && entry?.event?.phase === 'composer_model_mutation'
      && entry?.event?.snapshot?.workPrePickerAuthority?.triggerDisplay?.modelVersion === 'GPT-5.6'
    )));

    const messages = await page.evaluate(() => window.__probeMessages);
    const event = featureMessages(messages, 'work_pre_picker_authority_observed')
      .find((item) => item.phase === 'composer_model_mutation' && item.snapshot?.workPrePickerAuthority?.triggerDisplay?.modelVersion);
    assert.deepEqual(event.snapshot.workPrePickerAuthority.triggerDisplay, {
      animatedSliderTriggerPresent: true,
      modelLabelPresent: true,
      effortLabelPresent: true,
      modelVersion: 'GPT-5.6',
      workFamily: 'Sol',
      performance: '非常に高い',
      performanceSource: 'localized_display_text'
    });
    assert.equal(event.snapshot.workPrePickerAuthority.authoritySignalFound, true);
    assert.doesNotMatch(JSON.stringify(messages), /PRIVATE OTHER MENU/);

    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.type === 'work_main_world_authority_observed'
      && entry?.event?.phase === 'composer_model_mutation'
    )));
    const mainWorldMessages = await page.evaluate(() => window.__probeMessages);
    const mainWorldEvent = featureMessages(mainWorldMessages, 'work_main_world_authority_observed')
      .find((item) => item.phase === 'composer_model_mutation');
    assert.equal(mainWorldEvent.authority.react.triggerDescendants.thinkingEffort, 'xhigh');
    assert.deepEqual(mainWorldEvent.authority.react.triggerDescendants.effortReactPropNames, [
      'data-max-effort',
      'data-thinking-mode',
      'thinkingEffort'
    ]);
    assert.deepEqual(mainWorldEvent.authority.react.triggerDescendants.effortDomAttributeNames, [
      'data-thinking-slot'
    ]);
    assert.deepEqual(mainWorldEvent.authority.react.triggerDescendants.dataMaxEffort, {
      valueType: 'boolean',
      booleanValue: true,
      numberValue: null,
      identifierValue: null
    });
    assert.doesNotMatch(
      JSON.stringify(mainWorldEvent),
      /PRIVATE DESCENDANT CONTENT|privateValue|PRIVATE_UNKNOWN_EFFORT_VALUE|PRIVATE_DOM_EFFORT_VALUE/
    );

    const beforeUnknownLocaleCount = featureMessages(messages, 'work_pre_picker_authority_observed').length;
    await page.evaluate(() => {
      document.querySelector('[class*="_SliderTriggerEffortLabel"]').textContent = 'UNKNOWN_LOCALE_EFFORT';
    });
    await page.waitForFunction((beforeCount) => {
      const events = window.__probeMessages
        .map((entry) => entry?.event)
        .filter((item) => item?.type === 'work_pre_picker_authority_observed');
      return events.length > beforeCount
        && events.at(-1)?.snapshot?.workPrePickerAuthority?.triggerDisplay?.modelVersion === 'GPT-5.6';
    }, beforeUnknownLocaleCount, { timeout: 3000 });
    const unknownLocaleMessages = await page.evaluate(() => window.__probeMessages);
    const unknownLocaleEvent = featureMessages(unknownLocaleMessages, 'work_pre_picker_authority_observed').at(-1);
    assert.equal(unknownLocaleEvent.snapshot.workPrePickerAuthority.triggerDisplay.workFamily, 'Sol');
    assert.equal(unknownLocaleEvent.snapshot.workPrePickerAuthority.triggerDisplay.performance, null);

    const beforeUnrelatedMutationCount = featureMessages(unknownLocaleMessages, 'work_pre_picker_authority_observed').length;
    await page.evaluate(() => {
      document.querySelector('#other-menu span').textContent = 'PRIVATE OTHER MENU UPDATED';
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const afterUnrelatedMutationMessages = await page.evaluate(() => window.__probeMessages);
    assert.equal(
      featureMessages(afterUnrelatedMutationMessages, 'work_pre_picker_authority_observed').length,
      beforeUnrelatedMutationCount
    );
    assert.doesNotMatch(contentSource, /WORK_PRE_PICKER_RECHECK_MS|WORK_PRE_PICKER_DEEP_RECHECK_MS|delayed_180|deep_700/);
  } finally {
    await browser.close();
  }
});

test('watch probe records Work authority storage shape without exporting storage values', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head></head><body>
        <button role="radio" data-state="off">Chat</button>
        <button role="radio" data-state="on">Work</button>
        <form data-type="unified-composer"><button aria-haspopup="menu">高い</button></form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/model-settings', JSON.stringify({
        recent: {
          modelSlug: 'gpt-5-6-thinking',
          thinkingEffort: 'xhigh'
        }
      }));
      localStorage.setItem('oai/apps/tpp/thinking-effort', JSON.stringify('xhigh'));
      localStorage.setItem('oai/apps/tpp/model-session', JSON.stringify({ privateValue: 'must-not-export' }));
    });
    await page.evaluate((source) => {
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      (0, eval)(source);
    }, contentSource);
    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.snapshot?.workAuthorityStorage?.settingsPresent === true
    )));
    const messages = await page.evaluate(() => window.__probeMessages);
    const snapshot = messages.map((entry) => entry?.event?.snapshot).find((item) => item?.workAuthorityStorage?.settingsPresent);
    assert.deepEqual(snapshot.workAuthorityStorage, {
      settingsPresent: true,
      settingsJsonObject: true,
      knownModelSlugPresent: false,
      knownModelSlugLooksGpt56: false,
      thinkingEffortPresent: true,
      authorityCandidateFound: false,
      semanticPaths: ['recent.modelSlug', 'recent.thinkingEffort'],
      tppKeyNames: [
        'oai/apps/tpp/model-session',
        'oai/apps/tpp/model-settings',
        'oai/apps/tpp/thinking-effort'
      ]
    });
    const serialized = JSON.stringify(messages);
    assert.doesNotMatch(serialized, /gpt-5-6-thinking|xhigh|must-not-export|privateValue/);
  } finally {
    await browser.close();
  }
});

test('watch probe captures Chat-to-Work surface transition and privacy-bounded native Work picker authority', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><style id="arcaia-model-selector-rich-style"></style></head><body>
        <button id="chat" type="button" role="radio" data-state="on">Chat</button>
        <button id="work" type="button" role="radio" data-state="off">Work</button>
        <div><div><form data-type="unified-composer">
          <button id="model" type="button" aria-haspopup="menu" aria-expanded="false" data-state="closed" data-arcaia-model-rich="true" data-arcaia-model-version="GPT-5.6" data-arcaia-model-performance="高い">
            <span data-arcaia-model-native-label="true">高い</span>
            <span data-arcaia-model-rich-content="true"><span>GPT-5.6</span><span>高い</span></span>
            <svg></svg>
          </button>
        </form></div></div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => {
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      (0, eval)(source);

      document.getElementById('work').addEventListener('click', () => {
        document.getElementById('chat').setAttribute('data-state', 'off');
        document.getElementById('work').setAttribute('data-state', 'on');
        document.getElementById('model').outerHTML = `
          <button id="work-model" type="button" aria-haspopup="menu" aria-expanded="false" data-state="closed"><span></span><svg></svg></button>
        `;
        document.getElementById('work-model').addEventListener('click', (event) => {
          const trigger = event.currentTarget;
          trigger.setAttribute('aria-expanded', 'true');
          trigger.setAttribute('data-state', 'open');
          document.body.insertAdjacentHTML('beforeend', `
            <div role="menu" data-state="open" aria-labelledby="work-model">
              <div data-testid="composer-intelligence-picker-content">
                <div role="menuitem" aria-expanded="true" data-has-submenu>Sol</div>
                <div role="menuitemradio" aria-checked="true">非常に高い</div>
                <div data-testid="composer-model-picker-slider-simple-view"><div role="slider" aria-valuenow="4"></div></div>
                <div role="menuitem">PRIVATE UNRELATED LABEL</div>
              </div>
            </div>
          `);
        }, { once: true });
      }, { once: true });
    }, contentSource);

    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'baseline_armed'));
    await page.click('#work');
    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'surface_control_transition_observed'));
    await page.click('#work-model');
    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.type === 'native_picker_authority_observed'
      && entry?.event?.snapshot?.nativePickerAuthority
    )));

    const messages = await page.evaluate(() => window.__probeMessages);
    const transition = featureMessages(messages, 'surface_control_transition_observed').at(-1);
    assert.equal(transition.fromSurface, 'chatgpt');
    assert.equal(transition.targetSurface, 'work');
    assert.equal(transition.settledSurface, 'work');
    assert.equal(transition.snapshot.activeSurfaceMode, 'work');
    assert.equal(transition.routeGeneration, 1);
    assert.equal(transition.surfaceGeneration, 2);
    assert.equal(transition.snapshot.surfaceGeneration, 2);

    const pickerEvent = featureMessages(messages, 'native_picker_authority_observed').at(-1);
    assert.deepEqual(pickerEvent.snapshot.nativePickerAuthority, {
      surfaceMode: 'work',
      triggerLinkedToComposer: true,
      checkedItemPresent: true,
      checkedExplicitModelVersion: null,
      checkedKnownPerformanceLabel: '非常に高い',
      sliderPresent: true,
      sliderValue: 4,
      modelCandidates: [
        {
          explicitModelVersion: null,
          workFamily: 'Sol',
          ariaExpanded: 'true',
          dataState: null,
          hasSubmenu: true
        }
      ],
      selectedModelCandidate: {
        explicitModelVersion: null,
        workFamily: 'Sol',
        ariaExpanded: 'true',
        dataState: null,
        hasSubmenu: true
      }
    });
    const serialized = JSON.stringify(messages);
    assert.doesNotMatch(serialized, /PRIVATE UNRELATED LABEL/);
  } finally {
    await browser.close();
  }
});

test('watch probe classifies same-route Chat-to-Work decoration loss as a surface transition', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><style id="arcaia-model-selector-rich-style"></style></head><body>
        <button id="chat" type="button" role="radio" data-state="on">Chat</button>
        <button id="work" type="button" role="radio" data-state="off">Work</button>
        <div><div><form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" data-arcaia-model-rich="true" data-arcaia-model-version="GPT-5.6" data-arcaia-model-performance="高い">
            <span data-arcaia-model-native-label="true">高い</span>
            <span data-arcaia-model-rich-content="true"><span>GPT-5.6</span><span>高い</span></span>
          </button>
        </form></div></div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (handler, delay, ...args) => nativeSetTimeout(
        handler,
        delay === 1200 ? 40 : delay,
        ...args
      );
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      (0, eval)(source);
      document.getElementById('work').addEventListener('click', () => {
        document.getElementById('chat').setAttribute('data-state', 'off');
        document.getElementById('work').setAttribute('data-state', 'on');
        document.getElementById('model').outerHTML = '<button id="work-model" aria-haspopup="menu">高い</button>';
      }, { once: true });
    }, contentSource);

    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'baseline_armed'));
    await page.click('#work');
    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.type === 'incident'
      && entry?.event?.incident?.kind === 'surface_transition_not_redecorated'
    )), null, { timeout: 1500 });

    const incident = await page.evaluate(() => window.__probeMessages
      .map((entry) => entry?.event)
      .find((event) => event?.type === 'incident'));
    assert.equal(incident.routeGeneration, 1);
    assert.equal(incident.surfaceGeneration, 2);
    assert.equal(incident.incident.kind, 'surface_transition_not_redecorated');
  } finally {
    await browser.close();
  }
});

test('watch probe distinguishes trigger absence, classification misses, and multiple composers without collecting arbitrary labels', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><head></head><body>
        <div id="old-host">
          <form id="old-composer" data-type="unified-composer" style="display:none">
            <button id="old-model" aria-haspopup="menu" data-arcaia-model-rich="true" data-arcaia-model-version="GPT-5.6">
              <span data-arcaia-model-rich-content="true">GPT-5.6</span>
            </button>
          </form>
        </div>
        <div id="new-host">
          <form id="new-composer" data-type="unified-composer">
            <button id="unknown-button" aria-haspopup="listbox" data-testid="mystery-control"><svg></svg><span>SECRET BUTTON LABEL</span></button>
            <button id="thinking-button" aria-haspopup="dialog" data-testid="composer-thinking-control" aria-expanded="false" data-state="closed"><svg></svg></button>
          </form>
        </div>
      </body></html>
    `);
    await page.evaluate((source) => {
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      (0, eval)(source);
    }, contentSource);
    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.snapshot?.composerCount === 2));
    const messages = await page.evaluate(() => window.__probeMessages);
    const snapshotEvent = messages.map((entry) => entry?.event).find((event) => event?.snapshot?.composerCount === 2);
    const snapshot = snapshotEvent.snapshot;
    assert.equal(snapshot.composerCount, 2);
    assert.equal(typeof snapshot.observedComposerIsSelected, 'boolean');
    assert.equal(snapshot.composers.length, 2);
    assert.ok(snapshot.composers.some((composer) => composer.decoratedTriggerCount === 1));
    assert.ok(snapshot.composers.some((composer) => composer.buttonCount === 2 && composer.menuButtonCount === 0));
    const active = snapshot.composers.find((composer) => composer.buttonCount === 2);
    assert.equal(active.buttonProfiles.length, 2);
    assert.deepEqual(active.buttonProfiles.map((profile) => profile.ariaHaspopup), ['listbox', 'dialog']);
    assert.deepEqual(active.buttonProfiles.map((profile) => profile.dataTestidCategory), ['other', 'thinking']);
    assert.equal(active.buttonProfiles[1].ariaExpanded, 'false');
    assert.equal(active.buttonProfiles[1].dataState, 'closed');
    assert.deepEqual(active.buttonProfiles[0].dataTestidHints, []);
    assert.deepEqual(active.buttonProfiles[1].dataTestidHints, ['thinking', 'composer']);
    assert.deepEqual(active.buttonProfiles.map((profile) => profile.buttonOrder), [0, 1]);
    assert.deepEqual(active.buttonProfiles.map((profile) => profile.menuOrder), [-1, -1]);
    assert.equal(active.buttonProfiles[0].ariaLabelPresent, false);
    assert.equal(active.buttonProfiles[0].parent.tag, 'form');
    const serialized = JSON.stringify(messages);
    assert.doesNotMatch(serialized, /SECRET BUTTON LABEL|mystery-control|composer-thinking-control/);
  } finally {
    await browser.close();
  }
});

test('watch probe uses local event-driven observers without polling', () => {
  assert.doesNotMatch(contentSource, /setInterval\s*\(/);
  assert.match(contentSource, /composerObserver\.observe\(composer/);
  assert.match(contentSource, /composerParentObserver\.observe\(parent, \{ childList: true \}\)/);
  assert.match(contentSource, /composerGrandparentObserver\.observe\(grandparent, \{ childList: true \}\)/);
  assert.match(contentSource, /triggerObserver\.observe\(next/);
  assert.match(contentSource, /headObserver\.observe\(document\.head, \{ childList: true \}\)/);
  assert.match(contentSource, /BOOTSTRAP_DURATION_MS = 30000/);
  assert.match(contentSource, /stopBootstrap\(\)/);
  assert.doesNotMatch(contentSource, /WORK_PRE_PICKER_RECHECK_MS|WORK_PRE_PICKER_DEEP_RECHECK_MS|delayed_180|deep_700/);
  assert.doesNotMatch(contentSource, /observe\(document,|observe\(document\.body/);
});

test('watch probe detects same-trigger decoration loss after a healthy baseline', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><head><style id="arcaia-model-selector-rich-style"></style></head><body>
        <div><div><form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" data-arcaia-model-rich="true" data-arcaia-model-version="GPT-5.6" data-arcaia-model-performance="High">
            <span data-arcaia-model-native-label="true">High</span>
            <span data-arcaia-model-rich-content="true"><span>GPT-5.6</span><span>High</span></span>
          </button>
        </form></div></div>
      </body></html>
    `);
    await page.evaluate((source) => {
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      (0, eval)(source);
    }, contentSource);
    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'baseline_armed'));
    await page.evaluate(() => document.querySelector('[data-arcaia-model-rich-content="true"]').remove());
    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'incident'));
    const messages = await page.evaluate(() => window.__probeMessages);
    const incidents = featureMessages(messages, 'incident');
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].incident.kind, 'same_trigger_rich_content_removed');
    assert.equal(await page.locator('text=MODEL DECORATION LOST').count(), 0);
  } finally {
    await browser.close();
  }
});

test('watch probe gives replacement triggers a bounded grace and ignores explicit non-5.6 changes', async () => {
  assert.match(contentSource, /REPLACEMENT_GRACE_MS = 1200/);
  assert.match(contentSource, /requestArcaiaInternalSnapshotAfterRender\('replacement_grace_started'\)/);
  assert.match(contentSource, /requestArcaiaInternalSnapshotAfterRender\('replacement_grace_expired'\)/);
  assert.match(contentSource, /requestArcaiaInternalSnapshotAfterRender\('replacement_waiting_for_candidate'\)/);
  assert.match(contentSource, /replacement_trigger_not_redecorated/);
  assert.match(contentSource, /route_transition_not_redecorated/);
  assert.match(contentSource, /surface_transition_not_redecorated/);
  assert.match(contentSource, /explicit_model_change/);
  assert.match(contentSource, /explicitModelVersion === baseline\?\.modelVersion/);
  assert.match(contentSource, /MAIN_PROTOCOL_SOURCE = 'aice-probe-main-v159'/);
  assert.match(contentSource, /eventType === 'page_navigation'/);
});

test('watch probe diagnoses a new Chat cold start that resolves but never decorates', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><style id="arcaia-model-selector-rich-style"></style></head><body>
        <button role="radio" data-state="on">Chat</button>
        <button role="radio" data-state="off">Work</button>
        <div><div><form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed">高い<svg></svg></button>
        </form></div></div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (handler, delay, ...args) => nativeSetTimeout(
        handler,
        delay === 7000 ? 40 : delay,
        ...args
      );
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (
          data?.source !== 'arcaia-model-decoration-watch-v1'
          || data.type !== 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_REQUEST'
        ) return;
        window.postMessage({
          source: 'arcaia-model-decoration-watch-v1',
          type: 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_RESPONSE',
          requestId: data.requestId,
          payload: {
            apiPresent: true,
            snapshotAvailable: true,
            activeSurfaceModePresent: true,
            activeSurfaceMode: 'chatgpt',
            newChatModelConfigPresent: true,
            newChatStateCandidateFound: true,
            resolvedContextKind: 'new_chat_cookie',
            triggerFound: true,
            currentStatePresent: true,
            modelSource: 'new_chat_cookie',
            thinkingEffort: 'extended',
            performance: '高い',
            triggerApplied: false,
            currentTriggerInComposer: true,
            scanReason: 'conversation_state_sync_complete',
            scanOutcome: 'resolved_state_applied'
          }
        }, '*');
      });
      (0, eval)(source);
    }, contentSource);

    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.type === 'incident'
      && entry?.event?.incident?.kind === 'new_chat_decoration_missing_after_applied'
    )), null, { timeout: 1500 });

    const messages = await page.evaluate(() => window.__probeMessages);
    const incident = featureMessages(messages, 'incident')[0];
    assert.equal(incident.incident.kind, 'new_chat_decoration_missing_after_applied');
    assert.equal(incident.snapshot.supplyDiagnostics.lastInternalSnapshot.modelSource, 'new_chat_cookie');
    assert.equal(incident.snapshot.supplyDiagnostics.lastInternalSnapshot.thinkingEffort, 'extended');
    assert.equal(incident.snapshot.supplyDiagnostics.lastInternalSnapshot.performance, '高い');
    assert.equal(incident.snapshot.supplyDiagnostics.lastInternalSnapshot.triggerApplied, false);
  } finally {
    await browser.close();
  }
});

test('watch probe diagnoses a Work cold start that never becomes decorated using the existing internal snapshot bridge', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><head><style id="arcaia-model-selector-rich-style"></style></head><body>
        <button role="radio" data-state="off">Chat</button>
        <button role="radio" data-state="on">Work</button>
        <div><div><form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed">高い<svg></svg></button>
        </form></div></div>
      </body></html>
    `);
    await page.evaluate((source) => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (handler, delay, ...args) => nativeSetTimeout(
        handler,
        delay === 7000 ? 40 : delay,
        ...args
      );
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (
          data?.source !== 'arcaia-model-decoration-watch-v1'
          || data.type !== 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_REQUEST'
        ) return;
        window.postMessage({
          source: 'arcaia-model-decoration-watch-v1',
          type: 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_RESPONSE',
          requestId: data.requestId,
          payload: {
            apiPresent: true,
            snapshotAvailable: true,
            activeSurfaceModePresent: true,
            activeSurfaceMode: 'work',
            newChatModelConfigPresent: false,
            newChatStateCandidateFound: false,
            resolvedContextKind: 'new_work_local_storage',
            triggerFound: false,
            scanReason: 'composer_trigger_added',
            scanOutcome: 'resolved_state_not_applied'
          }
        }, '*');
      });
      (0, eval)(source);
    }, contentSource);

    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.type === 'incident'
      && entry?.event?.incident?.kind === 'work_cold_start_resolved_state_not_applied'
    )), null, { timeout: 1500 });

    const messages = await page.evaluate(() => window.__probeMessages);
    const incident = featureMessages(messages, 'incident')[0];
    assert.equal(incident.incident.kind, 'work_cold_start_resolved_state_not_applied');
    assert.equal(incident.snapshot.supplyDiagnostics.lastInternalSnapshot.activeSurfaceMode, 'work');
    assert.equal(incident.snapshot.supplyDiagnostics.lastInternalSnapshot.resolvedContextKind, 'new_work_local_storage');
    assert.equal(incident.snapshot.supplyDiagnostics.lastInternalSnapshot.scanOutcome, 'resolved_state_not_applied');
  } finally {
    await browser.close();
  }
});

test('watch probe diagnoses a plain conversation cold start that remains undecorated', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><style id="arcaia-model-selector-rich-style"></style></head><body>
        <button role="radio" data-state="on">Chat</button>
        <button role="radio" data-state="off">Work</button>
        <form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" aria-expanded="false" data-state="closed">&#39640;&#12356;<svg></svg></button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/c/cold-start');
    await page.evaluate((source) => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (handler, delay, ...args) => nativeSetTimeout(handler, delay === 7000 ? 40 : delay, ...args);
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (data?.source !== 'arcaia-model-decoration-watch-v1' || data.type !== 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_REQUEST') return;
        window.postMessage({
          source: 'arcaia-model-decoration-watch-v1',
          type: 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_RESPONSE',
          requestId: data.requestId,
          payload: {
            apiPresent: true,
            snapshotAvailable: true,
            activeSurfaceModePresent: true,
            activeSurfaceMode: 'chatgpt',
            newChatModelConfigPresent: true,
            newChatStateCandidateFound: true,
            resolvedContextKind: 'conversation_waiting_for_detail',
            triggerFound: true,
            currentStatePresent: false,
            triggerApplied: false,
            currentTriggerInComposer: true,
            scanReason: 'startup',
            scanOutcome: 'resolved_state_not_applied'
          }
        }, '*');
      });
      (0, eval)(source);
    }, contentSource);

    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.type === 'incident'
      && entry?.event?.incident?.kind === 'conversation_cold_start_resolved_state_not_applied'
    )), null, { timeout: 1500 });

    const incident = featureMessages(await page.evaluate(() => window.__probeMessages), 'incident')[0];
    assert.equal(incident.incident.kind, 'conversation_cold_start_resolved_state_not_applied');
    assert.equal(incident.incident.displayState.native.performance, '高い');
    assert.equal(incident.snapshot.supplyDiagnostics.lastInternalSnapshot.resolvedContextKind, 'conversation_waiting_for_detail');
  } finally {
    await browser.close();
  }
});

test('watch probe records model-config event and conversation-sync supply boundaries without IDs', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><head></head><body><form data-type="unified-composer"><button aria-haspopup="menu">High</button></form></body></html>'
    }));
    await page.goto('https://chatgpt.com/c/current-route-token');
    await page.evaluate((source) => {
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      (0, eval)(source);
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (
          data?.source !== 'arcaia-model-decoration-watch-v1'
          || data.type !== 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_REQUEST'
        ) return;
        window.postMessage({
          source: 'arcaia-model-decoration-watch-v1',
          type: 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_RESPONSE',
          requestId: data.requestId,
          payload: {
            apiPresent: true,
            snapshotAvailable: true,
            activeSurfaceModePresent: false,
            activeSurfaceMode: null,
            newChatModelConfigPresent: true,
            newChatStateCandidateFound: true,
            resolvedContextKind: 'new_chat_cookie',
            triggerFound: true,
            scanReason: 'conversation_state_sync_complete',
            scanOutcome: 'resolved_state_unavailable',
            modelSlug: 'must-not-be-exported'
          }
        }, '*');
      });
      window.postMessage({
        source: 'aice-probe-content-v159',
        type: 'SYNC_PAGE_CONVERSATION',
        requestId: 'private-request-id',
        payload: { conversationId: 'current-route-token' }
      }, '*');
      window.postMessage({
        source: 'aice-probe-main-v159',
        type: 'PAGE_CONVERSATION_SYNC_RESULT',
        requestId: 'private-request-id',
        payload: {
          ok: true,
          conversationModelConfig: {
            conversationId: 'current-route-token',
            modelSlug: 'gpt-5-6-thinking',
            thinkingEffort: 'xhigh'
          }
        }
      }, '*');
      window.postMessage({
        source: 'aice-probe-main-v159',
        type: 'AICE_MAIN_EVENT',
        eventType: 'current_conversation_model_config',
        payload: {
          conversationId: 'current-route-token',
          modelSlug: 'gpt-5-6-thinking',
          thinkingEffort: 'xhigh'
        }
      }, '*');
      window.postMessage({
        source: 'aice-probe-main-v159',
        type: 'AICE_MAIN_EVENT',
        eventType: 'current_conversation_model_config',
        payload: {
          conversationId: 'current-route-token',
          modelSlug: 'gpt-5.5-thinking',
          thinkingEffort: 'xhigh'
        }
      }, '*');
    }, contentSource);
    await page.waitForFunction(() => window.__probeMessages.filter((entry) => entry?.event?.type === 'conversation_model_config_event_observed').length >= 2);
    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'arcaia_internal_model_selector_snapshot'));
    const messages = await page.evaluate(() => window.__probeMessages);
    const request = featureMessages(messages, 'conversation_sync_request_observed')[0];
    const response = featureMessages(messages, 'conversation_sync_result_observed')[0];
    const configEvents = featureMessages(messages, 'conversation_model_config_event_observed');
    const configEvent = configEvents[0];
    const nonGpt56ConfigEvent = configEvents[1];
    assert.equal(request.supply.suppliedConversationMatchesCurrentRoute, true);
    assert.equal(response.supply.responseMatchedObservedRequest, true);
    assert.equal(response.supply.configPresent, true);
    assert.equal(response.supply.suppliedConversationMatchesCurrentRoute, true);
    assert.equal(response.supply.modelSlugPresent, true);
    assert.equal(response.supply.modelVersion, 'GPT-5');
    assert.equal(response.supply.thinkingEffortPresent, true);
    assert.equal(response.supply.isGpt56, true);
    assert.equal(response.supply.shouldDecorate, true);
    assert.deepEqual(response.supply.slugStructure, {
      slugLength: 'gpt-5-6-thinking'.length,
      tokenCount: 4,
      separatorPattern: 'hyphen',
      gpt5Present: true,
      version6Present: true,
      thinkingAlias: true,
      knownFamily: 'explicit_gpt56'
    });
    assert.equal(configEvent.supply.configPresent, true);
    assert.equal(configEvent.supply.suppliedConversationMatchesCurrentRoute, true);
    assert.equal(configEvent.supply.isGpt56, true);
    assert.equal(configEvent.supply.shouldDecorate, true);
    assert.equal(nonGpt56ConfigEvent.supply.isGpt56, false);
    assert.equal(nonGpt56ConfigEvent.supply.shouldDecorate, false);
    assert.deepEqual(nonGpt56ConfigEvent.supply.slugStructure, {
      slugLength: 'gpt-5.5-thinking'.length,
      tokenCount: 4,
      separatorPattern: 'mixed',
      gpt5Present: true,
      version6Present: false,
      thinkingAlias: true,
      knownFamily: 'gpt5_thinking_alias'
    });
    const internalEvent = featureMessages(messages, 'arcaia_internal_model_selector_snapshot').at(-1);
    assert.equal(internalEvent.internal.apiPresent, true);
    assert.equal(internalEvent.internal.snapshotAvailable, true);
    assert.equal(internalEvent.internal.activeSurfaceModePresent, false);
    assert.equal(internalEvent.internal.newChatModelConfigPresent, true);
    assert.equal(internalEvent.internal.newChatStateCandidateFound, true);
    assert.equal(internalEvent.internal.resolvedContextKind, 'new_chat_cookie');
    assert.equal(internalEvent.internal.triggerFound, true);
    assert.equal(internalEvent.internal.scanOutcome, 'resolved_state_unavailable');
    const serialized = JSON.stringify(messages);
    assert.doesNotMatch(serialized, /private-request-id|current-route-token|gpt-5-6-thinking|gpt-5\.5-thinking|xhigh|must-not-be-exported/);
  } finally {
    await browser.close();
  }
});

test('watch probe marks a conversation-to-new-chat route transition that never regains decoration', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><style id="arcaia-model-selector-rich-style"></style></head><body>
        <div><div><form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" data-arcaia-model-rich="true" data-arcaia-model-version="GPT-5.6" data-arcaia-model-performance="High">
            <span data-arcaia-model-native-label="true">High</span>
            <span data-arcaia-model-rich-content="true"><span>GPT-5.6</span><span>High</span></span>
          </button>
        </form></div></div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.com/c/probe-route');
    await page.evaluate((source) => {
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (
          data?.source !== 'arcaia-model-decoration-watch-v1'
          || data.type !== 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_REQUEST'
        ) return;
        window.postMessage({
          source: 'arcaia-model-decoration-watch-v1',
          type: 'ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_RESPONSE',
          requestId: data.requestId,
          payload: {
            apiPresent: true,
            snapshotAvailable: true,
            currentContextKind: 'new_chat',
            currentStateContextKind: 'conversation',
            currentStateContextMatchesCurrent: false,
            lastNavigationResetPresent: true,
            lastNavigationResetPreserved: true,
            navigationResetHistory: [{
              sequence: 7,
              reason: 'pushState',
              previousContextKind: 'gpt_surface_chat',
              nextContextKind: 'conversation',
              contextKeyChanged: true,
              statePresentBefore: true,
              stateModelVersionBefore: 'GPT-5.6',
              activeSurfaceModeAtReset: 'chatgpt',
              conditions: {
                sameContext: false,
                normalNewChatPromotion: false,
                gptSurfaceChatPromotion: true,
                workNewChatCarry: false,
                confirmedDecoration: false,
                crossingChatToWork: false
              },
              decision: 'preserve',
              decisionReason: 'gpt_surface_chat_promotion',
              statePresentAfter: true,
              stateContextKindAfter: 'conversation',
              rawContextKey: 'gpt_surface:/g/private:chatgpt'
            }],
            lastStateMutation: {
              sequence: 3,
              kind: 'replace',
              reason: 'set_current_state',
              sourceReason: 'resolved_state',
              currentContextKind: 'conversation',
              previousContextKind: 'gpt_surface_chat',
              nextContextKind: 'conversation',
              previousModelVersion: 'GPT-5.6',
              nextModelVersion: 'GPT-5.6'
            }
          }
        }, '*');
      });
      (0, eval)(source);
    }, contentSource);
    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'baseline_armed'));
    await page.evaluate(() => {
      document.querySelector('form[data-type="unified-composer"]').outerHTML = `
        <form data-type="unified-composer">
          <button id="model-next" aria-haspopup="menu">High</button>
        </form>`;
      history.pushState({}, '', '/');
      window.postMessage({
        source: 'aice-probe-main-v159',
        type: 'AICE_MAIN_EVENT',
        eventType: 'page_navigation',
        payload: { reason: 'pushState' }
      }, '*');
    });
    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.type === 'arcaia_internal_model_selector_snapshot'
      && entry?.event?.internal?.requestReason === 'arcaia_page_navigation'
    )));
    await page.waitForFunction(() => window.__probeMessages.some((entry) => (
      entry?.event?.type === 'incident'
      && entry?.event?.incident?.kind === 'route_transition_not_redecorated'
    )), null, { timeout: 3000 });
    const messages = await page.evaluate(() => window.__probeMessages);
    const incidents = featureMessages(messages, 'incident');
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].incident.kind, 'route_transition_not_redecorated');
    assert.equal(incidents[0].incident.baseline.routeKind, 'conversation');
    assert.equal(incidents[0].incident.routeKind, 'new_chat');
    const transitionInternal = featureMessages(messages, 'arcaia_internal_model_selector_snapshot')
      .find((entry) => entry.internal?.requestReason === 'arcaia_page_navigation');
    assert.equal(transitionInternal.internal.lastNavigationResetPreserved, true);
    assert.equal(transitionInternal.internal.navigationResetHistory.length, 1);
    assert.equal(transitionInternal.internal.navigationResetHistory[0].sequence, 7);
    assert.equal(transitionInternal.internal.navigationResetHistory[0].decisionReason, 'gpt_surface_chat_promotion');
    assert.equal('rawContextKey' in transitionInternal.internal.navigationResetHistory[0], false);
    assert.equal(transitionInternal.internal.lastStateMutation.kind, 'replace');
    assert.equal(transitionInternal.internal.lastStateMutation.reason, 'set_current_state');
    assert.equal(
      transitionInternal.snapshot.supplyDiagnostics.lastTransitionInternalSnapshot.currentStateContextMatchesCurrent,
      false
    );
  } finally {
    await browser.close();
  }
});

test('watch probe marks an undecorated replacement after the grace period', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><head><style id="arcaia-model-selector-rich-style"></style></head><body>
        <div><div><form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" data-arcaia-model-rich="true" data-arcaia-model-version="GPT-5.6" data-arcaia-model-performance="高い">
            <span data-arcaia-model-native-label="true">高い</span>
            <span data-arcaia-model-rich-content="true"><span>GPT-5.6</span><span>高い</span></span>
          </button>
        </form></div></div>
      </body></html>
    `);
    await page.evaluate((source) => {
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      (0, eval)(source);
    }, contentSource);
    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'baseline_armed'));
    await page.evaluate(() => {
      document.getElementById('model').outerHTML = '<button id="model-next" aria-haspopup="menu">高い</button>';
    });
    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'incident'), null, { timeout: 3000 });
    const messages = await page.evaluate(() => window.__probeMessages);
    const incidents = featureMessages(messages, 'incident');
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].incident.kind, 'replacement_trigger_not_redecorated');
  } finally {
    await browser.close();
  }
});

test('watch probe treats an explicit GPT-5.5 replacement as a model change, not a loss', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><head><style id="arcaia-model-selector-rich-style"></style></head><body>
        <div><div><form data-type="unified-composer">
          <button id="model" aria-haspopup="menu" data-arcaia-model-rich="true" data-arcaia-model-version="GPT-5.6" data-arcaia-model-performance="高い">
            <span data-arcaia-model-native-label="true">高い</span>
            <span data-arcaia-model-rich-content="true"><span>GPT-5.6</span><span>高い</span></span>
          </button>
        </form></div></div>
      </body></html>
    `);
    await page.evaluate((source) => {
      window.__probeMessages = [];
      window.chrome = {
        runtime: {
          sendMessage(message) { window.__probeMessages.push(message); return Promise.resolve({ ok: true }); },
          onMessage: { addListener() {} }
        }
      };
      (0, eval)(source);
    }, contentSource);
    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'baseline_armed'));
    await page.evaluate(() => {
      document.getElementById('model').outerHTML = '<button id="model-next" aria-haspopup="menu">GPT-5.5</button>';
    });
    await page.waitForFunction(() => window.__probeMessages.some((entry) => entry?.event?.type === 'explicit_model_change'));
    await page.waitForTimeout(1400);
    const messages = await page.evaluate(() => window.__probeMessages);
    assert.equal(featureMessages(messages, 'incident').length, 0);
    assert.equal(featureMessages(messages, 'explicit_model_change').length, 1);
  } finally {
    await browser.close();
  }
});

test('watch probe popup exposes JSON save as the only user action and captures before export', () => {
  assert.match(popupSource, /CAPTURE_NOW/);
  assert.match(popupSource, /application\/json/);
  assert.match(popupSource, /const PROBE_VERSION = '1\.0\.28'/);
  assert.match(popupSource, /probeConnectionState !== 'connected'/);
  assert.match(popupHtml, /JSON保存/);
  assert.doesNotMatch(popupHtml, /現在を記録|マーク解除|記録をリセット|このページで停止/);
  assert.equal((popupHtml.match(/<button\b/g) || []).length, 1);
  assert.doesNotMatch(popupSource, /ACK_TAB|RESET_TAB|RESET_PROBE_SESSION|STOP_PROBE/);
});

test('manual capture returns its sanitized snapshot without depending on background persistence', () => {
  assert.match(contentSource, /function emit\(type, details = \{\}\)/);
  assert.match(contentSource, /chrome\.runtime\.sendMessage\(\{ source: SOURCE, type: 'PROBE_EVENT', event \}\)/);
  assert.match(contentSource, /function manualSnapshot\(reason = 'toolbar_manual_capture'\)/);
  assert.match(contentSource, /emit\('manual_snapshot', \{ reason, snapshot \}\)/);
  assert.match(contentSource, /const MAX_LOCAL_EVENTS = 24/);
  assert.match(contentSource, /recentEvents\.push\(event\)/);
  assert.match(contentSource, /events: getRecentLocalEvents\(\)/);
  assert.match(contentSource, /if \(message\.type === 'CAPTURE_NOW'\)[\s\S]*?return false;/);
  assert.match(popupSource, /let currentManualSnapshot = null/);
  assert.match(popupSource, /let currentManualEvents = \[\]/);
  assert.match(popupSource, /currentManualSnapshot = result\?\.ok === true && result\.snapshot \? result\.snapshot : null/);
  assert.match(popupSource, /currentManualEvents = result\?\.ok === true && Array\.isArray\(result\.events\)/);
  assert.match(popupSource, /currentManualSnapshot = result\?\.ok === true && result\.snapshot \? result\.snapshot : null/);
  assert.match(popupSource, /currentManualEvents = result\?\.ok === true && Array\.isArray\(result\.events\)/);
  assert.match(popupSource, /latestSnapshot:\s*currentManualSnapshot\s*\|\|\s*currentTabReport\?\.latestSnapshot/);
  assert.match(popupSource, /status: 'manual_snapshot_only'/);
  assert.match(popupSource, /latestSnapshot: currentManualSnapshot/);
  assert.match(popupSource, /events: currentManualEvents/);
});

test('temporary Arcaia internal boundary is request-driven and returns only sanitized state', () => {
  assert.match(runtimeContentSource, /MODEL_DECORATION_INTERNAL_PROBE_REQUEST/);
  assert.match(runtimeContentSource, /getProbeSnapshot\?\.\(\)/);
  assert.match(runtimeContentSource, /MODEL_DECORATION_INTERNAL_PROBE_RESPONSE/);
  assert.match(modelSelectorSource, /function getProbeSnapshot\(\)/);
  assert.match(modelSelectorSource, /activeSurfaceModePresent/);
  assert.match(modelSelectorSource, /newChatModelConfigPresent/);
  assert.match(modelSelectorSource, /newChatStateCandidateFound/);
  assert.match(modelSelectorSource, /resolvedContextKind/);
  assert.match(modelSelectorSource, /triggerFound/);
  assert.match(modelSelectorSource, /currentStatePresent/);
  assert.match(modelSelectorSource, /modelSource/);
  assert.match(modelSelectorSource, /thinkingEffort/);
  assert.match(modelSelectorSource, /performance/);
  assert.match(modelSelectorSource, /triggerApplied/);
  assert.match(modelSelectorSource, /currentTriggerInComposer/);
  assert.match(modelSelectorSource, /scanReason/);
  assert.match(modelSelectorSource, /scanOutcome/);
  assert.match(modelSelectorSource, /currentContextKind/);
  assert.match(modelSelectorSource, /currentStateContextKind/);
  assert.match(modelSelectorSource, /currentStateContextMatchesCurrent/);
  assert.match(modelSelectorSource, /lastNavigationResetPresent/);
  assert.match(modelSelectorSource, /lastNavigationResetPreserved/);
  assert.match(modelSelectorSource, /navigationResetHistory/);
  assert.match(modelSelectorSource, /lastStateMutation/);
  assert.match(modelSelectorSource, /confirmedComposerStatePresent/);
  assert.match(modelSelectorSource, /confirmedComposerContextMatchesCurrent/);
  assert.match(modelSelectorSource, /navigationCarryStatePresent/);
  assert.match(modelSelectorSource, /navigationCarryContextMatchesCurrent/);
  assert.match(modelSelectorSource, /conversationStatePresent/);
  assert.match(modelSelectorSource, /conversationContextMatchesCurrent/);
  assert.match(contentSource, /lastTransitionInternalSnapshot/);
  assert.match(contentSource, /navigationResetHistory/);
  assert.match(contentSource, /lastStateMutation/);
  assert.doesNotMatch(contentSource, /setInterval\s*\(/);
  assert.match(readme, /常時ログ、追加Observer、ポーリングはありません/);
});

test('watch probe keeps the report privacy bounded', () => {
  const combined = `${contentSource}\n${mainSource}\n${backgroundSource}\n${popupSource}`;
  assert.doesNotMatch(contentSource, /document\.cookie/);
  assert.match(contentSource, /localStorage\.getItem/);
  assert.match(contentSource, /sessionStorage/);
  assert.match(contentSource, /summarizeSemanticStorageArea\(sessionStorage, 'session'\)/);
  assert.match(contentSource, /MAX_PRE_PICKER_STORAGE_SIGNALS = 16/);
  assert.match(mainSource, /MAX_INDEXED_DB_RECORD_SAMPLES/);
  assert.match(mainSource, /MAX_REACT_DOM_ANCESTORS/);
  assert.doesNotMatch(mainSource, /\.innerHTML|\.outerHTML|document\.cookie|fetch\s*\(|XMLHttpRequest/);
  assert.doesNotMatch(contentSource, /innerHTML|outerHTML|location\.href/);
  assert.doesNotMatch(combined, /document\.cookie|headers\.get\(['"]authorization|Bearer\s+[A-Za-z0-9._-]+|conversationId\s*:/i);
  assert.match(readme, /Storage値そのものやmodel slug実値は保存しません/);
  assert.match(readme, /thinking effortはArcaia internal snapshotから受け取った既知enumだけ/);
  assert.match(readme, /会話本文/);
  assert.match(readme, /URL全文/);
  assert.match(readme, /isolated world/);
  assert.match(contentSource, /conversationTextCollected: false/);
  assert.match(contentSource, /conversationIdsCollected: false/);
  assert.match(contentSource, /urlsCollected: false/);
  assert.match(contentSource, /MAX_PENDING_SYNC_REQUESTS = 12/);
  assert.doesNotMatch(contentSource, /supply:\s*\{[^}]*requestId|supply:\s*\{[^}]*conversationId/s);
});
