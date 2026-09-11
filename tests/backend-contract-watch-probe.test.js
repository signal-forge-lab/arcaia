const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('../tools/playwright_browser');

const root = path.join(__dirname, '..', 'tools', 'arcaia_backend_contract_probe_extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('backend contract probe is a separate bounded document-start extension', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Arcaia Backend Contract Probe');
  assert.equal(manifest.version, '1.0.8');
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.deepEqual(manifest.content_scripts[0].js, ['main.js']);
  assert.equal(manifest.content_scripts[1].run_at, 'document_start');
  assert.deepEqual(manifest.content_scripts[1].js, ['content.js']);
  assert.match(mainSource, /WATCH_DURATION_MS = 180000/);
  assert.doesNotMatch(mainSource, /setInterval\s*\(/);
  assert.doesNotMatch(contentSource, /setInterval\s*\(/);
  assert.match(popupHtml, /JSON保存/);
  assert.doesNotMatch(popupHtml, /リセット|停止|現在を記録/);
  assert.match(readme, /Decoration|Render Gap|Markdown/);
  assert.match(contentSource, /READ_ONLY_MODEL_REQUEST/);
  assert.match(contentSource, /READ_ONLY_MODEL_RESULT/);
  assert.match(contentSource, /FULL_DISPLAY_CLICK/);
  assert.match(contentSource, /readOnlyTurnCount/);
  assert.match(contentSource, /window\.removeEventListener\('message', onWindowMessage\)/);
  assert.match(contentSource, /document\.removeEventListener\('scroll', onScroll, true\)/);
  assert.match(mainSource, /XMLHttpRequest\.prototype\.open = probeXHROpen/);
  assert.match(mainSource, /BACKEND_RESPONSE_SUMMARY/);
  assert.match(contentSource, /apiResponsibilityEvidence/);
  assert.match(contentSource, /absoluteTurnDiscovery/);
  assert.match(contentSource, /CONTENT_READ_ONLY_TIMEOUT_MS = 5000/);
  assert.match(contentSource, /arrivedAfterContentTimeout/);
  assert.match(mainSource, /responseConversationMatchesRequest/);
  assert.match(mainSource, /metadataParentSiblingGroupCount/);
  assert.match(mainSource, /includeHasVersions/);
});

test('MAIN probe summarizes the selected-path conversation contract without retaining body text or IDs', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => {
      if (!new URL(route.request().url()).pathname.startsWith('/backend-api/conversation/')) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        conversation_id: 'PRIVATE-CONVERSATION-ID',
        current_node: 'a2',
        title: 'PRIVATE TITLE',
        mapping: {
          root: { id: 'root', parent: null, children: ['u1'], message: null },
          u1: {
            id: 'u1', parent: 'root', children: ['a1'],
            message: { id: 'm-u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['PRIVATE USER TEXT'] }, status: 'finished_successfully' }
          },
          a1: {
            id: 'a1', parent: 'u1', children: ['u2'],
            message: { id: 'm-a1', author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'text', parts: ['PRIVATE ASSISTANT TEXT'] }, status: 'finished_successfully' }
          },
          u2: {
            id: 'u2', parent: 'a1', children: ['a2'],
            message: { id: 'm-u2', author: { role: 'user' }, content: { content_type: 'text', parts: ['SECOND PRIVATE USER TEXT'] }, status: 'finished_successfully' }
          },
          a2: {
            id: 'a2', parent: 'u2', children: [],
            message: { id: 'm-a2', author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'text', parts: ['SECOND PRIVATE ASSISTANT TEXT'] }, status: 'finished_successfully' }
          }
        }
      }) });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => {
      window.__backendProbeMessages = [];
      window.addEventListener('message', (event) => {
        if (event.data?.source === 'arcaia-backend-contract-probe-v1') window.__backendProbeMessages.push(event.data);
      });
      (0, eval)(source);
    }, mainSource);
    await page.evaluate(() => fetch('/backend-api/conversation/PRIVATE-CONVERSATION-ID').then((response) => response.json()));
    await page.waitForFunction(() => window.__backendProbeMessages.some((item) => item.type === 'CONVERSATION_RESPONSE_SUMMARY'));
    const summary = await page.evaluate(() => window.__backendProbeMessages.find((item) => item.type === 'CONVERSATION_RESPONSE_SUMMARY').payload);
    assert.equal(summary.contract.mappingPresent, true);
    assert.equal(summary.contract.currentNodePresent, true);
    assert.equal(summary.contract.currentNodeFoundInMapping, true);
    assert.equal(summary.graph.mappingNodeCount, 5);
    assert.equal(summary.path.selectedPathNodeCount, 5);
    assert.equal(summary.path.userTurnCount, 2);
    assert.equal(summary.path.visibleAssistantCount, 2);
    assert.equal(summary.contract.issueCodes.length, 0);
    const serialized = JSON.stringify(summary);
    assert.doesNotMatch(serialized, /PRIVATE|m-u1|m-a1|u1|a2/);
  } finally {
    await browser.close();
  }
});

