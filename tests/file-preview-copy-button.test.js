const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('../tools/playwright_browser');

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const markdownSource = fs.readFileSync(path.join(__dirname, '..', 'content_markdown.js'), 'utf8');

test('file preview Markdown serializer preserves document structure', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>
      <div id="preview" class="ProseMirror markdown">
        <h1>Title</h1>
        <p>Hello <strong>world</strong> and <a href="https://example.com">link</a>.</p>
        <ul><li>One</li><li>Two</li></ul>
        <pre><code class="language-css">.card {\n  color: red;\n}</code></pre>
      </div>
    </body></html>`);
    await page.addScriptTag({ content: markdownSource });
    const result = await page.evaluate(() => window.ArcaiaContentMarkdown.serializeFilePreviewMarkdown(document.getElementById('preview')));
    assert.equal(result, [
      '# Title',
      '',
      'Hello **world** and [link](https://example.com).',
      '',
      '- One',
      '- Two',
      '',
      '```css',
      '.card {',
      '  color: red;',
      '}',
      '```'
    ].join('\n'));
  } finally {
    await browser.close();
  }
});

test('file preview raw source extraction keeps CSS unfenced', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>
      <div id="preview" class="ProseMirror markdown">
        <pre><code><span>.card</span> {\n  color: red;\n}</code></pre>
      </div>
    </body></html>`);
    await page.addScriptTag({ content: markdownSource });
    const result = await page.evaluate(() => window.ArcaiaContentMarkdown.extractFilePreviewRawText(document.getElementById('preview')));
    assert.equal(result, '.card {\n  color: red;\n}');
    assert.doesNotMatch(result, /```/);
  } finally {
    await browser.close();
  }
});

test('file preview copy button uses the flyout toolbar and format-aware extraction without polling', () => {
  const start = contentSource.indexOf('  const FILE_PREVIEW_STAGE_SELECTOR');
  const end = contentSource.indexOf('  function startArcaiaPageUi()', start);
  const source = contentSource.slice(start, end);
  assert.match(source, /\[data-testid="stage-thread-flyout"\]/);
  assert.match(source, /section\[data-testid="screen-threadFlyOut"\]/);
  assert.match(source, /button\[data-testid="close-button"\]/);
  assert.match(source, /FILE_PREVIEW_MARKDOWN_EXTENSIONS/);
  assert.match(source, /serializeFilePreviewMarkdown\(editor\)/);
  assert.match(source, /getContentMarkdown\(\)\.extractFilePreviewRawText\(editor\)/);
  assert.match(source, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(source, /FILE_PREVIEW_COPY_RESET_MS = 2000/);
  assert.match(source, /createFilePreviewCheckIcon/);
  assert.match(source, /showFilePreviewCopySuccess\(button\)/);
  assert.match(source, /button\.dataset\.arcaiaCopied/);
  assert.match(source, /installArcaiaTooltip\(button, 'コピー'\)/);
  assert.match(source, /setArcaiaTooltipText\(button, copied \? 'コピーしました' : 'コピー'\)/);
  assert.doesNotMatch(source, /bg-token-bg-elevated-secondary|text-token-text-primary|shadow-lg/);
  assert.doesNotMatch(source, /button\.title\s*=/);
  assert.match(source, /new MutationObserver\(ensureFilePreviewCopyButton\)/);
  assert.match(source, /handleFilePreviewPotentialOpenClick/);
  assert.match(source, /FILE_PREVIEW_OPEN_TIMEOUT_MS = 3000/);
  assert.doesNotMatch(source, /setInterval/);
});
