const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const popupSource = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupHtmlSource = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const modelSelectorSource = fs.readFileSync(path.join(root, 'content_model_selector.js'), 'utf8');
const injectedSource = fs.readFileSync(path.join(root, 'injected-main.js'), 'utf8');
const toolbarSource = fs.readFileSync(path.join(root, 'content_toolbar.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const DEFAULT_FEATURE_SETTINGS = {
  liteView: true,
  liteImages: true,
  messageTimestamps: true,
  modelDecoration: true,
  blockCollapser: true,
  ctrlEnterSend: true,
  loadingTitle: true,
  completionSound: false,
  pinnedSort: true,
  pinnedIcons: true,
  turnMarkdownButtons: true,
  headerMarkdownButton: true
};

const DEFAULT_FINGERPRINT = JSON.stringify({
  schemaVersion: 2,
  operationMode: 'normal',
  featureSettings: DEFAULT_FEATURE_SETTINGS,
  liteTurnCount: 3,
  assistantCompletionSoundId: 'classic_chime',
  assistantCompletionSoundVolume: 0.153
});

test('popup follows prefers-color-scheme dark with the soft graphite palette', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 }, colorScheme: 'dark' });
    await page.addInitScript(() => {
      globalThis.chrome = {
        action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
        storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } },
        tabs: { async query() { return []; } },
        scripting: { async executeScript() {} },
        runtime: { lastError: null, sendMessage(_message, callback) { callback?.({ ok: true }); }, getURL(value) { return value; } }
      };
    });

    await page.goto(pathToFileURL(path.join(root, 'popup.html')).href);
    const theme = await page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const panel = document.getElementById('menuView');
      const panelNoise = getComputedStyle(panel, '::after');
      return {
        prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
        page: rootStyle.getPropertyValue('--arcaia-page').trim(),
        surface: rootStyle.getPropertyValue('--arcaia-surface').trim(),
        headerSurface: rootStyle.getPropertyValue('--arcaia-header-surface').trim(),
        sectionSurface: rootStyle.getPropertyValue('--arcaia-section-surface').trim(),
        sectionBand: rootStyle.getPropertyValue('--arcaia-section-band').trim(),
        surfaceSoft: rootStyle.getPropertyValue('--arcaia-surface-soft').trim(),
        border: rootStyle.getPropertyValue('--arcaia-section-border').trim(),
        accent: rootStyle.getPropertyValue('--arcaia-accent').trim(),
        toggleOn: rootStyle.getPropertyValue('--arcaia-toggle-on').trim(),
        toggleKnob: rootStyle.getPropertyValue('--arcaia-toggle-knob').trim(),
        grainOpacity: panelNoise.opacity,
        grainBackground: panelNoise.backgroundImage,
        grainBlend: panelNoise.mixBlendMode,
        headerBackgroundImage: getComputedStyle(document.querySelector('.extension-state')).backgroundImage,
        headerBoxShadow: getComputedStyle(document.querySelector('.extension-state')).boxShadow,
        sectionBackgroundImage: getComputedStyle(document.querySelector('.section-band')).backgroundImage,
        sectionBoxShadow: getComputedStyle(document.querySelector('.settings-section')).boxShadow,
        success: rootStyle.getPropertyValue('--arcaia-success').trim(),
        text: rootStyle.getPropertyValue('--arcaia-text').trim()
      };
    });

    assert.equal(theme.prefersDark, true);
    assert.equal(theme.page, '#2a2d31');
    assert.equal(theme.surface, '#1b1f23');
    assert.equal(theme.headerSurface, '#1c2024');
    assert.equal(theme.sectionSurface, '#20252a');
    assert.equal(theme.sectionBand, '#1d2227');
    assert.equal(theme.surfaceSoft, '#252b31');
    assert.equal(theme.border, '#353c43');
    assert.equal(theme.accent, '#4773b7');
    assert.equal(theme.toggleOn, '#4f6f9f');
    assert.equal(theme.toggleKnob, '#d9dee5');
    assert.equal(theme.grainOpacity, '0.035');
    assert.match(theme.grainBackground, /data:image\/svg\+xml/);
    assert.equal(theme.grainBlend, 'soft-light');
    assert.equal(theme.headerBackgroundImage, 'none');
    assert.equal(theme.headerBoxShadow, 'none');
    assert.equal(theme.sectionBackgroundImage, 'none');
    assert.equal(theme.sectionBoxShadow, 'none');
    assert.equal(theme.success, '#22c55e');
    assert.equal(theme.text, '#e5e7eb');
  } finally {
    await browser.close();
  }
});

