const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('../tools/playwright_browser');

const root = path.resolve(__dirname, '..');
const probeRoot = path.join(root, 'tools', 'arcaia_model_selector_interaction_probe_extension');
const manifest = JSON.parse(fs.readFileSync(path.join(probeRoot, 'manifest.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(probeRoot, 'main.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(probeRoot, 'content.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(probeRoot, 'popup.html'), 'utf8');
const popupSource = fs.readFileSync(path.join(probeRoot, 'popup.js'), 'utf8');
const readme = fs.readFileSync(path.join(probeRoot, 'README.md'), 'utf8');

test('model selector interaction probe uses separate document-start MAIN and isolated scripts', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.1.0');
  assert.equal(manifest.content_scripts.length, 2);
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.equal(manifest.content_scripts[1].run_at, 'document_start');
  assert.doesNotMatch(contentSource, /setInterval\s*\(/);
  assert.match(contentSource, /MAX_DURATION_MS\s*=\s*20\s*\*\s*60\s*\*\s*1000/);
  assert.match(contentSource, /MAX_RECORDS\s*=\s*700/);
  assert.match(readme, /Composerと表示中Pickerだけを局所監視/);
  assert.match(readme, /文字入力そのものでは自動captureしません/);
  assert.doesNotMatch(contentSource, /addEventListener\('input',\s*handleInteraction/);
  assert.match(contentSource, /nodeTouchesModelUi/);
});

test('probe captures overlap, picker selection, authoritative state, Arcaia state, and style fingerprints', () => {
  assert.match(contentSource, /lastTextTriggerOverlapPx/);
  assert.match(contentSource, /internalRichOverlap/);
  assert.match(contentSource, /selectedSubtypeMatchesDecoration/);
  assert.match(contentSource, /authorityFamilyMatchesDecoration/);
  assert.match(contentSource, /ARCAIA_MODEL_SELECTOR_INTERNAL_PROBE_REQUEST/);
  assert.match(contentSource, /data-arcaia-model-style/);
  assert.match(contentSource, /backgroundImage/);
  assert.match(contentSource, /boxShadow/);
  assert.match(mainSource, /workModel/);
  assert.match(mainSource, /chatModel/);
  assert.match(mainSource, /family = 'sol'/);
  assert.match(mainSource, /family = 'terra'/);
  assert.match(mainSource, /family = 'luna'/);
  assert.match(popupHtml, /chat_selection/);
  assert.match(popupHtml, /work_selection/);
  assert.match(popupSource, /button\.dataset\.scenario/);
});

test('probe report is privacy bounded', () => {
  assert.match(contentSource, /conversationTextStored:\s*false/);
  assert.match(contentSource, /rawCookieStored:\s*false/);
  assert.match(contentSource, /rawStorageStored:\s*false/);
  assert.doesNotMatch(contentSource, /location\.href/);
  assert.doesNotMatch(contentSource, /innerHTML/);
  assert.doesNotMatch(mainSource, /payload:\s*\{[^}]*document\.cookie/s);
  assert.match(readme, /入力文字列/);
});

test('probe detects a Work authority/decorated subtype mismatch and editor overlap', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html class="dark"><body>
        <button role="radio" data-state="off">Chat</button>
        <button role="radio" data-state="on">Work</button>
        <form data-type="unified-composer" style="position:relative;width:620px;height:70px">
          <div id="prompt-textarea" contenteditable="true" style="display:block;width:590px;white-space:nowrap;padding:8px 0">これは重なり確認用の長い入力テキストです。これは重なり確認用の長い入力テキストです。これは重なり確認用の長い入力テキストです。</div>
          <button id="model" aria-haspopup="menu" data-arcaia-model-rich="true" data-arcaia-model-version="GPT-5.6" data-arcaia-model-performance="高い" style="position:absolute;right:0;top:4px;width:150px;height:34px">
            <span data-arcaia-model-rich-content="true"><span class="arcaia-model-version">GPT-5.6</span><span class="arcaia-model-suffix">Sol</span><span class="arcaia-model-performance">高い</span></span><svg></svg>
          </button>
        </form>
        <div data-testid="composer-intelligence-picker-content" style="display:block">
          <div role="menuitemradio" aria-checked="true">GPT-5.6 Terra</div>
          <div role="menuitemradio" aria-checked="false">GPT-5.6 Sol</div>
        </div>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
      localStorage.setItem('oai/apps/tpp/model-settings', JSON.stringify({ lastUsedModelSlug: 'gpt-5.6-terra-wm' }));
      localStorage.setItem('oai/apps/tpp/thinking-effort', JSON.stringify('extended'));
    });
    await page.addScriptTag({ content: mainSource });
    await page.addScriptTag({ content: contentSource });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_INTERACTION_PROBE__.capture('test_fixture'));
    await page.waitForTimeout(100);
    const report = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_INTERACTION_PROBE__.report());
    const mainRecord = report.records.find((record) => record.type === 'main_state_snapshot');
    const domRecord = report.records.find((record) => record.type === 'dom_snapshot' && record.dom?.reason === 'test_fixture');
    assert.equal(mainRecord.state.surface, 'work');
    assert.equal(mainRecord.state.workModel.family, 'terra');
    assert.equal(mainRecord.consistency.authorityFamilyMatchesDecoration, false);
    assert.equal(domRecord.dom.trigger.subtype, 'sol');
    assert.equal(domRecord.dom.picker.selected[0].subtype, 'terra');
    assert.equal(domRecord.dom.consistency.selectedSubtypeMatchesDecoration, false);
    assert.ok(domRecord.dom.geometry.editorTriggerBoxOverlapPx > 0);
  } finally {
    await browser.close();
  }
});

test('long composer input does not exhaust the record budget before manual model captures', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <button role="radio" data-state="on">Chat</button>
        <button role="radio" data-state="off">Work</button>
        <form data-type="unified-composer">
          <div id="prompt-textarea" contenteditable="true"></div>
          <button id="model" aria-haspopup="menu" data-arcaia-model-rich="true" data-arcaia-model-version="GPT-5.6" data-arcaia-model-performance="高い">
            <span data-arcaia-model-rich-content="true"><span class="arcaia-model-version">GPT-5.6</span><span class="arcaia-model-suffix">Sol</span><span class="arcaia-model-performance">高い</span></span><svg></svg>
          </button>
        </form>
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.addScriptTag({ content: mainSource });
    await page.addScriptTag({ content: contentSource });
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_INTERACTION_PROBE__.reset());
    await page.locator('#prompt-textarea').fill('あ'.repeat(180));
    await page.waitForTimeout(1050);
    const beforeManual = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_INTERACTION_PROBE__.report());
    assert.equal(beforeManual.summary.droppedRecordCount, 0);
    assert.ok(beforeManual.summary.recordCount < 80);
    assert.equal(
      beforeManual.records.some((record) => record.dom?.reason === 'composer_input'),
      false
    );
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_INTERACTION_PROBE__.mark('chat_selection'));
    await page.waitForTimeout(1050);
    const afterManual = await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_INTERACTION_PROBE__.report());
    assert.equal(afterManual.summary.droppedRecordCount, 0);
    assert.equal(afterManual.records.some((record) => record.scenario === 'chat_selection'), true);
    assert.equal(afterManual.records.some((record) => record.dom?.reason === 'manual_chat_selection'), true);
  } finally {
    await browser.close();
  }
});
