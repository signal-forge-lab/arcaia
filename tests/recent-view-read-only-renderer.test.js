'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { launchBrowser } = require('../tools/playwright_browser');

const root = path.join(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(root, 'content_recent_view_renderer.js'), 'utf8');
const injectedSource = fs.readFileSync(path.join(root, 'injected-main.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function extractFunction(source, name) {
  const markers = [`  function ${name}(`, `  async function ${name}(`];
  const start = markers.reduce((found, marker) => {
    const index = source.indexOf(marker);
    return index >= 0 && (found < 0 || index < found) ? index : found;
  }, -1);
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

function loadRendererApi() {
  const sandbox = {
    URL,
    window: {
      location: { href: 'https://chatgpt.com/c/test' }
    }
  };
  vm.runInNewContext(rendererSource, sandbox);
  return sandbox.window.ArcaiaRecentViewRenderer;
}

test('read-only renderer helper is loaded immediately before content.js', () => {
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('content_recent_view_renderer.js'));
  assert.ok(scripts.indexOf('content_model_selector.js') < scripts.indexOf('content_recent_view_renderer.js'));
  assert.ok(scripts.indexOf('content_recent_view_renderer.js') < scripts.indexOf('content.js'));
  assert.match(popupSource, /'content_recent_view_renderer\.js'[\s\S]*?'content\.js'/);
});

test('read-only Markdown parser recognizes the supported static block types', () => {
  const api = loadRendererApi();
  const blocks = api.parseMarkdown([
    '# Heading',
    '',
    '- one',
    '- two',
    '',
    '> quote',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```js',
    'const ok = true;',
    '```'
  ].join('\n'));
  assert.deepEqual(
    Array.from(blocks, (block) => block.type),
    ['heading', 'list', 'quote', 'table', 'code']
  );
  assert.equal(blocks.at(-1).language, 'js');
  assert.equal(blocks.at(-1).text, 'const ok = true;');
});

test('read-only renderer converts web and file citation tokens into source badges', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><main><div id="native"></div></main></body></html>');
    await page.addScriptTag({ content: rendererSource });
    await page.evaluate(() => {
      window.ArcaiaRecentViewRenderer.mount({
        nativeContentRoot: document.getElementById('native'),
        model: {
          conversationId: 'conversation-1',
          totalTurnCount: 1,
          visibleTurnCount: 1,
          turns: [{
            turnNumber: 1,
            user: { messageId: 'u1', text: 'Question' },
            assistant: {
              messageId: 'a1',
              text: 'Web citeturn0search0 File fileciteturn0file0'
            }
          }]
        }
      });
    });
    const result = await page.evaluate(() => ({
      text: document.querySelector('.arcaia-ror-message-assistant .arcaia-ror-body')?.textContent || '',
      badges: Array.from(document.querySelectorAll('.arcaia-ror-message-assistant .arcaia-ror-inline-citation')).map((node) => node.textContent)
    }));
    assert.deepEqual(result.badges, ['出典', '出典']);
    assert.doesNotMatch(result.text, /(?:file)?cite/);
  } finally {
    await browser.close();
  }
});