test('popup opening with identical settings performs a status check but sends no settings update', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    await page.addInitScript(({ fingerprint }) => {
      globalThis.__arcaiaMessages = [];
      globalThis.__arcaiaStorageSets = [];
      globalThis.chrome = {
        action: {
          setBadgeText() {},
          setBadgeBackgroundColor() {}
        },
        storage: {
          local: {
            async get() { return {}; },
            async set(values) { globalThis.__arcaiaStorageSets.push(values); },
            async remove() {}
          }
        },
        tabs: {
          async query() { return [{ id: 7, url: 'https://chatgpt.com/c/example' }]; },
          sendMessage(tabId, message, options, callback) {
            if (typeof options === 'function') callback = options;
            globalThis.__arcaiaMessages.push({ tabId, message });
            if (message.type === 'AICE_GET_UI_SETTINGS_STATUS') {
              callback({ ok: true, result: { settingsFingerprint: fingerprint } });
              return;
            }
            callback({ ok: true, result: { settingsFingerprint: fingerprint } });
          }
        },
        scripting: {
          async executeScript() {}
        },
        runtime: {
          lastError: null,
          sendMessage(_message, callback) { callback?.({ ok: true }); },
          getURL(value) { return value; }
        }
      };
    }, { fingerprint: DEFAULT_FINGERPRINT });

    await page.goto(pathToFileURL(path.join(root, 'popup.html')).href);
    await page.waitForFunction(() => globalThis.__arcaiaMessages.some((entry) => entry.message.type === 'AICE_GET_UI_SETTINGS_STATUS'));

    const state = await page.evaluate(() => ({
      messages: globalThis.__arcaiaMessages.map((entry) => entry.message.type),
      saveHidden: document.getElementById('settingsSaveState').hidden
    }));
    assert.deepEqual(state.messages, ['AICE_GET_UI_SETTINGS_STATUS']);
    assert.equal(state.saveHidden, true);
  } finally {
    await browser.close();
  }
});

test('changing one popup feature sends one settings update after the status comparison', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    await page.addInitScript(({ fingerprint }) => {
      globalThis.__arcaiaMessages = [];
      globalThis.chrome = {
        action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
        storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } },
        tabs: {
          async query() { return [{ id: 8, url: 'https://chatgpt.com/c/example' }]; },
          sendMessage(tabId, message, options, callback) {
            if (typeof options === 'function') callback = options;
            globalThis.__arcaiaMessages.push({ tabId, message });
            if (message.type === 'AICE_GET_UI_SETTINGS_STATUS') {
              callback({ ok: true, result: { settingsFingerprint: fingerprint } });
              return;
            }
            callback({ ok: true, result: { changedSubsystems: ['header_markdown'] } });
          }
        },
        scripting: { async executeScript() {} },
        runtime: { lastError: null, sendMessage(_message, callback) { callback?.({ ok: true }); }, getURL(value) { return value; } }
      };
    }, { fingerprint: DEFAULT_FINGERPRINT });

    await page.goto(pathToFileURL(path.join(root, 'popup.html')).href);
    await page.waitForFunction(() => globalThis.__arcaiaMessages.some((entry) => entry.message.type === 'AICE_GET_UI_SETTINGS_STATUS'));
    await page.evaluate(() => {
      const input = document.getElementById('headerMarkdownButtonToggle');
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => globalThis.__arcaiaMessages.some((entry) => entry.message.type === 'AICE_SET_UI_SETTINGS'));
    await page.waitForFunction(() => document.getElementById('settingsSaveState')?.dataset.state === 'saved');

    const result = await page.evaluate(() => ({
      sent: globalThis.__arcaiaMessages.map((entry) => entry.message),
      saveHidden: document.getElementById('settingsSaveState').hidden,
      saveText: document.getElementById('settingsSaveState').textContent
    }));
    const sent = result.sent;
    assert.deepEqual(sent.map((message) => message.type), [
      'AICE_GET_UI_SETTINGS_STATUS',
      'AICE_GET_UI_SETTINGS_STATUS',
      'AICE_SET_UI_SETTINGS'
    ]);
    const update = sent.at(-1);
    assert.equal(update.featureSettings.headerMarkdownButton, false);
    assert.equal(update.reason, 'popup_settings_changed');
    assert.equal(result.saveHidden, false);
    assert.match(result.saveText, /保存済み/);
  } finally {
    await browser.close();
  }
});

