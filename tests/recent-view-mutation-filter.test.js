const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('../tools/playwright_browser');

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

const classifierSource = `
  const MESSAGE_SECTION_SELECTOR = 'section[data-testid^="conversation-turn-"]';
  const LITE_GROUPING_ROLE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
  let rollingLiteRolelessSectionState = new WeakMap();
  ${extractFunction('getTopLevelRollingLiteMessageSections')}
  ${extractFunction('isTopLevelMessageSection')}
  ${extractFunction('getSectionOwnedRoleNodes')}
  ${extractFunction('isRollingLiteGroupingSectionMeaningful')}
  ${extractFunction('resetRollingLiteGroupingMutationState')}
  ${extractFunction('mutationNodeContainsLiteGroupingStructure')}
  ${extractFunction('collectRollingLiteMutationSections')}
  ${extractFunction('shouldScheduleRollingLiteForMutations')}
  window.__arcaiaRecentMutationFilter = {
    reset: resetRollingLiteGroupingMutationState,
    shouldSchedule: shouldScheduleRollingLiteForMutations
  };
`;

test('Recent View schedules only proven grouping mutations while shared content observation stays broad', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main id="content-root">
        <section data-testid="conversation-turn-1">
          <div data-message-author-role="assistant" data-message-id="message-1">
            <div id="answer">answer</div>
            <pre id="code" data-start="1" data-end="2">code</pre>
          </div>
        </section>
      </main>
    `);
    await page.addScriptTag({ content: classifierSource });
    await page.evaluate(() => {
      const root = document.getElementById('content-root');
      window.__recentMutationResults = [];
      window.__arcaiaRecentMutationFilter.reset(root);
      const observer = new MutationObserver((mutations) => {
        window.__recentMutationResults.push(window.__arcaiaRecentMutationFilter.shouldSchedule(mutations));
      });
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'data-message-author-role',
          'data-message-id',
          'data-writing-block',
          'data-writing-block-fullscreen-fallback-target',
          'data-writing-block-fullscreen-header-chrome',
          'data-start',
          'data-end'
        ]
      });
      window.__recentMutationObserver = observer;
    });

    async function mutateAndCollect(expression) {
      await page.evaluate(expression);
      return page.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return window.__recentMutationResults.splice(0);
      });
    }

    assert.deepEqual(await mutateAndCollect(() => {
      document.getElementById('answer').append(document.createTextNode(' streamed'));
    }), [false]);

    assert.deepEqual(await mutateAndCollect(() => {
      document.getElementById('code').setAttribute('data-start', '2');
    }), [false]);

    assert.deepEqual(await mutateAndCollect(() => {
      const badge = document.createElement('span');
      badge.dataset.arcaiaProbe = 'self-injected';
      badge.textContent = 'meta';
      document.getElementById('answer').append(badge);
    }), [false]);

    assert.deepEqual(await mutateAndCollect(() => {
      const section = document.createElement('section');
      section.dataset.testid = 'conversation-turn-2';
      document.getElementById('content-root').append(section);
    }), [true]);

    assert.deepEqual(await mutateAndCollect(() => {
      document.querySelector('[data-testid="conversation-turn-2"]').append(document.createTextNode('pending'));
    }), [true]);

    assert.deepEqual(await mutateAndCollect(() => {
      document.querySelector('[data-testid="conversation-turn-2"]').append(document.createTextNode(' stream'));
    }), [false]);

    assert.deepEqual(await mutateAndCollect(() => {
      document.querySelector('[data-testid="conversation-turn-2"]').replaceChildren();
    }), [true]);

    assert.deepEqual(await mutateAndCollect(() => {
      const role = document.createElement('div');
      role.dataset.messageAuthorRole = 'user';
      role.dataset.messageId = 'message-2';
      document.querySelector('[data-testid="conversation-turn-2"]').append(role);
    }), [true]);

    assert.deepEqual(await mutateAndCollect(() => {
      document.querySelector('[data-message-id="message-2"]').dataset.messageId = 'message-2b';
    }), [true]);

    assert.deepEqual(await mutateAndCollect(() => {
      document.querySelector('[data-message-id="message-2b"]').dataset.messageAuthorRole = 'assistant';
    }), [true]);

    assert.deepEqual(await mutateAndCollect(() => {
      document.querySelector('[data-message-id="message-2b"]').remove();
    }), [true]);

    assert.deepEqual(await mutateAndCollect(() => {
      document.querySelector('[data-testid="conversation-turn-2"]').remove();
    }), [true]);
  } finally {
    await browser.close();
  }
});