test('read-only renderer rejects executable and data URLs', () => {
  const api = loadRendererApi();
  assert.equal(api.safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(api.safeHttpUrl('data:text/html,test'), null);
  assert.equal(api.safeHttpUrl('/mnt/data/generated.png'), null);
  assert.equal(api.safeHttpUrl('sandbox:/mnt/data/generated.png'), null);
  assert.equal(api.safeHttpUrl('https://example.com/source'), 'https://example.com/source');
});

test('read-only renderer builds sandbox download targets with message context even without a matching resource', () => {
  const source = [
    extractFunction(rendererSource, 'sandboxFileName'),
    extractFunction(rendererSource, 'sandboxFilePath'),
    extractFunction(rendererSource, 'findSandboxDownloadResource'),
    extractFunction(rendererSource, 'buildSandboxDownloadTarget')
  ].join('\n');
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  const resources = [
    {
      name: 'chatgpt-soft-graphite-v1.0.25.user.css',
      fileId: 'file-css',
      assetPointer: 'sediment://file-css',
      mimeType: 'text/css',
      isImage: false
    },
    {
      name: 'UserStyles.world-v1.0.25-note.md',
      fileId: 'file-md',
      assetPointer: 'sediment://file-md',
      mimeType: 'text/markdown',
      isImage: false
    }
  ];
  assert.equal(
    sandbox.sandboxFileName('sandbox:/mnt/data/chatgpt-soft-graphite-v1.0.25.user.css'),
    'chatgpt-soft-graphite-v1.0.25.user.css'
  );
  assert.equal(
    sandbox.findSandboxDownloadResource(
      'sandbox:/mnt/data/UserStyles.world-v1.0.25-note.md',
      'UserStyles.world-v1.0.25-note.md',
      resources
    ).fileId,
    'file-md'
  );
  assert.equal(
    sandbox.findSandboxDownloadResource('javascript:alert(1)', 'bad', resources),
    null
  );
  const fallback = sandbox.buildSandboxDownloadTarget(
    'sandbox:/mnt/data/missing.txt',
    'missing.txt',
    resources,
    { conversationId: 'conversation-1', messageId: 'message-1' }
  );
  assert.equal(fallback.name, 'missing.txt');
  assert.equal(fallback.conversationId, 'conversation-1');
  assert.equal(fallback.messageId, 'message-1');
  assert.equal(fallback.sandboxPath, '/mnt/data/missing.txt');
  assert.equal(fallback.fileId, null);
  assert.equal(
    sandbox.buildSandboxDownloadTarget(
      'sandbox:/mnt/data/%2e%2e/secret.txt',
      'secret.txt',
      resources,
      { conversationId: 'conversation-1', messageId: 'message-1' }
    ),
    null
  );
});

test('read-only sandbox file links download resolved Blob data without enabling image rendering', () => {
  assert.match(rendererSource, /className = 'arcaia-ror-file-link'/);
  assert.match(rendererSource, /download\.download =/);
  assert.match(rendererSource, /Promise\.resolve\(resolveAsset\(resource\)\)/);
  assert.match(rendererSource, /buildSandboxDownloadTarget\(href, selected\.match\[1\], context\.resources, context\)/);
  assert.match(contentSource, /resource\?\.isImage && !liteShowImagesEnabled/);
  assert.match(contentSource, /conversationId: resource\?\.conversationId \|\| null/);
  assert.match(contentSource, /messageId: resource\?\.messageId \|\| null/);
  assert.match(contentSource, /sandboxPath: resource\?\.sandboxPath \|\| null/);
});

test('read-only renderer makes non-image user attachments downloadable through the existing asset resolver', () => {
  const renderResources = extractFunction(rendererSource, 'renderResources');
  assert.match(renderResources, /!resource\?\.isImage && typeof resolveAsset === 'function'/);
  assert.match(renderResources, /createSandboxFileButton\(fileName, resource, resolveAsset\)/);
  assert.match(renderResources, /card\.replaceChildren\(button\)/);
});

test('read-only renderer adds no polling or broad DOM observer', () => {
  assert.doesNotMatch(rendererSource, /MutationObserver|setInterval|addEventListener\(['"]scroll/);
  assert.match(rendererSource, /URL\.revokeObjectURL/);
  assert.match(rendererSource, /removeAttribute\?\.\(NATIVE_HIDDEN_ATTR\)/);
});

test('read-only renderer inherits the active native conversation appearance instead of its own dark palette', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html>
      <html><head><style>
        body { margin: 0; background: rgb(241, 238, 231); }
        #native { color: rgb(37, 42, 51); background: rgb(241, 238, 231); font: 17px/29px Georgia, serif; }
        #native [data-message-author-role="user"] .native-user-bubble {
          color: rgb(250, 248, 244);
          background: rgb(82, 93, 107);
        }
        #native a { color: rgb(126, 46, 176); }
        #native pre {
          color: rgb(226, 230, 235);
          background: rgb(55, 62, 72);
          border: 1px solid rgb(114, 123, 136);
        }
      </style></head><body>
        <main>
          <div id="native">
            <section><div data-message-author-role="user"><div class="native-user-bubble">Native user</div></div></section>
            <section><div data-message-author-role="assistant">Native assistant <a href="https://example.com">link</a><pre>code</pre></div></section>
          </div>
        </main>
      </body></html>
    `);
    await page.addScriptTag({ content: rendererSource });
    await page.evaluate(() => {
      window.ArcaiaRecentViewRenderer.mount({
        nativeContentRoot: document.getElementById('native'),
        model: {
          conversationId: 'conversation-1',
          totalTurnCount: 1,
          visibleTurnCount: 1,
          turns: [{
            turnNumber: 1,
            user: { messageId: 'u1', text: 'User message' },
            assistant: { messageId: 'a1', text: '[link](https://example.com)\n\n```js\ncode\n```' }
          }]
        }
      });
    });
    const appearance = await page.evaluate(() => {
      const root = document.getElementById('arcaia-recent-view-read-only-root');
      const userBody = root.querySelector('.arcaia-ror-message-user .arcaia-ror-body');
      const link = root.querySelector('.arcaia-ror-message-assistant a');
      const codeSurface = root.querySelector('.arcaia-ror-code-surface');
      const rootStyle = getComputedStyle(root);
      return {
        rootColor: rootStyle.color,
        rootBackground: rootStyle.backgroundColor,
        rootFontFamily: rootStyle.fontFamily,
        rootFontSize: rootStyle.fontSize,
        rootLineHeight: rootStyle.lineHeight,
        userColor: getComputedStyle(userBody).color,
        userBackground: getComputedStyle(userBody).backgroundColor,
        linkColor: getComputedStyle(link).color,
        codeColor: getComputedStyle(codeSurface).color,
        codeBackground: getComputedStyle(codeSurface).backgroundColor,
        codeBorderColor: getComputedStyle(codeSurface).borderTopColor
      };
    });
    assert.equal(appearance.rootColor, 'rgb(37, 42, 51)');
    assert.equal(appearance.rootBackground, 'rgb(241, 238, 231)');
    assert.match(appearance.rootFontFamily, /Georgia/);
    assert.equal(appearance.rootFontSize, '17px');
    assert.equal(appearance.rootLineHeight, '29px');
    assert.equal(appearance.userColor, 'rgb(250, 248, 244)');
    assert.equal(appearance.userBackground, 'rgb(82, 93, 107)');
    assert.equal(appearance.linkColor, 'rgb(126, 46, 176)');
    assert.equal(appearance.codeColor, 'rgb(226, 230, 235)');
    assert.equal(appearance.codeBackground, 'rgb(55, 62, 72)');
    assert.equal(appearance.codeBorderColor, 'rgb(114, 123, 136)');

    const remountedUserBackground = await page.evaluate(() => {
      document.querySelector('.native-user-bubble').style.backgroundColor = 'rgb(102, 113, 127)';
      const native = document.getElementById('native');
      window.ArcaiaRecentViewRenderer.mount({
        nativeContentRoot: native,
        model: {
          conversationId: 'conversation-1',
          totalTurnCount: 1,
          visibleTurnCount: 1,
          turns: [{ turnNumber: 1, user: { messageId: 'u1', text: 'User message' }, assistant: null }]
        }
      });
      return getComputedStyle(
        document.querySelector('#arcaia-recent-view-read-only-root .arcaia-ror-message-user .arcaia-ror-body')
      ).backgroundColor;
    });
    assert.equal(remountedUserBackground, 'rgb(102, 113, 127)');
  } finally {
    await browser.close();
  }
});

test('full read-only renderer restores the previous Recent View first turn to the same viewport top', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    await page.setContent(`
      <!doctype html>
      <html><head><style>
        body { margin: 0; }
        #scroll { height: 600px; overflow-y: auto; }
        #spacer { height: 900px; }
        #native section { height: 240px; }
      </style></head><body>
        <div id="scroll">
          <div id="spacer"></div>
          <main>
            <div id="native">
              <section data-visible-turn="8"><div data-message-author-role="user">Turn 8</div></section>
              <section data-visible-turn="9"><div data-message-author-role="user">Turn 9</div></section>
              <section data-visible-turn="10"><div data-message-author-role="user">Turn 10</div></section>
            </div>
          </main>
        </div>
      </body></html>
    `);
    await page.addScriptTag({ content: rendererSource });
    await page.evaluate(() => { document.getElementById('scroll').scrollTop = 820; });
    const beforeTop = await page.locator('[data-visible-turn="8"]').evaluate((element) => element.getBoundingClientRect().top);
    await page.evaluate((viewportTop) => {
      window.ArcaiaRecentViewRenderer.mount({
        nativeContentRoot: document.getElementById('native'),
        model: {
          conversationId: 'conversation-1',
          totalTurnCount: 10,
          visibleTurnCount: 10,
          turns: Array.from({ length: 10 }, (_, index) => ({
            turnNumber: index + 1,
            user: { messageId: `u${index + 1}`, text: `User ${index + 1}\n\n`.repeat(6) },
            assistant: { messageId: `a${index + 1}`, text: `Assistant ${index + 1}\n\n`.repeat(6) }
          }))
        },
        scrollAnchor: { turnNumber: 8, viewportTop }
      });
    }, beforeTop);
    const afterTop = await page.locator('.arcaia-ror-turn[data-turn-number="8"]').evaluate((element) => element.getBoundingClientRect().top);
    assert.ok(Math.abs(afterTop - beforeTop) < 1, `expected ${afterTop} to remain at ${beforeTop}`);
  } finally {
    await browser.close();
  }
});

test('conversation model keeps visible user and final assistant messages only', () => {
  const names = [
    'findRootNode',
    'getLeafNodes',
    'collectReachableNodeIds',
    'findLatestLeafNodeForLite',
    'buildPathFromLeaf',
    'isVisuallyHiddenMessage',
    'rendererTimestampIso',
    'rendererMessageText',
    'rendererSafeHttpUrl',
    'rendererResourceName',
    'rendererFileIdFromPointer',
    'collectRendererResources',
    'collectRendererCitations',
    'dedupeRendererItems',
    'normalizeRendererMessage',
    'buildReadOnlyConversationModel'
  ];
  const source = names.map((name) => extractFunction(injectedSource, name)).join('\n');
  const sandbox = {
    APP_VERSION: 'test',
    URL,
    window: { location: { href: 'https://chatgpt.com/c/conversation-1' } },
    extractConversationIdFromConversationDetailUrl: () => 'conversation-1'
  };
  vm.runInNewContext(source, sandbox);
  const node = (id, parent, message) => ({ id, parent, children: [], message });
  const message = (role, contentType, parts, extra = {}) => ({
    author: { role },
    content: { content_type: contentType, parts },
    metadata: {},
    ...extra
  });
  const mapping = {
    root: node('root', null, null),
    u1: node('u1', 'root', message('user', 'multimodal_text', [
      'User one',
      { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file-user-image', mime_type: 'image/png' }
    ])),
    thought: node('thought', 'u1', message('assistant', 'thoughts', ['secret thought'])),
    tool: node('tool', 'thought', message('tool', 'computer_output', [
      {
        asset_pointer: 'sediment://file-generated-image',
        mime_type: 'image/png',
        width: 1024,
        height: 1024,
        file_name: 'internal/hash/mnt/data/generated-image.png',
        url: '/mnt/data/generated-image.png'
      },
      {
        asset_pointer: 'sediment://file-generated-css',
        mime_type: 'text/css',
        file_name: 'internal/hash/mnt/data/chatgpt-soft-graphite-v1.0.25.user.css'
      }
    ], { metadata: { is_visually_hidden_from_conversation: true } })),
    a1: node('a1', 'tool', message('assistant', 'text', ['Assistant **one**'], { end_turn: true, recipient: 'all' })),
    u2: node('u2', 'a1', message('user', 'text', ['User two'])),
    draft: node('draft', 'u2', message('assistant', 'text', ['internal draft'], { end_turn: false, recipient: 'all' })),
    a2: node('a2', 'draft', message('assistant', 'text', ['Assistant two'], { end_turn: true, recipient: 'all' }))
  };
  for (const item of Object.values(mapping)) {
    if (item.parent) mapping[item.parent].children.push(item.id);
  }
  const model = sandbox.buildReadOnlyConversationModel({
    conversation_id: 'conversation-1',
    current_node: 'a2',
    mapping
  }, 'https://chatgpt.com/backend-api/conversation/conversation-1');
  assert.equal(model.totalTurnCount, 2);
  assert.equal(model.turns[0].user.text, 'User one');
  assert.equal(model.turns[0].assistant.text, 'Assistant **one**');
  assert.equal(model.turns[1].assistant.text, 'Assistant two');
  assert.equal(model.turns[0].assistant.messageId, 'a1');
  assert.equal(model.turns[1].assistant.messageId, 'a2');
  assert.equal(JSON.stringify(model).includes('secret thought'), false);
  assert.equal(JSON.stringify(model).includes('internal draft'), false);
  assert.equal(model.turns[0].user.resources[0].isImage, true);
  assert.equal(model.turns[0].assistant.resources[0].fileId, 'file-generated-image');
  assert.equal(model.turns[0].assistant.resources[0].name, 'generated-image.png');
  assert.equal(model.turns[0].assistant.resources[0].url, null);
  assert.equal(model.turns[0].assistant.resources[1].fileId, 'file-generated-css');
  assert.equal(model.turns[0].assistant.resources[1].name, 'chatgpt-soft-graphite-v1.0.25.user.css');
  assert.equal(model.turns[0].assistant.resources[1].isImage, false);
});

test('full read-only history allows long pagination instead of the default five-second wait', () => {
  const start = contentSource.indexOf('  async function showFullConversationReadOnly(');
  const end = contentSource.indexOf('  async function handleRecentViewHistoryControlAction(', start);
  const source = contentSource.slice(start, end);
  assert.match(source, /requestedTurnCount: 'all'[\s\S]*?\}, 120000\)/);
});

test('Recent View read-only model fetches the current conversation once when its cache is missing', async () => {
  const source = extractFunction(injectedSource, 'getReadOnlyConversationModelForContent');
  const requests = [];
  const cachedModels = new Map();
  const state = {
    authorization: 'Bearer test-token',
    extraHeaders: { 'oai-device-id': 'device-test' },
    fetchHooked: true,
    readOnlyConversationModelsByConversation: {
      get: (conversationId) => cachedModels.get(conversationId) || null,
      set: (conversationId, model) => cachedModels.set(conversationId, model)
    },
    originalFetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({ conversation_id: 'conversation-1' })
      };
    }
  };
  const sandbox = {
    APP_VERSION: 'test',
    Headers,
    Math,
    Number,
    String,
    encodeURIComponent,
    extractConversationIdFromCurrentUrl: () => 'conversation-1',
    state,
    normalizeConversationPayloadForArcaia: (raw) => ({ raw, sourceFormat: 'messages' }),
    observeReadOnlyConversationModel(raw) {
      const model = {
        conversationId: raw.conversation_id,
        totalTurnCount: 2,
        turns: [{ turnNumber: 1 }, { turnNumber: 2 }]
      };
      cachedModels.set(model.conversationId, model);
      return model;
    },
    window: {}
  };
  vm.runInNewContext(source, sandbox);

  const result = await sandbox.getReadOnlyConversationModelForContent('conversation-1', 1);
  assert.equal(result.ok, true);
  assert.equal(result.model.visibleTurnCount, 1);
  assert.equal(result.model.turns[0].turnNumber, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/backend-api/conversations/conversation-1');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.credentials, 'include');
  assert.equal(requests[0].init.headers.get('authorization'), 'Bearer test-token');
  assert.equal(requests[0].init.headers.get('oai-device-id'), 'device-test');

  const cachedResult = await sandbox.getReadOnlyConversationModelForContent('conversation-1', 'all');
  assert.equal(cachedResult.ok, true);
  assert.equal(cachedResult.model.visibleTurnCount, 2);
  assert.equal(requests.length, 1);

  const wrongConversation = await sandbox.getReadOnlyConversationModelForContent('conversation-2', 'all');
  assert.equal(wrongConversation.ok, false);
  assert.equal(requests.length, 1);
});


test('full read-only model paginates older flat messages when the cached initial page is incomplete', async () => {
  const source = extractFunction(injectedSource, 'getReadOnlyConversationModelForContent');
  const requests = [];
  const cachedModels = new Map();
  let mergedIds = [];
  cachedModels.set('conversation-1', {
    conversationId: 'conversation-1', historyComplete: false,
    totalTurnCount: 2, turns: [{ turnNumber: 4 }, { turnNumber: 5 }]
  });
  const direct = (id, role) => ({ id, author: { role }, content: { content_type: 'text', parts: [id] }, metadata: {} });
  const payloads = new Map([
    ['/backend-api/conversations/conversation-1', {
      conversation_id: 'conversation-1', current_node: 'a5',
      page_info: { has_previous_page: true, start_cursor: 'cursor-2' },
      messages: [direct('u4', 'user'), direct('a4', 'assistant'), direct('u5', 'user'), direct('a5', 'assistant')]
    }],
    ['/backend-api/conversations/conversation-1/messages?before=cursor-2&include_has_versions=true&num_turns=20', {
      page_info: { has_previous_page: true, start_cursor: 'cursor-1' },
      messages: [direct('u2', 'user'), direct('a2', 'assistant'), direct('u3', 'user'), direct('a3', 'assistant')]
    }],
    ['/backend-api/conversations/conversation-1/messages?before=cursor-1&include_has_versions=true&num_turns=20', {
      page_info: { has_previous_page: false, start_cursor: 'cursor-0' },
      messages: [direct('u1', 'user'), direct('a1', 'assistant')]
    }]
  ]);
  const state = {
    authorization: 'Bearer test-token', extraHeaders: {}, fetchHooked: true,
    readOnlyConversationModelsByConversation: {
      get: (id) => cachedModels.get(id) || null,
      set: (id, model) => cachedModels.set(id, model)
    },
    originalFetch: async (url, init) => {
      requests.push({ url: String(url), init });
      const payload = payloads.get(String(url));
      return { ok: Boolean(payload), json: async () => payload };
    }
  };
  const sandbox = {
    APP_VERSION: 'test', Headers, Math, Number, String, Set, Map, encodeURIComponent,
    extractConversationIdFromCurrentUrl: () => 'conversation-1', state,
    normalizeConversationPayloadForArcaia: (raw) => ({ raw, sourceFormat: 'messages' }),
    observeReadOnlyConversationModel(raw) {
      mergedIds = raw.messages.map((message) => message.id);
      const turns = raw.messages.filter((message) => message.author?.role === 'user')
        .map((message, index) => ({ turnNumber: index + 1, user: { messageId: message.id } }));
      const model = {
        conversationId: raw.conversation_id,
        totalTurnCount: turns.length,
        historyComplete: raw.page_info?.has_previous_page !== true,
        turns
      };
      cachedModels.set(model.conversationId, model);
      return model;
    },
    window: {}
  };
  vm.runInNewContext(source, sandbox);
  const result = await sandbox.getReadOnlyConversationModelForContent('conversation-1', 'all');
  assert.equal(result.ok, true);
  assert.equal(result.model.totalTurnCount, 5);
  assert.equal(result.model.visibleTurnCount, 5);
  assert.equal(result.model.historyComplete, true);
  assert.deepEqual(Array.from(mergedIds), ['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4', 'a4', 'u5', 'a5']);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, '/backend-api/conversations/conversation-1');
  assert.equal(requests[1].url, '/backend-api/conversations/conversation-1/messages?before=cursor-2&include_has_versions=true&num_turns=20');
  assert.equal(requests[2].url, '/backend-api/conversations/conversation-1/messages?before=cursor-1&include_has_versions=true&num_turns=20');
  assert.equal(requests.every((request) => request.init.method === 'GET'), true);
});

test('Recent View history actions use custom DOM without document reload', () => {
  assert.match(contentSource, /showFullConversationReadOnly/);
  assert.match(contentSource, /strategy: 'existing_conversation_payload_read_only_renderer'/);
  assert.match(contentSource, /GET_READ_ONLY_CONVERSATION_MODEL/);
  assert.doesNotMatch(contentSource, /recent_view_history_expand_read_only|showRecentViewReadOnlyConversation/);
  assert.match(contentSource, /recentViewReadOnlyRequestSequence/);
  assert.match(contentSource, /recent_view_read_only_request_stale/);
  assert.doesNotMatch(contentSource, /runRecentViewDocumentReload/);
  assert.doesNotMatch(contentSource, /window\.location\.reload\(\)/);
});

test('asset resolution stays in Main World and returns Blob data only', () => {
  assert.match(injectedSource, /RESOLVE_READ_ONLY_RENDERER_ASSET/);
  assert.match(injectedSource, /25 \* 1024 \* 1024/);
  assert.match(injectedSource, /if \(depth > 3\) return null/);
  assert.match(injectedSource, /getReadOnlyConversationModelForContent\([\s\S]*?\.then\(\(payload\) =>/);
  assert.doesNotMatch(contentSource, /fetch\(['"`]\/backend-api\/files/);
});