test('failed active-tab apply rolls storage and popup state back to the previous settings', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    await page.addInitScript(({ fingerprint, defaults }) => {
      globalThis.__arcaiaMessages = [];
      globalThis.__arcaiaStored = {};
      globalThis.__arcaiaRemoteFingerprint = fingerprint;
      globalThis.__arcaiaUpdateCount = 0;
      globalThis.chrome = {
        action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
        storage: {
          local: {
            async get() { return { arcaia_feature_settings_v1: { ...defaults } }; },
            async set(values) { Object.assign(globalThis.__arcaiaStored, structuredClone(values)); },
            async remove() {}
          }
        },
        tabs: {
          async query() { return [{ id: 9, url: 'https://chatgpt.com/c/example' }]; },
          sendMessage(tabId, message, options, callback) {
            if (typeof options === 'function') callback = options;
            globalThis.__arcaiaMessages.push({ tabId, message: structuredClone(message) });
            if (message.type === 'AICE_GET_UI_SETTINGS_STATUS') {
              callback({ ok: true, result: { settingsFingerprint: globalThis.__arcaiaRemoteFingerprint } });
              return;
            }
            if (message.type === 'AICE_SET_UI_SETTINGS') {
              globalThis.__arcaiaUpdateCount += 1;
              if (globalThis.__arcaiaUpdateCount === 1) {
                callback({ ok: false, error: 'simulated_apply_failure' });
                return;
              }
              globalThis.__arcaiaRemoteFingerprint = message.settingsFingerprint;
              callback({ ok: true, result: { settingsFingerprint: message.settingsFingerprint } });
              return;
            }
            callback({ ok: true });
          }
        },
        scripting: { async executeScript() {} },
        runtime: { lastError: null, sendMessage(_message, callback) { callback?.({ ok: true }); }, getURL(value) { return value; } }
      };
    }, { fingerprint: DEFAULT_FINGERPRINT, defaults: DEFAULT_FEATURE_SETTINGS });

    await page.goto(pathToFileURL(path.join(root, 'popup.html')).href);
    await page.waitForFunction(() => globalThis.__arcaiaMessages.some((entry) => entry.message.type === 'AICE_GET_UI_SETTINGS_STATUS'));
    await page.evaluate(() => {
      const input = document.getElementById('headerMarkdownButtonToggle');
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.getElementById('settingsSaveState')?.dataset.state === 'error');

    const state = await page.evaluate(() => ({
      checked: document.getElementById('headerMarkdownButtonToggle').checked,
      storedFeatures: globalThis.__arcaiaStored.arcaia_feature_settings_v1,
      updates: globalThis.__arcaiaMessages.filter((entry) => entry.message.type === 'AICE_SET_UI_SETTINGS').map((entry) => entry.message)
    }));
    assert.equal(state.checked, true);
    assert.equal(state.storedFeatures.headerMarkdownButton, true);
    assert.equal(state.updates.length, 2);
    assert.equal(state.updates[0].featureSettings.headerMarkdownButton, false);
    assert.equal(state.updates[1].featureSettings.headerMarkdownButton, true);
    assert.match(state.updates[1].reason, /^rollback:/);
  } finally {
    await browser.close();
  }
});