test('MAIN probe summarizes messages-array conversation schema without retaining text or IDs', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => {
      if (!new URL(route.request().url()).pathname.startsWith('/backend-api/conversations/')) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        conversation_id: 'PRIVATE-CONVERSATION-ID',
        current_node: 'assistant-node-2',
        page_info: { has_more: false, cursor: 'PRIVATE-CURSOR' },
        messages: [
          {
            id: 'user-node-1', parent: null, children: ['assistant-node-1'],
            message: { id: 'private-user-message-1', author: { role: 'user' }, content: { content_type: 'text', parts: ['PRIVATE USER TEXT'] }, metadata: {} }
          },
          {
            id: 'assistant-node-1', parent: 'user-node-1', children: ['user-node-2'],
            message: { id: 'private-assistant-message-1', author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'text', parts: ['PRIVATE ASSISTANT TEXT'] }, metadata: {} }
          },
          {
            id: 'user-node-2', parent: 'assistant-node-1', children: ['assistant-node-2'],
            message: { id: 'private-user-message-2', author: { role: 'user' }, content: { content_type: 'text', parts: ['SECOND PRIVATE USER TEXT'] }, metadata: {} }
          },
          {
            id: 'assistant-node-2', parent: 'user-node-2', children: [],
            message: { id: 'private-assistant-message-2', author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'text', parts: ['SECOND PRIVATE ASSISTANT TEXT'] }, metadata: {} }
          }
        ]
      }) });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => {
      window.__backendProbeMessages = [];
      window.addEventListener('message', (event) => {
        if (event.data?.source === 'arcaia-backend-contract-probe-v1') window.__backendProbeMessages.push(event.data);
      });
      (0, eval)(source);
    }, mainSource);
    await page.evaluate(() => fetch('/backend-api/conversations/PRIVATE-CONVERSATION-ID?num_turns=20').then((response) => response.json()));
    await page.waitForFunction(() => window.__backendProbeMessages.some((item) => item.type === 'CONVERSATION_RESPONSE_SUMMARY'));
    const summary = await page.evaluate(() => window.__backendProbeMessages.find((item) => item.type === 'CONVERSATION_RESPONSE_SUMMARY').payload);
    assert.equal(summary.contract.mappingPresent, false);
    assert.equal(summary.contract.transportFormat, 'messages');
    assert.equal(summary.contract.messagesPresent, true);
    assert.equal(summary.contract.messagesFieldType, 'array');
    assert.equal(summary.contract.messagesItemCount, 4);
    assert.equal(summary.contract.currentNodeFoundInMessages, true);
    assert.equal(summary.contract.pageInfo.present, true);
    assert.deepEqual(summary.contract.pageInfo.keys, ['cursor', 'has_more']);
    assert.equal(summary.contract.pageInfo.hasMore, false);
    assert.equal(summary.contract.pageInfo.cursorPresent, true);
    assert.equal(summary.messages.nestedMessageCount, 4);
    assert.equal(summary.messages.userRoleCandidateCount, 2);
    assert.equal(summary.messages.assistantRoleCandidateCount, 2);
    assert.equal(summary.messages.readOnlyUserEligibleCount, 2);
    assert.equal(summary.messages.readOnlyAssistantEligibleCount, 0);
    assert.equal(summary.messages.readOnlyUserExcludedByContentTypeCount, 0);
    assert.equal(summary.messages.userTurnCount, 2);
    assert.equal(summary.messages.visibleAssistantCount, 2);
    assert.equal(summary.messages.currentNodeArrayIndex, 3);
    assert.equal(summary.messages.currentNodePositionFromEnd, 0);
    assert.equal(summary.messages.parentFieldCount, 4);
    assert.equal(summary.messages.childrenArrayCount, 4);
    assert.equal(summary.contract.issueCodes.includes('messages_present_without_mapping'), false);
    assert.equal(summary.contract.issueCodes.includes('current_node_not_in_messages'), false);
    const serialized = JSON.stringify(summary);
    assert.doesNotMatch(serialized, /PRIVATE|user-node|assistant-node|private-user-message|private-assistant-message/);
  } finally {
    await browser.close();
  }
});

