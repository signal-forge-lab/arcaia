const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser } = require('../tools/playwright_browser');

const probePath = path.join(__dirname, '..', 'tools', 'arcaia_file_preview_tooltip_probe.js');
const source = fs.readFileSync(probePath, 'utf8');

test('file preview tooltip probe is bounded, compares native and Arcaia, and downloads JSON', () => {
  assert.match(source, /__ARCAIA_FILE_PREVIEW_TOOLTIP_PROBE__/);
  assert.match(source, /PROBE_TIMEOUT_MS = 90000/);
  assert.match(source, /MAX_EVENTS = 120/);
  assert.match(source, /MAX_SNAPSHOTS = 80/);
  assert.match(source, /native_download/);
  assert.match(source, /arcaia_copy/);
  assert.match(source, /data-radix-popper-content-wrapper/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /associatedButtonKind/);
  assert.match(source, /backgroundColor/);
  assert.match(source, /outsideTop/);
  assert.match(source, /URL\.createObjectURL\(blob\)/);
  assert.match(source, /anchor\.download = `arcaia-file-preview-tooltip-probe-/);
  assert.doesNotMatch(source, /navigator\.clipboard|\bcopy\(|setInterval|chrome\.(?:runtime|tabs|storage|scripting)/);
  assert.doesNotMatch(source, /innerHTML|document\.cookie|localStorage|sessionStorage|\bfetch\s*\(/);
});

test('file preview tooltip probe identifies an Arcaia tooltip positioned above the viewport', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    await page.setContent(`<!doctype html><html><body>
      <section data-testid="screen-threadFlyOut" style="position:fixed;right:0;top:0;width:480px;height:700px">
        <div><button aria-label="Download">D</button><button data-arcaia-file-preview-copy-button="true" aria-label="Copy">C</button><button data-testid="close-button">X</button></div>
      </section>
    </body></html>`);
    await page.evaluate((probeSource) => (0, eval)(probeSource), source);
    await page.dispatchEvent('button[aria-label="Download"]', 'pointerover');
    await page.evaluate(() => {
      const native = document.createElement('div');
      native.id = 'native-download-tooltip';
      native.setAttribute('role', 'tooltip');
      native.setAttribute('data-side', 'bottom');
      native.textContent = 'Download';
      native.style.cssText = 'position:fixed;top:50px;left:800px;width:80px;height:24px';
      document.body.appendChild(native);
      document.querySelector('button[aria-label="Download"]').setAttribute('aria-describedby', native.id);
    });
    await page.dispatchEvent('[data-arcaia-file-preview-copy-button="true"]', 'pointerover');
    await page.evaluate(() => {
      const custom = document.createElement('div');
      custom.id = 'arcaia-file-preview-copy-tooltip';
      custom.setAttribute('role', 'tooltip');
      custom.setAttribute('data-side', 'top');
      custom.textContent = 'Copy';
      custom.style.cssText = 'position:fixed;top:-40px;left:900px;width:60px;height:24px';
      document.body.appendChild(custom);
      window.__ARCAIA_FILE_PREVIEW_TOOLTIP_PROBE__.snapshot();
    });
    const diagnosis = await page.evaluate(() => window.__ARCAIA_FILE_PREVIEW_TOOLTIP_PROBE__.json());
    assert.match(diagnosis, /arcaia_tooltip_positioned_above_viewport/);
    assert.match(diagnosis, /"nativeSides": \[\s*"bottom"/);
    await page.evaluate(() => window.__ARCAIA_FILE_PREVIEW_TOOLTIP_PROBE__.cancel());
  } finally {
    await browser.close();
  }
});