test('rapid popup changes are serialized and the later payload includes earlier successful changes', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    await page.addInitScript(({ fingerprint }) => {
      globalThis.__arcaiaMessages = [];
      globalThis.__arcaiaRemoteFingerprint = fingerprint;
      globalThis.__arcaiaInFlight = 0;
      globalThis.__arcaiaMaxInFlight = 0;
      globalThis.chrome = {
        action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
        storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } },
        tabs: {
          async query() { return [{ id: 10, url: 'https://chatgpt.com/c/example' }]; },
          sendMessage(tabId, message, options, callback) {
            if (typeof options === 'function') callback = options;
            globalThis.__arcaiaMessages.push({ tabId, message: structuredClone(message) });
            if (message.type === 'AICE_GET_UI_SETTINGS_STATUS') {
              callback({ ok: true, result: { settingsFingerprint: globalThis.__arcaiaRemoteFingerprint } });
              return;
            }
            if (message.type === 'AICE_SET_UI_SETTINGS') {
              globalThis.__arcaiaInFlight += 1;
              globalThis.__arcaiaMaxInFlight = Math.max(globalThis.__arcaiaMaxInFlight, globalThis.__arcaiaInFlight);
              setTimeout(() => {
                globalThis.__arcaiaRemoteFingerprint = message.settingsFingerprint;
                globalThis.__arcaiaInFlight -= 1;
                callback({ ok: true, result: { settingsFingerprint: message.settingsFingerprint } });
              }, 60);
              return;
            }
            callback({ ok: true });
          }
        },
        scripting: { async executeScript() {} },
        runtime: { lastError: null, sendMessage(_message, callback) { callback?.({ ok: true }); }, getURL(value) { return value; } }
      };
    }, { fingerprint: DEFAULT_FINGERPRINT });

    await page.goto(pathToFileURL(path.join(root, 'popup.html')).href);
    await page.waitForFunction(() => globalThis.__arcaiaMessages.some((entry) => entry.message.type === 'AICE_GET_UI_SETTINGS_STATUS'));
    await page.evaluate(() => {
      const header = document.getElementById('headerMarkdownButtonToggle');
      const timestamps = document.getElementById('messageTimestampsToggle');
      header.checked = false;
      header.dispatchEvent(new Event('change', { bubbles: true }));
      timestamps.checked = false;
      timestamps.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => globalThis.__arcaiaMessages.filter((entry) => entry.message.type === 'AICE_SET_UI_SETTINGS').length === 2 && globalThis.__arcaiaInFlight === 0);

    const result = await page.evaluate(() => ({
      maxInFlight: globalThis.__arcaiaMaxInFlight,
      updates: globalThis.__arcaiaMessages.filter((entry) => entry.message.type === 'AICE_SET_UI_SETTINGS').map((entry) => entry.message)
    }));
    assert.equal(result.maxInFlight, 1);
    assert.equal(result.updates[0].featureSettings.headerMarkdownButton, false);
    assert.equal(result.updates[0].featureSettings.messageTimestamps, true);
    assert.equal(result.updates[1].featureSettings.headerMarkdownButton, false);
    assert.equal(result.updates[1].featureSettings.messageTimestamps, false);
  } finally {
    await browser.close();
  }
});

test('content settings handler returns before storage and cleanup when the fingerprint is unchanged', () => {
  const start = contentSource.indexOf('  async function setUiSettings(payload = {}, reason = \'manual\') {');
  const end = contentSource.indexOf('  async function setExtensionEnabled', start);
  assert.ok(start >= 0 && end > start);
  const handler = contentSource.slice(start, end);
  const noOpIndex = handler.indexOf("reason: 'settings_unchanged'");
  const storageIndex = handler.indexOf('await chrome.storage.local.set');
  const diffIndex = handler.indexOf('await applyUiSettingsDiff');
  assert.ok(noOpIndex >= 0);
  assert.ok(storageIndex > noOpIndex);
  assert.ok(diffIndex > storageIndex);
  assert.doesNotMatch(handler.slice(0, noOpIndex), /cleanupArcaiaPageUiForDisabled|startArcaiaPageUi/);
});

test('ordinary settings changes are applied by subsystem and full cleanup is reserved for mode changes', () => {
  const start = contentSource.indexOf('  async function applyUiSettingsDiff(');
  const end = contentSource.indexOf('  async function syncUiSettingsFromStorage()', start);
  assert.ok(start >= 0 && end > start);
  const diffHandler = contentSource.slice(start, end);
  const modeBranchEnd = diffHandler.indexOf('    const changedSubsystems = new Set();');
  const modeBranch = diffHandler.slice(0, modeBranchEnd);
  const ordinaryBranches = diffHandler.slice(modeBranchEnd);

  assert.match(modeBranch, /cleanupArcaiaPageUiForDisabled/);
  assert.match(modeBranch, /startArcaiaPageUi/);
  assert.doesNotMatch(ordinaryBranches, /cleanupArcaiaPageUiForDisabled|startArcaiaPageUi/);
  assert.match(ordinaryBranches, /changedSubsystems\.add\('composer_input'\)/);
  assert.match(ordinaryBranches, /changedSubsystems\.add\('model_decoration'\)/);
  assert.match(ordinaryBranches, /changedSubsystems\.add\('assistant_monitor'\)/);
  assert.match(ordinaryBranches, /changedSubsystems\.add\('sidebar'\)/);
  assert.match(ordinaryBranches, /changedSubsystems\.add\('turn_markdown'\)/);
  assert.match(ordinaryBranches, /changedSubsystems\.add\('header_markdown'\)/);
  assert.match(ordinaryBranches, /changedSubsystems\.add\('timestamps'\)/);
  assert.match(ordinaryBranches, /changedSubsystems\.add\('recent_view'\)/);
});