test('MAIN probe records direct-message parent links and pagination values without cursor or ID values', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith('/backend-api/conversations/')) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
      }
      const direct = (id, parentId, role) => ({
        id,
        author: { role },
        recipient: role === 'assistant' ? 'all' : undefined,
        content: { content_type: 'text', parts: ['PRIVATE TEXT'] },
        metadata: { parent_id: parentId }
      });
      const paged = pathname.endsWith('/messages');
      const payload = paged ? {
        page_info: { has_previous_page: true, has_next_page: false, start_cursor: 'PRIVATE-START-2', end_cursor: 'PRIVATE-END-2' },
        messages: [direct('older-user', 'PRIVATE-OUTSIDE-ID', 'user'), direct('older-assistant', 'older-user', 'assistant')]
      } : {
        conversation_id: 'PRIVATE-CONVERSATION-ID',
        current_node: 'assistant-2',
        page_info: { has_previous_page: true, has_next_page: false, start_cursor: 'PRIVATE-START', end_cursor: 'PRIVATE-END' },
        messages: [
          { ...direct('user-1', null, 'user'), content: { content_type: 'nonstandard_visible_user', parts: [] } },
          direct('assistant-1', 'user-1', 'assistant'),
          direct('user-2', 'assistant-1', 'user'),
          direct('assistant-2', 'user-2', 'assistant')
        ]
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => {
      window.__backendProbeMessages = [];
      window.addEventListener('message', (event) => {
        if (event.data?.source === 'arcaia-backend-contract-probe-v1') window.__backendProbeMessages.push(event.data);
      });
      (0, eval)(source);
    }, mainSource);
    await page.evaluate(async () => {
      await fetch('/backend-api/conversations/PRIVATE-CONVERSATION-ID?num_turns=20').then((response) => response.json());
      await fetch('/backend-api/conversations/PRIVATE-CONVERSATION-ID/messages?before=PRIVATE-CURSOR&num_turns=20').then((response) => response.json());
    });
    await page.waitForFunction(() => window.__backendProbeMessages.filter((item) => item.type === 'CONVERSATION_RESPONSE_SUMMARY').length >= 2);
    const summaries = await page.evaluate(() => window.__backendProbeMessages.filter((item) => item.type === 'CONVERSATION_RESPONSE_SUMMARY').map((item) => item.payload));
    const primary = summaries.find((item) => !item.contract.pagedMessagesResponse);
    const pageSummary = summaries.find((item) => item.contract.pagedMessagesResponse);
    assert.equal(primary.contract.transportFormat, 'messages');
    assert.equal(primary.contract.pageInfo.hasPreviousPage, true);
    assert.equal(primary.contract.pageInfo.hasNextPage, false);
    assert.equal(primary.contract.pageInfo.startCursorPresent, true);
    assert.equal(primary.contract.pageInfo.endCursorPresent, true);
    assert.equal(primary.messages.directMessageShapeCount, 4);
    assert.equal(primary.messages.userRoleCandidateCount, 2);
    assert.equal(primary.messages.readOnlyUserEligibleCount, 1);
    assert.equal(primary.messages.readOnlyUserExcludedByContentTypeCount, 1);
    assert.equal(primary.messages.readOnlyExcludedUserContentTypes.nonstandard_visible_user, 1);
    assert.equal(primary.messages.userTurnCount, 1);
    assert.equal(primary.messages.currentNodeArrayIndex, 3);
    assert.equal(primary.messages.currentNodePositionFromEnd, 0);
    assert.equal(primary.messages.metadataParentIdCount, 3);
    assert.equal(primary.messages.metadataParentIdOutsidePageCount, 0);
    assert.equal(primary.messages.metadataParentImmediatePreviousCount, 3);
    assert.equal(primary.messages.metadataParentSiblingGroupCount, 0);
    assert.equal(primary.messages.parentFieldCount, 0);
    assert.equal(primary.identity.responseConversationMatchesRequest, true);
    assert.equal(pageSummary.contract.pagedMessagesResponse, true);
    assert.equal(pageSummary.identity.requestConversationMatchesCurrent, null);
    assert.equal(pageSummary.contract.currentNodePresent, false);
    assert.equal(pageSummary.contract.issueCodes.includes('current_node_missing'), false);
    assert.equal(pageSummary.messages.metadataParentIdOutsidePageCount, 1);
    const serialized = JSON.stringify(summaries);
    assert.doesNotMatch(serialized, /PRIVATE|user-1|assistant-2|older-user|older-assistant/);
  } finally {
    await browser.close();
  }
});

test('MAIN probe exposes critical contract drift when current_node no longer exists', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => {
      if (!new URL(route.request().url()).pathname.startsWith('/backend-api/conversation/')) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        current_node_id: 'assistant-new-schema',
        mapping: {
          root: { id: 'root', parent: null, children: ['assistant-new-schema'], message: null },
          'assistant-new-schema': { id: 'assistant-new-schema', parent: 'root', children: [], message: { author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'text', parts: ['PRIVATE'] } } }
        }
      }) });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => {
      window.__backendProbeMessages = [];
      window.addEventListener('message', (event) => {
        if (event.data?.source === 'arcaia-backend-contract-probe-v1') window.__backendProbeMessages.push(event.data);
      });
      (0, eval)(source);
    }, mainSource);
    await page.evaluate(() => fetch('/backend-api/conversation/PRIVATE').then((response) => response.json()));
    await page.waitForFunction(() => window.__backendProbeMessages.some((item) => item.type === 'CONVERSATION_RESPONSE_SUMMARY'));
    const summary = await page.evaluate(() => window.__backendProbeMessages.find((item) => item.type === 'CONVERSATION_RESPONSE_SUMMARY').payload);
    assert.equal(summary.contract.currentNodePresent, false);
    assert.equal(summary.contract.issueCodes.includes('current_node_missing'), true);
  } finally {
    await browser.close();
  }
});

