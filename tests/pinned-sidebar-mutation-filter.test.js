const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

function extractFunction(name) {
  const marker = `  function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 2, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const classifierSource = String.raw`
  const PINNED_SORT_CONVERSATION_SELECTOR = 'a[data-sidebar-item="true"][href*="/c/"]';
  const PINNED_SORT_SECTION_SELECTOR = '.group\\/sidebar-expando-section';
  ${extractFunction('normalizePinnedSortText')}
  ${extractFunction('isPinnedSortSectionElement')}
  ${extractFunction('mutationNodeContainsPinnedSortSection')}
  ${extractFunction('mutationNodeContainsPinnedSortConversationAnchor')}
  ${extractFunction('getPinnedSortMutationSection')}
  ${extractFunction('shouldSchedulePinnedSortForMutations')}
  window.__arcaiaPinnedMutationFilter = shouldSchedulePinnedSortForMutations;
`;

test('Pinned rescans only for Pinned section or conversation-anchor structure changes', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <aside id="stage-slideover-sidebar">
        <nav aria-label="Chat history">
          <section id="pinned" class="group/sidebar-expando-section">
            <h2>Pinned</h2>
            <div id="pinned-list">
              <a id="pinned-chat" data-sidebar-item="true" href="/c/pinned-1">Pinned chat</a>
            </div>
          </section>
          <section id="recent" class="group/sidebar-expando-section">
            <h2>Recent</h2>
            <div id="recent-list">
              <a id="recent-chat" data-sidebar-item="true" href="/c/recent-1">Recent chat</a>
            </div>
          </section>
          <div id="sidebar-decoration"></div>
        </nav>
      </aside>
    `);
    await page.addScriptTag({ content: classifierSource });
    await page.evaluate(() => {
      const root = document.getElementById('stage-slideover-sidebar');
      window.__pinnedMutationResults = [];
      const observer = new MutationObserver((mutations) => {
        window.__pinnedMutationResults.push(window.__arcaiaPinnedMutationFilter(mutations));
      });
      observer.observe(root, { childList: true, subtree: true });
      window.__pinnedMutationObserver = observer;
    });

    async function mutateAndCollect(expression) {
      await page.evaluate(expression);
      return page.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return window.__pinnedMutationResults.splice(0);
      });
    }

    assert.deepEqual(await mutateAndCollect(() => {
      const icon = document.createElement('span');
      icon.dataset.arcaiaPinnedFavoriteIcon = 'star';
      document.getElementById('pinned-chat').append(icon);
    }), [false]);

    assert.deepEqual(await mutateAndCollect(() => {
      const anchor = document.createElement('a');
      anchor.dataset.sidebarItem = 'true';
      anchor.href = '/c/recent-2';
      document.getElementById('recent-list').append(anchor);
    }), [false]);

    assert.deepEqual(await mutateAndCollect(() => {
      document.getElementById('sidebar-decoration').append(document.createElement('span'));
    }), [false]);

    assert.deepEqual(await mutateAndCollect(() => {
      const anchor = document.createElement('a');
      anchor.id = 'pinned-chat-2';
      anchor.dataset.sidebarItem = 'true';
      anchor.href = '/c/pinned-2';
      document.getElementById('pinned-list').append(anchor);
    }), [true]);

    assert.deepEqual(await mutateAndCollect(() => {
      document.getElementById('pinned-chat-2').remove();
    }), [true]);

    assert.deepEqual(await mutateAndCollect(() => {
      const replacement = document.getElementById('pinned-chat').cloneNode(true);
      replacement.id = 'pinned-chat-replacement';
      document.getElementById('pinned-chat').replaceWith(replacement);
    }), [true]);

    assert.deepEqual(await mutateAndCollect(() => {
      const replacement = document.createElement('section');
      replacement.id = 'pinned-replacement';
      replacement.className = 'group/sidebar-expando-section';
      replacement.innerHTML = '<h2>Pinned</h2><div id="replacement-list"></div>';
      document.getElementById('pinned').replaceWith(replacement);
    }), [true]);

    assert.deepEqual(await mutateAndCollect(() => {
      const section = document.createElement('section');
      section.id = 'late-pinned';
      section.className = 'group/sidebar-expando-section';
      section.innerHTML = '<h2 id="late-pinned-heading"></h2>';
      document.querySelector('nav').append(section);
    }), [false]);

    assert.deepEqual(await mutateAndCollect(() => {
      document.getElementById('late-pinned-heading').textContent = 'ピン留め';
    }), [true]);
  } finally {
    await browser.close();
  }
});
