const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('../tools/playwright_browser');

const source = fs.readFileSync(path.join(__dirname, '..', 'content_model_selector.js'), 'utf8');

test('Aurora Edge keeps the rich selector compact and theme-aware', () => {
  assert.match(source, /min-width:\s*0\s*!important/);
  assert.match(source, /linear-gradient\(112deg, #67e8f9 0%, #60a5fa 52%, #c084fc 100%\)/);
  assert.match(source, /0 0 23px rgba\(139,92,246,\.34\)/);
  assert.match(source, /html\.dark/);
  assert.match(source, /button\[\$\{RICH_ATTR\}=\"true\"\]:focus-visible/);
  assert.match(source, /form\[\$\{COMPOSER_RICH_ATTR\}=\"true\"\][\s\S]*?padding-inline-end:\s*calc/);
  assert.doesNotMatch(source, /setInterval\(/);
});

test('model selector exposes Classic, Aurora, and Frosted visual styles without duplicating runtime observers', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html class="dark" lang="ja"><body>
        <button role="radio" data-state="on">Chat</button>
        <button role="radio" data-state="off">Work</button>
        <form data-type="unified-composer">
          <div id="prompt-textarea" contenteditable="true"></div>
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
    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.start());
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');

    const aurora = await page.evaluate(() => {
      const api = window.__ARCAIA_MODEL_SELECTOR_UI__;
      api.setVisualStyle('aurora');
      const trigger = document.getElementById('model');
      return {
        style: trigger.getAttribute('data-arcaia-model-style'),
        shadow: getComputedStyle(trigger).boxShadow
      };
    });
    assert.equal(aurora.style, 'aurora');
    assert.notEqual(aurora.shadow, 'none');

    const classic = await page.evaluate(() => {
      const api = window.__ARCAIA_MODEL_SELECTOR_UI__;
      api.setVisualStyle('classic');
      const trigger = document.getElementById('model');
      return {
        style: trigger.getAttribute('data-arcaia-model-style'),
        minWidth: getComputedStyle(trigger).minWidth
      };
    });
    assert.equal(classic.style, 'classic');
    assert.equal(classic.minWidth, '142px');

    const outline = await page.evaluate(() => {
      const api = window.__ARCAIA_MODEL_SELECTOR_UI__;
      api.setVisualStyle('outline');
      return true;
    });
    assert.equal(outline, true);
    await page.waitForTimeout(200);
    const outlineComputed = await page.evaluate(() => {
      const trigger = document.getElementById('model');
      const performance = trigger.querySelector('.arcaia-model-performance');
      const sparkle = trigger.querySelector('.arcaia-model-sparkle');
      return {
        style: trigger.getAttribute('data-arcaia-model-style'),
        borderColor: getComputedStyle(trigger).borderColor,
        shadow: getComputedStyle(trigger).boxShadow,
        performanceColor: performance ? getComputedStyle(performance).color : null,
        sparkleDisplay: sparkle ? getComputedStyle(sparkle).display : null
      };
    });
    assert.equal(outlineComputed.style, 'outline');
    assert.equal(outlineComputed.borderColor, 'rgba(255, 255, 255, 0.82)');
    assert.notEqual(outlineComputed.shadow, 'none');
    assert.match(source, /backdrop-filter:\s*blur\(8px\) saturate\(\.82\)/);
    assert.match(source, /0 0 13px rgba\(255,255,255,\.14\)/);
    assert.equal(outlineComputed.performanceColor, 'rgba(255, 255, 255, 0.96)');
    assert.equal(outlineComputed.sparkleDisplay, 'none');
    assert.equal(await page.locator('#model .arcaia-model-performance').textContent(), 'high');
    assert.equal(
      await page.locator('#model .arcaia-model-suffix').evaluate((el) => getComputedStyle(el).textTransform),
      'lowercase'
    );
    assert.match(source, /'軽': 'light'/);
    assert.match(source, /'中程度': 'medium'/);
    assert.match(source, /'非常に高い': 'very high'/);
    assert.match(source, /'最大': 'maximum'/);
  } finally {
    await browser.close();
  }
});

test('model decoration reserves only the width added beyond the native trigger', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html>
        <html class="dark" lang="ja">
          <head>
            <style>
              form { position: relative; width: 620px; min-height: 48px; }
              #prompt-textarea { box-sizing: border-box; width: 100%; line-height: 26px; padding: 0 18px 16px; }
              #model { position: absolute; inset-inline-end: 48px; top: 8px; display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 8px; }
              #model svg { width: 14px; height: 14px; }
            </style>
          </head>
          <body>
            <button role="radio" data-state="on">Chat</button>
            <button role="radio" data-state="off">Work</button>
            <form data-type="unified-composer">
              <div id="prompt-textarea" contenteditable="true">長いテキスト入力を再現します</div>
              <button id="model" aria-haspopup="menu"><span>&#39640;&#12356;</span><svg viewBox="0 0 16 16"></svg></button>
            </form>
          </body>
        </html>`
    }));
    await page.goto('https://chatgpt.test/');
    await page.evaluate(() => {
      localStorage.setItem('oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt'));
      document.cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'extended' }))}; path=/`;
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      window.__ARCAIA_MODEL_SELECTOR_UI__.start();
      window.__ARCAIA_MODEL_SELECTOR_UI__.scan('aurora_edge_layout_test');
    });
    await page.waitForFunction(() => document.getElementById('model')?.getAttribute('data-arcaia-model-rich') === 'true');

    const decorated = await page.evaluate(() => {
      const composer = document.querySelector('form[data-type="unified-composer"]');
      const editor = document.getElementById('prompt-textarea');
      const trigger = document.getElementById('model');
      return {
        composerMarked: composer.getAttribute('data-arcaia-model-rich-composer'),
        nativeWidth: Number(trigger.getAttribute('data-arcaia-model-native-width')),
        richWidth: trigger.getBoundingClientRect().width,
        basePadding: Number.parseFloat(composer.style.getPropertyValue('--arcaia-model-native-editor-padding-end')),
        extraReserve: Number.parseFloat(composer.style.getPropertyValue('--arcaia-model-extra-inline-reserve')),
        computedPadding: Number.parseFloat(getComputedStyle(editor).paddingInlineEnd),
        backgroundImage: getComputedStyle(trigger).backgroundImage,
        boxShadow: getComputedStyle(trigger).boxShadow
      };
    });

    assert.equal(decorated.composerMarked, 'true');
    assert.ok(decorated.richWidth > decorated.nativeWidth);
    assert.ok(
      decorated.extraReserve >= Math.ceil(decorated.richWidth - decorated.nativeWidth + 18),
      'real-browser evidence requires an additional safety gap beyond the decorated width delta'
    );
    assert.ok(decorated.computedPadding >= decorated.basePadding + decorated.extraReserve - 0.5);
    assert.match(decorated.backgroundImage, /linear-gradient/);
    assert.notEqual(decorated.boxShadow, 'none');

    const multiline = await page.evaluate(() => {
      const composer = document.querySelector('form[data-type="unified-composer"]');
      const editor = document.getElementById('prompt-textarea');
      editor.textContent = '複数行入力を再現します。'.repeat(80);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
      return {
        marked: composer.hasAttribute('data-arcaia-model-rich-composer'),
        reserve: composer.style.getPropertyValue('--arcaia-model-extra-inline-reserve'),
        height: editor.scrollHeight
      };
    });
    assert.equal(multiline.marked, false);
    assert.equal(multiline.reserve, '');
    assert.ok(multiline.height > 42);

    const singlelineAgain = await page.evaluate(() => {
      const composer = document.querySelector('form[data-type="unified-composer"]');
      const editor = document.getElementById('prompt-textarea');
      editor.textContent = '短い入力';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      return {
        marked: composer.getAttribute('data-arcaia-model-rich-composer'),
        reserve: Number.parseFloat(composer.style.getPropertyValue('--arcaia-model-extra-inline-reserve')),
        height: editor.scrollHeight
      };
    });
    assert.equal(singlelineAgain.marked, 'true');
    assert.ok(singlelineAgain.reserve > 0);
    assert.ok(singlelineAgain.height <= 42);

    await page.evaluate(() => window.__ARCAIA_MODEL_SELECTOR_UI__.cleanup('aurora_edge_test'));
    const restored = await page.evaluate(() => {
      const composer = document.querySelector('form[data-type="unified-composer"]');
      const trigger = document.getElementById('model');
      return {
        composerMarked: composer.hasAttribute('data-arcaia-model-rich-composer'),
        reserve: composer.style.getPropertyValue('--arcaia-model-extra-inline-reserve'),
        nativeWidth: trigger.hasAttribute('data-arcaia-model-native-width')
      };
    });
    assert.deepEqual(restored, { composerMarked: false, reserve: '', nativeWidth: false });
  } finally {
    await browser.close();
  }
});
