const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const start = source.indexOf("  const HEADER_MARKDOWN_BUTTON_ID = 'arcaia-header-markdown-button';");
const end = source.indexOf('  function startArcaiaPageUi()', start);

test('header Markdown action matches Share styling and renders only a download icon', async () => {
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const featureSource = source.slice(start, end);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent(`
      <!doctype html>
      <html lang="ja">
        <body>
          <div id="stable-header-parent">
            <header>
              <div id="conversation-header-actions" class="translucent-surface flex items-center rounded-lg">
                <button
                  class="btn relative btn-ghost text-token-text-primary hover:bg-token-surface-hover rounded-lg max-sm:hidden"
                  aria-label="共有する"
                  data-testid="share-chat-button"
                ><div class="flex w-full items-center justify-center gap-1.5"><svg width="20" height="20"></svg>共有する</div></button>
              </div>
            </header>
          </div>
        </body>
      </html>
    `);
    await page.evaluate((code) => {
      window.__markdownSaveCount = 0;
      const prelude = `
        function isArcaiaNormalMode() { return true; }
        async function startToolbarMarkdownSaveFromPopup() { window.__markdownSaveCount += 1; }
      `;
      const expose = `
        window.__ensureHeaderMarkdownButton = ensureHeaderMarkdownButton;
        window.__syncHeaderMarkdownButtonUi = syncHeaderMarkdownButtonUi;
        window.__startHeaderMarkdownButtonUi = startHeaderMarkdownButtonUi;
        window.__stopHeaderMarkdownButtonUi = stopHeaderMarkdownButtonUi;
      `;
      (0, eval)(`${prelude}${code}${expose}`);
    }, featureSource);

    await page.evaluate(() => window.__startHeaderMarkdownButtonUi());
    const state = await page.evaluate(() => {
      const button = document.getElementById('arcaia-header-markdown-button');
      const share = document.querySelector('[data-testid="share-chat-button"]');
      const svg = button?.querySelector('svg');
      return {
        count: document.querySelectorAll('#arcaia-header-markdown-button').length,
        beforeShare: button?.nextElementSibling === share,
        sameClass: button?.className === share?.className,
        text: button?.textContent || '',
        ariaLabel: button?.getAttribute('aria-label'),
        title: button?.title,
        svgWidth: svg?.getAttribute('width'),
        svgHeight: svg?.getAttribute('height'),
        path: svg?.querySelector('path')?.getAttribute('d') || ''
      };
    });

    assert.deepEqual(state, {
      count: 1,
      beforeShare: true,
      sameClass: true,
      text: '',
      ariaLabel: '全ログをMarkdownでダウンロード',
      title: 'Arcaia: このチャットの全ログをMarkdownでダウンロード',
      svgWidth: '20',
      svgHeight: '20',
      path: 'M12 3v12m0 0 4-4m-4 4-4-4M5 21h14a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2'
    });

    await page.evaluate(() => window.__ensureHeaderMarkdownButton());
    assert.equal(await page.locator('#arcaia-header-markdown-button').count(), 1);

    await page.click('#arcaia-header-markdown-button');
    await page.waitForFunction(() => window.__markdownSaveCount === 1);

    await page.evaluate(() => document.getElementById('arcaia-header-markdown-button').remove());
    await page.waitForFunction(() => document.getElementById('arcaia-header-markdown-button'));

    await page.evaluate(() => {
      document.getElementById('stable-header-parent').innerHTML = `
        <header>
          <div id="conversation-header-actions-next">
            <button class="replacement-share" aria-label="共有する" data-testid="share-chat-button-next">共有する</button>
          </div>
        </header>
      `;
      window.__syncHeaderMarkdownButtonUi('page_structure_changed');
    });
    await page.waitForFunction(() => {
      const button = document.getElementById('arcaia-header-markdown-button');
      const share = document.querySelector('[data-testid="share-chat-button-next"]');
      return button?.nextElementSibling === share && button?.className === share?.className;
    });
    assert.equal(await page.locator('#arcaia-header-markdown-button').count(), 1);
  } finally {
    await browser.close();
  }
});

test('header Markdown startup follows a native Share control rendered after initial settings sync', async () => {
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const featureSource = source.slice(start, end);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent(`
      <!doctype html>
      <html lang="ja">
        <body>
          <div id="stable-header-parent">
            <header>
              <div id="conversation-header-actions"></div>
            </header>
          </div>
        </body>
      </html>
    `);
    await page.evaluate((code) => {
      const prelude = `
        function isArcaiaNormalMode() { return true; }
        async function startToolbarMarkdownSaveFromPopup() {}
      `;
      const expose = `
        window.__startHeaderMarkdownButtonUi = startHeaderMarkdownButtonUi;
        window.__stopHeaderMarkdownButtonUi = stopHeaderMarkdownButtonUi;
      `;
      (0, eval)(`${prelude}${code}${expose}`);
    }, featureSource);

    await page.evaluate(() => window.__startHeaderMarkdownButtonUi());
    assert.equal(await page.locator('#arcaia-header-markdown-button').count(), 0);

    await page.evaluate(() => {
      const share = document.createElement('button');
      share.className = 'late-share';
      share.setAttribute('aria-label', '共有する');
      share.setAttribute('data-testid', 'share-chat-button-late');
      document.getElementById('conversation-header-actions').appendChild(share);
    });
    await page.waitForFunction(() => {
      const button = document.getElementById('arcaia-header-markdown-button');
      const share = document.querySelector('[data-testid="share-chat-button-late"]');
      return button?.nextElementSibling === share && button?.className === share?.className;
    });

    await page.evaluate(() => window.__stopHeaderMarkdownButtonUi());
    assert.equal(await page.locator('#arcaia-header-markdown-button').count(), 0);
    await page.evaluate(() => {
      const share = document.querySelector('[data-testid="share-chat-button-late"]');
      share.remove();
      document.getElementById('conversation-header-actions').appendChild(share);
    });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#arcaia-header-markdown-button').count(), 0);
  } finally {
    await browser.close();
  }
});