test('isolated probe captures DOM turn structure and Arcaia turn/rewrite state without IDs or text', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>
      <main><div id="conversation-root">
        <section data-testid="conversation-turn-1"><div data-message-author-role="user"><span data-arcaia-message-time-badge="true"></span></div></section>
        <section data-testid="conversation-turn-2"><div data-message-author-role="assistant"><span data-arcaia-message-time-badge="true"></span></div></section>
        <section data-testid="conversation-turn-3" data-arcaia-lite-rolling-hidden="true"><div data-message-author-role="user"><span data-arcaia-message-time-badge="true"></span></div></section>
      </div></main>
    </body></html>`);
    const result = await page.evaluate(async (source) => {
      let listener = null;
      window.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (data?.source !== 'aice-probe-content-v159') return;
        if (data.type === 'GET_LITE_DISPLAY_CONFIG') {
          window.postMessage({
            source: 'aice-probe-main-v159', type: 'LITE_DISPLAY_CONFIG_RESULT', requestId: data.requestId,
            payload: { appVersion: '0.1.341', liteDisplay: { enabled: true, extensionEnabled: true, backendRewriteEnabled: true, turnCount: 3, rewriteCount: 1, messageTimestampIndexSummary: { messageCount: 4 } } }
          }, '*');
        }
        if (data.type === 'GET_MESSAGE_TIMESTAMP_INDEX') {
          window.postMessage({
            source: 'aice-probe-main-v159', type: 'MESSAGE_TIMESTAMP_INDEX_RESULT', requestId: data.requestId,
            payload: { messageTimestampIndex: { messageCount: 4, roleOrder: [
              { role: 'user', iso: '2026-08-23T00:00:00Z' }, { role: 'assistant', iso: '2026-08-23T00:00:01Z' }, { role: 'user', iso: '2026-08-23T00:00:02Z' }, { role: 'assistant', iso: '2026-08-23T00:00:03Z' }
            ] }, updateCount: 1 }
          }, '*');
        }
      });
      (0, eval)(source);
      return await new Promise((resolve) => listener({ source: 'arcaia-backend-contract-probe-v1', type: 'EXPORT_REPORT' }, {}, resolve));
    }, contentSource);
    assert.equal(result.ok, true);
    assert.equal(result.report.dom.topLevelSectionCount, 3);
    assert.equal(result.report.dom.userRoleCount, 2);
    assert.equal(result.report.dom.assistantRoleCount, 1);
    assert.equal(result.report.dom.arcaiaHiddenSectionCount, 1);
    assert.equal(result.report.dom.timestampBadgeCount, 3);
    assert.equal(result.report.arcaia.timestampIndex.messageCount, 4);
    assert.equal(Object.prototype.hasOwnProperty.call(result.report.arcaia.timestampIndex, 'turnCount'), false);
    assert.equal(result.report.arcaia.lite.configuredTurnCount, 3);
    assert.equal(result.report.network.fetchCallCount, 0);
    const serialized = JSON.stringify(result.report);
    assert.doesNotMatch(serialized, /conversation-turn-1|PRIVATE|"messageId"\s*:|"conversationId"\s*:/);
  } finally {
    await browser.close();
  }
});

test('report traces full-display request result and renderer turn loss without retaining content or IDs', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('https://chatgpt.test/c/current');
    const result = await page.evaluate(async (source) => {
      let listener = null;
      window.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (data?.source !== 'aice-probe-content-v159') return;
        if (data.type === 'GET_LITE_DISPLAY_CONFIG') {
          window.postMessage({ source: 'aice-probe-main-v159', type: 'LITE_DISPLAY_CONFIG_RESULT', requestId: data.requestId, payload: { appVersion: '0.1.343', liteDisplay: { enabled: true, extensionEnabled: true, backendRewriteEnabled: true, turnCount: 3, rewriteCount: 1 } } }, '*');
        }
        if (data.type === 'GET_MESSAGE_TIMESTAMP_INDEX') {
          window.postMessage({ source: 'aice-probe-main-v159', type: 'MESSAGE_TIMESTAMP_INDEX_RESULT', requestId: data.requestId, payload: { messageTimestampIndex: { messageCount: 10, turnCount: 5, roleOrder: [] }, updateCount: 1 } }, '*');
        }
      });
      document.body.innerHTML = `
        <main data-arcaia-read-only-native-hidden="true">
          <div id="arcaia-recent-view-history-controls"><button data-action="full">full</button></div>
        </main>`;
      (0, eval)(source);
      document.querySelector('button[data-action="full"]').click();
      window.postMessage({ source: 'aice-probe-content-v159', type: 'GET_READ_ONLY_CONVERSATION_MODEL', payload: { conversationId: 'current', requestedTurnCount: 'all' } }, '*');
      window.postMessage({ source: 'aice-probe-main-v159', type: 'READ_ONLY_CONVERSATION_MODEL_RESULT', payload: {
        ok: true, appVersion: '0.1.343', model: {
          conversationId: 'current', totalTurnCount: 3, visibleTurnCount: 3, firstVisibleTurnNumber: 1,
          turns: [1, 2, 3].map((turnNumber) => ({ turnNumber, user: { text: 'PRIVATE USER' }, assistant: { text: 'PRIVATE ASSISTANT' } }))
        }
      } }, '*');
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'CONVERSATION_RESPONSE_SUMMARY', payload: {
        endpoint: { pathnamePattern: '/backend-api/conversations/<id>' }, bodyBytes: 1000,
        contract: { pagedMessagesResponse: false, pageInfo: { present: true, hasPreviousPage: false }, issueCodes: [] },
        messages: { userRoleCandidateCount: 5, readOnlyUserEligibleCount: 3, userTurnCount: 3 }
      } }, '*');
      const root = document.createElement('div');
      root.id = 'arcaia-recent-view-read-only-root';
      for (const turnNumber of [1, 2, 3]) {
        const turn = document.createElement('article');
        turn.className = 'arcaia-ror-turn';
        turn.dataset.turnNumber = String(turnNumber);
        turn.innerHTML = '<section class="arcaia-ror-message arcaia-ror-message-user"></section><section class="arcaia-ror-message arcaia-ror-message-assistant"></section>';
        root.appendChild(turn);
      }
      document.body.prepend(root);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return await new Promise((resolve) => listener({ source: 'arcaia-backend-contract-probe-v1', type: 'EXPORT_REPORT' }, {}, resolve));
    }, contentSource);
    assert.equal(result.ok, true);
    assert.equal(result.report.fullDisplay.clickCount, 1);
    assert.equal(result.report.fullDisplay.readOnlyRequestCount, 1);
    assert.equal(result.report.fullDisplay.readOnlyResultCount, 1);
    assert.equal(result.report.fullDisplay.lastReadOnlyRequest.requestedAll, true);
    assert.equal(result.report.fullDisplay.lastReadOnlyResult.totalTurnCount, 3);
    assert.equal(result.report.fullDisplay.lastReadOnlyResult.returnedTurnArrayCount, 3);
    assert.equal(result.report.fullDisplay.renderer.mounted, true);
    assert.equal(result.report.fullDisplay.renderer.turnCount, 3);
    assert.equal(result.report.fullDisplay.renderer.nativeContentHiddenCount, 1);
    assert.equal(result.report.fullDisplay.fetchObservation, 'no_conversation_fetch_observed_after_click');
    assert.equal(result.report.diagnosis.backendUserRoleCandidateCount, 5);
    assert.equal(result.report.diagnosis.backendReadOnlyEligibleUserCount, 3);
    assert.equal(result.report.diagnosis.readOnlyModelTotalTurnCount, 3);
    assert.equal(result.report.diagnosis.issueCodes.includes('full_display:read_only_user_filter_excludes_backend_user_roles'), true);
    assert.equal(result.report.diagnosis.issueCodes.includes('full_display:read_only_model_has_fewer_turns_than_backend_user_roles'), true);
    const serialized = JSON.stringify(result.report);
    assert.doesNotMatch(serialized, /PRIVATE USER|PRIVATE ASSISTANT|"conversationId"\s*:\s*"current"|requestId/);
  } finally {
    await browser.close();
  }
});

test('report marks initial-page turn counts as non-absolute when previous-page evidence exists', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('https://chatgpt.test/c/current');
    const result = await page.evaluate(async (source) => {
      let listener = null;
      window.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (data?.source !== 'aice-probe-content-v159') return;
        if (data.type === 'GET_LITE_DISPLAY_CONFIG') {
          window.postMessage({ source: 'aice-probe-main-v159', type: 'LITE_DISPLAY_CONFIG_RESULT', requestId: data.requestId, payload: { appVersion: '0.1.342', liteDisplay: { enabled: true, extensionEnabled: true, backendRewriteEnabled: true, turnCount: 3, rewriteCount: 1 } } }, '*');
        }
        if (data.type === 'GET_MESSAGE_TIMESTAMP_INDEX') {
          window.postMessage({ source: 'aice-probe-main-v159', type: 'MESSAGE_TIMESTAMP_INDEX_RESULT', requestId: data.requestId, payload: { messageTimestampIndex: { messageCount: 10, turnCount: 5, roleOrder: [] }, updateCount: 1 } }, '*');
        }
      });
      (0, eval)(source);
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'CONVERSATION_RESPONSE_SUMMARY', payload: {
        endpoint: { pathnamePattern: '/backend-api/conversations/<id>' }, bodyBytes: 1000,
        contract: { pagedMessagesResponse: false, pageInfo: { present: true, hasPreviousPage: true, hasNextPage: false }, issueCodes: [] },
        messages: { userTurnCount: 5, metadataParentIdOutsidePageCount: 0 }
      } }, '*');
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'CONVERSATION_RESPONSE_SUMMARY', payload: {
        endpoint: { pathnamePattern: '/backend-api/conversations/<id>/messages' }, bodyBytes: 400,
        contract: { pagedMessagesResponse: true, pageInfo: { present: true, hasPreviousPage: true, hasNextPage: false }, issueCodes: [] },
        messages: { userTurnCount: 2, metadataParentIdOutsidePageCount: 1 }
      } }, '*');
      await new Promise((resolve) => setTimeout(resolve, 0));
      return await new Promise((resolve) => listener({ source: 'arcaia-backend-contract-probe-v1', type: 'EXPORT_REPORT' }, {}, resolve));
    }, contentSource);
    assert.equal(result.ok, true);
    assert.equal(result.report.pagination.pagedMessagesResponseCount, 1);
    assert.equal(result.report.pagination.initialPageInfo.hasPreviousPage, true);
    assert.equal(result.report.pagination.initialPageLocalUserTurnCount, 5);
    assert.deepEqual(result.report.pagination.pageLocalUserTurnCounts, [2]);
    assert.equal(result.report.pagination.absoluteTurnCountStatus, 'initial_page_has_previous_page');
    assert.equal(result.report.diagnosis.apiObservedTurnCountScope, 'initial_page_local_only');
    assert.equal(result.report.diagnosis.issueCodes.includes('turn_count:absolute_turn_count_unresolved_due_to_previous_page'), true);
  } finally {
    await browser.close();
  }
});

test('report summarizes backend endpoint observation even when no conversation response was captured', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('https://chatgpt.test/c/current');
    const result = await page.evaluate(async (source) => {
      let listener = null;
      window.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
      (0, eval)(source);
      window.postMessage({
        source: 'arcaia-backend-contract-probe-v1',
        type: 'FETCH_CALL_OBSERVED',
        payload: { endpoint: { method: 'GET', pathnamePattern: '/backend-api/chat/<id>', queryKeys: [], conversationLike: false, backendApi: true } }
      }, '*');
      await new Promise((resolve) => setTimeout(resolve, 0));
      return await new Promise((resolve) => listener({ source: 'arcaia-backend-contract-probe-v1', type: 'EXPORT_REPORT' }, {}, resolve));
    }, contentSource);
    assert.equal(result.report.network.backendApiCallCount, 1);
    assert.equal(result.report.network.conversationLikeCallCount, 0);
    assert.deepEqual(result.report.network.endpointPatterns, ['/backend-api/chat/<id>']);
    assert.equal(result.report.diagnosis.issueCodes.includes('backend_contract:conversation_endpoint_not_observed'), true);
  } finally {
    await browser.close();
  }
});

test('MAIN probe captures count-like metadata and headers without private body values', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith('/backend-api/conversations/')) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'x-total-count': '37' },
        body: JSON.stringify({
          conversation_id: 'PRIVATE-CONVERSATION-ID',
          current_node: 'PRIVATE-NODE',
          title: 'PRIVATE TITLE',
          total_turn_count: 37,
          stats: { message_count: 211 },
          accounts: { '0075038d-d9dd-4353-bcde-0c40eb795e75': { total_count: 5 } },
          flags: { file_library_enabled_for_registration_country: true },
          page_info: { has_previous_page: true, start_cursor: 'PRIVATE-CURSOR' },
          messages: []
        })
      });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => {
      window.__backendProbeMessages = [];
      window.addEventListener('message', (event) => {
        if (event.data?.source === 'arcaia-backend-contract-probe-v1') window.__backendProbeMessages.push(event.data);
      });
      (0, eval)(source);
    }, mainSource);
    await page.evaluate(() => fetch('/backend-api/conversations/PRIVATE-CONVERSATION-ID?num_turns=20&before=PRIVATE-CURSOR').then((response) => response.json()));
    await page.waitForFunction(() => window.__backendProbeMessages.some((item) => item.type === 'BACKEND_RESPONSE_SUMMARY'));
    const result = await page.evaluate(() => ({
      request: window.__backendProbeMessages.find((item) => item.type === 'FETCH_CALL_OBSERVED')?.payload,
      response: window.__backendProbeMessages.find((item) => item.type === 'BACKEND_RESPONSE_SUMMARY')?.payload
    }));
    assert.equal(result.request.endpoint.pathnamePattern, '/backend-api/conversations/<id>');
    assert.deepEqual(result.request.endpoint.queryKeys, ['before', 'num_turns']);
    assert.deepEqual(result.request.endpoint.queryNumericHints, [{ key: 'num_turns', value: 20 }]);
    const countHints = result.response.json.structuralHints.countLikeScalars;
    assert.equal(countHints.some((item) => item.path === 'total_turn_count' && item.value === 37), true);
    assert.equal(countHints.some((item) => item.path === 'stats.message_count' && item.value === 211), true);
    assert.equal(countHints.some((item) => item.path === 'accounts.<id>.total_count' && item.value === 5), true);
    assert.equal(countHints.some((item) => item.path === 'flags.file_library_enabled_for_registration_country' && item.value === true), true);
    assert.equal(result.response.responseHeaderHints.some((item) => item.name === 'x-total-count' && item.numberValues.includes(37)), true);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /PRIVATE TITLE|PRIVATE-CURSOR|PRIVATE-CONVERSATION-ID|PRIVATE-NODE|0075038d-d9dd-4353-bcde-0c40eb795e75/);
  } finally {
    await browser.close();
  }
});

test('MAIN probe observes backend XHR request and response shape', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/backend-api/telemetry/conversation/PRIVATE') {
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-total-count': '9' }, body: JSON.stringify({ status: 'ok', total_count: 9 }) });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => {
      window.__backendProbeMessages = [];
      window.addEventListener('message', (event) => {
        if (event.data?.source === 'arcaia-backend-contract-probe-v1') window.__backendProbeMessages.push(event.data);
      });
      (0, eval)(source);
    }, mainSource);
    await page.evaluate(() => new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/backend-api/telemetry/conversation/PRIVATE');
      xhr.onloadend = resolve;
      xhr.send(JSON.stringify({ action: 'refresh', prompt: 'PRIVATE REQUEST BODY' }));
    }));
    await page.waitForFunction(() => window.__backendProbeMessages.some((item) => item.type === 'BACKEND_RESPONSE_SUMMARY' && item.payload?.transport === 'xhr'));
    const result = await page.evaluate(() => ({
      request: window.__backendProbeMessages.find((item) => item.type === 'XHR_CALL_OBSERVED')?.payload,
      response: window.__backendProbeMessages.find((item) => item.type === 'BACKEND_RESPONSE_SUMMARY' && item.payload?.transport === 'xhr')?.payload
    }));
    assert.equal(result.request.endpoint.pathnamePattern, '/backend-api/telemetry/conversation/<id>');
    assert.deepEqual(result.request.requestBody.jsonShape.topLevelKeys, ['action', 'prompt']);
    assert.equal(result.request.requestBody.jsonShape.structuralHints.enumScalars.some((item) => item.path === 'action' && item.value === 'refresh'), true);
    assert.equal(result.response.json.structuralHints.countLikeScalars.some((item) => item.path === 'total_count' && item.value === 9), true);
    assert.equal(result.response.responseHeaderHints.some((item) => item.name === 'x-total-count' && item.numberValues.includes(9)), true);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE REQUEST BODY|PRIVATE/);
  } finally {
    await browser.close();
  }
});

test('report exposes absolute-turn metadata candidates without claiming proof', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('https://chatgpt.test/c/current');
    const result = await page.evaluate(async (source) => {
      let listener = null;
      window.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
      (0, eval)(source);
      const endpoint = { method: 'GET', pathnamePattern: '/backend-api/conversations/<id>', queryKeys: ['num_turns'], queryNumericHints: [{ key: 'num_turns', value: 20 }], conversationLike: true, backendApi: true };
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'FETCH_CALL_OBSERVED', payload: { requestOrdinal: 1, endpoint, requestBody: { present: false, type: 'none' } } }, '*');
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'BACKEND_RESPONSE_SUMMARY', payload: {
        requestOrdinal: 1, transport: 'fetch', endpoint, status: 200, responseHeaderHints: [],
        json: { topLevelKeys: ['messages', 'page_info', 'total_turn_count'], structuralHints: { countLikeScalars: [{ path: 'total_turn_count', type: 'number', value: 37 }], enumScalars: [], arrayLengths: [{ path: 'messages', length: 10 }] } }
      } }, '*');
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'CONVERSATION_RESPONSE_SUMMARY', payload: {
        requestOrdinal: 1, endpoint, bodyBytes: 1000,
        contract: { pagedMessagesResponse: false, pageInfo: { present: true, hasPreviousPage: true, hasNextPage: false }, issueCodes: [] },
        messages: { userRoleCandidateCount: 5, userTurnCount: 5, readOnlyUserEligibleCount: 5, metadataParentIdOutsidePageCount: 0 }
      } }, '*');
      await new Promise((resolve) => setTimeout(resolve, 0));
      return await new Promise((resolve) => listener({ source: 'arcaia-backend-contract-probe-v1', type: 'EXPORT_REPORT' }, {}, resolve));
    }, contentSource);
    assert.equal(result.ok, true);
    assert.equal(result.report.absoluteTurnDiscovery.initialPageHasPreviousPage, true);
    assert.equal(result.report.absoluteTurnDiscovery.candidateCount, 1);
    assert.equal(result.report.absoluteTurnDiscovery.candidates[0].path, 'total_turn_count');
    assert.equal(result.report.absoluteTurnDiscovery.candidates[0].value, 37);
    assert.equal(result.report.absoluteTurnDiscovery.absoluteTurnCountProvenWithoutPagination, false);
    assert.equal(result.report.absoluteTurnDiscovery.proofStatus, 'unresolved');
    assert.equal(result.report.diagnosis.issueCodes.includes('absolute_turn:candidate_metadata_requires_validation'), true);
    assert.equal(result.report.apiResponsibilityEvidence[0].proofStatus, 'request_and_response_shape_observed');
    assert.deepEqual(result.report.apiResponsibilityEvidence[0].responseCountLikePaths, ['total_turn_count']);
  } finally {
    await browser.close();
  }
});

test('popup only exports JSON from the active ChatGPT tab', () => {
  assert.match(popupSource, /EXPORT_REPORT/);
  assert.match(popupSource, /application\/json/);
  assert.match(popupSource, /arcaia-backend-contract-probe-/);
  assert.match(popupHtml, /JSON保存/);
  assert.doesNotMatch(popupHtml, /リセット|停止|現在を記録/);
});

test('v1.0.8 keeps initial detail separate from full-display detail', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><div id="arcaia-recent-view-history-controls"><button data-action="full">full</button></div></body></html>');
    const result = await page.evaluate(async (source) => {
      let listener = null;
      window.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
      (0, eval)(source);
      const initial = { method: 'GET', pathnamePattern: '/backend-api/conversations/<id>', queryKeys: ['include_has_versions', 'num_turns'], queryNumericHints: [{ key: 'num_turns', value: 10 }], conversationLike: true, backendApi: true };
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'FETCH_CALL_OBSERVED', payload: { requestOrdinal: 1, endpoint: initial, requestBody: { present: false, type: 'none' } } }, '*');
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'BACKEND_RESPONSE_SUMMARY', payload: { requestOrdinal: 1, endpoint: initial, status: 200, responseHeaderHints: [], json: { topLevelKeys: ['messages', 'page_info'], structuralHints: { countLikeScalars: [], enumScalars: [], arrayLengths: [{ path: 'messages', length: 243 }] } } } }, '*');
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'CONVERSATION_RESPONSE_SUMMARY', payload: { requestOrdinal: 1, endpoint: initial, bodyBytes: 1000, contract: { pagedMessagesResponse: false, pageInfo: { present: true, hasPreviousPage: true, hasNextPage: false }, issueCodes: [] }, messages: { userRoleCandidateCount: 5, userTurnCount: 5, readOnlyUserEligibleCount: 5, metadataParentIdOutsidePageCount: 0 } } }, '*');
      await new Promise((resolve) => setTimeout(resolve, 0));
      document.querySelector('button[data-action="full"]').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const full = { method: 'GET', pathnamePattern: '/backend-api/conversations/<id>', queryKeys: [], queryNumericHints: [], conversationLike: true, backendApi: true };
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'FETCH_CALL_OBSERVED', payload: { requestOrdinal: 2, endpoint: full, requestBody: { present: false, type: 'none' } } }, '*');
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'BACKEND_RESPONSE_SUMMARY', payload: { requestOrdinal: 2, endpoint: full, status: 200, responseHeaderHints: [], json: { topLevelKeys: ['messages', 'page_info'], structuralHints: { countLikeScalars: [], enumScalars: [], arrayLengths: [{ path: 'messages', length: 1272 }] } } } }, '*');
      window.postMessage({ source: 'arcaia-backend-contract-probe-v1', type: 'CONVERSATION_RESPONSE_SUMMARY', payload: { requestOrdinal: 2, endpoint: full, bodyBytes: 7000, contract: { pagedMessagesResponse: false, pageInfo: { present: true, hasPreviousPage: false, hasNextPage: false }, issueCodes: [] }, messages: { userRoleCandidateCount: 21, userTurnCount: 17, readOnlyUserEligibleCount: 21, metadataParentIdOutsidePageCount: 1 } } }, '*');
      await new Promise((resolve) => setTimeout(resolve, 0));
      return await new Promise((resolve) => listener({ source: 'arcaia-backend-contract-probe-v1', type: 'EXPORT_REPORT' }, {}, resolve));
    }, contentSource);
    assert.equal(result.report.response.requestOrdinal, 1);
    assert.equal(result.report.pagination.initialPageInfo.hasPreviousPage, true);
    assert.equal(result.report.pagination.initialPageLocalUserTurnCount, 5);
    assert.equal(result.report.conversationFetchPhases.initialDetail.requestOrdinal, 1);
    assert.equal(result.report.conversationFetchPhases.fullDisplayDetail.requestOrdinal, 2);
    const profiles = result.report.apiResponsibilityEvidence.filter((item) => item.pathnamePattern === '/backend-api/conversations/<id>');
    assert.deepEqual(profiles.map((item) => item.querySignature).sort(), ['(no-query)', 'include_has_versions,num_turns']);
  } finally {
    await browser.close();
  }
});

test('v1.0.8 summarizes numeric turn-like message metadata only', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith('/backend-api/conversations/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        conversation_id: 'PRIVATE-ID', current_node: 'a', page_info: { has_previous_page: true, start_cursor: 'PRIVATE-CURSOR' },
        messages: [
          { id: 'u', author: { role: 'user' }, content: { content_type: 'text', parts: ['PRIVATE TEXT'] }, metadata: { retrieval_turn_number: 17, turn_exchange_id: 999999, parent_id: 'PRIVATE-PARENT' } },
          { id: 'a', author: { role: 'assistant' }, recipient: 'all', content: { content_type: 'text', parts: ['PRIVATE ANSWER'] }, metadata: { retrieval_turn_number: 18, request_id: 'PRIVATE-REQUEST' } }
        ]
      }) });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => { window.__msgs = []; window.addEventListener('message', (e) => { if (e.data?.source === 'arcaia-backend-contract-probe-v1') window.__msgs.push(e.data); }); (0, eval)(source); }, mainSource);
    await page.evaluate(() => fetch('/backend-api/conversations/PRIVATE-ID?num_turns=10').then((response) => response.json()));
    await page.waitForFunction(() => window.__msgs.some((item) => item.type === 'CONVERSATION_RESPONSE_SUMMARY'));
    const summary = await page.evaluate(() => window.__msgs.find((item) => item.type === 'CONVERSATION_RESPONSE_SUMMARY').payload);
    const hint = summary.messages.numericMetadataHints.find((item) => item.key === 'retrieval_turn_number');
    assert.deepEqual(hint, { key: 'retrieval_turn_number', count: 2, min: 17, max: 18, distinctValues: [17, 18] });
    assert.equal(summary.messages.numericMetadataHints.some((item) => item.key === 'turn_exchange_id'), false);
    assert.doesNotMatch(JSON.stringify(summary), /PRIVATE TEXT|PRIVATE ANSWER|PRIVATE-CURSOR|PRIVATE-REQUEST|PRIVATE-PARENT|PRIVATE-ID/);
  } finally {
    await browser.close();
  }
});

test('v1.0.8 reads Request body schema from a clone without body values', async () => {
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.test/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith('/backend-api/conversation/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'conversation_detail_metadata' }) });
    });
    await page.goto('https://chatgpt.test/');
    await page.evaluate((source) => { window.__msgs = []; window.addEventListener('message', (e) => { if (e.data?.source === 'arcaia-backend-contract-probe-v1') window.__msgs.push(e.data); }); (0, eval)(source); }, mainSource);
    await page.evaluate(() => fetch(new Request('/backend-api/conversation/PRIVATE-ID', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'detail', count: 3, source: '0075038d-d9dd-4353-bcde-0c40eb795e75', secret: 'PRIVATE BODY' })
    })).then((response) => response.json()));
    await page.waitForFunction(() => window.__msgs.some((item) => item.type === 'REQUEST_BODY_SHAPE_OBSERVED'));
    const body = await page.evaluate(() => window.__msgs.find((item) => item.type === 'REQUEST_BODY_SHAPE_OBSERVED').payload.body);
    assert.deepEqual(body.jsonShape.topLevelKeys, ['action', 'count', 'secret', 'source']);
    assert.equal(body.jsonShape.structuralHints.countLikeScalars.some((item) => item.path === 'count' && item.value === 3), true);
    assert.equal(body.jsonShape.structuralHints.enumScalars.some((item) => item.path === 'action' && item.value === 'detail'), true);
    assert.equal(body.jsonShape.structuralHints.enumScalars.some((item) => item.path === 'source'), false);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE BODY|PRIVATE-ID|0075038d-d9dd-4353-bcde-0c40eb795e75/);
  } finally {
    await browser.close();
  }
});
