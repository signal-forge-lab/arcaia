const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { launchBrowser } = require('../tools/playwright_browser');

const probePath = path.join(__dirname, '..', 'tools', 'arcaia_file_preview_copy_probe.js');
const source = fs.readFileSync(probePath, 'utf8');

test('file preview copy probe is a one-shot DevTools console probe, not an extension', () => {
  assert.match(source, /__ARCAIA_FILE_PREVIEW_COPY_PROBE__/);
  assert.match(source, /document\.addEventListener\('click', clickListener, true\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.doesNotMatch(source, /chrome\.(?:runtime|tabs|storage|scripting)/);
  assert.doesNotMatch(source, /MutationObserver|setInterval/);
});

test('file preview copy probe arms exactly one capture listener and exposes cleanup', () => {
  const listeners = [];
  const sandbox = {
    window: {},
    document: {
      addEventListener(type, listener, capture) { listeners.push({ type, listener, capture }); },
      removeEventListener() {}
    },
    console: { info() {}, log() {} },
    Element: class Element {},
    HTMLTextAreaElement: class HTMLTextAreaElement {},
    HTMLInputElement: class HTMLInputElement {},
    getComputedStyle() { return {}; },
    copy() {}
  };
  vm.runInNewContext(source, sandbox);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].type, 'click');
  assert.equal(listeners[0].capture, true);
  assert.equal(typeof sandbox.window.__ARCAIA_FILE_PREVIEW_COPY_PROBE__.cancel, 'function');
  assert.equal(sandbox.window.__ARCAIA_FILE_PREVIEW_COPY_PROBE__.result, null);
});

test('file preview copy probe uses the clicked pane and retains counts instead of text', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.setContent(`
      <main style="width:900px;height:900px"></main>
      <aside data-testid="file-preview-pane" style="position:fixed;right:0;top:0;width:500px;height:900px">
        <header style="display:flex"><button aria-label="Download">D</button><button aria-label="Close">X</button></header>
        <pre id="probe-target" style="height:400px">secret-file-body\nsecond-line</pre>
      </aside>
    `);
    await page.evaluate((probeSource) => (0, eval)(probeSource), source);
    await page.click('#probe-target');
    const result = await page.evaluate(() => window.__ARCAIA_FILE_PREVIEW_COPY_PROBE__.result);
    const serialized = JSON.stringify(result);
    assert.equal(result.probe.mode, 'one_shot_click_target');
    assert.equal(result.selectedPanel.element.dataTestId, 'file-preview-pane');
    assert.equal(result.selectedPanel.textSources[0].charCount, 28);
    assert.deepEqual(result.selectedPanel.buttons.map((button) => button.actionKind), ['download', 'close']);
    assert.doesNotMatch(serialized, /secret-file-body|second-line/);
  } finally {
    await browser.close();
  }
});

test('file preview copy probe is privacy bounded and exposes explicit JSON copy', () => {
  assert.match(source, /fileContentsCollected: false/);
  assert.match(source, /fileNamesCollected: false/);
  assert.match(source, /urlsCollected: false/);
  assert.match(source, /conversationTextCollected: false/);
  assert.match(source, /copy\(json\)/);
  assert.match(source, /json\(\) \{ return result/);
  assert.match(source, /charCount: text\.length/);
  assert.match(source, /lineCount: text \? text\.split/);
  assert.doesNotMatch(source, /innerHTML|document\.cookie|localStorage|sessionStorage|\bfetch\s*\(/);
});