test('assistant feedback settings reconfigure only the stream monitor and release generation DOM state', () => {
  const diffStart = contentSource.indexOf('  async function applyUiSettingsDiff(');
  const diffEnd = contentSource.indexOf('  async function syncUiSettingsFromStorage()', diffStart);
  const diffHandler = contentSource.slice(diffStart, diffEnd);
  const branchStart = diffHandler.indexOf("    const assistantMonitorKeys = ['loadingTitle', 'completionSound', 'liteView'];");
  const branchEnd = diffHandler.indexOf("    if (featureChanged('pinnedSort')", branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  const assistantBranch = diffHandler.slice(branchStart, branchEnd);
  const stopIndex = assistantBranch.indexOf("stopAssistantLoadingFaviconMonitor('assistant_features_changed')");
  const startIndex = assistantBranch.indexOf('if (shouldRun) startAssistantLoadingFaviconMonitor()');
  assert.ok(stopIndex >= 0, 'the existing Lite-only monitor must be stopped before feedback listeners are rebuilt');
  assert.ok(startIndex > stopIndex, 'the affected monitor must restart only after its previous listeners are removed');
  assert.doesNotMatch(assistantBranch, /cleanupArcaiaPageUiForDisabled|startArcaiaPageUi/);

  const stopStart = contentSource.indexOf('  function stopAssistantLoadingFaviconMonitor(');
  const stopEnd = contentSource.indexOf('  function isElementActuallyVisible', stopStart);
  assert.ok(stopStart >= 0 && stopEnd > stopStart);
  const stopHandler = contentSource.slice(stopStart, stopEnd);
  assert.match(stopHandler, /cancelPendingAssistantLoadingFaviconCheck\(/);
  assert.match(stopHandler, /clearAssistantGenerationIdentity\(\)/);
  assert.doesNotMatch(contentSource, /assistantGenerationNavigationAbandonReason/);
});

test('normal model-selector status is lightweight and built-in diagnostics are absent', () => {
  const lightweightStart = modelSelectorSource.indexOf('  function getLightweightStatus() {');
  const lightweightEnd = modelSelectorSource.indexOf('  function getStatus()', lightweightStart);
  const lightweight = modelSelectorSource.slice(lightweightStart, lightweightEnd);
  assert.doesNotMatch(lightweight, /getDiagnosticSnapshot|querySelectorAll|getVisiblePicker/);
  assert.match(lightweight, /activeSurfaceMode: getActiveSurfaceMode\(\)/);
  assert.doesNotMatch(modelSelectorSource, /function getDiagnosticSnapshot\(\)|getDiagnosticSnapshot,/);
  assert.doesNotMatch(injectedSource, /RUN_MODEL_SELECTOR_CLIENT_STATE_DIAGNOSTIC|MODEL_SELECTOR_CLIENT_STATE_DIAGNOSTIC_RESULT|collectModelSelectorClientStateDiagnostic|MODEL_SELECTOR_CLIENT_STATE_MATCHES/);
});

test('generic debug UI and runtime commands are absent', () => {
  assert.doesNotMatch(popupHtmlSource, /debugSettingsSection|debugLoggingToggle|diagnosticOnlyToggle|diagnosticPresetSelect|diagnosticZipDownloadMain|debugView/);
  assert.doesNotMatch(popupSource, /AICE_SET_DEBUG_MODE|AICE_COLLECT_DIAGNOSTIC_BUNDLE|diagnosticOnlyPreference|debugLoggingPreference/);
  assert.doesNotMatch(contentSource, /AICE_SET_DEBUG_MODE|AICE_COLLECT_DIAGNOSTIC_BUNDLE|AICE_TOOLBAR_SAVE_DIAGNOSTIC_ZIP|operationMode === 'diagnostic'|debugModeEnabled|appendStoredDebugEvent|pushContentFailedTrace|contentFailedObserver/);
  assert.doesNotMatch(injectedSource, /SET_DEBUG_MODE|GET_HOOK_DEBUG|CLEAR_HOOK_DEBUG|debugModeEnabled|deletionApiObservations|nonGetBackendApiObservations|modelSelectorNetworkObservations/);
  assert.doesNotMatch(toolbarSource, /diagnostic_zip|DiagnosticZip|appendStoredDebugEvent|isDebugModeEnabled/);
  assert.equal(manifest.content_scripts[0].js.includes('content_zip.js'), false);
  assert.equal(fs.existsSync(path.join(root, 'content_zip.js')), false);
});
