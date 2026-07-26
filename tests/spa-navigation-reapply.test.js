'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const helperStart = source.indexOf('  let pageConversationPendingDomSync = null;');
const helperEnd = source.indexOf('  function scheduleConversationDependentStateSync(', helperStart);

test('SPA pending sync waits for replacement header and Composer, then schedules once per DOM identity', async () => {
  assert.ok(helperStart > -1 && helperEnd > helperStart);
  const helperSource = source.slice(helperStart, helperEnd);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent(`
      <!doctype html>
      <html lang="ja">
        <body>
          <header id="old-header">
            <div id="old-actions">
              <button id="old-share" data-testid="share-chat-button">共有する</button>
            </div>
          </header>
          <form id="old-composer" data-type="unified-composer">
            <button id="old-trigger" aria-haspopup="menu">GPT-5.6</button>
          </form>
        </body>
      </html>
    `);
    await page.evaluate((code) => {
      window.__conversationId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      window.__syncReasons = [];
      const prelude = `
        let pageConversationMonitorStarted = true;
        function isArcaiaExtensionEnabled() { return true; }
        function isArcaiaFeatureEnabled() { return true; }
        function tryExtractConversationIdFromUrl() { return window.__conversationId; }
        function findNativeShareButton() { return document.querySelector('header [data-testid*="share"]'); }
        function scheduleConversationDependentStateSync(reason) { window.__syncReasons.push(reason); }
        function hasObservedPageConversationStateChanged() { return false; }
      `;
      const expose = `
        window.__spaPendingTest = {
          mark: markConversationDependentDomSyncPending,
          note: noteConversationDependentDomSyncSignal,
          stopObserver: disconnectPageConversationPendingDomObserver,
          snapshot() {
            return {
              pending: Boolean(pageConversationPendingDomSync),
              domSignalReceived: Boolean(pageConversationPendingDomSync?.domSignalReceived),
              syncReasons: [...window.__syncReasons]
            };
          }
        };
      `;
      (0, eval)(`${prelude}${code}${expose}`);
    }, helperSource);

    assert.equal(await page.evaluate(() => Boolean(window.__spaPendingTest.mark('page_navigation'))), true);
    await page.evaluate(() => window.__spaPendingTest.stopObserver());
    assert.equal(await page.evaluate(() => window.__spaPendingTest.note('old_dom_mutation')), false);
    assert.deepEqual(await page.evaluate(() => window.__spaPendingTest.snapshot()), {
      pending: true,
      domSignalReceived: false,
      syncReasons: []
    });

    await page.evaluate(() => {
      document.getElementById('old-header').remove();
      document.getElementById('old-composer').remove();
    });
    assert.equal(await page.evaluate(() => window.__spaPendingTest.note('transition_gap')), false);

    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', `
        <header id="new-header">
          <div id="new-actions">
            <button id="new-share" data-testid="share-chat-button-next">共有する</button>
          </div>
        </header>
      `);
    });
    assert.equal(await page.evaluate(() => window.__spaPendingTest.note('header_only')), false);

    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', `
        <form id="new-composer" data-type="unified-composer">
          <button id="new-trigger" aria-haspopup="menu">GPT-5.6</button>
        </form>
      `);
    });
    assert.equal(await page.evaluate(() => window.__spaPendingTest.note('replacement_dom_ready')), true);
    assert.deepEqual(await page.evaluate(() => window.__spaPendingTest.snapshot()), {
      pending: true,
      domSignalReceived: true,
      syncReasons: ['replacement_dom_ready']
    });
    assert.equal(await page.evaluate(() => window.__spaPendingTest.note('duplicate_mutation')), false);
    assert.deepEqual(await page.evaluate(() => window.__spaPendingTest.snapshot().syncReasons), ['replacement_dom_ready']);
  } finally {
    await browser.close();
  }
});

test('SPA pending observer completes when replacement header and Composer appear before the model trigger', async () => {
  assert.ok(helperStart > -1 && helperEnd > helperStart);
  const helperSource = source.slice(helperStart, helperEnd);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent(`
      <!doctype html>
      <html lang="ja">
        <body>
          <header id="old-header">
            <div id="old-actions">
              <button id="old-share" data-testid="share-chat-button">共有する</button>
            </div>
          </header>
          <form id="old-composer" data-type="unified-composer">
            <button id="old-trigger" aria-haspopup="menu">GPT-5.6</button>
          </form>
        </body>
      </html>
    `);
    await page.evaluate((code) => {
      window.__conversationId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      window.__syncReasons = [];
      const prelude = `
        let pageConversationMonitorStarted = true;
        function isArcaiaExtensionEnabled() { return true; }
        function isArcaiaFeatureEnabled() { return true; }
        function tryExtractConversationIdFromUrl() { return window.__conversationId; }
        function findNativeShareButton() { return document.querySelector('header [data-testid*="share"]'); }
        function scheduleConversationDependentStateSync(reason) { window.__syncReasons.push(reason); }
        function hasObservedPageConversationStateChanged() { return false; }
      `;
      const expose = `
        window.__spaPendingObserverTest = {
          mark: markConversationDependentDomSyncPending,
          stop: disconnectPageConversationPendingDomObserver,
          snapshot() {
            return {
              observerActive: Boolean(pageConversationPendingDomObserver),
              domSignalReceived: Boolean(pageConversationPendingDomSync?.domSignalReceived),
              syncReasons: [...window.__syncReasons]
            };
          }
        };
      `;
      (0, eval)(`${prelude}${code}${expose}`);
    }, helperSource);

    assert.equal(await page.evaluate(() => Boolean(window.__spaPendingObserverTest.mark('page_navigation'))), true);
    assert.equal(await page.evaluate(() => window.__spaPendingObserverTest.snapshot().observerActive), true);

    await page.evaluate(() => document.body.appendChild(document.createElement('div')));
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.__spaPendingObserverTest.snapshot().syncReasons), []);

    await page.evaluate(() => {
      document.getElementById('old-header').remove();
      document.getElementById('old-composer').remove();
      document.body.insertAdjacentHTML('beforeend', `
        <header id="new-header">
          <div id="new-actions">
            <button id="new-share" data-testid="share-chat-button-next">共有する</button>
          </div>
        </header>
        <form id="new-composer" data-type="unified-composer"></form>
      `);
    });
    await page.waitForFunction(() => window.__syncReasons.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__spaPendingObserverTest.snapshot()), {
      observerActive: true,
      domSignalReceived: true,
      syncReasons: ['pending_conversation_dom_mutation']
    });

    await page.evaluate(() => {
      document.getElementById('new-composer').insertAdjacentHTML(
        'beforeend',
        '<button id="new-trigger" aria-haspopup="menu">GPT-5.6</button>'
      );
    });
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.__spaPendingObserverTest.snapshot()), {
      observerActive: true,
      domSignalReceived: true,
      syncReasons: ['pending_conversation_dom_mutation']
    });

    await page.evaluate(() => document.body.appendChild(document.createElement('div')));
    await page.waitForTimeout(50);
    assert.deepEqual(
      await page.evaluate(() => window.__spaPendingObserverTest.snapshot().syncReasons),
      ['pending_conversation_dom_mutation']
    );
    await page.evaluate(() => window.__spaPendingObserverTest.stop());
    assert.equal(await page.evaluate(() => window.__spaPendingObserverTest.snapshot().observerActive), false);
  } finally {
    await browser.close();
  }
});

test('SPA pending observer is bounded to conversation routes and is disconnected during monitor cleanup', () => {
  assert.match(source, /if \(\s*!pending\?\.conversationId/);
  assert.match(source, /function isPageConversationPendingDomMutationRelevant\(mutations\)/);
  assert.match(source, /target\?\.closest\?\.\('header'\)/);
  assert.match(source, /if \(!isPageConversationPendingDomMutationRelevant\(mutations\)\) return;/);
  assert.match(source, /pageConversationPendingDomObserver\.observe\(target, \{ childList: true, subtree: true \}\)/);
  assert.match(source, /pageConversationPendingDomSync = null;\s*disconnectPageConversationPendingDomObserver\(\);/);
  assert.match(source, /function stopPageConversationMonitor\(\)[\s\S]*?disconnectPageConversationPendingDomObserver\(\);/);
  const readinessSource = source.slice(
    source.indexOf('  function isConversationDependentDomIdentityReady('),
    source.indexOf('  function getCurrentConversationDependentDomSyncPending', source.indexOf('  function isConversationDependentDomIdentityReady('))
  );
  assert.match(readinessSource, /identity\?\.composer\?\.isConnected/);
  assert.doesNotMatch(readinessSource, /modelTrigger/);
});