test('asset resolution skips non-image responses and follows the confirmed files API route', async () => {
  const names = [
    'rendererSafeHttpUrl',
    'rendererFileIdFromPointer',
    'rendererSandboxPath',
    'findRendererAssetDownloadUrl',
    'isRendererAssetResponseTypeAllowed',
    'fetchRendererAssetBlob',
    'resolveReadOnlyRendererAsset'
  ];
  const source = names.map((name) => extractFunction(injectedSource, name)).join('\n');
  const requests = [];
  const imageBlob = new Blob(['png'], { type: 'image/png' });
  const response = (contentType, body, json = null) => ({
    ok: true,
    headers: { get: () => contentType },
    json: async () => json,
    blob: async () => body
  });
  const fetch = async (url) => {
    requests.push(String(url));
    if (String(url) === 'https://chatgpt.com/mnt/data/generated.png') {
      return response('text/html; charset=utf-8', new Blob(['page'], { type: 'text/html' }));
    }
    if (String(url) === '/backend-api/files/download/file-generated-image') {
      return response('application/json', null, { download_url: 'https://files.example.test/signed-image' });
    }
    if (String(url) === 'https://files.example.test/signed-image') {
      return response('image/png', imageBlob);
    }
    return { ok: false, headers: { get: () => '' } };
  };
  const sandbox = {
    APP_VERSION: 'test',
    Blob,
    Headers,
    URL,
    state: { originalFetch: fetch, authorization: null },
    window: { location: { href: 'https://chatgpt.com/c/test' }, fetch }
  };
  vm.runInNewContext(source, sandbox);
  assert.equal(
    sandbox.rendererSafeHttpUrl('/backend-api/files/download/file-generated-image', true),
    '/backend-api/files/download/file-generated-image'
  );
  const result = await sandbox.resolveReadOnlyRendererAsset({
    assetPointer: 'sediment://file-generated-image',
    url: 'https://chatgpt.com/mnt/data/generated.png',
    mimeType: 'image/png',
    isImage: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.blob.type, 'image/png');
  assert.deepEqual(requests, [
    'https://chatgpt.com/mnt/data/generated.png',
    '/backend-api/files/download/file-generated-image',
    'https://files.example.test/signed-image'
  ]);
});

test('sandbox-only generated files follow the browser-proven interpreter download route', async () => {
  const names = [
    'rendererSafeHttpUrl',
    'rendererFileIdFromPointer',
    'rendererSandboxPath',
    'findRendererAssetDownloadUrl',
    'isRendererAssetResponseTypeAllowed',
    'fetchRendererAssetBlob',
    'resolveReadOnlyRendererAsset'
  ];
  const source = names.map((name) => extractFunction(injectedSource, name)).join('\n');
  const requests = [];
  const markdownBlob = new Blob(['# generated'], { type: 'text/markdown' });
  const response = (contentType, body, json = null) => ({
    ok: true,
    headers: { get: () => contentType },
    json: async () => json,
    blob: async () => body
  });
  const fetch = async (url) => {
    requests.push(String(url));
    if (String(url) === '/backend-api/conversation/conversation-1/interpreter/download?message_id=message-1&sandbox_path=%2Fmnt%2Fdata%2Fgenerated.md') {
      return response('application/json', null, {
        download_url: '/backend-api/estuary/content?id=file-generated&fn=generated.md&sig=signed'
      });
    }
    if (String(url).startsWith('/backend-api/estuary/content?')) {
      return response('text/markdown', markdownBlob);
    }
    return { ok: false, headers: { get: () => '' } };
  };
  const sandbox = {
    APP_VERSION: 'test',
    Blob,
    Headers,
    URL,
    state: { originalFetch: fetch, authorization: 'Bearer diagnostic-test' },
    window: { location: { href: 'https://chatgpt.com/c/conversation-1' }, fetch }
  };
  vm.runInNewContext(source, sandbox);
  assert.equal(sandbox.rendererSandboxPath('/mnt/data/%2e%2e/secret.txt'), null);
  const result = await sandbox.resolveReadOnlyRendererAsset({
    conversationId: 'conversation-1',
    messageId: 'message-1',
    sandboxPath: '/mnt/data/generated.md',
    mimeType: 'text/markdown',
    isImage: false
  });
  assert.equal(result.ok, true);
  assert.equal(result.blob.type, 'text/markdown');
  assert.deepEqual(requests, [
    '/backend-api/conversation/conversation-1/interpreter/download?message_id=message-1&sandbox_path=%2Fmnt%2Fdata%2Fgenerated.md',
    '/backend-api/estuary/content?id=file-generated&fn=generated.md&sig=signed'
  ]);
});
