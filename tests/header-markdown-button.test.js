const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('../tools/playwright_browser');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const start = source.indexOf("  const HEADER_MARKDOWN_BUTTON_ID = 'arcaia-header-markdown-button';");
const end = source.indexOf('  function startArcaiaPageUi()', start);

test('header Markdown action matches Share styling and renders the Lucide file-down icon', async () => {
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const featureSource = source.slice(start, end);
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent(`
      <!doctype html>
      <html lang="ja">
        <body>
          <div id="stable-header-parent">
            <header>
              <div id="conversation-header-actions" class="translucent-surface flex items-center gap-2 rounded-lg" style="display:flex">
                <div id="share-action-root" class="-me-2">
                  <div><div><span>
                    <button
                      class="btn relative btn-ghost text-token-text-primary hover:bg-token-surface-hover rounded-lg max-sm:hidden"
                      aria-label="共有する"
                      data-testid="share-chat-button"
                    ><div class="flex w-full items-center justify-center gap-1.5"><svg width="20" height="20"></svg>共有する</div></button>
                  </span></div></div>
                </div>
                <button id="other-header-action">Other</button>
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
        function installArcaiaTooltip(button, text) { button.setAttribute('data-arcaia-tooltip-text', text); }
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
      const shareActionRoot = document.getElementById('share-action-root');
      const svg = button?.querySelector('svg');
      const buttonRect = button?.getBoundingClientRect();
      const shareRect = share?.getBoundingClientRect();
      return {
        count: document.querySelectorAll('#arcaia-header-markdown-button').length,
        parentId: button?.parentElement?.id || '',
        beforeShareAction: button?.nextElementSibling === shareActionRoot,
        sameClass: button?.className === share?.className,
        sameRow: buttonRect?.y === shareRect?.y,
        text: button?.textContent || '',
        ariaLabel: button?.getAttribute('aria-label'),
        titlePresent: button?.hasAttribute('title'),
        tooltipText: button?.getAttribute('data-arcaia-tooltip-text'),
        svgWidth: svg?.getAttribute('width'),
        svgHeight: svg?.getAttribute('height'),
        viewBox: svg?.getAttribute('viewBox'),
        paths: Array.from(svg?.querySelectorAll('path') || []).map((path) => path.getAttribute('d')),
        rectCount: svg?.querySelectorAll('rect').length || 0
      };
    });

    assert.deepEqual(state, {
      count: 1,
      parentId: 'conversation-header-actions',
      beforeShareAction: true,
      sameClass: true,
      sameRow: true,
      text: '',
      ariaLabel: '全ログをMarkdownでダウンロード',
      titlePresent: false,
      tooltipText: 'Arcaia: このチャットの全ログをMarkdownでダウンロード',
      svgWidth: '20',
      svgHeight: '20',
      viewBox: '0 0 24 24',
      paths: [
        'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
        'M14 2v5a1 1 0 0 0 1 1h5',
        'M12 18v-6',
        'm9 15 3 3 3-3'
      ],
      rectCount: 0
    });

    await page.evaluate(() => {
      const button = document.getElementById('arcaia-header-markdown-button');
      button.title = 'legacy title';
      button.removeAttribute('data-arcaia-tooltip-text');
      window.__ensureHeaderMarkdownButton();
    });
    assert.equal(await page.locator('#arcaia-header-markdown-button').count(), 1);
    assert.equal(await page.locator('#arcaia-header-markdown-button').getAttribute('title'), null);
    assert.equal(
      await page.locator('#arcaia-header-markdown-button').getAttribute('data-arcaia-tooltip-text'),
      'Arcaia: このチャットの全ログをMarkdownでダウンロード'
    );

    await page.click('#arcaia-header-markdown-button');
    await page.waitForFunction(() => window.__markdownSaveCount === 1);

    await page.evaluate(() => document.getElementById('arcaia-header-markdown-button').remove());
    await page.waitForFunction(() => document.getElementById('arcaia-header-markdown-button'));

    await page.evaluate(() => {
      document.getElementById('stable-header-parent').innerHTML = `
        <header>
          <div id="conversation-header-actions-next" style="display:flex">
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
  const browser = await launchBrowser({ headless: true });
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
        function installArcaiaTooltip(button, text) { button.setAttribute('data-arcaia-tooltip-text', text); }
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
      const shareRoot = document.createElement('div');
      shareRoot.id = 'late-share-action-root';
      shareRoot.innerHTML = '<span></span>';
      const share = document.createElement('button');
      share.className = 'late-share';
      share.setAttribute('aria-label', '共有する');
      share.setAttribute('data-testid', 'share-chat-button-late');
      shareRoot.querySelector('span').appendChild(share);
      const actions = document.getElementById('conversation-header-actions');
      actions.style.display = 'flex';
      actions.appendChild(shareRoot);
    });
    await page.waitForFunction(() => {
      const button = document.getElementById('arcaia-header-markdown-button');
      const share = document.querySelector('[data-testid="share-chat-button-late"]');
      const shareRoot = document.getElementById('late-share-action-root');
      return button?.parentElement?.id === 'conversation-header-actions'
        && button?.nextElementSibling === shareRoot
        && button?.className === share?.className;
    });

    await page.evaluate(() => window.__stopHeaderMarkdownButtonUi());
    assert.equal(await page.locator('#arcaia-header-markdown-button').count(), 0);
    await page.evaluate(() => {
      const shareRoot = document.getElementById('late-share-action-root');
      shareRoot.remove();
      document.getElementById('conversation-header-actions').appendChild(shareRoot);
    });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#arcaia-header-markdown-button').count(), 0);
  } finally {
    await browser.close();
  }
});

test('header Markdown startup waits for window load before mutating the server-rendered header', async () => {
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const featureSource = source.slice(start, end);
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    let releaseSlowImage;
    const slowImageGate = new Promise((resolve) => { releaseSlowImage = resolve; });
    await page.route('https://chatgpt.test/slow.gif', async (route) => {
      await slowImageGate;
      await route.fulfill({
        contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
      });
    });
    await page.route('https://chatgpt.test/', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><body>
        <header><div id="actions" style="display:flex">
          <button class="native-share" aria-label="共有する" data-testid="share-chat-button">共有する</button>
        </div></header>
        <img src="/slow.gif" alt="">
      </body></html>`
    }));
    await page.goto('https://chatgpt.test/', { waitUntil: 'domcontentloaded' });
    assert.notEqual(await page.evaluate(() => document.readyState), 'complete');

    await page.evaluate((code) => {
      const prelude = `
        function isArcaiaNormalMode() { return true; }
        async function startToolbarMarkdownSaveFromPopup() {}
        function installArcaiaTooltip(button, text) { button.setAttribute('data-arcaia-tooltip-text', text); }
      `;
      const expose = `window.__startHeaderMarkdownButtonUi = startHeaderMarkdownButtonUi;`;
      (0, eval)(`${prelude}${code}${expose}`);
    }, featureSource);

    await page.evaluate(() => window.__startHeaderMarkdownButtonUi());
    assert.equal(await page.locator('#arcaia-header-markdown-button').count(), 0);

    releaseSlowImage();
    await page.waitForLoadState('load');
    await page.waitForFunction(() => document.getElementById('arcaia-header-markdown-button'));
    assert.equal(await page.locator('#arcaia-header-markdown-button').count(), 1);
  } finally {
    await browser.close();
  }
});
