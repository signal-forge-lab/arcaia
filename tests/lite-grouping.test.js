'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const contentToolbarSourceFile = fs.readFileSync(path.join(__dirname, '..', 'content_toolbar.js'), 'utf8');
const contentDiagnosticsSource = fs.readFileSync(path.join(__dirname, '..', 'content_diagnostics.js'), 'utf8');
const contentMarkdownSource = fs.readFileSync(path.join(__dirname, '..', 'content_markdown.js'), 'utf8');
const contentFilenameSource = fs.readFileSync(path.join(__dirname, '..', 'content_filename.js'), 'utf8');
const contentModelSelectorSource = fs.readFileSync(path.join(__dirname, '..', 'content_model_selector.js'), 'utf8');
const injectedSource = fs.readFileSync(path.join(__dirname, '..', 'injected-main.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const offscreenHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'offscreen.html'), 'utf8');
const offscreenSource = fs.readFileSync(path.join(__dirname, '..', 'offscreen.js'), 'utf8');
const completionSoundAssetPath = path.join(__dirname, '..', 'sounds', 'assistant-complete.ogg');
const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const popupHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
const toolbarIconPngPaths = [16, 32, 48, 128].map((size) => path.join(__dirname, '..', 'icons', 'toolbar', 'icon' + size + '.png'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
const MESSAGE_SECTION_SELECTOR = 'section[data-testid^="conversation-turn-"]';
const PROMPT_TOC_BUTTON_SELECTOR = 'button[aria-label^="Prompt "]';
const PROMPT_TOC_HIDE_ROOT_ATTR = 'data-arcaia-prompt-toc-hidden';
const LITE_GROUPING_STRATEGY = 'latest_user_started_turns_hard_prune_v1';
const LITE_RETAIN_MODE = 'latest_user_started_turns_hard_prune';
const LITE_BAR_ID = 'arcaia-lite-display-bar';
const NATIVE_LITE_TURN_COUNT = 3;
const ROLLING_HIDE_ATTR = 'data-arcaia-lite-rolling-hidden';
const ROLLING_ORIGINAL_DISPLAY_ATTR = 'data-arcaia-lite-original-display';
const ROLLING_PRUNE_MODE_ATTR = 'data-arcaia-lite-prune-mode';

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

class FakeRoleNode {
  constructor(section, role, messageId) {
    this.section = section;
    this.role = role;
    this.messageId = messageId;
    this.isConnected = true;
  }

  getAttribute(name) {
    if (name === 'data-message-author-role') return this.role;
    if (name === 'data-message-id') return this.messageId;
    return null;
  }

  closest(selector) {
    if (selector === MESSAGE_SECTION_SELECTOR) return this.section;
    return null;
  }
}

class FakeSection {
  constructor(testId, role = null, messageId = null, text = undefined) {
    this.attrs = new Map([['data-testid', testId]]);
    this.id = '';
    this.isConnected = true;
    this.parentElement = null;
    this.style = { display: '' };
    this.textContent = text === undefined ? (role ? `${role}:${messageId || testId}` : '') : text;
    this.roleNodes = role ? [new FakeRoleNode(this, role, messageId)] : [];
    if (messageId) this.attrs.set('data-message-id', messageId);
  }

  remove() {
    this.isConnected = false;
  }

  matches(selector) {
    return selector === MESSAGE_SECTION_SELECTOR
      && String(this.getAttribute('data-testid') || '').startsWith('conversation-turn-');
  }

  closest(selector) {
    if (selector === MESSAGE_SECTION_SELECTOR && this.matches(selector)) return this;
    return null;
  }

  querySelectorAll(selector) {
    if (selector.includes('data-message-author-role')) return this.roleNodes;
    if (selector === '[data-message-id]') return this.roleNodes.filter((node) => node.messageId);
    return [];
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  removeAttribute(name) {
    this.attrs.delete(name);
  }

  hasAttribute(name) {
    return this.attrs.has(name);
  }
}

class FakePromptTocButton {
  constructor(label, parent) {
    this.attrs = new Map([['aria-label', label]]);
    this.parentElement = parent;
    this.parentNode = parent;
    this.isConnected = true;
    this.className = 'h-0.5 w-4.5 shrink-0 rounded-full transition-all';
    this.style = { visibility: '', opacity: '', pointerEvents: '' };
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  remove() {
    this.isConnected = false;
  }

  removeAttribute(name) {
    this.attrs.delete(name);
  }

  hasAttribute(name) {
    return this.attrs.has(name);
  }
}

class FakePromptTocParent {
  constructor() {
    this.className = 'no-scrollbar flex max-h-[50lvh] w-9 flex-col items-center gap-2 overflow-y-auto py-1';
  }
}

class FakeDocument {
  constructor(sections, promptTocButtons = []) {
    this.sections = sections;
    this.promptTocButtons = promptTocButtons;
  }

  querySelectorAll(selector) {
    if (selector === PROMPT_TOC_BUTTON_SELECTOR) return this.promptTocButtons;
    if (selector === MESSAGE_SECTION_SELECTOR) return this.sections;
    if (selector.includes(ROLLING_HIDE_ATTR) || selector.includes(ROLLING_PRUNE_MODE_ATTR) || selector.includes(ROLLING_ORIGINAL_DISPLAY_ATTR)) {
      return this.sections.filter((section) =>
        section.getAttribute(ROLLING_HIDE_ATTR) === 'true'
        || section.getAttribute(ROLLING_PRUNE_MODE_ATTR) === 'css_hide'
        || section.hasAttribute(ROLLING_ORIGINAL_DISPLAY_ATTR)
      );
    }
    if (selector === `[${ROLLING_HIDE_ATTR}="true"]`) {
      return this.sections.filter((section) => section.getAttribute(ROLLING_HIDE_ATTR) === 'true');
    }
    if (selector === `${MESSAGE_SECTION_SELECTOR}[${ROLLING_HIDE_ATTR}="true"]`) {
      return this.sections.filter((section) => section.matches(MESSAGE_SECTION_SELECTOR)
        && section.getAttribute(ROLLING_HIDE_ATTR) === 'true');
    }
    return [];
  }
}

const context = {
  console,
  MESSAGE_SECTION_SELECTOR,
  LITE_GROUPING_STRATEGY,
  LITE_RETAIN_MODE,
  LITE_BAR_ID,
  NATIVE_LITE_TURN_COUNT,
  PROMPT_TOC_BUTTON_SELECTOR,
  PROMPT_TOC_HIDE_ROOT_ATTR,
  ROLLING_HIDE_ATTR,
  ROLLING_ORIGINAL_DISPLAY_ATTR,
  ROLLING_PRUNE_MODE_ATTR,
  document: null
};
vm.createContext(context);
for (const name of [
  'redactSnapshotUrl',
  'isTopLevelMessageSection',
  'getSectionOwnedRoleNodes',
  'getSectionMessageId',
  'collectMessageSectionModel',
  'buildUserStartedGroupsFromSectionRecords',
  'buildLiteGroupingPlan',
  'unhideRollingLiteContainer',
  'hideRollingLiteContainer',
  'setPromptTocHiddenActive',
  'reconcileRollingLiteSections',
  'shouldNoopLiteForShortConversation',
  'unhideRollingLiteContainers'
]) {
  vm.runInContext(`${extractFunction(name)}; this.${name} = ${name};`, context);
}

const {
  buildLiteGroupingPlan,
  reconcileRollingLiteSections,
  redactSnapshotUrl,
  shouldNoopLiteForShortConversation,
  unhideRollingLiteContainers
} = context;

function makeSections(roles) {
  return roles.map((role, index) => new FakeSection(`conversation-turn-${index + 1}`, role, `message-${index + 1}`));
}

test('diagnostic URL redaction helper is defined and removes conversation ids and secrets', () => {
  const value = redactSnapshotUrl('https://chatgpt.com/c/12345678-abcd?token=secret&arcaia_soft_refresh=123');
  assert.equal(value.includes('12345678-abcd'), false);
  assert.equal(value.includes('secret'), false);
  assert.match(value, /<conversationId>/);
});

test('34 sections retain the latest three user-started turns as six sections', () => {
  const sections = makeSections(Array.from({ length: 34 }, (_, index) => index % 2 === 0 ? 'user' : 'assistant'));
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, false);
  assert.equal(plan.liteRetainMode, 'latest_user_started_turns_hard_prune');
  assert.equal(plan.model.meaningfulSectionCount, 34);
  assert.equal(plan.retainedUserStartedGroups.length, 3);
  assert.deepEqual([...plan.retainedSections], sections.slice(-6));
  assert.deepEqual([...plan.hiddenSections], sections.slice(0, 28));
});

test('short conversations are treated as Lite no-op when nothing would be hidden', () => {
  const sections = makeSections(['user', 'assistant', 'user', 'assistant']);
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, false);
  assert.equal(plan.hiddenSections.size, 0);
  assert.equal(plan.userStartedGroups.length, 2);
  assert.equal(shouldNoopLiteForShortConversation(plan, 3), true);

  const longerSections = makeSections(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  context.document = new FakeDocument(longerSections);
  const longerPlan = buildLiteGroupingPlan(context.document, 3, false);
  assert.equal(longerPlan.hiddenSections.size > 0, true);
  assert.equal(shouldNoopLiteForShortConversation(longerPlan, 3), false);
});

test('old roleless empty sections are hidden and do not consume retention slots', () => {
  const empty = new FakeSection('conversation-turn-1');
  const meaningful = makeSections(['user', 'assistant', 'user', 'assistant']);
  const sections = [empty, ...meaningful];
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, false);
  assert.equal(plan.model.emptySectionCount, 1);
  assert.equal(plan.hiddenSections.has(empty), true);
  assert.deepEqual([...plan.retainedSections], meaningful);
});

test('roleless sections inside retained turns are retained with their user-started turn', () => {
  const sections = [
    new FakeSection('conversation-turn-1', 'user', 'message-1'),
    new FakeSection('conversation-turn-2', null, null, 'roleless content'),
    new FakeSection('conversation-turn-3', 'assistant', 'message-3'),
    new FakeSection('conversation-turn-4', null, null, 'latest roleless content')
  ];
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, false);
  assert.deepEqual([...plan.retainedSections], sections);
});

test('the latest empty shell is protected while generation is in progress', () => {
  const meaningful = makeSections(['user', 'assistant', 'user', 'assistant']);
  const latestShell = new FakeSection('conversation-turn-5');
  const sections = [...meaningful, latestShell];
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, true);
  assert.equal(plan.retainedSections.size, 5);
  assert.equal(plan.retainedSections.has(latestShell), true);
  assert.match(plan.fallbackReason, /generating_latest_empty_shell_protected/);
});

test('consecutive user sections still retain only the latest three user-started turns', () => {
  const sections = makeSections(['user', 'user', 'user', 'user', 'user']);
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, false);
  assert.equal(plan.model.consecutiveUserCount, 4);
  assert.deepEqual([...plan.retainedSections], sections.slice(-3));
});

test('assistant-only mixtures retain the latest user-started turn and hide old assistant-only prefix', () => {
  const sections = makeSections(['assistant', 'assistant', 'user', 'assistant', 'assistant']);
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, false);
  assert.deepEqual([...plan.retainedSections], sections.slice(-3));
});

test('latest assistant is protected even when it falls outside the last three sections', () => {
  const assistant = new FakeSection('conversation-turn-1', 'assistant', 'assistant-1');
  const users = makeSections(['user', 'user', 'user']);
  const sections = [assistant, ...users];
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, true);
  assert.equal(plan.retainedSections.size, 4);
  assert.equal(plan.retainedSections.has(assistant), true);
  assert.match(plan.fallbackReason, /latest_assistant_protected/);
});

test('generation protection keeps latest assistant and latest shell in addition to the three-turn window', () => {
  const assistant = new FakeSection('conversation-turn-1', 'assistant', 'assistant-1');
  const users = makeSections(['user', 'user', 'user']);
  const shell = new FakeSection('conversation-turn-5');
  const sections = [assistant, ...users, shell];
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, true);
  assert.equal(plan.retainedSections.size, 5);
  assert.equal(plan.retainedSections.has(assistant), true);
  assert.equal(plan.retainedSections.has(shell), true);
});

test('a previously hidden section is unhidden when it becomes retained', () => {
  const sections = makeSections(['user', 'assistant', 'user']);
  for (const section of sections) {
    section.setAttribute(ROLLING_HIDE_ATTR, 'true');
    section.setAttribute(ROLLING_ORIGINAL_DISPLAY_ATTR, '');
    section.style.display = 'none';
  }
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, false);
  const result = reconcileRollingLiteSections(plan);
  assert.equal(result.arcaiaHiddenSectionCount, 0);
  assert.equal(sections.every((section) => section.getAttribute(ROLLING_HIDE_ATTR) === null), true);
});

test('legacy Arcaia display style markers are cleared when a section becomes retained', () => {
  const sections = makeSections(['user', 'assistant', 'user']);
  sections[0].setAttribute(ROLLING_PRUNE_MODE_ATTR, 'css_hide');
  sections[0].setAttribute(ROLLING_ORIGINAL_DISPLAY_ATTR, '');
  sections[0].style.display = 'none';
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, false);
  reconcileRollingLiteSections(plan);
  assert.equal(sections[0].style.display, '');
  assert.equal(sections[0].getAttribute(ROLLING_PRUNE_MODE_ATTR), null);
  assert.equal(sections[0].hasAttribute(ROLLING_ORIGINAL_DISPLAY_ATTR), false);
});

test('full-load behavior unhides every Arcaia-hidden section', () => {
  const sections = makeSections(['user', 'assistant', 'user', 'assistant']);
  for (const section of sections) {
    section.setAttribute(ROLLING_HIDE_ATTR, 'true');
    section.setAttribute(ROLLING_ORIGINAL_DISPLAY_ATTR, '');
    section.style.display = 'none';
  }
  context.document = new FakeDocument(sections);
  unhideRollingLiteContainers();
  assert.equal(sections.every((section) => section.getAttribute(ROLLING_HIDE_ATTR) === null), true);
  assert.equal(sections.every((section) => section.style.display === ''), true);
});

test('default Lite CSS-hides old non-retained turns without removing ChatGPT DOM', () => {
  const sections = makeSections(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  context.document = new FakeDocument(sections);
  const plan = buildLiteGroupingPlan(context.document, 3, false);
  const result = reconcileRollingLiteSections(plan);
  assert.equal(result.newlyHiddenSectionCount, 2);
  assert.equal(result.removedSectionCount, 0);
  assert.equal(result.prunedSectionCount, 0);
  assert.equal(sections[0].isConnected, true);
  assert.equal(sections[1].isConnected, true);
  assert.equal(sections[0].style.display, 'none');
  assert.equal(sections[1].style.display, 'none');
  assert.equal(sections[0].getAttribute(ROLLING_PRUNE_MODE_ATTR), 'css_hide');
  assert.equal(sections[1].getAttribute(ROLLING_PRUNE_MODE_ATTR), 'css_hide');
  assert.equal(sections.slice(2).every((section) => section.isConnected), true);
});

test('prompt TOC hide CSS is installed for all prompt jump markers', () => {
  assert.match(source, /PROMPT_TOC_HIDE_ROOT_ATTR/);
  assert.match(source, /display:\s*none\s*!important/);
  assert.match(source, /setPromptTocHiddenActive\(true\)/);
  assert.match(source, /setPromptTocHiddenActive\(false\)/);
});

test('generic debug mode, stored logs, and diagnostic-only state are removed', () => {
  assert.doesNotMatch(popupHtmlSource, /debugSettingsSection|debugLoggingToggle|diagnosticOnlyToggle|diagnosticPresetSelect|診断ZIP|実行ログ/);
  assert.doesNotMatch(popupSource, /DEBUG_MODE_STORAGE_KEY|DEBUG_LOGGING_PREFERENCE_STORAGE_KEY|DIAGNOSTIC_ONLY_STORAGE_KEY|DIAGNOSTIC_PRESET_STORAGE_KEY/);
  assert.doesNotMatch(source, /SET_DEBUG_MODE|AICE_SET_DEBUG_MODE|operationMode === 'diagnostic'/);
  assert.doesNotMatch(injectedSource, /SET_DEBUG_MODE|DEBUG_MODE_STORAGE_KEY|readDebugModeFromStorage|writeDebugModeToStorage/);
  assert.match(popupSource, /const LEGACY_DEBUG_STORAGE_KEYS = \[/);
  assert.match(popupSource, /chrome\.storage\.local\.remove\(LEGACY_DEBUG_STORAGE_KEYS\)/);
  assert.doesNotMatch(source, /readStoredDebugEvents|appendStoredDebugEvent|pushContentFailedTrace|scanContentFailedSignal/);
});

test('operation mode restores normal or off settings and primes main-world state before injection', () => {
  const syncSettingsSource = source.slice(
    source.indexOf('  async function syncUiSettingsFromStorage() {'),
    source.indexOf('  async function setUiSettings(', source.indexOf('  async function syncUiSettingsFromStorage() {'))
  );
  assert.match(syncSettingsSource, /OPERATION_MODE_STORAGE_KEY/);
  assert.match(syncSettingsSource, /FEATURE_SETTINGS_STORAGE_KEY/);
  assert.match(syncSettingsSource, /storedMode === 'off'/);
  assert.match(syncSettingsSource, /currentUiSettingsFingerprint = getUiSettingsFingerprint\(\)/);
  assert.match(syncSettingsSource, /function primeMainWorldStorageForUiSettings\(\)/);
  assert.match(syncSettingsSource, /window\.sessionStorage\?\.setItem\?\.\(EXTENSION_ENABLED_STORAGE_KEY/);
  assert.match(syncSettingsSource, /window\.sessionStorage\?\.removeItem\?\.\('arcaia_debug_mode_enabled_v1'\)/);

  const startupSource = source.slice(
    source.indexOf('  async function syncStartupSettingsFromStorage() {'),
    source.indexOf('  function trimLargeForDebug', source.indexOf('  async function syncStartupSettingsFromStorage() {'))
  );
  assert.match(startupSource, /await syncUiSettingsFromStorage\(\)/);
  assert.match(startupSource, /primeMainWorldStorageForUiSettings\(\)/);
  assert.match(startupSource, /initialInjection = injectMainScript\(\)/);
  assert.match(startupSource, /await sleep\(40\)/);
  assert.ok(startupSource.indexOf('primeMainWorldStorageForUiSettings()') < startupSource.indexOf('initialInjection = injectMainScript()'));
});

test('generic Content failed tracing is inert and dedicated probes remain separate', () => {
  assert.doesNotMatch(source, /pushContentFailedTrace|scanContentFailedSignal|installContentFailedTraceObserver|contentFailedObserver/);
  assert.doesNotMatch(source, /contentFailedObserver\.observe|window\.addEventListener\('unhandledrejection'/);
});

test('backend rewrite remains default ON without a generic debug command', () => {
  assert.doesNotMatch(source, /AICE_BACKEND_REWRITE_EXPERIMENT_ON/);
  assert.match(injectedSource, /backendRewriteEnabled: Boolean\(config\?\.backendRewriteEnabled !== false && BACKEND_REWRITE_DEFAULT_ENABLED\)/);
  assert.match(injectedSource, /const BACKEND_REWRITE_DEFAULT_ENABLED = true;/);
});

test('backend rewrite skips DOM pruning by default to avoid scrollbar oscillation', () => {
  assert.match(source, /if \(lite\?\.backendRewriteEnabled && reasonText\.includes\('interval'\)\)/);
  assert.match(source, /backend_rewrite_default_interval_noop/);
  assert.match(source, /if \(lite\?\.backendRewriteEnabled\)/);
  assert.match(source, /backend_rewrite_default_active/);
  assert.match(source, /pruneMode: 'backend_rewrite_skip_dom_prune'/);
  assert.match(source, /removedContainerCount: 0/);
});

test('default Lite does not hard-delete message sections', () => {
  const hideStart = source.indexOf('  function hideRollingLiteContainer(');
  const hideEnd = source.indexOf('  function reconcileRollingLiteSections', hideStart);
  const hideSource = source.slice(hideStart, hideEnd);
  assert.match(hideSource, /ROLLING_PRUNE_MODE_ATTR, 'css_hide'/);
  assert.match(hideSource, /style\.display = 'none'/);
  assert.doesNotMatch(hideSource, /\.remove\(\)/);
  assert.match(source, /pruneMode: 'css_hide'/);
});

test('page-level Arcaia Lite toolbar is not rendered', () => {
  const start = source.indexOf('  function updateLiteBar(');
  const end = source.indexOf('  function getVisibleDomTurnsFromConversation', start);
  const updateSource = source.slice(start, end);
  assert.match(updateSource, /document\.getElementById\(LITE_BAR_ID\)\?\.remove\?\.\(\)/);
  assert.doesNotMatch(updateSource, /getLiteBar\(\)/);
  assert.doesNotMatch(updateSource, /bar\.hidden = false/);
});

test('page conversation monitor consumes main-world navigation events with a bounded pending DOM observer and no polling', () => {
  const monitorStart = source.indexOf('  let observedPageConversationId =');
  const monitorEnd = source.indexOf('  function startRollingLiteUi()', monitorStart);
  const monitorSource = source.slice(monitorStart, monitorEnd);
  assert.match(source, /mainEventType === 'page_navigation'/);
  assert.match(source, /markConversationDependentDomSyncPending\(`main_world_\$\{navigationReason\}`\)/);
  assert.match(source, /scheduleConversationDependentStateSync\(`main_world_\$\{navigationReason\}`\)/);
  assert.match(source, /function handleConversationDependentDomSignal\(reason = 'conversation_dom_signal'\)/);
  assert.match(source, /hasObservedPageConversationStateChanged\(\)/);
  assert.match(source, /markConversationDependentDomSyncPending\('mutation_url_check'\)/);
  assert.match(source, /noteConversationDependentDomSyncSignal\(reason\)/);
  assert.match(source, /pageConversationPendingDomSync/);
  assert.match(source, /pendingDomSync\?\.domSignalReceived/);
  assert.match(source, /let pageConversationPendingSyncReason = null/);
  assert.match(source, /pageConversationPendingSyncReason = reason/);
  assert.match(source, /hasObservedPageConversationStateChanged\(\)/);
  assert.match(source, /scheduleConversationDependentStateSync\('monitor_started'\)/);
  assert.match(source, /queueMicrotask\(\(\) => \{/);
  assert.doesNotMatch(source, /pageConversationSyncTimer/);
  assert.match(source, /function stopPageConversationMonitor\(\)/);
  assert.doesNotMatch(source, /PAGE_CONVERSATION_FALLBACK_INTERVAL_MS/);
  assert.doesNotMatch(source, /pageConversationFallbackInterval/);
  assert.doesNotMatch(source, /installPageConversationHistoryHooks/);
  assert.match(monitorSource, /pageConversationPendingDomSync = null/);
  assert.match(monitorSource, /pageConversationPendingDomObserver = new MutationObserver/);
  assert.match(monitorSource, /!pending\?\.conversationId/);
  assert.match(monitorSource, /isPageConversationPendingDomMutationRelevant\(mutations\)/);
  assert.match(monitorSource, /observe\(target, \{ childList: true, subtree: true \}\)/);
  assert.match(monitorSource, /disconnectPageConversationPendingDomObserver\(\)/);
  assert.doesNotMatch(monitorSource, /setInterval|setTimeout/);
});

test('Lite display main-world status is short-term cached for repeated non-manual apply calls', () => {
  assert.match(source, /const LITE_DISPLAY_MAIN_CACHE_TTL_MS = 1500/);
  assert.match(source, /let liteDisplayMainCache = \{ at: 0, conversationId: null, lite: null \}/);
  assert.match(source, /function clearLiteDisplayMainCache/);
  assert.match(source, /function shouldBypassLiteDisplayMainCache/);
  assert.match(source, /manual\|bar_\|popup\|toolbar\|conversation_changed\|url_changed\|full\|relite\|off\|reset/);
  assert.match(source, /now - Number\(liteDisplayMainCache\.at \|\| 0\) <= LITE_DISPLAY_MAIN_CACHE_TTL_MS/);
  assert.match(source, /readCurrentLiteDisplayFromMain\(1700, \{ reason, conversationId: currentConversationId \}\)/);
  assert.match(source, /clearLiteDisplayMainCache\('set_lite_display_config'\)/);
  assert.match(source, /clearLiteDisplayMainCache\(conversationChanged \? 'conversation_changed' : 'url_changed'\)/);
});

test('main-world Lite conversation sync is driven by History and navigation events', () => {
  assert.match(injectedSource, /function handleMainWorldNavigation/);
  assert.match(injectedSource, /function installMainWorldHistoryHooks/);
  assert.match(injectedSource, /function uninstallMainWorldHistoryHooks/);
  assert.match(injectedSource, /'pushState', 'originalHistoryPushState', 'historyPushStateWrapper'/);
  assert.match(injectedSource, /'replaceState', 'originalHistoryReplaceState', 'historyReplaceStateWrapper'/);
  assert.match(injectedSource, /handleMainWorldNavigation\(`history_\$\{methodName\}`\)/);
  assert.match(injectedSource, /window\.history\?\.\[methodName\] === state\[wrapperKey\]/);
  assert.doesNotMatch(injectedSource, /if \(state\.historyHooked\) return true/);
  assert.match(injectedSource, /emitMainEvent\('page_navigation'/);
  assert.match(injectedSource, /function startMainWorldRuntime/);
  assert.match(injectedSource, /function stopMainWorldRuntime/);
  assert.match(injectedSource, /window\.addEventListener\('popstate', liteConversationSyncPopstateHandler\)/);
  assert.match(injectedSource, /window\.addEventListener\('hashchange', liteConversationSyncHashchangeHandler\)/);
  assert.match(injectedSource, /uninstallMainWorldHistoryHooks\(\)/);
  assert.match(injectedSource, /state\.stopMainWorldRuntime = stopMainWorldRuntime/);
  assert.match(injectedSource, /historyHooked: state\.historyHooked/);
  assert.match(injectedSource, /SYNC_PAGE_CONVERSATION/);
  assert.match(injectedSource, /const historyHooksReady = installMainWorldHistoryHooks\(\)/);
  assert.match(injectedSource, /handleMainWorldNavigation\(data\.payload\?\.reason \|\| 'content_sync'\)/);
  assert.match(injectedSource, /historyHooksReady/);
  assert.doesNotMatch(injectedSource, /LITE_CONVERSATION_SYNC_FALLBACK_INTERVAL_MS/);
  assert.doesNotMatch(injectedSource, /liteConversationSyncFallbackInterval/);
});

test('main-world History hooks repair displaced wrappers even when the state flag remains true', () => {
  const functionStart = injectedSource.indexOf('  function installMainWorldHistoryHooks()');
  const functionEnd = injectedSource.indexOf('  function uninstallMainWorldHistoryHooks()', functionStart);
  assert.ok(functionStart > -1 && functionEnd > functionStart);
  const installSource = injectedSource.slice(functionStart, functionEnd);
  const calls = [];
  const initialPush = function initialPush(...args) { calls.push(['initial_push', ...args]); };
  const initialReplace = function initialReplace(...args) { calls.push(['initial_replace', ...args]); };
  const sandbox = {
    window: { history: { pushState: initialPush, replaceState: initialReplace } },
    state: {
      historyHooked: false,
      originalHistoryPushState: null,
      originalHistoryReplaceState: null,
      historyPushStateWrapper: null,
      historyReplaceStateWrapper: null
    },
    handleMainWorldNavigation(reason) { calls.push(['navigation', reason]); }
  };
  vm.runInNewContext(`${installSource}\nthis.installMainWorldHistoryHooks = installMainWorldHistoryHooks;`, sandbox);
  assert.equal(sandbox.installMainWorldHistoryHooks(), true);

  const displacedPush = function displacedPush(...args) { calls.push(['displaced_push', ...args]); };
  const displacedReplace = function displacedReplace(...args) { calls.push(['displaced_replace', ...args]); };
  sandbox.window.history.pushState = displacedPush;
  sandbox.window.history.replaceState = displacedReplace;
  assert.equal(sandbox.state.historyHooked, true);

  assert.equal(sandbox.installMainWorldHistoryHooks(), true);
  assert.notEqual(sandbox.window.history.pushState, displacedPush);
  assert.notEqual(sandbox.window.history.replaceState, displacedReplace);
  assert.equal(sandbox.state.originalHistoryPushState, displacedPush);
  assert.equal(sandbox.state.originalHistoryReplaceState, displacedReplace);
  sandbox.window.history.pushState({ page: 2 }, '', '/c/next');
  sandbox.window.history.replaceState({ page: 3 }, '', '/c/final');
  assert.deepEqual(calls.slice(-4), [
    ['displaced_push', { page: 2 }, '', '/c/next'],
    ['navigation', 'history_pushState'],
    ['displaced_replace', { page: 3 }, '', '/c/final'],
    ['navigation', 'history_replaceState']
  ]);
});

test('rolling Lite monitoring follows the probe-backed hierarchy without time fallbacks', () => {
  const start = source.indexOf('  function getRollingLiteMain()');
  const end = source.indexOf('  const PINNED_SORT_STYLE_ID', start);
  const liteRuntimeSource = source.slice(start, end);
  assert.match(source, /function findRollingLiteContentRoot/);
  assert.match(source, /sections\.map\(\(section\) => section\.parentElement \|\| section\)/);
  assert.match(source, /function findRollingLiteStableAnchor/);
  assert.match(source, /directChild\?\.parentElement === main && directChild\.getAttribute\('role'\) === 'presentation'/);
  assert.match(source, /directCandidates\.length === 1 \? directCandidates\[0\] : null/);
  assert.match(source, /conversationDomStableAnchorObserver\.observe\(stableAnchor, \{ childList: true, subtree: false \}\)/);
  assert.match(source, /conversationDomContentObserver\.observe\(contentRoot, \{/);
  assert.match(source, /function handleConversationDomMutations\(mutations\)/);
  assert.match(source, /handleTurnExportMutations\(mutations\)/);
  assert.match(source, /handleMessageTimestampMutations\(mutations\)/);
  assert.match(source, /collectBlockCollapserMutationRoots\(mutations\)/);
  assert.match(source, /queueMicrotask\(flushRollingLiteApply\)/);
  assert.match(source, /refreshConversationDomObserverBindings\('stream_active_attribute_mutation'\)/);
  assert.match(source, /scheduleRollingLiteApply\('stream_active_attribute_mutation'\)/);
  assert.doesNotMatch(liteRuntimeSource, /document\.querySelector\('\[role="presentation"\]'\)/);
  assert.doesNotMatch(source, /ROLLING_LITE_FALLBACK_INTERVAL_MS/);
  assert.doesNotMatch(source, /scheduleInitialRollingLiteBurst/);
  assert.doesNotMatch(source, /rollingLiteStartupRetryTimer/);
  assert.doesNotMatch(source, /rollingLiteInitialBurstTimers/);
  assert.doesNotMatch(source, /post_apply_cleanup/);
  assert.doesNotMatch(source, /rollingLiteContentObserver|rollingLiteStableAnchorObserver/);
});

test('scroll container diagnostics expose scroll burden and Lite descendant counts', () => {
  const layoutStart = source.indexOf('  function getComputedLayoutSummary(');
  const layoutEnd = source.indexOf('  function isRuntimeLayoutVisible', layoutStart);
  const layoutSource = source.slice(layoutStart, layoutEnd);
  assert.match(layoutSource, /scrollTop/);
  assert.match(layoutSource, /maxScrollTop/);
  assert.match(layoutSource, /verticalOverflowPx/);

  const scrollStart = source.indexOf('  function collectScrollContainerDiagnostics(');
  const scrollEnd = source.indexOf('  function collectLiteRuntimeLayoutDiagnostics', scrollStart);
  const scrollSource = source.slice(scrollStart, scrollEnd);
  assert.match(scrollSource, /scrollBurdenScore/);
  assert.match(scrollSource, /sectionDescendantCount/);
  assert.match(scrollSource, /hiddenSectionDescendantCount/);
  assert.match(scrollSource, /visibleSectionDescendantCount/);
  assert.match(scrollSource, /hiddenSectionLayoutLeakCount/);
});

test('message timestamp display format includes date and time', () => {
  assert.match(source, /timeZone: 'Asia\/Tokyo'/);
  assert.match(source, /compact: `\$\{parts\.month\}\/\$\{parts\.day\} \$\{parts\.hour\}:\$\{parts\.minute\}`/);
  assert.match(source, /displayTimezone: item\.displayTimezone \|\| 'Asia\/Tokyo'/);
});

test('message timestamp badge is anchored to the chat content role element', () => {
  assert.match(source, /function getMessageTimeBadgeContainer/);
  assert.match(source, /roleEl\.matches\?\.\('\[data-message-author-role\]'\)/);
  assert.match(source, /const container = getMessageTimeBadgeContainer\(roleEl\)/);
  assert.doesNotMatch(source, /\.arcaia-message-time-user \{ margin-left: auto/);
});

test('live timestamp fallback uses DOM observation time for missing index items', () => {
  assert.match(source, /provisionalByDomKey/);
  assert.match(source, /provisionalCount/);
  assert.match(source, /replacedProvisionalCount/);
  assert.match(source, /function getMessageTimeDomKey/);
  assert.match(source, /function getOrCreateProvisionalTimestampInfo/);

  const fallbackStart = source.indexOf('  function getOrCreateProvisionalTimestampInfo(');
  const fallbackEnd = source.indexOf('  function getRoleNodesForTimestampBadges', fallbackStart);
  const fallbackSource = source.slice(fallbackStart, fallbackEnd);
  assert.match(fallbackSource, /const observedAt = Date\.now\(\);/);
  assert.match(fallbackSource, /const iso = nowIso\(observedAt\);/);
  assert.match(fallbackSource, /const parts = formatJstDateTimeParts\(iso\);/);
  assert.match(fallbackSource, /source: 'dom_first_observed_at'/);
  assert.match(fallbackSource, /observedAtJst: parts\?\.full \|\| null/);
  assert.match(fallbackSource, /displayTime: parts\?\.compact \|\| parts\?\.time \|\| null/);
  assert.match(fallbackSource, /displayTimezone: 'Asia\/Tokyo'/);
  assert.match(fallbackSource, /provisional: true/);

  const matchSource = source.slice(
    source.indexOf('  function findTimestampInfoForRoleNode('),
    source.indexOf('  function getMessageTimeBadgeContainer')
  );
  assert.match(matchSource, /getOrCreateProvisionalTimestampInfo\(roleEl, role, ordinal\)/);
});

test('initial existing timestamp DOM waits for index instead of current-time provisional badges', () => {
  assert.match(source, /const MESSAGE_TIME_INITIAL_DOM_ATTR = 'data-arcaia-message-time-initial-dom'/);
  assert.match(source, /initialDomAwaitingAuthoritativeIndex: true/);
  assert.match(source, /initialDomAwaitingAuthoritativeIndex: false/);
  assert.doesNotMatch(source, /MESSAGE_TIME_INITIAL_DOM_GUARD_MS|initialDomGuardUntil/);
  assert.match(source, /function markInitialMessageTimeRoleNodes/);
  assert.match(source, /function isInitialMessageTimeRoleNode/);
  assert.match(source, /initial_existing_dom_waiting_for_index_id/);
  assert.match(source, /initial_existing_dom_waiting_for_index_no_id/);
  assert.match(source, /startup_initial_dom_snapshot/);
  assert.match(source, /conversation_changed_initial_dom_snapshot/);
  assert.match(source, /skippedInitialExistingCount/);
  const matchStart = source.indexOf('  function findTimestampInfoForRoleNode(');
  const matchEnd = source.indexOf('  function getMessageTimeBadgeContainer', matchStart);
  const matchSource = source.slice(matchStart, matchEnd);
  assert.match(matchSource, /isInitialMessageTimeRoleNode\(roleEl\)/);
  assert.match(matchSource, /return \{ item: null, match:/);
  assert.match(matchSource, /getOrCreateProvisionalTimestampInfo\(roleEl, role, ordinal\)/);
});

test('timestamp initial DOM awaiting state is applied only on startup and conversation snapshots', () => {
  const startupStart = source.indexOf('  function startMessageTimestampUi()');
  const startupEnd = source.indexOf('  function scheduleApplyMessageTimestamps', startupStart);
  const startupSource = source.slice(startupStart, startupEnd);
  assert.match(startupSource, /resetMessageTimeStateForConversation\(tryExtractConversationIdFromUrl\(window\.location\.href\)\)/);
  assert.match(startupSource, /markInitialMessageTimeRoleNodes\(getRoleNodesForTimestampBadges\(\), 'startup_initial_dom_snapshot'\)/);
  assert.match(startupSource, /scheduleRefreshMessageTimestampIndex\('startup_existing_conversation_fetch_index'\)/);

  const monitorStart = source.indexOf('  async function syncConversationDependentState(');
  const monitorEnd = source.indexOf('  function startPageConversationMonitor', monitorStart);
  const monitorSource = source.slice(monitorStart, monitorEnd);
  assert.match(monitorSource, /resetMessageTimeStateForConversation\(nextConversationId\)/);
  assert.match(monitorSource, /markInitialMessageTimeRoleNodes\(getRoleNodesForTimestampBadges\(\), 'conversation_changed_initial_dom_snapshot'\)/);

  const applyStart = source.indexOf('  async function applyMessageTimestampBadges(');
  const applyEnd = source.indexOf('  function scheduleApplyMessageTimestamps', applyStart);
  const applySource = source.slice(applyStart, applyEnd);
  assert.match(applySource, /const initialDomMarkedThisApply = 0/);
  assert.doesNotMatch(applySource, /guarded_initial_apply/);
  assert.doesNotMatch(applySource, /markInitialMessageTimeRoleNodes\(roleNodes/);
});

test('provisional timestamp fallback code does not call fetch', () => {
  const fallbackStart = source.indexOf('  function getMessageTimeDomKey(');
  const fallbackEnd = source.indexOf('  function getRoleNodesForTimestampBadges', fallbackStart);
  const fallbackSource = source.slice(fallbackStart, fallbackEnd);
  assert.doesNotMatch(fallbackSource, /fetch\s*\(/);
  assert.doesNotMatch(fallbackSource, /\/backend-api\/conversation|\/api\/auth\/session/);
});

test('message timestamp badges mark provisional values without role-specific italics and count official replacements', () => {
  const badgeSource = source.slice(
    source.indexOf('  function ensureMessageTimeBadge('),
    source.indexOf('  async function applyMessageTimestampBadges', source.indexOf('  function ensureMessageTimeBadge('))
  );
  assert.match(source, /const MESSAGE_TIME_PROVISIONAL_ATTR = 'data-arcaia-timestamp-provisional';/);
  assert.match(badgeSource, /MESSAGE_TIME_PROVISIONAL_ATTR/);
  assert.match(badgeSource, /arcaia-message-time-provisional/);
  assert.match(badgeSource, /wasProvisional && !isProvisional/);
  assert.match(badgeSource, /replacedProvisionalCount/);
  const styleSource = source.slice(
    source.indexOf('  function installLiteDisplayStyles('),
    source.indexOf('  function getRollingLiteDomState', source.indexOf('  function installLiteDisplayStyles('))
  );
  assert.doesNotMatch(styleSource, /font-style:\s*italic/);
});

test('assistant timestamp display is deferred while the latest assistant is generating', () => {
  const applySource = source.slice(
    source.indexOf('  async function applyMessageTimestampBadges('),
    source.indexOf('  function scheduleApplyMessageTimestamps', source.indexOf('  async function applyMessageTimestampBadges('))
  );
  assert.match(source, /function shouldDeferAssistantTimestampForGeneration/);
  assert.match(applySource, /const generationDetector = isLikelyChatGPTGenerating\(\);/);
  assert.match(applySource, /latestAssistantIndex > latestUserIndex/);
  assert.match(applySource, /assistant_generating_pending_completion/);
  assert.match(applySource, /continue;/);
  assert.doesNotMatch(applySource, /fetch\s*\(/);
});

test('assistant timestamp defer removes any existing in-progress badge and reports counts', () => {
  const removeSource = source.slice(
    source.indexOf('  function removeMessageTimeBadge('),
    source.indexOf('  function ensureMessageTimeBadge', source.indexOf('  function removeMessageTimeBadge('))
  );
  const applySource = source.slice(
    source.indexOf('  async function applyMessageTimestampBadges('),
    source.indexOf('  function scheduleApplyMessageTimestamps', source.indexOf('  async function applyMessageTimestampBadges('))
  );
  assert.match(removeSource, /badge\.remove\(\)/);
  assert.match(removeSource, /data-arcaia-message-time-skip-reason/);
  assert.match(applySource, /deferredAssistantCount \+= 1/);
  assert.match(applySource, /removedDeferredAssistantBadgeCount \+= 1/);
  assert.match(applySource, /generationDetector: \{[\s\S]*?generating: Boolean\(generationDetector\?\.generating\)/);
  assert.doesNotMatch(applySource, /collectDebugSamples|lastApplySamples/);
});

test('existing timestamp index refresh requests only the current conversation and ignores stale navigation responses', () => {
  const refreshStart = source.indexOf('  async function refreshMessageTimestampIndex(');
  const refreshEnd = source.indexOf('  function findTimestampInfoForRoleNode', refreshStart);
  const refreshSource = source.slice(refreshStart, refreshEnd);
  assert.match(refreshSource, /getMainWorldMessageTimestampIndex\(1800, conversationId\)/);
  assert.match(refreshSource, /activeConversationId !== conversationId/);
  assert.doesNotMatch(refreshSource, /index_response_stale_after_navigation|pushMessageTimeDebugEvent/);
  assert.match(refreshSource, /!index \|\| Boolean\(conversationId && index\.conversationId === conversationId\)/);
  assert.match(refreshSource, /scheduleApplyMessageTimestamps\(`index_refreshed:\$\{reason\}`\)/);
  assert.doesNotMatch(refreshSource, /fetch\s*\(/);
});

test('message timestamp UI uses the main-world timestamp index without content-side fetching', () => {
  assert.match(injectedSource, /function buildMessageTimestampIndexFromConversation/);
  assert.match(injectedSource, /observeMessageTimestampIndexFromConversation/);
  assert.match(injectedSource, /MESSAGE_TIMESTAMP_INDEX_RESULT/);
  assert.match(source, /getMainWorldMessageTimestampIndex/);
  assert.match(source, /main_event_message_timestamp_index_updated/);
  const start = source.indexOf('  async function refreshMessageTimestampIndex(');
  const end = source.indexOf('  function findTimestampInfoForRoleNode', start);
  const timestampRefreshSource = source.slice(start, end);
  assert.doesNotMatch(timestampRefreshSource, /fetch\s*\(/);
});

test('conversation-derived timestamp and model state use bounded per-conversation caches', () => {
  assert.match(injectedSource, /const MAX_CONVERSATION_DERIVED_STATE_CACHE_ENTRIES = 4/);
  assert.match(injectedSource, /messageTimestampIndexesByConversation: createBoundedConversationCache\(\)/);
  assert.match(injectedSource, /conversationModelConfigsByConversation: createBoundedConversationCache\(\)/);
  assert.match(injectedSource, /messageTimestampIndexesByConversation\.set\(index\.conversationId, index\)/);
  assert.match(injectedSource, /conversationModelConfigsByConversation\.set\(config\.conversationId, config\)/);
  assert.match(injectedSource, /getMessageTimestampIndexForContent\(data\.payload\?\.conversationId \|\| null\)/);

  const cacheStart = injectedSource.indexOf('  function createBoundedConversationCache(');
  const cacheEnd = injectedSource.indexOf('  const state =', cacheStart);
  assert.ok(cacheStart > -1 && cacheEnd > cacheStart);
  const sandbox = { Map, Math, Number, String };
  vm.runInNewContext(`
    const MAX_CONVERSATION_DERIVED_STATE_CACHE_ENTRIES = 4;
    ${injectedSource.slice(cacheStart, cacheEnd)}
    this.createBoundedConversationCache = createBoundedConversationCache;
  `, sandbox);
  const cache = sandbox.createBoundedConversationCache(2);
  assert.equal(cache.set('conversation-a', { value: 'a' }), true);
  assert.equal(cache.set('conversation-b', { value: 'b' }), true);
  assert.equal(cache.get('conversation-a').value, 'a');
  assert.equal(cache.set('conversation-c', { value: 'c' }), true);
  assert.equal(cache.get('conversation-b'), null);
  assert.equal(cache.get('conversation-a').value, 'a');
  assert.equal(cache.get('conversation-c').value, 'c');
});

test('conversation-derived state is accepted only for the current conversation and replayed on navigation sync', () => {
  const listenerStart = source.indexOf("  window.addEventListener('message', (event) => {");
  const listenerEnd = source.indexOf('  function requestMainAuth', listenerStart);
  const listenerSource = source.slice(listenerStart, listenerEnd);
  assert.equal(
    (listenerSource.match(/if \(currentConversationId && eventConversationId === currentConversationId\)/g) || []).length,
    2
  );
  assert.match(listenerSource, /mainEventType === 'message_timestamp_index_updated'/);
  assert.match(listenerSource, /mainEventType === 'current_conversation_model_config'/);

  const syncStart = source.indexOf('  async function syncConversationDependentState(');
  const syncEnd = source.indexOf('  function startPageConversationMonitor', syncStart);
  const syncSource = source.slice(syncStart, syncEnd);
  assert.match(syncSource, /mainWorldSync\?\.conversationModelConfig/);
  assert.match(syncSource, /currentConversationIdAfterSync === nextConversationId/);
  assert.match(syncSource, /cachedConversationModelConfig\?\.conversationId === nextConversationId/);
  assert.match(syncSource, /'main_world_conversation_cache_sync'/);
  assert.doesNotMatch(syncSource, /setInterval|setTimeout/);

  const protocolStart = injectedSource.indexOf("    if (data.type === 'SYNC_PAGE_CONVERSATION') {");
  const protocolEnd = injectedSource.indexOf("    if (data.type === 'SET_LITE_DISPLAY_CONFIG')", protocolStart);
  const protocolSource = injectedSource.slice(protocolStart, protocolEnd);
  assert.match(protocolSource, /getConversationModelConfigForContent\(requestedConversationId\)/);
  assert.match(protocolSource, /conversationModelConfig: conversationModelConfig \|\| null/);
  assert.doesNotMatch(protocolSource, /conversationModelConfigCacheHit|requestedConversationId:/);
});

test('message timestamp observer uses message DOM and assistant toolbar readiness triggers', () => {
  const start = source.indexOf('  function nodeContainsMessageTimestampDom(');
  const end = source.indexOf('  const LITE_BAR_ID', start);
  const timestampUiSource = source.slice(start, end);
  assert.match(source, /const MESSAGE_TIME_MUTATION_SELECTOR =/);
  assert.match(timestampUiSource, /function nodeContainsMessageTimestampDom/);
  assert.match(timestampUiSource, /function classifyMessageTimestampMutation/);
  assert.match(timestampUiSource, /nodeContainsTurnCopyButton\(node\)/);
  assert.match(timestampUiSource, /sawTurnCopyButton \? 'assistant_toolbar_ready'/);
  assert.match(timestampUiSource, /sawMessageDom \? 'message_dom_mutation' : null/);
  assert.match(timestampUiSource, /const reason = classifyMessageTimestampMutation\(mutations\)/);
  assert.match(timestampUiSource, /if \(reason\) scheduleApplyMessageTimestamps\(reason\)/);
  assert.doesNotMatch(timestampUiSource, /setInterval/);
});

test('message timestamp generic diagnostics are removed while event-driven scheduling remains', () => {
  const start = source.indexOf('  const MESSAGE_TIME_BADGE_ATTR');
  const end = source.indexOf('  const LITE_BAR_ID', start);
  const timestampSource = source.slice(start, end);
  assert.match(source, /let conversationDomObservedContentRoot = null/);
  assert.doesNotMatch(timestampSource, /messageTimeDebugEvents|snapshotMessageTimeRoleNodes|pushMessageTimeDebugEvent|getMessageTimeObserverDiagnostic|lastApplyRoleSnapshot/);
  assert.match(timestampSource, /queueMicrotask\(\(\) => \{/);
  assert.match(timestampSource, /queueMicrotask\(flushMessageTimestampIndexRefresh\)/);
  assert.match(timestampSource, /function scheduleApplyMessageTimestamps\(/);
  assert.match(timestampSource, /function scheduleRefreshMessageTimestampIndex\(/);
  assert.doesNotMatch(timestampSource, /messageTimeObserver|messageTimeScanTimer|messageTimeRefreshTimer/);
  assert.doesNotMatch(timestampSource, /setTimeout/);
});

test('extension version is v0.1.275 across executable entry points', () => {
  assert.equal(manifest.version, '0.1.275');
  assert.match(source, /const APP_VERSION = '0\.1\.275'/);
  assert.match(injectedSource, /const APP_VERSION = '0\.1\.275'/);
  assert.match(popupSource, /const APP_VERSION = '0\.1\.275'/);
});

test('assistant completion is bound to the generation conversation and navigation abandons without sound', () => {
  assert.match(source, /let assistantGenerationConversationId = null/);
  assert.match(source, /let assistantGenerationStreamRoot = null/);
  assert.match(source, /function captureAssistantGenerationIdentity\(/);
  assert.match(source, /function abandonAssistantGenerationForNavigation\(/);
  assert.match(source, /handleAssistantPageNavigationIntent\(navigationReason\)/);
  assert.match(source, /assistantCompletionSignaledForCurrentGeneration = true/);
  assert.match(source, /assistantCompletionLatched = true/);
  assert.match(source, /assistantCompletedInactiveTitlePending = false/);
  assert.match(source, /navigation_abandon:/);
  assert.match(source, /reconcileAssistantGenerationConversationChange\(\s*previousConversationId,\s*nextConversationId,/);
  assert.match(source, /captureAssistantGenerationIdentity\(reason\)/);
  assert.match(source, /clearAssistantGenerationIdentity\(\)/);
});

test('stream completion waits for navigation and cancellation prevents a stale completion update', () => {
  const helperNames = [
    'clearPendingAssistantLoadingFaviconCheckHandles',
    'cancelPendingAssistantLoadingFaviconCheck',
    'flushPendingAssistantLoadingFaviconCheck',
    'handleAssistantPageNavigationIntent',
    'scheduleAssistantLoadingFaviconCheck'
  ];
  const callbacks = new Map();
  const timers = new Map();
  const updates = [];
  const reconciliations = [];
  let nextHandle = 1;
  const sandbox = {
    window: {
      location: { href: 'https://chatgpt.com/' },
      requestAnimationFrame(callback) {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame(handle) {
        callbacks.delete(handle);
      }
    },
    setTimeout(callback) {
      const handle = nextHandle++;
      timers.set(handle, callback);
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    isArcaiaExtensionEnabled: () => true,
    tryExtractConversationIdFromUrl: () => null,
    reconcileAssistantGenerationConversationChange(previousConversationId, nextConversationId, reason) {
      reconciliations.push({ previousConversationId, nextConversationId, reason });
      return { abandoned: true, reason };
    },
    updateAssistantLoadingFavicon(reason) {
      updates.push(reason);
      return { ok: true, reason };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    let assistantLoadingFaviconCheckAnimationFrame = null;
    let assistantLoadingFaviconCheckFallbackTimer = null;
    let assistantLoadingFaviconCheckSequence = 0;
    let assistantGenerationActive = true;
    let assistantGenerationConversationId = 'conversation-old';
    ${helperNames.map((name) => extractFunction(name)).join('\n')}
    this.schedule = scheduleAssistantLoadingFaviconCheck;
    this.navigate = handleAssistantPageNavigationIntent;
  `, sandbox);

  const pending = sandbox.schedule('stream_removed_final');
  assert.equal(pending.scheduled, true);
  assert.deepEqual(updates, []);
  const frameCallback = callbacks.values().next().value;
  const navigation = sandbox.navigate('new_chat');
  assert.equal(navigation.abandoned, true);
  frameCallback();
  assert.deepEqual(updates, []);
  assert.deepEqual(reconciliations, [{
    previousConversationId: 'conversation-old',
    nextConversationId: null,
    reason: 'page_navigation:new_chat'
  }]);

  sandbox.schedule('stream_removed_final');
  const completionCallback = callbacks.values().next().value;
  completionCallback();
  assert.deepEqual(updates, ['stream_removed_final']);

  sandbox.schedule('stream_removed_final');
  const staleCallback = callbacks.values().next().value;
  sandbox.schedule('stream_root_active_attribute_mutation');
  staleCallback();
  assert.deepEqual(updates, [
    'stream_removed_final',
    'stream_root_active_attribute_mutation'
  ]);
});

test('history search navigation temporarily bypasses Lite without persisting a user disable', () => {
  assert.match(injectedSource, /function isHistorySearchNavigationUrl\(value = window\.location\.href\)/);
  assert.match(injectedSource, /searchParams\.get\('src'\)/);
  assert.match(injectedSource, /historySearchBypass: true/);
  assert.match(injectedSource, /configSource: 'history_search_bypass'/);
  assert.match(injectedSource, /const enabled = Boolean\(currentConversationId\) && !userDisabled && !historySearchBypass/);
  assert.match(injectedSource, /if \(config\.historySearchBypass\) return false/);
  assert.match(injectedSource, /historySearchBypass: Boolean\(config\.historySearchBypass\)/);
  assert.match(source, /function isHistorySearchNavigationUrl\(value = window\.location\.href\)/);
  assert.match(source, /if \(isHistorySearchNavigationUrl\(\)\) \{/);
  assert.match(source, /lastSkipReason: 'history_search_navigation'/);
  assert.doesNotMatch(source, /appendStoredDebugEvent|pushContentFailedTrace/);
  assert.doesNotMatch(source, /ROLLING_LITE_FALLBACK_INTERVAL_MS/);
  assert.doesNotMatch(injectedSource, /history_search_bypass[\s\S]{0,300}userDisabled: true/);
});

test('model selector built-in diagnostics are removed while normal status stays lightweight', () => {
  assert.match(contentModelSelectorSource, /function getLightweightStatus\(\)/);
  const statusStart = contentModelSelectorSource.indexOf('  function getLightweightStatus() {');
  const statusEnd = contentModelSelectorSource.indexOf('  function getStatus()', statusStart);
  const statusSource = contentModelSelectorSource.slice(statusStart, statusEnd);
  assert.doesNotMatch(statusSource, /getDiagnosticSnapshot|querySelectorAll/);
  assert.match(statusSource, /activeSurfaceMode: getActiveSurfaceMode\(\)/);
  assert.doesNotMatch(contentModelSelectorSource, /function getDiagnosticSnapshot\(\)|getDiagnosticSnapshot,/);
  assert.doesNotMatch(injectedSource, /RUN_MODEL_SELECTOR_CLIENT_STATE_DIAGNOSTIC|MODEL_SELECTOR_CLIENT_STATE_DIAGNOSTIC_RESULT|collectModelSelectorClientStateDiagnostic|MODEL_SELECTOR_CLIENT_STATE_MATCHES/);
  assert.match(source, /getLightweightStatus\?\.\(\)/);
});

test('toolbar icon uses the same Arcaia PNG artwork as the main extension icon', () => {
  assert.equal(manifest.action.default_icon['16'], 'icons/toolbar/icon16.png');
  assert.equal(manifest.action.default_icon['32'], 'icons/toolbar/icon32.png');
  assert.equal(manifest.action.default_icon['48'], 'icons/toolbar/icon48.png');
  assert.equal(manifest.action.default_icon['128'], 'icons/toolbar/icon128.png');
  assert.doesNotMatch(JSON.stringify(manifest.action.default_icon), /\.svg/);
  for (const iconPath of toolbarIconPngPaths) {
    const buffer = fs.readFileSync(iconPath);
    assert.ok(buffer.length > 8);
    assert.equal(buffer.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
    const mainIconPath = path.join(__dirname, '..', 'icons', 'main', path.basename(iconPath));
    assert.deepEqual(buffer, fs.readFileSync(mainIconPath));
  }
});

test.skip('legacy popup debug controls were removed in v0.1.257', () => {
  assert.match(popupHtmlSource, /id="arcaiaEnabledToggle"/);
  assert.match(popupHtmlSource, /Arcaiaを有効にする/);
  assert.match(popupHtmlSource, /id="debugLoggingToggle"/);
  assert.match(popupHtmlSource, /デバッグログを取得/);
  assert.match(popupHtmlSource, /id="diagnosticOnlyToggle"/);
  assert.match(popupHtmlSource, /診断専用モード/);
  assert.doesNotMatch(popupHtmlSource, /id="operationModeNormal"|id="operationModeDiagnostic"|id="operationModeOff"/);
  assert.match(popupHtmlSource, /class="section-label"><span>表示<\/span>/);
  assert.match(popupHtmlSource, /class="section-label"><span>操作・通知<\/span>/);
  assert.match(popupHtmlSource, /class="section-label"><span>サイドバー<\/span>/);
  assert.match(popupHtmlSource, /class="section-label"><span>保存・出力<\/span>/);
  assert.match(popupHtmlSource, /id="debugSettingsSection"/);
  assert.doesNotMatch(popupHtmlSource, /id="debugSettingsSection" open/);
  assert.match(popupHtmlSource, /id="settingsSaveState"/);
  assert.match(popupHtmlSource, /設定は自動保存されます/);
  assert.match(popupSource, /function setSettingsSaveState\(state = 'saved', text = ''\)/);
  assert.match(popupSource, /setSettingsSaveState\('saving', '保存中…'\)/);
  assert.match(popupSource, /setSettingsSaveState\('saved', '保存済み'\)/);
  assert.ok(popupHtmlSource.indexOf('id="debugSettingsSection"') > popupHtmlSource.indexOf('<span>保存・出力</span>'));
  assert.match(popupHtmlSource, /id="liteViewToggle"/);
  assert.match(popupHtmlSource, /id="liteTurnCountSelect"/);
  assert.match(popupHtmlSource, /id="messageTimestampsToggle"/);
  assert.match(popupHtmlSource, /id="modelDecorationToggle"/);
  assert.match(popupHtmlSource, /id="blockCollapserToggle"/);
  assert.match(popupHtmlSource, /id="ctrlEnterSendToggle"/);
  assert.match(popupHtmlSource, /id="loadingTitleToggle"/);
  assert.match(popupHtmlSource, /id="pinnedSortToggle"/);
  assert.match(popupHtmlSource, /id="pinnedIconsToggle"/);
  assert.match(popupHtmlSource, /id="turnMarkdownButtonsToggle"/);
  assert.match(popupHtmlSource, /id="headerMarkdownButtonToggle"/);
  assert.match(popupHtmlSource, /ヘッダー（全部）/);
  assert.doesNotMatch(popupHtmlSource, /id="extensionEnabledToggle"/);
  assert.doesNotMatch(popupHtmlSource, /id="toggleDebugMode"/);
  assert.match(popupSource, /const OPERATION_MODE_STORAGE_KEY = 'arcaia_operation_mode_v1'/);
  assert.match(popupSource, /const DIAGNOSTIC_ONLY_STORAGE_KEY = 'arcaia_diagnostic_only_v1'/);
  assert.match(popupSource, /const FEATURE_SETTINGS_STORAGE_KEY = 'arcaia_feature_settings_v1'/);
  assert.match(popupSource, /const LITE_TURN_COUNT_STORAGE_KEY = 'arcaia_lite_turn_count_v1'/);
  assert.match(popupSource, /const DIAGNOSTIC_PRESET_STORAGE_KEY = 'arcaia_diagnostic_preset_v1'/);
  assert.match(popupSource, /onChange\('arcaiaEnabledToggle'/);
  assert.match(popupSource, /function writeArcaiaEnabled\(enabled\)/);
  assert.match(popupSource, /onChange\('diagnosticOnlyToggle'/);
  assert.match(popupSource, /function writeDiagnosticOnly\(enabled\)/);
  assert.doesNotMatch(popupSource, /popupInitializationComplete|popupInitializationPromise|waitForPopupInitialization/);
  assert.match(popupSource, /for \(const \[featureKey, buttonKey\] of Object\.entries\(FEATURE_TOGGLE_IDS\)\)/);
  assert.match(popupSource, /type: 'AICE_SET_UI_SETTINGS'/);
  const debugSectionStart = popupHtmlSource.indexOf('id="debugSettingsSection"');
  const debugSectionEnd = popupHtmlSource.indexOf('<button id="mainAnswerScreenshot"', debugSectionStart);
  const debugSectionSource = popupHtmlSource.slice(debugSectionStart, debugSectionEnd);
  assert.doesNotMatch(debugSectionSource, /実行ログ/);
  assert.doesNotMatch(popupHtmlSource, /id="status"/);
  assert.match(popupSource, /function setStatus\(text\) \{[\s\S]*?if \(statusEl\) statusEl\.textContent = text;/);
  const switchRowStyle = popupHtmlSource.slice(
    popupHtmlSource.indexOf('    .switch-row {'),
    popupHtmlSource.indexOf('    .switch-label {')
  );
  assert.match(switchRowStyle, /border: 0;/);
  assert.doesNotMatch(switchRowStyle, /border-bottom:/);
  assert.match(popupHtmlSource, /details\.settings-section \{[\s\S]*?border: 1px solid var\(--arcaia-border\);[\s\S]*?border-radius: 16px;/);
  assert.match(popupHtmlSource, /box-shadow: var\(--arcaia-shadow\);/);
  assert.match(popupHtmlSource, /\.section-heading \{ display: flex;/);
  assert.match(popupHtmlSource, /\.section-icon \{[\s\S]*?background: color-mix/);
  assert.match(popupHtmlSource, /button:disabled \{ cursor: not-allowed; opacity: 0\.5;/);
  assert.match(popupHtmlSource, /\.menu button \{[\s\S]*?width: auto;[\s\S]*?text-align: center;/);
  assert.match(popupHtmlSource, /\.action-row \{[\s\S]*?justify-content: flex-end;/);
  assert.match(popupHtmlSource, /\.master-switch-track \{[\s\S]*?width: 48px;[\s\S]*?height: 28px;/);
  assert.match(popupHtmlSource, /\.settings-stack \{[\s\S]*?border-top: 1px solid var\(--arcaia-border\);[\s\S]*?padding: 0 0 4px;/);
  assert.match(popupHtmlSource, /\.switch-row \{[\s\S]*?grid-template-areas:[\s\S]*?"title toggle"[\s\S]*?"hint toggle"/);
  assert.match(popupHtmlSource, /\.switch-title \{[\s\S]*?text-align: left;/);
  assert.match(popupHtmlSource, /\.switch-hint \{[\s\S]*?font-size: 11px;[\s\S]*?text-align: left;/);
  assert.match(popupHtmlSource, /\.switch-track \{[\s\S]*?grid-area: toggle;/);
  assert.match(popupHtmlSource, /\.switch-row:not\(\.is-disabled\) \.switch-track \{[\s\S]*?cursor: pointer;/);
  assert.match(popupHtmlSource, /\.switch-input:focus-visible \+ \.switch-track \{[\s\S]*?outline:/);
  const saveSectionStart = popupHtmlSource.indexOf('<span>保存・出力</span>');
  const saveSectionEnd = popupHtmlSource.indexOf('id="debugSettingsSection"', saveSectionStart);
  const saveSectionSource = popupHtmlSource.slice(saveSectionStart, saveSectionEnd);
  assert.doesNotMatch(saveSectionSource, /id="mainSaveMarkdown"/);
  assert.doesNotMatch(saveSectionSource, /id="diagnosticZipDownloadMain"/);
  assert.doesNotMatch(saveSectionSource, /id="debugLoggingToggle"/);
  assert.match(saveSectionSource, /id="turnMarkdownButtonsToggle"/);
  assert.match(saveSectionSource, /id="headerMarkdownButtonToggle"/);
  assert.match(debugSectionSource, /id="debugLoggingToggle"/);
  assert.match(debugSectionSource, /id="diagnosticOnlyToggle"/);
  assert.ok(debugSectionSource.indexOf('id="diagnosticPresetSelect"') < debugSectionSource.indexOf('id="diagnosticZipDownloadMain"'));
  assert.doesNotMatch(debugSectionSource, /id="showDebug"|開発者向け詳細を開く/);
  assert.doesNotMatch(popupSource, /buttons\.showDebug|onButton\('showDebug'|function showDebugView/);
  assert.match(popupHtmlSource, /<summary>状態・ログ共有<\/summary>/);
  assert.match(popupHtmlSource, /<summary>Recent View診断<\/summary>/);
  assert.match(popupHtmlSource, /<summary>破壊的操作<\/summary>/);
  assert.match(popupHtmlSource, /<summary>旧・低レベル診断<\/summary>/);
});

test('Lite image display option is persisted and synced to main-world config', () => {
  assert.match(popupHtmlSource, /id="liteShowImagesToggle"/);
  assert.match(popupHtmlSource, /画像を表示/);
  assert.match(popupSource, /const LITE_SHOW_IMAGES_STORAGE_KEY = 'arcaia_lite_show_images_v1'/);
  assert.match(popupSource, /liteImages: 'liteShowImagesToggle'/);
  assert.match(popupSource, /const liteImagesDisabled = !extensionEnabled \|\| featureSettings\.liteView === false/);
  assert.match(popupSource, /controls\.liteShowImagesToggle\.disabled = liteImagesDisabled/);
  assert.match(popupSource, /featureSettings\.liteView === false[\s\S]*?Recent View OFF/);
  assert.match(popupSource, /const enabled = Boolean\(controls\[controlId\]\.checked\)/);
  assert.match(popupSource, /featureSettings = normalizeFeatureSettings\(\{ \.\.\.featureSettings, \[featureKey\]: enabled \}\)/);
  assert.match(popupSource, /settingsCommitQueue = queued\.catch/);
  assert.match(popupSource, /\[LITE_SHOW_IMAGES_STORAGE_KEY\]: payload\.featureSettings\.liteImages/);
  assert.match(source, /const LITE_SHOW_IMAGES_STORAGE_KEY = 'arcaia_lite_show_images_v1'/);
  assert.match(source, /const liteSettingsChanged = featureChanged\('liteView'\)[\s\S]*?featureChanged\('liteImages'\)/);
  assert.match(source, /configSource: 'popup_ui_settings_diff'/);
  assert.match(source, /liteShowImages: liteShowImagesEnabled/);
  assert.match(injectedSource, /liteShowImages: true/);
  assert.match(injectedSource, /liteShowImages: config\?\.liteShowImages !== false/);
  assert.match(injectedSource, /liteShowImages: config\.liteShowImages !== false/);
  assert.match(injectedSource, /liteImageDisplayNodeCount/);
  assert.match(injectedSource, /addedPathNodeCount/);
});

test('Lite image option sync does not rewrite enabled=false into popup_disable by itself', () => {
  const start = injectedSource.indexOf('  function setLiteDisplayConfig(config) {');
  const end = injectedSource.indexOf('  function getLiteDisplayInternalDiagnostic', start);
  const setterSource = injectedSource.slice(start, end);
  assert.match(setterSource, /const hasExplicitEnabled = Object\.prototype\.hasOwnProperty\.call\(config \|\| \{\}, 'enabled'\)/);
  assert.match(setterSource, /if \(hasExplicitEnabled && merged\.enabled === false\)/);
  assert.match(setterSource, /else if \(hasExplicitEnabled && merged\.enabled === true\)/);
  assert.match(setterSource, /hasExplicitEnabled/);
});

test('assistant completion sound remains selectable, persisted, and previewable in the settings-only popup', () => {
  assert.match(popupHtmlSource, /id="assistantCompletionSoundToggle"/);
  assert.match(popupHtmlSource, /id="assistantCompletionSoundSelect"/);
  assert.match(popupHtmlSource, /id="assistantCompletionSoundVolume"/);
  assert.match(popupHtmlSource, /value="classic_chime" selected>通知音1<\/option>/);
  assert.match(popupHtmlSource, /value="soft_chime">通知音2<\/option>/);
  assert.match(popupSource, /\[ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY\]: payload\.assistantCompletionSoundId/);
  assert.match(popupSource, /\[ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY\]: payload\.assistantCompletionSoundVolume/);
  assert.match(popupSource, /type: 'ARCAIA_PLAY_COMPLETION_SOUND'/);
  assert.match(popupSource, /function setSoundTestPlaying\(playing\)/);
  assert.match(popupSource, /function updateRangeProgress\(input, percent\)/);
  assert.match(backgroundSource, /ARCAIA_PLAY_COMPLETION_SOUND/);
  assert.match(offscreenSource, /audio\.volume = appliedVolume/);
});

test('popup uses soft-graphite dark colors and the simplified one-line master header', () => {
  assert.doesNotMatch(popupHtmlSource, /class="popup-header"|class="popup-brand"|id="popupCloseButton"|>オプション</);
  assert.match(popupHtmlSource, /<span class="master-title">Arcaia<\/span>[\s\S]*?id="operationModeStatus"[^>]*><\/span>[\s\S]*?class="menu-version">v0\.1\.275<\/span>[\s\S]*?id="settingsSaveState"[^>]*data-state="idle"[^>]*hidden[\s\S]*?class="master-switch-label"/);
  assert.match(popupHtmlSource, /\.extension-state \{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\) auto auto auto;[\s\S]*?margin: 10px 12px;/);
  assert.match(popupHtmlSource, /\.master-switch-track \{[\s\S]*?width: 48px;[\s\S]*?height: 28px;/);
  assert.match(popupHtmlSource, /\.switch-track \{[\s\S]*?width: 34px;[\s\S]*?height: 20px;/);
  assert.match(popupHtmlSource, /\.switch-input:checked \+ \.master-switch-track::after \{ transform: translateX\(20px\); \}/);
  assert.doesNotMatch(popupSource, /popupCloseButton|window\.close\(\)/);
  assert.match(popupHtmlSource, /<section class="settings-section" data-section="display">/);
  assert.match(popupHtmlSource, /<section class="settings-section" data-section="operation">/);
  assert.match(popupHtmlSource, /<section class="settings-section" data-section="sidebar">/);
  assert.match(popupHtmlSource, /<section class="settings-section" data-section="save">/);
  assert.match(popupHtmlSource, /class="section-band"/);
  assert.match(popupHtmlSource, /--arcaia-section-band: #eaf3ff/);
  const darkThemeStart = popupHtmlSource.indexOf('    @media (prefers-color-scheme: dark) {');
  const darkThemeEnd = popupHtmlSource.indexOf('    * { box-sizing: border-box; }', darkThemeStart);
  const darkThemeSource = popupHtmlSource.slice(darkThemeStart, darkThemeEnd);
  assert.match(darkThemeSource, /--arcaia-page: #2a2d31;/);
  assert.match(darkThemeSource, /--arcaia-surface: #1b1f23;/);
  assert.match(darkThemeSource, /--arcaia-header-surface: #1c2024;/);
  assert.match(darkThemeSource, /--arcaia-section-surface: #20252a;/);
  assert.match(darkThemeSource, /--arcaia-surface-soft: #252b31;/);
  assert.match(darkThemeSource, /--arcaia-section-band: #1d2227;/);
  assert.match(darkThemeSource, /--arcaia-section-border: #353c43;/);
  assert.match(darkThemeSource, /--arcaia-accent: #4773b7;/);
  assert.match(darkThemeSource, /--arcaia-toggle-on: #4f6f9f;/);
  assert.match(darkThemeSource, /--arcaia-toggle-knob: #d9dee5;/);
  assert.match(darkThemeSource, /--arcaia-grain-opacity: 0\.035;/);
  assert.match(darkThemeSource, /--arcaia-success: #22c55e;/);
  assert.match(darkThemeSource, /--arcaia-text: #e5e7eb;/);
  assert.match(popupHtmlSource, /\.options-panel \{[\s\S]*?background: var\(--arcaia-page\)/);
  assert.match(popupHtmlSource, /\.settings-section \{[\s\S]*?background: var\(--arcaia-section-surface\);/);
  assert.match(popupHtmlSource, /\.options-panel::after \{[\s\S]*?opacity: var\(--arcaia-grain-opacity\);[\s\S]*?feTurbulence[\s\S]*?mix-blend-mode: soft-light;/);
  const extensionStateStyle = popupHtmlSource.slice(popupHtmlSource.indexOf('    .extension-state {'), popupHtmlSource.indexOf('    .master-switch-label {'));
  const sectionStyle = popupHtmlSource.slice(popupHtmlSource.indexOf('    .settings-section {'), popupHtmlSource.indexOf('    .section-icon {'));
  assert.doesNotMatch(extensionStateStyle, /linear-gradient|box-shadow/);
  assert.doesNotMatch(sectionStyle, /linear-gradient|box-shadow/);
  assert.match(popupHtmlSource, /\.switch-input:checked \+ \.switch-track,[\s\S]*?background: var\(--arcaia-toggle-on\)/);
  assert.match(popupHtmlSource, /\.menu \{[\s\S]*?gap: 10px;[\s\S]*?padding: 0 12px;/);
  assert.doesNotMatch(popupHtmlSource, /<details|<summary|summary-chevron/);
  assert.doesNotMatch(popupHtmlSource, /section-description|会話の見え方を設定|入力と完了通知を設定|ピン留め並べ替え \/ アイコン変更|各ターン \/ ヘッダー（全部）/);
  assert.match(popupHtmlSource, /#assistantCompletionSoundTest \{[\s\S]*?border: 1px solid var\(--arcaia-accent\)/);
  assert.match(popupHtmlSource, /\.switch-row,[\s\S]*?min-height: 35px;/);
  assert.doesNotMatch(popupHtmlSource, /popup-brand-mark|class="brand-mark"|menu-subtitle|master-panel/);
  assert.match(popupSource, /operationModeStatusEl\.textContent = enabled \? '' : 'Arcaiaは停止中です。'/);
  assert.match(popupSource, /settingsSaveStateEl\.hidden = false/);
  assert.doesNotMatch(popupSource, /setSettingsSaveState\('saved', '保存済み（変更なし）'\)/);
  const initializeStart = popupSource.indexOf('  async function initialize() {');
  const initializeEnd = popupSource.indexOf('  controls.arcaiaEnabledToggle', initializeStart);
  assert.doesNotMatch(popupSource.slice(initializeStart, initializeEnd), /setSettingsSaveState\('saved'/);
});

test.skip('legacy completion-sound popup implementation contract was replaced in v0.1.257', () => {
  assert.match(popupHtmlSource, /id="assistantCompletionSoundToggle"/);
  assert.match(popupHtmlSource, /id="assistantCompletionSoundSelect"/);
  assert.match(popupHtmlSource, /id="assistantCompletionSoundVolume"/);
  assert.match(popupHtmlSource, /id="assistantCompletionSoundVolumeHint"/);
  assert.match(popupHtmlSource, /id="assistantCompletionSoundTest"/);
  assert.match(popupHtmlSource, /回答完了通知音/);
  assert.match(popupHtmlSource, /id="assistantCompletionSoundTest"[\s\S]*?class="test-icon"[\s\S]*?class="test-label">試聴<\/span><\/button>/);
  assert.match(popupHtmlSource, /value="classic_chime" selected>通知音1<\/option>/);
  assert.match(popupHtmlSource, /value="soft_chime">通知音2<\/option>/);
  assert.match(popupHtmlSource, /id="assistantCompletionSoundVolume"[^>]*value="50"/);
  assert.match(popupHtmlSource, /id="assistantCompletionSoundVolumeHint"[^>]*>50%<\/output>/);
  assert.match(popupHtmlSource, /class="sound-select-wrap"/);
  assert.match(popupHtmlSource, /class="volume-icon"/);
  assert.match(popupHtmlSource, /<div class="sound-control-row[^>]*data-sound-select-row>[\s\S]*?id="assistantCompletionSoundSelect"[\s\S]*?id="assistantCompletionSoundTest"/);
  assert.match(popupHtmlSource, /<div class="sound-control-row[^>]*data-sound-volume-row>[\s\S]*?id="assistantCompletionSoundVolume"/);
  assert.match(popupSource, /const ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY = 'arcaia_assistant_completion_sound_enabled_v1'/);
  assert.match(popupSource, /const ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY = 'arcaia_assistant_completion_sound_id_v1'/);
  assert.match(popupSource, /const ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY = 'arcaia_assistant_completion_sound_volume_v1'/);
  assert.match(popupSource, /const DEFAULT_ASSISTANT_COMPLETION_SOUND_ID = 'classic_chime'/);
  assert.match(popupSource, /new Set\(\['classic_chime', 'soft_chime'\]\)/);
  assert.match(popupSource, /const DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME = 0\.153/);
  assert.match(popupSource, /const ASSISTANT_COMPLETION_SOUND_REFERENCE_UI_PERCENT = 50/);
  assert.match(popupSource, /const MAX_ASSISTANT_COMPLETION_SOUND_VOLUME = DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME \/ \(ASSISTANT_COMPLETION_SOUND_REFERENCE_UI_PERCENT \/ 100\)/);
  assert.match(popupSource, /function assistantCompletionSoundVolumeToUiPercent\(value\)/);
  assert.match(popupSource, /function assistantCompletionSoundUiPercentToVolume\(value\)/);
  const volumeHelperStart = popupSource.indexOf('  function normalizeAssistantCompletionSoundVolume(value) {');
  const volumeHelperEnd = popupSource.indexOf('  function updateActionBadge()', volumeHelperStart);
  assert.ok(volumeHelperStart > -1 && volumeHelperEnd > volumeHelperStart);
  const volumeHelperSource = popupSource.slice(volumeHelperStart, volumeHelperEnd);
  const volumeSandbox = {};
  vm.runInNewContext(`
    const DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME = 0.153;
    const ASSISTANT_COMPLETION_SOUND_REFERENCE_UI_PERCENT = 50;
    const MAX_ASSISTANT_COMPLETION_SOUND_VOLUME = DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME / (ASSISTANT_COMPLETION_SOUND_REFERENCE_UI_PERCENT / 100);
    ${volumeHelperSource}
    this.toUi = assistantCompletionSoundVolumeToUiPercent;
    this.fromUi = assistantCompletionSoundUiPercentToVolume;
  `, volumeSandbox);
  assert.equal(volumeSandbox.toUi(0.153), 50);
  assert.ok(Math.abs(volumeSandbox.fromUi(50) - 0.153) < 1e-12);
  assert.ok(volumeSandbox.fromUi(100) < 0.31);
  assert.match(popupSource, /completionSound: 'assistantCompletionSoundToggle'/);
  assert.match(popupSource, /onChange\(buttonKey, async \(\) => \{/);
  assert.match(popupSource, /const enabled = Boolean\(buttons\[buttonKey\]\?\.checked\)/);
  assert.doesNotMatch(popupSource, /if \(featureKey === 'completionSound'\) assistantCompletionSoundEnabled/);
  assert.match(popupSource, /initPopupMode\(\)\.catch/);
  assert.match(popupSource, /writeFeatureSetting\(featureKey, enabled\)/);
  assert.match(popupSource, /onButton\('assistantCompletionSoundTest', testAssistantCompletionSound\)/);
  assert.match(popupSource, /function testAssistantCompletionSound\(\)/);
  assert.match(popupSource, /function updateRangeProgress\(input, percent\)/);
  assert.match(popupSource, /style\.setProperty\('--range-progress', `\$\{normalized\}%`\)/);
  assert.match(popupSource, /function setAssistantCompletionSoundTestPlaying\(playing\)/);
  assert.match(popupSource, /button\.classList\.toggle\('is-playing'/);
  assert.match(popupSource, /setAssistantCompletionSoundTestPlaying\(true\)/);
  assert.match(popupSource, /setAssistantCompletionSoundTestPlaying\(false\)/);
  assert.match(popupHtmlSource, /::-webkit-slider-runnable-track/);
  assert.match(popupHtmlSource, /::-webkit-slider-thumb/);
  assert.match(popupSource, /ARCAIA_COMPLETION_SOUND_STATUS/);
  assert.match(popupSource, /popup_manual_test_direct/);
  assert.match(popupSource, /soundId: assistantCompletionSoundId/);
  assert.match(popupSource, /volume: assistantCompletionSoundVolume/);
  const soundTestStart = popupSource.indexOf('  async function testAssistantCompletionSound() {');
  const soundTestEnd = popupSource.indexOf('  async function writeDebugMode(enabled)', soundTestStart);
  const soundTestSource = popupSource.slice(soundTestStart, soundTestEnd);
  assert.doesNotMatch(soundTestSource, /showDebugView\(/);
  assert.doesNotMatch(soundTestSource, /AICE_PLAY_ASSISTANT_COMPLETION_SOUND_TEST/);
  assert.doesNotMatch(soundTestSource, /contentPlay/);
  assert.match(popupSource, /function writeAssistantCompletionSoundId\(nextSoundId\)/);
  assert.match(popupSource, /onChange\('assistantCompletionSoundSelect'/);
  assert.match(popupSource, /\[ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY\]: assistantCompletionSoundId/);
  assert.match(popupSource, /function writeAssistantCompletionSoundVolume\(nextVolume\)/);
  assert.match(popupSource, /onChange\('assistantCompletionSoundVolume'/);
  assert.match(popupSource, /\[ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY\]: assistantCompletionSoundVolume/);
  assert.match(popupSource, /assistantCompletionSoundVolume,/);
  assert.match(popupSource, /type: 'AICE_SET_UI_SETTINGS'/);
  assert.match(popupSource, /\[ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY\]: Boolean\(featureSettings\.completionSound\)/);
  assert.match(source, /const ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY = 'arcaia_assistant_completion_sound_enabled_v1'/);
  assert.match(source, /const ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY = 'arcaia_assistant_completion_sound_id_v1'/);
  assert.match(source, /const ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY = 'arcaia_assistant_completion_sound_volume_v1'/);
  assert.match(source, /const DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME = 0\.153/);
  assert.match(source, /const ASSISTANT_COMPLETION_SOUND_REFERENCE_UI_PERCENT = 50/);
  assert.match(source, /const MAX_ASSISTANT_COMPLETION_SOUND_VOLUME = DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME \/ \(ASSISTANT_COMPLETION_SOUND_REFERENCE_UI_PERCENT \/ 100\)/);
  assert.match(source, /const ASSISTANT_COMPLETION_SOUND_PRESETS = Object\.freeze\(\{/);
  assert.match(source, /classic_chime/);
  assert.match(source, /soft_chime/);
  assert.match(source, /offscreen_html_audio_synth/);
  assert.match(source, /offscreen_html_audio_asset/);
  assert.match(source, /background_offscreen_audio/);
  assert.match(source, /volume: DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME/);
  assert.match(source, /volume: assistantCompletionSoundVolume/);
  assert.match(source, /assistantCompletionSoundVolume = normalizeAssistantCompletionSoundVolume/);
  assert.match(source, /\[ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY\]: assistantCompletionSoundVolume/);
  assert.match(source, /function sendAssistantCompletionSoundMessage\(payload\)/);
  assert.match(source, /type: 'ARCAIA_PLAY_COMPLETION_SOUND'/);
  assert.match(source, /AICE_PLAY_ASSISTANT_COMPLETION_SOUND_TEST/);
  assert.match(source, /playAssistantCompletionSound\('popup_manual_test'\)/);
  assert.match(source, /chrome\.runtime\.sendMessage\(payload/);
  assert.match(manifest.permissions.join('\n'), /offscreen/);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.match(backgroundSource, /chrome\.offscreen\.createDocument/);
  assert.match(backgroundSource, /reasons: \['AUDIO_PLAYBACK'\]/);
  assert.match(backgroundSource, /ARCAIA_PLAY_COMPLETION_SOUND/);
  assert.match(backgroundSource, /ARCAIA_COMPLETION_SOUND_STATUS/);
  assert.match(backgroundSource, /completionSoundState/);
  assert.match(backgroundSource, /offscreenCreateAttemptCount/);
  assert.match(backgroundSource, /ARCAIA_OFFSCREEN_PLAY_COMPLETION_SOUND/);
  assert.match(backgroundSource, /function resolveCompletionSoundSettings\(message = \{\}\)/);
  assert.match(backgroundSource, /chrome\.storage\.local\.get\(\[/);
  assert.match(backgroundSource, /ARCAIA_COMPLETION_SOUND_ID_STORAGE_KEY/);
  assert.match(backgroundSource, /ARCAIA_COMPLETION_SOUND_VOLUME_STORAGE_KEY/);
  assert.match(backgroundSource, /lastAppliedSoundId/);
  assert.match(backgroundSource, /lastAppliedVolume/);
  assert.match(backgroundSource, /appliedSoundId: settings\.soundId/);
  assert.match(backgroundSource, /appliedVolume: settings\.volume/);
  assert.match(offscreenHtmlSource, /offscreen\.js/);
  assert.match(offscreenSource, /new Audio\(src\)/);
  assert.match(offscreenSource, /audio\.play\(\)/);
  assert.match(offscreenSource, /const COMPLETION_SOUND_ASSET_PATH = 'sounds\/assistant-complete\.ogg'/);
  assert.match(offscreenSource, /const DEFAULT_COMPLETION_SOUND_ID = 'classic_chime'/);
  assert.match(offscreenSource, /classic_chime: Object\.freeze\(\{/);
  assert.match(offscreenSource, /soft_chime: Object\.freeze\(\{/);
  assert.match(offscreenSource, /kind: 'synth'/);
  assert.match(offscreenSource, /kind: 'asset'/);
  assert.match(offscreenSource, /assetPath: COMPLETION_SOUND_ASSET_PATH/);
  assert.match(offscreenSource, /chrome\.runtime\.getURL\(preset\.assetPath \|\| COMPLETION_SOUND_ASSET_PATH\)/);
  assert.match(offscreenSource, /const DEFAULT_COMPLETION_SOUND_VOLUME = 0\.153/);
  assert.match(offscreenSource, /volume: DEFAULT_COMPLETION_SOUND_VOLUME/);
  assert.match(offscreenSource, /route: preset\.kind === 'asset' \? 'offscreen_html_audio_asset' : 'offscreen_html_audio_synth'/);
  assert.match(offscreenSource, /function synthesizeFutureGlass\(preset\)/);
  assert.match(offscreenSource, /new Blob/);
  assert.match(offscreenSource, /URL\.createObjectURL/);
  assert.match(offscreenSource, /audio\.volume = appliedVolume/);
  assert.match(offscreenSource, /appliedVolume/);
  assert.doesNotMatch(offscreenSource, /AudioContext|createOscillator/);
  const completionSoundAsset = fs.readFileSync(completionSoundAssetPath);
  assert.equal(completionSoundAsset.subarray(0, 4).toString('ascii'), 'OggS');
  assert.equal(completionSoundAsset.length, 12544);
  assert.equal(
    crypto.createHash('sha256').update(completionSoundAsset).digest('hex'),
    'a5602ccbcfed9e14923a4948ead12427b12d8ddb783bef32ae0431ea32b81fdb'
  );
  assert.match(source, /function getAssistantCompletionSoundPreset\(soundId = assistantCompletionSoundId\)/);
  assert.match(source, /function setAssistantCompletionSoundEnabled\(enabled, reason = 'manual'\)/);
  assert.match(source, /function syncAssistantCompletionSoundFromStorage\(\)/);
  assert.match(source, /await syncAssistantCompletionSoundFromStorage\(\)/);
  assert.match(source, /function playAssistantCompletionSound\(reason = 'assistant_completed'\)/);
  assert.match(source, /function triggerAssistantCompletionSound\(reason = 'assistant_completed'\)/);
  assert.match(source, /function triggerAssistantCompletionSoundOnce\(reason = 'assistant_completed'\)/);
  assert.match(source, /assistantCompletionSignaledForCurrentGeneration = true/);
  assert.match(source, /autoTriggerCount: assistantCompletionSoundState\.autoTriggerCount \+ 1/);
  assert.match(source, /triggerAssistantCompletionSoundOnce\(`generation_end:\$\{reason\}`\)/);
  assert.doesNotMatch(source, /scheduleAssistantStreamCompletionFallback|ASSISTANT_STREAM_COMPLETION_FALLBACK_DELAY_MS/);
  assert.doesNotMatch(source, /assistantCompletionSoundPlayedForCurrentGeneration|assistantCompletionToolbarAwaiting/);
  assert.doesNotMatch(source, /markAssistantCompletedFromToolbar|summarizeAssistantCompletionToolbarCandidate|assistant_toolbar_no_generation_observed|assistant_toolbar_duplicate/);
  assert.doesNotMatch(source, /AudioContext|webkitAudioContext|createOscillator|createGain|new Audio|audio\.play\(|startAssistantCompletionSoundUnlockListeners|unlockAssistantCompletionSoundFromUserGesture|startAssistantCompletionSoundPrimeListeners|primeAssistantCompletionSoundFromUserGesture/);
  assert.doesNotMatch(backgroundSource, /AudioContext|webkitAudioContext|createOscillator|createGain/);
  assert.doesNotMatch(offscreenSource, /AudioContext|webkitAudioContext|createOscillator|createGain/);
  assert.match(source, /function handleAssistantGenerationStateChange\(previousGenerating, nextGenerating, reason = 'manual'\)/);
  assert.match(source, /handleAssistantGenerationStateChange\(previousGenerating, nextActive, reason\)/);
  assert.match(source, /assistantCompletionSound: assistantCompletionSoundState/);
  assert.match(source, /AICE_SET_ASSISTANT_COMPLETION_SOUND/);
  assert.doesNotMatch(source, /previousGenerating && !nextGenerating/);

  const soundStart = source.indexOf('  const ASSISTANT_COMPLETION_SOUND_PRESETS = Object.freeze({');
  const soundEnd = source.indexOf('  function restoreLegacyAssistantLoadingFavicons', soundStart);
  const soundSource = source.slice(soundStart, soundEnd);
  assert.doesNotMatch(soundSource, /new MutationObserver|setInterval/);
});

test.skip('legacy diagnostic-only runtime was removed in v0.1.257', () => {
  assert.match(source, /const EXTENSION_ENABLED_STORAGE_KEY = 'arcaia_extension_enabled_v1'/);
  assert.match(source, /const OPERATION_MODE_STORAGE_KEY = 'arcaia_operation_mode_v1'/);
  assert.match(source, /const FEATURE_SETTINGS_STORAGE_KEY = 'arcaia_feature_settings_v1'/);
  assert.match(source, /function isArcaiaNormalMode\(\)/);
  assert.match(source, /function isArcaiaRuntimeEnabled\(\)/);
  assert.match(source, /function isArcaiaFeatureEnabled\(featureKey\)/);
  assert.match(source, /function cleanupArcaiaPageUiForDisabled/);
  assert.match(source, /stopPageConversationMonitor\(\)/);
  assert.match(source, /stopRollingLiteUi\(\)/);
  assert.match(source, /stopMessageTimestampUi\(\)/);
  assert.match(source, /stopTurnExportUi\(\)/);
  assert.match(source, /stopPinnedSortUi\(reason\)/);
  assert.match(source, /stopCtrlEnterSendUi\(\)/);
  assert.match(source, /cleanupCodeBlockCollapserUi\(\)/);
  assert.match(source, /arcaiaPageUiStarted = false/);
  assert.match(source, /if \(isArcaiaNormalMode\(\) && window\.top === window\) startArcaiaPageUi\(\)/);
  assert.match(source, /cleanupArcaiaPageUiForDisabled\(`ui_settings:\$\{reason\}`, \{ preserveDiagnostics: debugModeEnabled && isArcaiaRuntimeEnabled\(\) \}\)/);
  assert.match(source, /operationMode === 'diagnostic' && debugModeEnabled/);
  assert.match(source, /startChatLoadingElementTraceMonitor\('diagnostic_only_startup'\)/);
  assert.match(source, /startPageConversationMonitor\(\)/);
  assert.match(source, /else if \(operationMode === 'diagnostic'\)/);
  assert.match(source, /requestedBy: 'diagnostic_only_mode'/);
  assert.match(source, /if \(isArcaiaFeatureEnabled\('blockCollapser'\)\) startCodeBlockCollapserUi\(\)/);
  assert.match(source, /if \(isArcaiaFeatureEnabled\('messageTimestamps'\)\) startMessageTimestampUi\(\)/);
  assert.match(source, /if \(isArcaiaFeatureEnabled\('turnMarkdownButtons'\)\) startTurnExportUi\(\)/);
  assert.match(source, /if \(isArcaiaFeatureEnabled\('headerMarkdownButton'\)\) startHeaderMarkdownButtonUi\(\)/);
  assert.match(source, /if \(isArcaiaFeatureEnabled\('liteView'\)\)/);
  assert.match(source, /AICE_SET_UI_SETTINGS/);
  assert.match(source, /AICE_SET_EXTENSION_ENABLED/);
  assert.match(source, /diagnostic_only_mode/);
  assert.match(source, /arcaia_stopped/);
  assert.match(source, /syncStartupSettingsFromStorage/);
  assert.match(source, /primeMainWorldStorageForUiSettings\(\)/);
  assert.match(source, /MAIN_LITE_STORAGE_KEY/);
  assert.match(injectedSource, /const EXTENSION_ENABLED_STORAGE_KEY = 'arcaia_extension_enabled_v1'/);
  assert.match(injectedSource, /function isMainExtensionEnabled/);
  assert.match(injectedSource, /if \(!isMainExtensionEnabled\(\)\) return false/);
  assert.match(injectedSource, /function installNetworkHooks\(\)/);
  assert.match(injectedSource, /function uninstallNetworkHooks\(\)/);
  assert.match(injectedSource, /window\.fetch = state\.originalFetch/);
  assert.match(injectedSource, /XMLHttpRequest\.prototype\.open = state\.originalXHROpen/);
  assert.match(injectedSource, /if \(state\.extensionEnabled\) startMainWorldRuntime/);
  assert.match(injectedSource, /else stopMainWorldRuntime/);
  assert.match(injectedSource, /historyHooked: Boolean\(state\.historyHooked\)/);
  assert.match(injectedSource, /SET_EXTENSION_ENABLED/);
  assert.match(injectedSource, /EXTENSION_ENABLED_SET_RESULT/);
});

test('release version helper supports dry-run version bumps for known release files', () => {
  const helperPath = path.join(__dirname, '..', 'scripts', 'bump_version.py');
  const helperSource = fs.readFileSync(helperPath, 'utf8');
  assert.match(helperSource, /--dry-run/);
  assert.match(helperSource, /manifest\.json/);
  assert.match(helperSource, /content\.js/);
  assert.match(helperSource, /injected-main\.js/);
  assert.match(helperSource, /popup\.html/);
  assert.match(helperSource, /tests\/lite-grouping\.test\.js/);
  assert.doesNotMatch(helperSource, /aice-probe-main-|aice-probe-content-/);
});

test('extension display name is Arcaia ChatGPT Toolkit while internal prefixes stay compatible', () => {
  assert.equal(manifest.name, 'Arcaia ChatGPT Toolkit');
  assert.equal(manifest.short_name, 'Arcaia');
  assert.equal(manifest.action.default_title, 'Arcaia ChatGPT Toolkit');
  assert.match(manifest.description, /Customize ChatGPT/);
  assert.equal(manifest.icons['128'], 'icons/main/icon128.png');
  assert.equal(manifest.action.default_icon['32'], 'icons/toolbar/icon32.png');
  assert.match(contentMarkdownSource, /Generated by: Arcaia ChatGPT Toolkit/);
  assert.match(source, /arcaia-/);
  assert.match(source, /AICE_/);
  assert.doesNotMatch(popupSource, /arcaia_debug_log_v|debugLoggingToggle|diagnosticPreset/);
});


test('assistant loading title uses stream-active plus the evidenced pending-response guard', () => {
  assert.match(source, /const ASSISTANT_LOADING_TITLE_FRAMES = Object\.freeze\(\[/);
  assert.match(source, /'\|･･ '/);
  assert.match(source, /'･\|･ '/);
  assert.match(source, /'･･\| '/);
  assert.doesNotMatch(source, /' \|･･ '|' ･\|･ '|' ･･\| '/);
  assert.match(source, /const ASSISTANT_LOADING_TITLE_PREFIX = ASSISTANT_LOADING_TITLE_FRAMES\[0\]/);
  assert.match(source, /const ASSISTANT_LOADING_TITLE_ANIMATION_INTERVAL_MS = 800/);
  assert.match(source, /const ASSISTANT_COMPLETED_INACTIVE_TITLE_PREFIX = '● '/);
  assert.match(source, /const ASSISTANT_TITLE_PREFIX_STRIP_LIMIT = 32/);
  assert.match(source, /const ASSISTANT_LOADING_STREAM_ROOT_SELECTOR = '\[data-scroll-root\]'/);
  assert.match(source, /const ASSISTANT_LOADING_STREAM_ACTIVE_ATTR = 'data-stream-active'/);
  assert.match(source, /const ASSISTANT_STREAMING_RESPONSE_STATUS_SELECTOR = '\[data-streaming-response-status\]'/);
  assert.match(source, /function hasLatestAssistantStreamingResponseStatus\(root = document\)/);
  assert.match(source, /function shouldPreserveAssistantGenerationForStreamingResponseStatus\(generationActive, detector\)/);
  assert.match(source, /function getAssistantLoadingStreamRoot\(root = document\)/);
  assert.match(source, /streamRoot\.hasAttribute\?\.\(ASSISTANT_LOADING_STREAM_ACTIVE_ATTR\)/);
  assert.match(source, /scroll_root_data_stream_active/);
  assert.match(source, /detectorDetailsOmittedReason: 'stream_root_attribute_with_latest_assistant_response_status_guard'/);
  assert.match(source, /detector\?\.generating \|\| preserveGeneration/);
  assert.match(source, /function syncAssistantActivityTitle\(reason = 'manual'\)/);
  assert.match(source, /function startAssistantLoadingTitleAnimation\(\)/);
  assert.match(source, /function stopAssistantLoadingTitleAnimation\(\)/);
  assert.match(source, /loading_title_animation_tick/);
  assert.match(source, /setInterval\(\(\) => \{/);
  assert.match(source, /ASSISTANT_LOADING_TITLE_ANIMATION_INTERVAL_MS/);
  assert.match(source, /if \(!previousGenerating\) \{\s*assistantCompletionSignaledForCurrentGeneration = false;\s*assistantCompletionLastReason = null;\s*assistantCompletionLastKey = null;\s*captureAssistantGenerationIdentity\(reason\);\s*startAssistantLoadingTitleAnimation\(\);\s*\}/);
  assert.match(source, /stopAssistantLoadingTitleAnimation\(\)/);
  assert.match(source, /loadingTitleFrames: ASSISTANT_LOADING_TITLE_FRAMES\.slice\(\)/);
  assert.match(source, /loadingTitleAnimationActive: Boolean\(assistantLoadingTitleAnimationTimer\)/);
  assert.match(source, /function markAssistantCompletedFromSignal\(signal, reason = 'assistant_completion_signal'\)/);
  assert.match(source, /if \(!isAssistantActivityPageInactive\(\)\) return \{ skipped: true, reason: 'page_active' \}/);
  assert.match(source, /assistantCompletionLatched = true/);
  assert.match(source, /assistantGenerationActive = false/);
  assert.match(source, /triggerAssistantCompletionSoundOnce\(reason\)/);
  assert.match(source, /if \(assistantCompletionLatched\) \{/);
  assert.match(source, /if \(generating\) generating = false/);
  assert.match(source, /function isAssistantActivityPageActive\(\)/);
  assert.match(source, /function isAssistantActivityPageInactive\(\)/);
  assert.match(source, /if \(previousGenerating\) \{/);
  assert.match(source, /if \(isAssistantActivityPageInactive\(\)\) assistantCompletedInactiveTitlePending = true/);
  assert.match(source, /assistantCompletedInactiveTitlePending = true/);
  assert.match(source, /pageActive: isAssistantActivityPageActive\(\)/);
  assert.match(source, /function restoreLegacyAssistantLoadingFavicons\(\)/);
  assert.match(source, /function refreshAssistantLoadingStreamRootObserver/);
  assert.match(source, /function summarizeAssistantStreamMutationTransition\(mutations, streamRoot\)/);
  assert.match(source, /firstMutation\?\.oldValue !== null/);
  assert.match(source, /streamMutations\.slice\(1\)\.some\(\(mutation\) => mutation\.oldValue === null\)/);
  assert.match(source, /stream_removed_readded_without_stop_button/);
  assert.match(source, /!hasLatestAssistantStreamingResponseStatus\(streamRoot\)/);
  assert.match(source, /stream_removed_final/);
  assert.match(source, /attributeOldValue: true/);
  assert.match(source, /stream_root_active_attribute_mutation/);
  assert.match(source, /attributeFilter: \[ASSISTANT_LOADING_STREAM_ACTIVE_ATTR\]/);
  assert.match(source, /streamRootObserverActive/);
  assert.match(source, /streamRootSelector/);
  assert.match(source, /streamActiveAttribute/);
  assert.match(source, /AICE_ASSISTANT_LOADING_FAVICON_STATUS/);
  assert.match(source, /assistant_activity_title_status/);
  assert.match(source, /legacyFaviconLinkCount/);
  assert.match(source, /legacyDisabledNativeFaviconCount/);
  assert.doesNotMatch(source, /ASSISTANT_LOADING_STOP_BUTTON_SELECTOR|ASSISTANT_LOADING_COMPOSER_BUTTON_SELECTOR|ASSISTANT_LOADING_COMPOSER_ROOT_SELECTOR/);
  assert.doesNotMatch(source, /composer_submit_stop_button_exact|composer_root_button_mutation|composer_button_attribute_mutation/);
  assert.doesNotMatch(source, /function summarizeAssistantLoadingComposerButton|function refreshAssistantLoadingComposerRootObserver|function refreshAssistantLoadingFaviconComposerObserver/);
  assert.doesNotMatch(source, /function disableNativeFaviconsForAssistantLoading|function ensureAssistantLoadingFaviconLink|function upsertAssistantLoadingFaviconLink/);
  assert.doesNotMatch(source, /ASSISTANT_LOADING_FAVICON_SVG|ASSISTANT_LOADING_FAVICON_BASE_HREF|assistantLoadingFaviconToken/);
  assert.doesNotMatch(source, /function getAssistantLoadingStopCandidates/);
  assert.doesNotMatch(source, /function getAssistantLoadingStreamingCandidates/);
  assert.doesNotMatch(source, /recent_prompt_latest_assistant_without_completion_toolbar/);
  assert.doesNotMatch(source, /button_text_scan/);
  assert.doesNotMatch(source, /ASSISTANT_LOADING_PENDING_GRACE_MS/);
  assert.doesNotMatch(source, /ASSISTANT_LOADING_LATEST_ASSISTANT_FALLBACK_MS/);
  assert.doesNotMatch(source, /composer_button_interval/);
  assert.doesNotMatch(source, /assistantLoadingFaviconInterval/);
  assert.doesNotMatch(source, /composer_follow_up_placeholder|ASSISTANT_LOADING_FOLLOW_UP_PLACEHOLDER_PATTERN|ASSISTANT_LOADING_PROMPT_EDITOR_SELECTOR/);
});

test('assistant pending-response status only preserves an already active generation', () => {
  const detectStatus = Function(
    'document',
    'ASSISTANT_STREAMING_RESPONSE_STATUS_SELECTOR',
    `${extractFunction('hasLatestAssistantStreamingResponseStatus')}\nreturn hasLatestAssistantStreamingResponseStatus;`
  )({ querySelectorAll: () => [] }, '[data-streaming-response-status]');
  const preserve = Function(
    `${extractFunction('shouldPreserveAssistantGenerationForStreamingResponseStatus')}\nreturn shouldPreserveAssistantGenerationForStreamingResponseStatus;`
  )();
  const completedTurn = { querySelector: () => null };
  const pendingTurn = {
    querySelector(selector) {
      return selector === '[data-streaming-response-status]' ? {} : null;
    }
  };
  assert.equal(detectStatus({ querySelectorAll: () => [completedTurn, pendingTurn] }), true);
  assert.equal(detectStatus({ querySelectorAll: () => [pendingTurn, completedTurn] }), false);
  assert.equal(preserve(true, { streamingResponseStatusPresent: true }), true);
  assert.equal(preserve(false, { streamingResponseStatusPresent: true }), false);
  assert.equal(preserve(true, { streamingResponseStatusPresent: false }), false);
});

test('assistant loading title prefix remains singular across animation frames', () => {
  const helperStart = source.indexOf('  function stripAssistantActivityTitlePrefix(title) {');
  const helperEnd = source.indexOf('  function setAssistantActivityTitlePrefix(prefix) {', helperStart);
  assert.ok(helperStart > -1 && helperEnd > helperStart);
  const sandbox = {};
  vm.runInNewContext(`
    const ASSISTANT_LOADING_TITLE_FRAMES = Object.freeze(['|･･ ', '･|･ ', '･･| ']);
    const ASSISTANT_COMPLETED_INACTIVE_TITLE_PREFIX = '● ';
    const ASSISTANT_TITLE_PREFIX_STRIP_LIMIT = 32;
    ${source.slice(helperStart, helperEnd)}
    this.frames = ASSISTANT_LOADING_TITLE_FRAMES;
    this.stripAssistantActivityTitlePrefix = stripAssistantActivityTitlePrefix;
  `, sandbox);
  let title = '会話タイトル';
  for (let cycle = 0; cycle < 12; cycle += 1) {
    const frame = sandbox.frames[cycle % sandbox.frames.length];
    title = `${frame}${sandbox.stripAssistantActivityTitlePrefix(title)}`;
    assert.equal(sandbox.stripAssistantActivityTitlePrefix(title), '会話タイトル');
    assert.equal(sandbox.frames.filter((candidate) => title.startsWith(candidate)).length, 1);
  }
  const stacked = '|･･ ･|･ ･･| 会話タイトル';
  assert.equal(sandbox.stripAssistantActivityTitlePrefix(stacked), '会話タイトル');
});

test('assistant stream mutation transition distinguishes generation start, hidden completion, and final removal', () => {
  const helperStart = source.indexOf('  function summarizeAssistantStreamMutationTransition(mutations, streamRoot) {');
  const helperEnd = source.indexOf('\n  function hasAssistantCompletionStopButton()', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helperSource = source.slice(helperStart, helperEnd);
  const summarize = Function(
    'ASSISTANT_LOADING_STREAM_ACTIVE_ATTR',
    `${helperSource}\nreturn summarizeAssistantStreamMutationTransition;`
  )('data-stream-active');
  const root = (present) => ({
    hasAttribute(name) {
      return name === 'data-stream-active' && present;
    }
  });
  const mutation = (target, oldValue) => ({
    type: 'attributes',
    attributeName: 'data-stream-active',
    target,
    oldValue
  });

  const startRoot = root(true);
  const generationStart = summarize([
    mutation(startRoot, null),
    mutation(startRoot, ''),
    mutation(startRoot, null)
  ], startRoot);
  assert.equal(generationStart.removedThenReadded, false);
  assert.equal(generationStart.removedFinal, false);

  const hiddenCompletionRoot = root(true);
  const hiddenCompletion = summarize([
    mutation(hiddenCompletionRoot, ''),
    mutation(hiddenCompletionRoot, null)
  ], hiddenCompletionRoot);
  assert.equal(hiddenCompletion.removedThenReadded, true);
  assert.equal(hiddenCompletion.removedFinal, false);

  const finalRemovalRoot = root(false);
  const finalRemoval = summarize([
    mutation(finalRemovalRoot, '')
  ], finalRemovalRoot);
  assert.equal(finalRemoval.removedThenReadded, false);
  assert.equal(finalRemoval.removedFinal, true);
});

test('inactive completion uses stream mutation transitions with confirmed stream-error as the narrow error path', () => {
  const assistantStateStart = source.indexOf('  const ASSISTANT_COMPLETION_STOP_BUTTON_SELECTOR = [');
  const assistantStateEnd = source.indexOf('  const CHAT_LOADING_CENTER_CANDIDATE_SELECTORS', assistantStateStart);
  const assistantStateSource = source.slice(assistantStateStart, assistantStateEnd);
  assert.match(assistantStateSource, /const ASSISTANT_COMPLETION_STOP_BUTTON_SELECTOR = \[/);
  assert.match(assistantStateSource, /button\[data-testid="stop-button"\]/);
  assert.match(assistantStateSource, /function markAssistantCompletedFromSignal\(signal, reason = 'assistant_completion_signal'\)/);
  assert.match(assistantStateSource, /if \(!isAssistantActivityPageInactive\(\)\) return \{ skipped: true, reason: 'page_active' \}/);
  assert.match(assistantStateSource, /if \(!assistantGenerationActive\) return \{ skipped: true, reason: 'generation_not_active' \}/);
  assert.match(assistantStateSource, /const alreadySignaled = key\s*\? assistantCompletionNotifiedKeys\.has\(key\)\s*:\s*Boolean\(turnElement && assistantCompletionNotifiedTurnElements\.has\(turnElement\)\)/);
  assert.match(assistantStateSource, /assistantCompletionLatched = true/);
  assert.match(assistantStateSource, /triggerAssistantCompletionSoundOnce\(reason\)/);
  assert.match(assistantStateSource, /if \(assistantCompletionLatched\) \{\s*if \(generating\) generating = false/);
  assert.match(assistantStateSource, /mutation\.target === streamRoot/);
  assert.match(assistantStateSource, /transition\.removedThenReadded/);
  assert.match(assistantStateSource, /!hasAssistantCompletionStopButton\(\)/);
  assert.match(assistantStateSource, /buildLatestAssistantCompletionSignal\(\)/);
  assert.doesNotMatch(assistantStateSource, /ASSISTANT_COMPLETION_AUXILIARY_PRIMARY_TEMPORARY/);
  assert.doesNotMatch(assistantStateSource, /ASSISTANT_STREAM_COMPLETION_FALLBACK_DELAY_MS/);
  assert.doesNotMatch(assistantStateSource, /AssistantStreamCompletionFallback/);

  const turnStart = source.indexOf('  const TURN_EXPORT_BUTTON_ATTR');
  const turnEnd = source.indexOf('  function startArcaiaPageUi', turnStart);
  const turnSource = source.slice(turnStart, turnEnd);
  assert.match(turnSource, /button\[data-testid="copy-turn-action-button"\]/);
  assert.match(turnSource, /button\[data-testid="regenerate-thread-error-button"\]/);
  assert.match(turnSource, /button\.closest\?\.\(CHATGPT_STREAM_ERROR_BLOCK_SELECTOR\)/);
  assert.match(turnSource, /isElementInsideLatestAssistantCompletionTurn\(button\)/);
  assert.match(turnSource, /function buildAssistantCompletionSignal\(element\)/);
  assert.match(turnSource, /function buildLatestAssistantCompletionSignal\(\)/);
  assert.match(turnSource, /function primeExistingAssistantCompletionSignals\(\)/);
  assert.match(turnSource, /primeExistingAssistantCompletionSignals\(\)/);
  assert.match(turnSource, /assistant_stream_error:retry_button_mutation/);
  assert.doesNotMatch(turnSource, /markAssistantCompletedFromCopyButton/);
  assert.doesNotMatch(turnSource, /assistant_toolbar_ready:copy_button_mutation/);
  assert.doesNotMatch(turnSource, /retryButton\.click\(\)/);
});

test.skip('legacy generic chat-loading diagnostic was removed in v0.1.257', () => {
  assert.match(source, /const CHAT_LOADING_CENTER_CANDIDATE_SELECTORS = \[/);
  assert.match(source, /main \[role="status"\]/);
  assert.match(source, /main \[role="progressbar"\]/);
  assert.match(source, /main \[data-testid\*="loading"\]/);
  assert.doesNotMatch(source, /const CHAT_LOADING_COMPOSER_BUTTON_CANDIDATE_SELECTORS = \[/);
  assert.doesNotMatch(source, /function collectChatLoadingComposerButtonCandidates\(/);
  assert.doesNotMatch(source, /composerSubmitButton: collectChatLoadingComposerButtonCandidates\(\)/);
  assert.doesNotMatch(source, /composerButtonRows/);
  assert.doesNotMatch(source, /disabledCandidateCount/);
  assert.match(source, /const CHAT_LOADING_ELEMENT_TRACE_MAX = 60/);
  assert.match(source, /function summarizeChatLoadingTraceCandidateShallow\(item\)/);
  assert.match(source, /function getChatLoadingElementsFromPointDiagnostics\(\)/);
  assert.match(source, /function buildChatLoadingElementTraceRowsForDiagnostic\(\)/);
  assert.match(source, /eventRows/);
  assert.match(source, /centerCandidateRows/);
  assert.match(source, /elementsFromPointRows/);
  assert.match(source, /classTokensText: compactChatLoadingClassTokensText\(item\)/);
  assert.match(source, /selectorSuggestionsText: compactChatLoadingSelectorText\(item\)/);
  assert.match(source, /rectText: compactChatLoadingRectText\(item\)/);
  assert.match(source, /chatLoadingElementTraceRows: includeAssistantCompletionDiagnostic/);
  assert.match(source, /document\.elementsFromPoint\(x, y\)/);
  assert.match(source, /center_up/);
  assert.match(source, /center_down/);
  assert.match(source, /center_left/);
  assert.match(source, /center_right/);
  assert.match(source, /elementsFromPoint: getChatLoadingElementsFromPointDiagnostics\(\)/);
  assert.match(source, /summarizeChatLoadingCenterForTrace\(snapshot\.centerLoading\)/);
  assert.match(source, /function startChatLoadingElementTraceMonitor\(reason = 'startup'\)/);
  assert.match(source, /function recordChatLoadingElementTrace\(reason = 'manual'\)/);
  assert.match(source, /chatLoadingElementTrace\.slice\(\)\.reverse\(\)/);
  assert.match(source, /attributeFilter: \['aria-label', 'aria-live', 'aria-busy', 'aria-disabled', 'data-testid', 'disabled', 'hidden', 'class'\]/);
  assert.match(source, /diagnosticPresetIncludes\('assistant_completion'\)\) startChatLoadingElementTraceMonitor\('startup'\)/);
  assert.match(source, /diagnosticPresetIncludes\('assistant_completion'\)\) startChatLoadingElementTraceMonitor\('debug_mode_enabled'\)/);
  assert.match(source, /function collectChatLoadingElementDiagnostics\(reason = 'manual'\)/);
  assert.match(source, /if \(!debugModeEnabled\) return \{ skipped: true, reason: 'debug_mode_off' \}/);
  assert.match(source, /monitorOnly: true/);
  assert.match(source, /selectorSuggestions: buildChatLoadingSelectorSuggestions\(el\)/);
  assert.match(source, /recommendationPolicy/);
  assert.match(source, /AICE_CHAT_LOADING_ELEMENT_DIAGNOSTIC/);

  const diagnosticStart = source.indexOf('  async function collectDiagnosticBundleFromContent(');
  const diagnosticEnd = source.indexOf('  chrome.runtime.onMessage.addListener', diagnosticStart);
  const diagnosticSource = source.slice(diagnosticStart, diagnosticEnd);
  assert.match(diagnosticSource, /const includeAssistantCompletionDiagnostic = includeDebugDiagnostics && diagnosticPresetIncludes\('assistant_completion'\)/);
  assert.match(diagnosticSource, /chatLoadingElements: includeAssistantCompletionDiagnostic/);
  assert.match(diagnosticSource, /collectChatLoadingElementDiagnostics\('diagnostic_bundle'\)/);
  assert.match(diagnosticSource, /\{ skipped: true, reason: 'debug_mode_off' \}/);
});

test('Lite image outputs can remain visible or fall back to explicit placeholder without image fetch', () => {
  assert.match(contentMarkdownSource, /const IMAGE_OUTPUT_PLACEHOLDER_TEXT = \[/);
  assert.match(contentMarkdownSource, /Recent Viewでは画像本体は表示されません。/);
  assert.match(injectedSource, /const LITE_IMAGE_PLACEHOLDER_TEXT = \[/);
  assert.match(injectedSource, /function hasLiteImageLikeContent/);
  assert.match(injectedSource, /function applyLiteImagePlaceholderToMessage/);
  assert.match(injectedSource, /arcaia_lite_image_placeholder: true/);
  const builderStart = injectedSource.indexOf('  function buildLiteRawForPage(');
  const builderEnd = injectedSource.indexOf('  function summarizeNetworkLiteJsonForProbe', builderStart);
  const builderSource = injectedSource.slice(builderStart, builderEnd);
  assert.match(builderSource, /const liteShowImages = options\?\.liteShowImages !== false/);
  assert.match(builderSource, /const imageDisplayDiagnostics = \[\]/);
  assert.match(builderSource, /const appendRenderNodeId = \(nodeId\) => \{/);
  assert.match(builderSource, /if \(liteShowImages\) \{/);
  assert.match(builderSource, /const imagePathNodeIds = signalIndex > sourceIndex/);
  assert.match(builderSource, /pathIds\.slice\(sourceIndex \+ 1, signalIndex \+ 1\)/);
  assert.match(builderSource, /appendRenderNodeId\(imagePathNodeId\)/);
  assert.match(builderSource, /fallbackReason: 'lite_show_images_no_image_path_nodes_added'/);
  assert.match(builderSource, /if \(!liteShowImages && !syntheticPlaceholderNodeById\.has\(id\)\) applyLiteImagePlaceholderToMessage\(clone\?\.message\)/);
  assert.doesNotMatch(builderSource, /fetch\s*\(/);
});

test('backend Lite rewrite has a short conversation no-op guard', () => {
  const builderStart = injectedSource.indexOf('  function buildLiteRawForPage(');
  const builderEnd = injectedSource.indexOf('  function summarizeNetworkLiteJsonForProbe', builderStart);
  const builderSource = injectedSource.slice(builderStart, builderEnd);
  const guardIndex = builderSource.indexOf('if (turns.length <= safeTurnCount)');
  const laterIndex = builderSource.indexOf('const userOnlyTurnIds = new Set');
  assert.ok(guardIndex > -1);
  assert.ok(laterIndex > guardIndex);
  assert.match(builderSource, /below_lite_turn_threshold/);
  assert.match(builderSource, /short_conversation_noop/);
  assert.match(builderSource, /syntheticImagePlaceholderCount: 0/);
});

test('Lite synthetic image placeholders are inserted only for user-only retained turns with downstream image signals', () => {
  const builderStart = injectedSource.indexOf('  function buildLiteRawForPage(');
  const builderEnd = injectedSource.indexOf('  function summarizeNetworkLiteJsonForProbe', builderStart);
  const builderSource = injectedSource.slice(builderStart, builderEnd);
  assert.match(builderSource, /const userOnlyTurnIds = new Set/);
  assert.match(builderSource, /imageDisplayDiagnostics\.push\(\{/);
  assert.match(builderSource, /addedPathNodeCount: addedPathNodeIds\.length/);
  assert.match(builderSource, /roles\.has\('user'\) && !roles\.has\('assistant'\)/);
  assert.match(builderSource, /findLiteImageSignalAfterUser\(raw, pathIds, id, retainedUserNodeIdSet\)/);
  assert.match(builderSource, /createSyntheticLiteImagePlaceholderNode\(id, sourceSignal/);
  assert.match(builderSource, /syntheticImagePlaceholderCount: syntheticPlaceholderDiagnostics\.length/);
  assert.match(builderSource, /syntheticImagePlaceholders: syntheticPlaceholderDiagnostics/);
});

test('Lite synthetic image placeholder guard stops at the next retained user turn', () => {
  const start = injectedSource.indexOf('  function findLiteImageSignalAfterUser(');
  const end = injectedSource.indexOf('  function createSyntheticLiteImagePlaceholderNode', start);
  const finderSource = injectedSource.slice(start, end);
  assert.match(finderSource, /if \(stopUserNodeIds\?\.has\(id\)\) return null/);
  assert.match(finderSource, /isLiteImageSignalMessage\(message\)/);

  const messageStart = injectedSource.indexOf('  function isLiteImageSignalMessage(');
  const messageEnd = injectedSource.indexOf('  function findLiteImageSignalAfterUser', messageStart);
  const messageSource = injectedSource.slice(messageStart, messageEnd);
  assert.match(messageSource, /if \(role === 'user'\) return false/);
  assert.match(messageSource, /role === 'assistant' && hasLiteImageLikeContent\(message\?\.metadata\)/);
});

test('Lite image signal scan ignores search result thumbnails to avoid false placeholders', () => {
  const start = injectedSource.indexOf('  function isIgnoredLiteImageSignalPath(');
  const end = injectedSource.indexOf('  function isLiteImageSignalMessage', start);
  const ignoreSource = injectedSource.slice(start, end);
  assert.match(ignoreSource, /\.search_result_groups/);
  assert.match(ignoreSource, /\.search_results/);
  assert.match(ignoreSource, /thumbnail_url/);
  assert.match(ignoreSource, /thumbnail/);
  assert.match(ignoreSource, /thumbnails/);

  const scanStart = injectedSource.indexOf('  function collectLiteImageSignalKeys(');
  const scanEnd = injectedSource.indexOf('  function collectLiteImageSignalScan', scanStart);
  const scanSource = injectedSource.slice(scanStart, scanEnd);
  assert.match(scanSource, /isIgnoredLiteImageSignalPath\(childPath, key\)/);
  assert.match(scanSource, /lowered\.includes\('image'\)/);
});


test.skip('legacy debug-off diagnostic snapshot contract was removed in v0.1.257', () => {
  const timestampStart = source.indexOf('  async function applyMessageTimestampBadges(');
  const timestampEnd = source.indexOf('  function scheduleApplyMessageTimestamps', timestampStart);
  const timestampApplySource = source.slice(timestampStart, timestampEnd);
  assert.match(timestampApplySource, /const collectDebugSamples = Boolean\(debugModeEnabled\)/);
  assert.match(timestampApplySource, /lastApplySamples: collectDebugSamples \? samples : \[\]/);
  assert.match(timestampApplySource, /lastApplyElapsedMs: collectDebugSamples \? Date\.now\(\) - startedAt : null/);

  const uiStart = source.indexOf('  function getMessageTimestampUiState()');
  const uiEnd = source.indexOf('  function nodeContainsMessageTimestampDom', uiStart);
  const timestampUiStateSource = source.slice(uiStart, uiEnd);
  assert.match(timestampUiStateSource, /if \(!debugModeEnabled\)/);
  assert.match(timestampUiStateSource, /omittedReason: 'debug_mode_off'/);
  assert.match(timestampUiStateSource, /unmatchedDomTimestampBlocks: \[\]/);
  assert.match(timestampUiStateSource, /observerDiagnostic: getMessageTimeObserverDiagnostic\(\)/);

  const diagnosticStart = source.indexOf('  async function collectDiagnosticBundleFromContent(');
  const diagnosticEnd = source.indexOf('  chrome.runtime.onMessage.addListener', diagnosticStart);
  const diagnosticSource = source.slice(diagnosticStart, diagnosticEnd);
  assert.match(diagnosticSource, /const includeDebugDiagnostics = Boolean\(debugModeEnabled\)/);
  assert.match(diagnosticSource, /debugDetailsOmitted: !includeDebugDiagnostics/);
  assert.match(diagnosticSource, /getDomDiagnosticsForBundle\(\) : \{ skipped: true, reason: 'debug_mode_off' \}/);
  assert.match(diagnosticSource, /getRollingLiteDomState\(\) : \{ skipped: true, reason: 'debug_mode_off' \}/);

  const startupStart = source.indexOf('  function startArcaiaPageUi()');
  const startupEnd = source.indexOf('  function startAfterStartupSettingsSync()', startupStart);
  const startupSource = source.slice(startupStart, startupEnd);
  assert.match(startupSource, /if \(debugModeEnabled\) arcaiaStartupDiagnosticTimer = setTimeout\(async \(\) => \{/);
});

test('P1 runtime review fixes keep normal execution narrow', () => {
  const contentScript = manifest.content_scripts[0];
  assert.equal(contentScript.all_frames, false);
  assert.equal(Object.prototype.hasOwnProperty.call(contentScript, 'match_about_blank'), false);

  const groupingStart = source.indexOf('  function getLiteGroupingDiagnostics(');
  const groupingEnd = source.indexOf('  function unhideRollingLiteContainers()', groupingStart);
  const groupingSource = source.slice(groupingStart, groupingEnd);
  assert.doesNotMatch(groupingSource, /includeDetailedDiagnostics|collectLiteRuntimeLayoutDiagnostics|retainedGroupSamples|hiddenSectionSamples/);
  assert.match(groupingSource, /retainedSectionCount: retainedRecords\.length/);
  assert.match(groupingSource, /hiddenSectionCount: hiddenRecords\.length/);

  const fullLoadStart = source.indexOf('      if (fullLoadModeState.active && fullLoadModeState.conversationId === currentConversationId) {');
  const fullLoadEnd = source.indexOf('      const reasonText = String(reason || \'\');', fullLoadStart);
  const fullLoadSource = source.slice(fullLoadStart, fullLoadEnd);
  assert.doesNotMatch(fullLoadSource, /retainedSectionSamples|summarizeMessageSectionRecord|debugModeEnabled/);

  const pinnedStart = source.indexOf('  const PINNED_SORT_STYLE_ID');
  const pinnedEnd = source.indexOf('  const TURN_EXPORT_BUTTON_ATTR', pinnedStart);
  const pinnedSource = source.slice(pinnedStart, pinnedEnd);
  assert.doesNotMatch(pinnedSource, /pinnedSortStartupRetryTimer|startPinnedSortUi\(\);\s*\}, 500\)/);
  assert.match(pinnedSource, /let pinnedSortStartupBurstScheduled = false/);
  assert.match(pinnedSource, /if \(!pinnedSortStartupBurstScheduled\)/);
  assert.match(pinnedSource, /\[300, 900, 1800\]\.forEach/);

  const fetchStart = injectedSource.indexOf('      window.fetch = function patchedFetch');
  const fetchEnd = injectedSource.indexOf('      state.fetchHooked = true', fetchStart);
  const fetchSource = injectedSource.slice(fetchStart, fetchEnd);
  assert.match(fetchSource, /observedRequest = shouldObserve\(url\)/);
  assert.match(fetchSource, /if \(!observedRequest\) return state\.originalFetch\.apply\(this, arguments\)/);
  assert.doesNotMatch(fetchSource, /debugModeEnabled|summarizeRequestBodyForDeletionMonitor|recordDeletionApiObservation|recordNonGetBackendApiObservation|inspectModelSelector/);

  const xhrStart = injectedSource.indexOf('    XMLHttpRequest.prototype.open = function patchedOpen');
  const xhrEnd = injectedSource.indexOf('    state.xhrHooked = true', xhrStart);
  const xhrSource = injectedSource.slice(xhrStart, xhrEnd);
  assert.match(xhrSource, /this\.__aice_probe_observed = shouldObserve\(this\.__aice_probe_url\)/);
  assert.match(xhrSource, /if \(!this\.__aice_probe_observed\) return state\.originalXHRSend\.apply\(this, arguments\)/);
  assert.doesNotMatch(xhrSource, /debugModeEnabled|requestBodyMeta|recordDeletionApiObservation|recordNonGetBackendApiObservation|inspectModelSelector/);
});

test.skip('legacy main-world debug snapshot contract was removed in v0.1.257', () => {
  assert.match(injectedSource, /function isMainDebugModeEnabled/);
  const recordStart = injectedSource.indexOf('  function recordLiteConfigDecision(');
  const recordEnd = injectedSource.indexOf('  function emitMainEvent', recordStart);
  const recordSource = injectedSource.slice(recordStart, recordEnd);
  assert.match(recordSource, /if \(!isMainDebugModeEnabled\(\)\) return null/);

  const publicStart = injectedSource.indexOf('  function publicSnapshot()');
  const publicEnd = injectedSource.indexOf('  state.publicSnapshot = publicSnapshot', publicStart);
  const publicSource = injectedSource.slice(publicStart, publicEnd);
  assert.match(publicSource, /const includeDebugDetails = Boolean\(state\.debugModeEnabled\)/);
  assert.match(publicSource, /observations: includeDebugDetails \? state\.observations\.slice\(\)\.reverse\(\) : \[\]/);
  assert.match(publicSource, /probes: includeDebugDetails \? state\.responseProbes\.slice\(\)\.reverse\(\) : \[\]/);

  const internalStart = injectedSource.indexOf('  function getLiteDisplayInternalDiagnostic()');
  const internalEnd = injectedSource.indexOf('  function shouldApplyLiteDisplayToFetch', internalStart);
  const internalSource = injectedSource.slice(internalStart, internalEnd);
  assert.match(internalSource, /configDecisionLog: includeDebugDetails \? liteConfigDecisionLog\.slice\(-30\) : \[\]/);
  assert.match(internalSource, /messageTimestampIndex: includeDebugDetails \? \(state\.messageTimestampIndex \|\| null\) : null/);

  const coreAllowedMatch = source.match(/const coreAllowed = new Set\(\[([^\]]+)\]\)/);
  assert.ok(coreAllowedMatch);
  assert.doesNotMatch(coreAllowedMatch[1], /AICE_LITE_DISPLAY_WIRING_DIAGNOSTIC/);
  assert.doesNotMatch(coreAllowedMatch[1], /AICE_NETWORK_LITE_PROBE_STATUS/);

  const storedLogStart = popupSource.indexOf('  async function buildStoredDebugLogPayload(');
  const storedLogEnd = popupSource.indexOf('  async function downloadStoredDebugEvents', storedLogStart);
  const storedLogSource = popupSource.slice(storedLogStart, storedLogEnd);
  assert.match(storedLogSource, /if \(!debugModeEnabled\)/);
  assert.match(storedLogSource, /events: \[\]/);
  assert.match(storedLogSource, /reason: 'debug_mode_off'/);

  const zipStart = popupSource.indexOf('  async function downloadDiagnosticAndDebugZip(');
  const zipEnd = popupSource.indexOf('  function crc32', zipStart);
  const zipSource = popupSource.slice(zipStart, zipEnd);
  assert.match(zipSource, /const files = debugModeEnabled/);
  assert.match(zipSource, /\? \[[\s\S]*\{ name: diagnosticName, text: diagnosticText \},[\s\S]*\{ name: debugLogName, text: debugLogText \}/);
  assert.match(zipSource, /: \[[\s\S]*\{ name: diagnosticName, text: diagnosticText \}/);

  const popupBundleStart = popupSource.indexOf('  async function collectDiagnosticBundlePayload()');
  const popupBundleEnd = popupSource.indexOf('  async function copyDiagnosticBundleToClipboard', popupBundleStart);
  const popupBundleSource = popupSource.slice(popupBundleStart, popupBundleEnd);
  assert.match(popupBundleSource, /const events = debugModeEnabled \? await readStoredDebugEvents\(\) : \[\]/);
  assert.match(popupBundleSource, /storedDebugEvents: storedDebugOmitted \? \[\] : trimLargeForDebug\(events\)/);
});

test('toolbar diagnostic ZIP payload builders are removed', () => {
  assert.doesNotMatch(source, /collectDiagnosticBundleFromContent|buildContentFallbackLiteRewriteFlatDiagnostics|buildToolbarDiagnosticZipPayload|createToolbarZipBlob/);
  assert.doesNotMatch(contentToolbarSourceFile, /diagnostic_zip|DiagnosticZip|createToolbarZipBlob/);
});

test.skip('legacy main-world generic deletion monitor contract was removed in v0.1.257', () => {
  assert.doesNotMatch(injectedSource, /MAX_DELETION_API_OBSERVATIONS|MAX_NON_GET_BACKEND_API_OBSERVATIONS/);
  assert.doesNotMatch(injectedSource, /deletionApiObservations|nonGetBackendApiObservations/);
  assert.doesNotMatch(injectedSource, /summarizeRequestBodyForDeletionMonitor|classifyDeletionApiMonitorCandidate|isBodylessDeletionMonitorPatch/);
  assert.doesNotMatch(injectedSource, /recordDeletionApiObservation|recordNonGetBackendApiObservation|nonGetBackendApiMonitor|deletionApiMonitor/);
  assert.doesNotMatch(injectedSource, /DELETE_CURRENT_CHAT_TRIAL|DELETE_CURRENT_CHAT_TRIAL_RESULT/);
});

test.skip('legacy debug-only current-chat removal trial UI was removed in v0.1.257', () => {
  assert.match(popupHtmlSource, /id="deleteCurrentChatTrial"/);
  assert.match(popupHtmlSource, /現在チャット削除（仮）/);
  assert.match(popupSource, /function deleteCurrentChatTrial\(\)/);
  assert.match(popupSource, /window\.confirm/);
  assert.match(popupSource, /AICE_CURRENT_CHAT_REMOVE_TRIAL/);
  assert.match(source, /function runDeleteCurrentChatTrial\(message = \{\}\)/);
  assert.match(source, /pageConversationId !== conversationId/);
  assert.match(source, /requestMainWorldDeleteCurrentChatTrial/);
  assert.match(source, /requestMode: 'main_world_fetch'/);
  assert.match(source, /requestBodyOmitted: true/);
  assert.match(source, /authValuesOmitted: true/);
  const deleteStart = source.indexOf('  async function runDeleteCurrentChatTrial(message = {})');
  const deleteEnd = source.indexOf('  async function runHistoryFetchProbe()', deleteStart);
  assert.doesNotMatch(source.slice(deleteStart, deleteEnd), /fetch\s*\(/);
  assert.match(injectedSource, /function runDeleteCurrentChatTrialInMainWorld\(payload = \{\}\)/);
  assert.match(injectedSource, /DELETE_CURRENT_CHAT_TRIAL_RESULT/);
  assert.match(injectedSource, /endpointPathTemplate = '\/backend-api\/conversation\/:conversation_id'/);
  assert.match(injectedSource, /credentials: 'include'/);
  assert.match(injectedSource, /body: JSON\.stringify\(\{ is_visible: false \}\)/);
  assert.match(injectedSource, /authorizationHeaderUsed: authorizationAvailable/);
  assert.match(injectedSource, /authValuesOmitted: true/);
  assert.match(source, /AICE_CURRENT_CHAT_REMOVE_TRIAL/);
});

test.skip('legacy timestamp generic diagnostic contract was removed in v0.1.257', () => {
  assert.doesNotMatch(source, /MESSAGE_TIME_CANDIDATES_ATTR/);
  assert.doesNotMatch(source, /function collectMessageTimestampCandidates/);
  assert.doesNotMatch(source, /function collectNormalizedMessageTimestampCandidates/);
  assert.doesNotMatch(source, /function getTimestampDebugCandidates/);
  assert.doesNotMatch(source, /function renderMessageTimeCandidates/);
  assert.doesNotMatch(source, /all candidates:/);
  assert.doesNotMatch(injectedSource, /function collectTimestampCandidates/);
  assert.doesNotMatch(injectedSource, /timestampCandidates: collectTimestampCandidates\(message\)/);
  assert.doesNotMatch(source, /match: 'role_ordinal'/);
  assert.doesNotMatch(source, /function getUnmatchedDomTimestampBlocks|unmatchedDomTimestampBlocks/);
  assert.match(source, /provisionalByDomKey: \{\}/);
  assert.match(source, /provisionalCount: 0/);
  assert.match(source, /replacedProvisionalCount: 0/);
});


test('Ctrl+Enter send mode is scoped to composer and edit textarea', () => {
  const ctrlStart = source.indexOf('  const CTRL_ENTER_COMPOSER_FORM_SELECTOR');
  const ctrlEnd = source.indexOf('  const CODE_BLOCK_COLLAPSER_STYLE_ID', ctrlStart);
  assert.notEqual(ctrlStart, -1);
  assert.notEqual(ctrlEnd, -1);
  const ctrlSource = source.slice(ctrlStart, ctrlEnd);
  assert.match(ctrlSource, /function startCtrlEnterSendUi/);
  assert.match(ctrlSource, /document\.addEventListener\('keydown', handleCtrlEnterKeydown, true\)/);
  assert.match(ctrlSource, /function isCtrlEnterJapaneseComposing/);
  assert.match(ctrlSource, /event\?\.isComposing \|\| event\?\.keyCode === 229/);
  assert.match(ctrlSource, /function dispatchCtrlEnterShiftEnter/);
  assert.match(ctrlSource, /shiftKey: true/);
  assert.match(ctrlSource, /CTRL_ENTER_COMPOSER_FORM_SELECTOR = 'form\[data-type="unified-composer"\]'/);
  assert.match(ctrlSource, /fromEl\.closest\('#prompt-textarea\.ProseMirror\[contenteditable="true"\]'\)/);
  assert.match(ctrlSource, /fromEl\.closest\('\[role="textbox"\]\[contenteditable="true"\]\[aria-multiline="true"\]'\)/);
  assert.match(ctrlSource, /form\.contains\(editor\)/);
  assert.match(ctrlSource, /findComposerSendButton\(editor\)/);
  assert.match(ctrlSource, /isEditableMessageTextarea/);
  assert.doesNotMatch(ctrlSource, /document\.querySelector\('#prompt-textarea/);
  assert.match(source, /startCtrlEnterSendUi\(\)/);
});

test('block collapser targets real code and writing blocks without folding plain text', () => {
  const codeStart = source.indexOf('  const CODE_BLOCK_COLLAPSER_STYLE_ID');
  const codeEnd = source.indexOf('  const PINNED_SORT_STYLE_ID', codeStart);
  assert.notEqual(codeStart, -1);
  assert.notEqual(codeEnd, -1);
  const codeSource = source.slice(codeStart, codeEnd);
  assert.match(codeSource, /const CODE_BLOCK_MIN_COLLAPSE_LINES = 6/);
  assert.match(codeSource, /const CODE_BLOCK_OUTER_SELECTOR = 'pre\[data-start\]\[data-end\]'/);
  assert.match(codeSource, /const CODE_BLOCK_VIEWER_SELECTOR = '\[id="code-block-viewer"\]'/);
  assert.match(codeSource, /const WRITING_OUTER_SELECTOR = '\[data-writing-block-fullscreen-fallback-target="inline"\]'/);
  assert.match(codeSource, /const WRITING_BLOCK_SELECTOR = '\[data-writing-block\]'/);
  assert.match(codeSource, /const WRITING_HEADER_CHROME_SELECTOR = '\[data-writing-block-fullscreen-header-chrome="true"\]'/);
  assert.doesNotMatch(codeSource, /codeBlockCollapserObserver|codeBlockCollapserRootObserver/);
  assert.doesNotMatch(source, /collectBlockCollapserDiagnostics/);
  assert.match(codeSource, /function isRealCodeHeader/);
  assert.match(codeSource, /buttons\.some\(isCodeBlockCopyButton\)/);
  assert.match(codeSource, /function hasWritingEditButton/);
  assert.match(codeSource, /buttons\.some\(isWritingEditButton\)/);
  assert.match(codeSource, /outerBlock\.querySelector\(WRITING_BLOCK_SELECTOR\)/);
  assert.match(codeSource, /function findWritingOuterBlock/);
  assert.match(codeSource, /writingBlock\.closest\('section'\)/);
  assert.match(codeSource, /editButton\.parentElement/);
  assert.match(codeSource, /return outerBlock/);
  assert.match(codeSource, /!editorWrapper\.contains\(headerCandidate\) \? headerCandidate : outerBlock/);
  assert.doesNotMatch(codeSource, /if \(!hasWritingEditButton\(headerChrome\)\) return/);
  assert.match(codeSource, /headerChrome\.querySelector\('svg'\) instanceof SVGElement/);
  assert.match(codeSource, /getCodeLanguageText\(headerChrome\)/);
  assert.match(codeSource, /setCodeBlockCollapsed\(codeOuterBlock, contentTargets, toggle, shouldCollapseCodeBlock\(codeViewer\)\)/);
  assert.match(codeSource, /setCodeBlockCollapsed\(outerBlock, contentTargets, toggle, shouldCollapseCodeBlock\(editorWrapper\)\)/);
  assert.doesNotMatch(codeSource, /setCodeBlockCollapsed\(codeOuterBlock, contentTargets, toggle, true\)/);
  assert.doesNotMatch(codeSource, /setCodeBlockCollapsed\(outerBlock, contentTargets, toggle, true\)/);
  assert.match(codeSource, /scanWritingBlocksForCollapse\(root\)/);
  assert.match(source, /attributes: true/);
  assert.match(source, /attributeFilter: \[[\s\S]*?'data-writing-block'[\s\S]*?'data-start'[\s\S]*?'data-end'/);
  assert.match(codeSource, /function isCodeBlockCollapserAttributeMutation/);
  assert.match(codeSource, /function collectBlockCollapserMutationRoots/);
  assert.match(codeSource, /function processBlockCollapserMutationRoots/);
  assert.match(source, /processBlockCollapserMutationRoots\(roots, hasAttributeCandidate \? 'block_candidate_attribute_changed' : 'block_candidate_child_added'\)/);
  assert.match(source, /conversationDomContentObserver = new MutationObserver\(handleConversationDomMutations\)/);
  assert.match(codeSource, /scanCodeBlocksForCollapse\(root\)/);
  assert.match(codeSource, /startConversationDomObserver\(\)/);
  assert.doesNotMatch(codeSource, /section:has/);
  assert.doesNotMatch(codeSource, /scheduleCodeBlockCollapserScan/);
  assert.doesNotMatch(codeSource, /codeBlockCollapserScanTimer/);
  assert.doesNotMatch(codeSource, /setTimeout/);
  assert.match(codeSource, /\$\{WRITING_BLOCK_PROCESSED_ATTR\}="true"/);
  assert.doesNotMatch(codeSource, /WRITING_BLOCK_PROCESSED_ATTR\}=\\true/);
  assert.doesNotMatch(codeSource, /setTimeout\(\(\) => scanCodeBlocksForCollapse\(document\), 120\)/);
  assert.doesNotMatch(codeSource, /setTimeout\(\(\) => scanCodeBlocksForCollapse\(document\), 500\)/);
  assert.doesNotMatch(codeSource, /\[250, 500, 900, 1500, 3000\]/);
  assert.doesNotMatch(codeSource, /attributeFilter: \['class'/);
  assert.doesNotMatch(codeSource, /attributeFilter: \['style'/);
  assert.doesNotMatch(codeSource, /article\[data-testid/);
  assert.doesNotMatch(codeSource, /markdown\s*plain\s*text/);
  assert.match(source, /startCodeBlockCollapserUi\(\)/);
});

test('pinned sidebar sorter isolates standalone chats and each project folder without moving folders', () => {
  assert.match(source, /const PINNED_SORT_STORAGE_KEY = 'arcaia\.sidebarPinnedSorter\.v1'/);
  assert.match(source, /const PINNED_FAVORITES_STORAGE_KEY = 'arcaia\.sidebarPinnedFavorites\.v1'/);
  assert.match(source, /function startPinnedSortEarlyGate/);
  assert.match(source, /html\[data-arcaia-pinned-sort-gate="true"\]:not\(\[data-arcaia-pinned-sort-ready="true"\]\)/);
  assert.match(source, /releasePinnedSortGate\('fail_safe_timeout'\)/);
  assert.match(source, /function startPinnedSortUi/);
  assert.match(source, /findPinnedSortSection/);
  assert.match(source, /PINNED_SORT_CONVERSATION_SELECTOR = 'a\[data-sidebar-item="true"\]\[href\*="\/c\/"\]'/);
  assert.match(source, /const PINNED_SORT_OBSERVER_ROOT_SELECTOR = '#stage-slideover-sidebar, nav\[aria-label="チャット履歴"\], nav\[aria-label="Chat history"\]'/);
  assert.match(source, /function getPinnedSortObserverRoot/);
  assert.match(source, /function observePinnedSortRoot/);
  assert.match(source, /pinnedSortObserverRoot === root/);
  assert.match(source, /pinnedSortObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.match(source, /insertBefore\(draggedItem, marker\)/);
  assert.match(source, /document\.createComment\(`arcaia-pinned-slot:\$\{scope\.type\}`\)/);
  assert.doesNotMatch(source, /fragment\.appendChild\(row\.item\)/);
  assert.match(source, /shouldIgnorePinnedSortDragStartTarget/);
  assert.match(source, /const PINNED_SORT_DROP_MARKER_STICKY_PX = 18/);
  assert.match(source, /function isNearPinnedSortDropMarker/);
  assert.match(source, /function isPinnedSortDropMarkerRelatedTarget/);
  assert.match(source, /function getLastPinnedSortRow/);
  assert.match(source, /function isPinnedSortLastRow/);
  assert.match(source, /function getPinnedSortRowForEventTarget/);
  assert.match(source, /function showPinnedSortMarkerForRow/);
  assert.match(source, /showPinnedSortAppendMarker\(latestScope\)/);
  assert.match(source, /if \(isNearPinnedSortDropMarker\(event\)\) return/);
  const pinnedDropActiveStart = source.indexOf('      .arcaia-pinned-sort-drop-active {');
  const pinnedDropActiveEnd = source.indexOf('      body.arcaia-pinned-sort-dragging', pinnedDropActiveStart);
  const pinnedDropActiveStyle = source.slice(pinnedDropActiveStart, pinnedDropActiveEnd);
  assert.doesNotMatch(pinnedDropActiveStyle, /outline/);
  assert.match(source, /border-top: 1px dashed var\(--text-tertiary, currentColor\) !important/);
  assert.match(source, /data-conversation-options-trigger/);
  assert.match(source, /const PINNED_FAVORITE_ICON_CHOICES = Object\.freeze/);
  assert.match(source, /id: 'star'/);
  assert.match(source, /id: 'bot'/);
  assert.match(source, /id: 'vector-square'/);
  assert.match(source, /id: 'wrench'/);
  assert.match(source, /id: 'brain-cog'/);
  assert.match(source, /id: 'globe'/);
  assert.match(source, /id: 'globe-2'/);
  assert.match(source, /<svg class=\"arcaia-pinned-favorite-mark-icon\" data-arcaia-filled=\"true\"/);
  assert.match(source, /\.arcaia-pinned-favorite-mark-icon\[data-arcaia-filled=\"true\"\]/);
  assert.doesNotMatch(source, /id: 'heart'/);
  assert.doesNotMatch(source, /id: 'check'/);
  assert.doesNotMatch(source, /id: 'flag'/);
  assert.doesNotMatch(source, /id: 'diamond'/);
  assert.doesNotMatch(source, /id: 'circle'/);
  assert.doesNotMatch(source, /id: 'triangle'/);
  assert.doesNotMatch(source, /id: 'bang'/);
  assert.match(source, /const PINNED_FAVORITE_ICON_PICKER_ID = 'arcaia-pinned-favorite-icon-picker'/);
  assert.match(source, /function openPinnedFavoriteIconPicker/);
  assert.match(source, /function selectPinnedFavoriteIcon/);
  assert.match(source, /function bindPinnedFavoriteIcon/);
  assert.match(source, /bindPinnedFavoriteIcon\(row\)/);
  assert.match(source, /!row\?\.scopeKey/);
  assert.match(source, /aria-haspopup', 'menu'/);
  assert.match(source, /menuitemradio/);
  assert.match(source, /data-arcaia-pinned-favorite-icon/);
  assert.doesNotMatch(source, /function pinnedFavoriteStarSvg/);
  assert.doesNotMatch(source, /arcaia-pinned-favorite-star-icon/);
  const pinnedStart = source.indexOf('  const PINNED_SORT_STYLE_ID');
  const pinnedEnd = source.indexOf('  const TURN_EXPORT_BUTTON_ATTR', pinnedStart);
  const pinnedSource = source.slice(pinnedStart, pinnedEnd);
  assert.match(source, /startPinnedSortUi\(\)/);
  assert.match(pinnedSource, /payload\.scopeKey !== latestScope\.key/);
  assert.match(pinnedSource, /!isPinnedSortLastRow\(targetRow, latestScope\) \|\| !isPinnedSortLowerHalfEvent\(event, targetRow\.item\)/);
  assert.match(pinnedSource, /const suppressRemainingMs = pinnedSortSuppressObserverUntil - Date\.now\(\)/);
  assert.match(pinnedSource, /function shouldSchedulePinnedSortForMutations\(mutations\)/);
  assert.match(pinnedSource, /if \(!shouldSchedulePinnedSortForMutations\(mutations\)\) return;/);
  assert.match(pinnedSource, /observer_suppressed_deferred/);
  assert.doesNotMatch(source, /collectPinnedSortDiagnostics/);
  assert.match(pinnedSource, /anchor\.setAttribute\('draggable', 'true'\);/);
  assert.match(pinnedSource, /anchor\.setAttribute\(PINNED_SORT_DRAG_SOURCE_ATTR, 'true'\);/);
  assert.match(pinnedSource, /if \(anchor\.getAttribute\(PINNED_SORT_BOUND_ANCHOR_ATTR\) === 'true'\) return;/);
  assert.match(pinnedSource, /function ensurePinnedSortObserverRoot/);
  assert.match(pinnedSource, /ensurePinnedSortObserverRoot\(`scan:\$\{reason\}`\)/);
  assert.doesNotMatch(pinnedSource, /observer_root_ensured|pinnedSortRecentTrace|anchor_pointerdown|anchor_dragstart|drop_attempt/);
  assert.match(pinnedSource, /function extractPinnedSortProjectId\(href\)/);
  assert.ok(pinnedSource.includes("url.pathname.match(/^\\/g\\/(g-p-"));
  assert.match(pinnedSource, /key: `project:\$\{projectId\}`/);
  assert.match(pinnedSource, /key: 'standalone'/);
  assert.match(pinnedSource, /function collectPinnedSortScopes\(rows\)/);
  assert.match(pinnedSource, /function isPinnedSortForeignContainerTarget\(event, scope\)/);
  assert.match(pinnedSource, /return !\(scope\.rows \|\| \[\]\)\.some\(\(row\) => row\.item === directChild\)/);
  assert.match(pinnedSource, /if \(isPinnedSortForeignContainerTarget\(event, latestScope\)\) return/);
  assert.match(pinnedSource, /const PINNED_SORT_STATE_VERSION = 2/);
  assert.match(pinnedSource, /const pinnedSortLastAppliedOrderByScope = new Map\(\)/);
  assert.match(pinnedSource, /function adoptPinnedSortExpandedProjectOrder\(scope, currentIds\)/);
  assert.match(pinnedSource, /scope\.type === 'project'/);
  assert.match(pinnedSource, /retainedCurrentIds\.join\('\\n'\) === previousAppliedIds\.join\('\\n'\)/);
  assert.doesNotMatch(pinnedSource, /project_expansion_native_order_adopted/);
  assert.match(pinnedSource, /pinnedSortLastAppliedOrderByScope\.clear\(\)/);
  assert.match(pinnedSource, /orders: \{\}/);
  assert.match(pinnedSource, /legacyOrder/);
  assert.match(pinnedSource, /marker\.__arcaiaPinnedSortScopeKey !== payload\.scopeKey/);
  assert.match(pinnedSource, /draggedItem\.parentElement !== expectedScope\.list/);
  assert.match(pinnedSource, /saveCurrentPinnedSortOrder\(expectedScope\)/);
  assert.doesNotMatch(pinnedSource, /function markPinnedSortNativeInteraction/);
  assert.doesNotMatch(pinnedSource, /function isPinnedSortNativeInteractionActive/);
  assert.doesNotMatch(pinnedSource, /function installPinnedSortNativeInteractionGuards/);
  assert.doesNotMatch(pinnedSource, /native_interaction_deferred/);
  assert.doesNotMatch(pinnedSource, /observer_native_interaction_deferred/);
  assert.doesNotMatch(pinnedSource, /installPinnedSortNativeInteractionGuards\(root\)/);
  assert.doesNotMatch(pinnedSource, /data-arcaia-pinned-native-guard/);
  assert.doesNotMatch(pinnedSource, /function isPinnedSortNativeOverlayActive/);
  assert.doesNotMatch(pinnedSource, /function isPinnedSortElementVisiblyOpen/);
  assert.doesNotMatch(pinnedSource, /getComputedStyle/);
  assert.doesNotMatch(pinnedSource, /getClientRects/);
  assert.doesNotMatch(pinnedSource, /const target = document\.body \|\| document\.documentElement/);
  assert.doesNotMatch(pinnedSource, /pinnedSortObserver\.observe\(target/);
  assert.doesNotMatch(source, /cloneNode\(/);
  assert.doesNotMatch(source, /createFolder\(/);
});

test('project expansion preserves native revealed order and updates saved visible order', () => {
  const start = source.indexOf('  function adoptPinnedSortExpandedProjectOrder(scope, currentIds) {');
  const end = source.indexOf('  function suppressPinnedSortObserverBriefly', start);
  assert.ok(start > -1 && end > start);
  const functionSource = source.slice(start, end);
  const sandbox = {
    pinnedSortState: {
      orders: {
        'project:g-p-test': ['A', 'B', 'C', 'D', 'E', 'F', 'G']
      }
    },
    savePinnedSortState(nextState) {
      this.pinnedSortState = {
        version: 2,
        orders: nextState.orders,
        legacyOrder: []
      };
    }
  };
  vm.runInNewContext(`
    let pinnedSortState = this.pinnedSortState;
    function savePinnedSortState(nextState) {
      pinnedSortState = { version: 2, orders: nextState.orders, legacyOrder: [] };
      this.pinnedSortState = pinnedSortState;
    }
    ${functionSource}
    this.adoptPinnedSortExpandedProjectOrder = adoptPinnedSortExpandedProjectOrder;
  `, sandbox);
  const changed = sandbox.adoptPinnedSortExpandedProjectOrder(
    { type: 'project', key: 'project:g-p-test' },
    ['A', 'B', 'C', 'D', 'F', 'E']
  );
  assert.equal(changed, true);
  assert.deepEqual(
    Array.from(sandbox.pinnedSortState.orders['project:g-p-test']),
    ['A', 'B', 'C', 'D', 'F', 'E', 'G']
  );
});

test.skip('legacy pinned-sidebar generic diagnostics were removed in v0.1.257', () => {
  const pinnedStart = source.indexOf('  const PINNED_SORT_STYLE_ID');
  const pinnedEnd = source.indexOf('  const TURN_EXPORT_BUTTON_ATTR', pinnedStart);
  const pinnedSource = source.slice(pinnedStart, pinnedEnd);
  assert.match(pinnedSource, /const PINNED_SORT_HIERARCHY_NODE_LIMIT = 220/);
  assert.match(pinnedSource, /const PINNED_SORT_HIERARCHY_ANCESTOR_LIMIT = 12/);
  assert.match(pinnedSource, /function buildPinnedSortHierarchyProbe\(pinnedSection, rows\)/);
  assert.match(pinnedSource, /function getPinnedSortDiagnosticHrefShape\(element\)/);
  assert.match(pinnedSource, /<conversationId>/);
  assert.match(pinnedSource, /<projectId>/);
  assert.match(pinnedSource, /replace\(\/g-p-\[A-Za-z0-9_-\]\+\/g, 'g-p-<projectId>'\)/);
  assert.match(pinnedSource, /structuralNodes/);
  assert.match(pinnedSource, /conversationRows/);
  assert.match(pinnedSource, /parentImmediateConversationRowCount/);
  assert.match(pinnedSource, /ancestorChain/);
  assert.match(pinnedSource, /textValuesStored: false/);
  assert.match(pinnedSource, /projectNamesStored: false/);
  assert.match(pinnedSource, /conversationTitlesStored: false/);
  assert.match(pinnedSource, /rawHtmlStored: false/);
  assert.match(pinnedSource, /hierarchyProbe: diagnosticPresetIncludes\('pinned_sidebar'\)/);
  assert.match(pinnedSource, /const PINNED_SORT_ORDER_PROBE_ROW_LIMIT = 80/);
  assert.match(pinnedSource, /const pinnedSortLastScopeOrderProbe = new Map\(\)/);
  assert.match(pinnedSource, /function buildPinnedSortScopeOrderProbe\(scope\)/);
  assert.match(pinnedSource, /function recordPinnedSortOrderProbe\(reason, scopesBeforeApply, scopesAfterApply\)/);
  assert.match(pinnedSource, /recordPinnedSortTrace\('scope_order_probe'/);
  assert.match(pinnedSource, /addedAlreadyInSavedOrderHashes/);
  assert.match(pinnedSource, /nativeOrderBeforeApplyHashes/);
  assert.match(pinnedSource, /appliedOrderAfterHashes/);
  assert.match(pinnedSource, /directChildrenBeforeApply/);
  assert.match(pinnedSource, /directChildrenAfterApply/);
  assert.match(pinnedSource, /idsHashed: true/);
  assert.match(pinnedSource, /titlesStored: false/);
  assert.match(pinnedSource, /textValuesStored: false/);
  assert.match(pinnedSource, /rawHtmlStored: false/);
  assert.match(pinnedSource, /orderProbe: diagnosticPresetIncludes\('pinned_sidebar'\)/);
  assert.match(pinnedSource, /recordPinnedSortOrderProbe\(reason, scopesBeforeApply, scopesAfterApply\)/);
  assert.match(pinnedSource, /pinnedSortLastScopeOrderProbe\.clear\(\)/);
  assert.match(pinnedSource, /diagnostic_preset:\$\{diagnosticPreset\}/);
  assert.doesNotMatch(pinnedSource, /outerHTML\s*:/);
  assert.match(popupSource, /pageDiagnostics\.pinnedSortDiagnostics\.hierarchyProbe\.structuralNodes/);
  assert.match(popupSource, /pageDiagnostics\.pinnedSortDiagnostics\.hierarchyProbe\.conversationRows/);
});

test.skip('legacy diagnostic presets were removed in v0.1.257', () => {
  assert.match(popupHtmlSource, /id="diagnosticPresetSelect"/);
  assert.match(popupHtmlSource, /value="standard">標準/);
  assert.match(popupHtmlSource, /value="model_selector">モデルセレクター/);
  assert.match(popupHtmlSource, /value="assistant_completion">回答完了検知/);
  assert.match(popupHtmlSource, /value="pinned_sidebar">ピン留め・PJT階層/);
  assert.match(popupHtmlSource, /value="lite_view">Recent View/);
  assert.match(popupHtmlSource, /value="deletion">削除監視/);
  assert.match(popupHtmlSource, /value="all">すべて/);
  assert.match(popupSource, /function effectiveDebugLoggingEnabled\(\)/);
  assert.match(popupSource, /operationMode === 'diagnostic'\) return true/);
  assert.match(popupSource, /operationMode === 'off'\) return false/);
  assert.match(popupSource, /debugLoggingHintEl\.textContent = !enabled \? 'Arcaia OFF' : \(debugLoggingPreference \? 'ON' : 'OFF'\)/);
  assert.match(popupSource, /diagnosticOnlyHintEl\.textContent = !enabled/);
  assert.match(popupSource, /buttons\.diagnosticOnlyToggle\.disabled = !enabled \|\| !debugLoggingPreference/);
  assert.match(source, /function diagnosticPresetIncludes\(name\)/);
  assert.match(source, /if \(diagnosticPreset === 'all'\) return true/);
  assert.match(source, /if \(diagnosticPreset === 'standard'\) return name === 'assistant_completion'/);
  assert.match(source, /includeModelSelectorDiagnostic = includeDebugDiagnostics && diagnosticPresetIncludes\('model_selector'\)/);
  assert.match(source, /includeLiteDiagnostic = includeDebugDiagnostics && diagnosticPresetIncludes\('lite_view'\)/);
  assert.match(backgroundSource, /const ARCAIA_OPERATION_MODE_STORAGE_KEY = 'arcaia_operation_mode_v1'/);
  assert.match(backgroundSource, /resolvedMode === 'diagnostic' \? 'LOG'/);
  assert.match(backgroundSource, /resolvedMode === 'off' \? 'OFF'/);
  assert.match(backgroundSource, /chrome\.storage\.onChanged/);
});

test('pinned sidebar project scope recognizes only project g-p paths', () => {
  const start = source.indexOf('  function extractPinnedSortProjectId(href) {');
  const end = source.indexOf('  function getPinnedSortScopeDescriptor(anchor, item) {', start);
  assert.ok(start > -1 && end > start);
  const functionSource = source.slice(start, end);
  const sandbox = {
    URL,
    window: { location: { origin: 'https://chatgpt.com' } }
  };
  vm.runInNewContext(`${functionSource}\nthis.extractPinnedSortProjectId = extractPinnedSortProjectId;`, sandbox);
  assert.equal(sandbox.extractPinnedSortProjectId('/g/g-p-project123/c/chat456'), 'g-p-project123');
  assert.equal(sandbox.extractPinnedSortProjectId('/c/chat456'), null);
  assert.equal(sandbox.extractPinnedSortProjectId('/g/g-custom123/c/chat456'), null);
});

test('Markdown turn export button uses inline SVG matching native toolbar icons', () => {
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources || []);
  assert.ok(!resources.includes('icons/md_download/icon32.png'));
  assert.match(source, /function turnExportIconHtml\(\)/);
  assert.match(source, /<span class="arcaia-turn-export-icon-wrap flex items-center justify-center touch:w-10 h-8 w-8"/);
  assert.match(source, /<svg class="arcaia-turn-export-icon icon"/);
  assert.match(source, /width="20" height="20" viewBox="0 0 20 20"/);
  assert.match(source, /stroke="currentColor"/);
  assert.match(source, /stroke-linecap="round"/);
  assert.match(source, />M<|2\.05 2\.75/);
  assert.match(source, /polyline points="12\.2 13\.45 14\.2 15\.45 16\.2 13\.45"/);
  assert.doesNotMatch(source, /icons\/md_download\/icon32\.png|markdownDownloadIconUrl|-webkit-mask: url|mask: url/);
});

test('GPT-5.6 model selector rich UI resolves history Chat, new Chat, and Work independently', () => {
  assert.match(contentModelSelectorSource, /const PICKER_SELECTOR = '\[data-testid="composer-intelligence-picker-content"\]'/);
  assert.match(contentModelSelectorSource, /const COMPOSER_SELECTOR = 'form\[data-type="unified-composer"\]'/);
  assert.match(contentModelSelectorSource, /const MODEL_VERSION_PATTERN = \/\\bGPT/);
  assert.match(contentModelSelectorSource, /return match \? 'GPT-5\.6' : null/);
  assert.match(contentModelSelectorSource, /const CHATGPT_LAST_MODEL_COOKIE = 'oai-last-model-config'/);
  assert.match(contentModelSelectorSource, /const WORK_MODEL_SETTINGS_STORAGE_KEY = 'oai\/apps\/tpp\/model-settings'/);
  assert.match(contentModelSelectorSource, /const WORK_THINKING_EFFORT_STORAGE_KEY = 'oai\/apps\/tpp\/thinking-effort'/);
  assert.match(contentModelSelectorSource, /function readNewChatCurrentState\(\)/);
  assert.match(contentModelSelectorSource, /function readWorkCurrentState\(\)/);
  assert.match(contentModelSelectorSource, /function resolveCurrentContextState\(\)/);
  assert.ok(contentModelSelectorSource.includes("match(/\\/c\\/([^/?#]+)/i)"));
  assert.match(contentModelSelectorSource, /'work_local_storage_current'/);
  assert.match(contentModelSelectorSource, /'new_chat_cookie_last_model_config'/);
  assert.doesNotMatch(contentModelSelectorSource, /oai\/apps\/tpp\/last-started-model-config/);
  assert.match(contentModelSelectorSource, /function applyConversationModelConfig\(config, reason = 'conversation_detail'\)/);
  assert.match(contentModelSelectorSource, /config\?\.source \|\| 'conversation_detail_current_branch'/);
  assert.match(contentModelSelectorSource, /function resetForNavigation\(\{ reason = 'navigation' \} = \{\}\)/);
  assert.match(contentModelSelectorSource, /applyConversationModelConfig,/);
  assert.match(contentModelSelectorSource, /resetForNavigation/);
  assert.match(contentModelSelectorSource, /function getLightweightStatus\(\)/);
  assert.match(contentModelSelectorSource, /activeSurfaceMode: getActiveSurfaceMode\(\)/);
  assert.doesNotMatch(contentModelSelectorSource, /getDiagnosticSnapshot/);
  assert.match(contentModelSelectorSource, /function looksLikeExpectedModelTrigger\(button, expectedModelVersion = ''\)/);
  assert.match(contentModelSelectorSource, /looksLikeExpectedModelTrigger\(button, currentState\?\.modelVersion \|\| ''\)/);
  assert.match(contentModelSelectorSource, /lastConversationConfig/);
  assert.match(contentModelSelectorSource, /lastNavigationReset/);
  assert.match(contentModelSelectorSource, /lastScanResult/);
  assert.doesNotMatch(contentModelSelectorSource, /SESSION_STATE_KEY|arcaia\.modelSelectorRich\.v1/);
  assert.doesNotMatch(contentModelSelectorSource, /window\.sessionStorage\?\.setItem|window\.sessionStorage\?\.removeItem/);
  assert.match(contentModelSelectorSource, /'軽', '最速', '中程度', '高い', '非常に高い', '最大'/);
  assert.match(contentModelSelectorSource, /min: Object\.freeze\(\{ ja: '軽', en: 'Light' \}\)/);
  assert.match(contentModelSelectorSource, /xhigh: Object\.freeze\(\{ ja: '非常に高い', en: 'Very high' \}\)/);
  assert.match(contentModelSelectorSource, /max: Object\.freeze\(\{ ja: '最大', en: 'Maximum' \}\)/);
  assert.match(contentModelSelectorSource, /function normalizeGpt56ModelSlug\(modelSlug\)/);
  assert.match(contentModelSelectorSource, /modelSuffix = 'Sol'/);
  assert.match(contentModelSelectorSource, /performance_picker_with_current_state/);
  assert.match(contentModelSelectorSource, /width: auto !important/);
  assert.match(contentModelSelectorSource, /max-width: none !important/);
  assert.doesNotMatch(contentModelSelectorSource, /`memory:\$\{reason\}`/);
  assert.match(contentModelSelectorSource, /resolved_state_applied/);
  assert.match(contentModelSelectorSource, /menu\?\.getAttribute\?\.\('aria-labelledby'\)/);
  assert.match(contentModelSelectorSource, /document\.getElementById\(labelledBy\)/);
  assert.match(contentModelSelectorSource, /data-arcaia-model-rich/);
  assert.match(contentModelSelectorSource, /arcaia-model-sparkle/);
  assert.match(contentModelSelectorSource, /arcaia-model-version/);
  assert.match(contentModelSelectorSource, /arcaia-model-performance/);
  assert.match(contentModelSelectorSource, /data-arcaia-model-original-aria-label/);
  assert.match(contentModelSelectorSource, /trigger\.setAttribute\('aria-label', titleParts\.join\('、'\)\)/);
  assert.match(contentModelSelectorSource, /transform: none !important/);
  assert.match(contentModelSelectorSource, /button\[\$\{RICH_ATTR\}=\"true\"\]:focus-visible/);
  assert.doesNotMatch(contentModelSelectorSource, /translateY\(-1px\)/);
  assert.doesNotMatch(contentModelSelectorSource, /transition:[^;]*transform/);
  assert.match(contentModelSelectorSource, /if \(state\.modelVersion !== 'GPT-5\.6'\)/);
  assert.doesNotMatch(contentModelSelectorSource, /rootObserver|handleRootMutations|documentElement[\s\S]{0,120}subtree: true/);
  assert.match(contentModelSelectorSource, /composerObserver = new MutationObserver\(handleComposerMutations\)/);
  assert.match(contentModelSelectorSource, /composerObserver\.observe\(nextComposer, \{ childList: true, subtree: true \}\)/);
  assert.match(contentModelSelectorSource, /composerParentObserver\.observe\(nextParent, \{ childList: true \}\)/);
  assert.match(contentModelSelectorSource, /surfaceModeObserver = new MutationObserver\(handleSurfaceModeMutations\)/);
  assert.match(contentModelSelectorSource, /surface_state_changed/);
  assert.match(contentModelSelectorSource, /attributeFilter: \['data-state', 'aria-checked', 'aria-selected'\]/);
  assert.match(contentModelSelectorSource, /attributeFilter: \['aria-checked', 'aria-expanded', 'data-state'\]/);
  assert.match(contentModelSelectorSource, /pickerObserver = new MutationObserver\(handlePickerMutations\)/);
  assert.match(contentModelSelectorSource, /function handlePickerMutations\(mutations\)/);
  assert.match(contentModelSelectorSource, /picker_confirmed_selection/);
  assert.match(contentModelSelectorSource, /const THINKING_SLIDER_HOST_SELECTOR = '\[data-testid="composer-model-picker-slider-simple-view"\]'/);
  assert.match(contentModelSelectorSource, /function observeThinkingSlider\(picker\)/);
  assert.match(contentModelSelectorSource, /thinkingSliderObserver\.observe\(slider, \{/);
  assert.match(contentModelSelectorSource, /attributeFilter: \['aria-valuenow'\]/);
  assert.match(contentModelSelectorSource, /function handleThinkingSliderMutations\(mutations\)/);
  assert.match(contentModelSelectorSource, /mutation\.target === observedThinkingSlider/);
  assert.match(contentModelSelectorSource, /nextThinkingEffort !== observedWorkThinkingEffort/);
  assert.match(contentModelSelectorSource, /work_thinking_effort_pending/);
  assert.match(contentModelSelectorSource, /function observeTriggerState\(trigger\)/);
  assert.match(contentModelSelectorSource, /attributeFilter: \['aria-expanded', 'data-state'\]/);
  assert.match(contentModelSelectorSource, /function commitPendingWorkThinkingState\(reason = 'work_thinking_effort_focusout_confirmed'\)/);
  assert.match(contentModelSelectorSource, /composer_work_selection_confirmed/);
  assert.match(contentModelSelectorSource, /document\.addEventListener\('click', handleDocumentClick, true\)/);
  assert.doesNotMatch(contentModelSelectorSource, /menu\.itemSelect|handleMenuItemSelect|menu_item_select/);
  assert.match(contentModelSelectorSource, /const BARE_MODEL_VERSION_PATTERN = \/\\b\(\\d\+\\\.\\d\+\)\\b\//);
  assert.match(contentModelSelectorSource, /function extractExplicitModelVersion\(value\)/);
  assert.match(contentModelSelectorSource, /const explicitPerformanceModelVersion = extractExplicitModelVersion\(checkedText\)/);
  assert.match(contentModelSelectorSource, /const modelVersion = explicitPerformanceModelVersion \|\| candidateModelVersion/);
  assert.match(contentModelSelectorSource, /const modelSource = explicitPerformanceModelVersion/);
  assert.match(contentModelSelectorSource, /'performance_picker_with_current_state'/);
  assert.doesNotMatch(contentModelSelectorSource, /applySelectedMenuItem|buildPerformanceSelectionState|rememberTransientSelection/);
  assert.doesNotMatch(contentModelSelectorSource, /selectionInFlight|pendingClickFallback|transientSelection/);
  assert.doesNotMatch(contentModelSelectorSource, /click_fallback|selection_in_flight|queueMicrotask/);
  assert.doesNotMatch(contentModelSelectorSource, /expiresAt: Date\.now\(\) \+ 900/);
  assert.doesNotMatch(contentModelSelectorSource, /for \(const delay of \[0, 60, 180, 400\]\)/);
  assert.doesNotMatch(contentModelSelectorSource, /picker_disconnected/);
  assert.match(contentModelSelectorSource, /confirmedSelectionChanged/);
  assert.match(contentModelSelectorSource, /mutation\.removedNodes/);
  assert.doesNotMatch(contentModelSelectorSource, /setInterval/);
  assert.match(source, /window\.__ARCAIA_MODEL_SELECTOR_UI__\?\.start\?\.\(\)/);
  assert.match(source, /window\.__ARCAIA_MODEL_SELECTOR_UI__\?\.cleanup\?\.\(reason\)/);
  assert.match(source, /mainEventType === 'current_conversation_model_config'/);
  assert.match(source, /window\.__ARCAIA_MODEL_SELECTOR_UI__\?\.applyConversationModelConfig\?\./);
  assert.match(source, /window\.__ARCAIA_MODEL_SELECTOR_UI__\?\.resetForNavigation\?\./);
  assert.match(source, /window\.__ARCAIA_MODEL_SELECTOR_UI__\?\.scan\?\.\('conversation_state_sync_complete'\)/);
  assert.match(source, /modelSelectorUiStatus/);
  assert.doesNotMatch(source, /model_selector_ui_snapshot_start|hasModelSelectorUiDiagnostic/);
  assert.match(injectedSource, /function buildCurrentConversationModelConfig\(raw, url = ''\)/);
  assert.match(injectedSource, /emitMainEvent\('current_conversation_model_config'/);
  assert.match(injectedSource, /observeCurrentConversationModelConfig\(raw, url, 'conversation_fetch_response'\)/);
});

test('work composer model-name trigger is accepted when performance label is not rendered', () => {
  const helperStart = contentModelSelectorSource.indexOf('  function normalizeText(value) {');
  const helperEnd = contentModelSelectorSource.indexOf('  function normalizeModelVersion(value) {', helperStart);
  const explicitStart = contentModelSelectorSource.indexOf('  function extractExplicitModelVersion(value) {');
  const explicitEnd = contentModelSelectorSource.indexOf('  function extractModelSuffix(modelLabel) {', explicitStart);
  const triggerStart = contentModelSelectorSource.indexOf('  function looksLikeExpectedModelTrigger(button, expectedModelVersion = \'\') {');
  const triggerEnd = contentModelSelectorSource.indexOf('  function findFallbackTrigger(expectedPerformance = \'\') {', triggerStart);
  assert.ok(helperStart > -1 && helperEnd > helperStart);
  assert.ok(explicitStart > -1 && explicitEnd > explicitStart);
  assert.ok(triggerStart > -1 && triggerEnd > triggerStart);
  class FakeButton {
    constructor(text) {
      this.textContent = text;
      this.attrs = new Map([['aria-haspopup', 'menu']]);
    }
    getAttribute(name) { return this.attrs.get(name) || null; }
  }
  const sandbox = {
    HTMLButtonElement: FakeButton,
    ANY_MODEL_PATTERN: /\bGPT[-\u2011\u2013\s]?\d+(?:\.\d+)?\b/i,
    BARE_MODEL_VERSION_PATTERN: /\b(\d+\.\d+)\b/
  };
  vm.runInNewContext(`
    ${contentModelSelectorSource.slice(helperStart, helperEnd)}
    ${contentModelSelectorSource.slice(explicitStart, explicitEnd)}
    ${contentModelSelectorSource.slice(triggerStart, triggerEnd)}
    this.looksLikeExpectedModelTrigger = looksLikeExpectedModelTrigger;
  `, sandbox);
  assert.equal(sandbox.looksLikeExpectedModelTrigger(new FakeButton('GPT-5.6 Sol'), 'GPT-5.6'), true);
  assert.equal(sandbox.looksLikeExpectedModelTrigger(new FakeButton('非常に高い'), 'GPT-5.6'), false);
  assert.equal(sandbox.looksLikeExpectedModelTrigger(new FakeButton('GPT-5.5'), 'GPT-5.6'), false);
});

test('current conversation model config follows current_node branch instead of last-started or another branch', () => {
  const helperStart = injectedSource.indexOf('  function findRootNode(raw) {');
  const helperEnd = injectedSource.indexOf('  function isVisuallyHiddenMessage(message) {', helperStart);
  const configStart = injectedSource.indexOf('  function buildCurrentConversationModelConfig(raw, url = \'\') {');
  const configEnd = injectedSource.indexOf('  function observeCurrentConversationModelConfig', configStart);
  assert.ok(helperStart > -1 && helperEnd > helperStart);
  assert.ok(configStart > -1 && configEnd > configStart);
  const sandbox = { Date };
  vm.runInNewContext(`
    function extractConversationIdFromConversationDetailUrl() { return null; }
    ${injectedSource.slice(helperStart, helperEnd)}
    ${injectedSource.slice(configStart, configEnd)}
    this.buildCurrentConversationModelConfig = buildCurrentConversationModelConfig;
  `, sandbox);
  const config = sandbox.buildCurrentConversationModelConfig({
    conversation_id: 'conversation-current',
    current_node: 'assistant-current',
    mapping: {
      root: { id: 'root', parent: null, children: ['user-old', 'user-current'], message: null },
      'user-old': {
        id: 'user-old',
        parent: 'root',
        children: ['assistant-old'],
        message: { metadata: { model_slug: 'gpt-5-6-thinking', thinking_effort: 'xhigh' } }
      },
      'assistant-old': {
        id: 'assistant-old',
        parent: 'user-old',
        children: [],
        message: { metadata: { model_slug: 'gpt-5-6-thinking', thinking_effort: 'xhigh' } }
      },
      'user-current': {
        id: 'user-current',
        parent: 'root',
        children: ['assistant-current'],
        message: { metadata: { model_slug: 'gpt-5-6-thinking', thinking_effort: 'extended' } }
      },
      'assistant-current': {
        id: 'assistant-current',
        parent: 'user-current',
        children: [],
        message: { metadata: { resolved_model_slug: 'gpt-5-6-thinking' } }
      }
    }
  });
  assert.equal(config.conversationId, 'conversation-current');
  assert.equal(config.modelSlug, 'gpt-5-6-thinking');
  assert.equal(config.thinkingEffort, 'extended');
  assert.equal(config.source, 'conversation_detail_current_branch');
  assert.equal(config.selectedMessageDistanceFromLeaf, 1);
  assert.equal(config.currentNodeUsed, true);
});

test('model selector resolves source-specific Chat and Work state without stale last-started fallback', () => {
  const start = contentModelSelectorSource.indexOf("  const API_KEY = '__ARCAIA_MODEL_SELECTOR_UI__';");
  const end = contentModelSelectorSource.indexOf('  function injectStyle() {', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const setupSource = contentModelSelectorSource.slice(start, end);
  const storage = new Map([
    ['oai/apps/tpp/chat-surface-mode', JSON.stringify('chatgpt')],
    ['oai/apps/tpp/model-settings', JSON.stringify({ lastUsedModelSlug: 'gpt-5.6-terra-wm' })],
    ['oai/apps/tpp/thinking-effort', JSON.stringify('extended')],
    ['oai/apps/tpp/last-started-model-config', JSON.stringify({ modelSlug: 'gpt-5.6-sol-wm', thinkingEffort: 'xhigh' })]
  ]);
  let cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-6-thinking', effort: 'standard' }))}`;
  const sandbox = {
    window: {
      location: { pathname: '/' },
      localStorage: {
        getItem(key) { return storage.has(key) ? storage.get(key) : null; }
      },
      addEventListener() {},
      removeEventListener() {}
    },
    document: {
      documentElement: { lang: 'ja' },
      get cookie() { return cookie; },
      querySelectorAll() { return []; }
    },
    navigator: { language: 'ja-JP' },
    Date,
    decodeURIComponent,
    encodeURIComponent
  };
  vm.runInNewContext(`
    (() => {
      ${setupSource}
      globalThis.modelSelectorTestApi = {
        readNewChatCurrentState,
        readWorkCurrentState,
        resolveCurrentContextState,
        getPerformanceLabelForEffort,
        getEffortForPerformanceLabel,
        normalizeGpt56ModelSlug
      };
    })();
  `, sandbox);

  const chatState = JSON.parse(JSON.stringify(sandbox.modelSelectorTestApi.resolveCurrentContextState().state));
  assert.deepEqual(chatState, {
    modelVersion: 'GPT-5.6',
    modelSuffix: 'Sol',
    modelLabel: 'GPT-5.6 Sol',
    performance: '中程度',
    thinkingEffort: 'standard',
    observedAt: chatState.observedAt,
    candidateFound: true,
    modelSource: 'new_chat_cookie_last_model_config'
  });
  assert.equal(typeof chatState.observedAt, 'number');

  storage.set('oai/apps/tpp/chat-surface-mode', JSON.stringify('work'));
  const workState = JSON.parse(JSON.stringify(sandbox.modelSelectorTestApi.resolveCurrentContextState().state));
  assert.equal(workState.modelLabel, 'GPT-5.6 Terra');
  assert.equal(workState.performance, '高い');
  assert.equal(workState.thinkingEffort, 'extended');
  assert.equal(workState.modelSource, 'work_local_storage_current');

  const levels = [
    ['min', '軽'],
    ['standard', '中程度'],
    ['extended', '高い'],
    ['xhigh', '非常に高い'],
    ['max', '最大']
  ];
  for (const [effort, label] of levels) {
    assert.equal(sandbox.modelSelectorTestApi.getPerformanceLabelForEffort(effort), label);
    assert.equal(sandbox.modelSelectorTestApi.getEffortForPerformanceLabel(label), effort);
  }

  cookie = `oai-last-model-config=${encodeURIComponent(JSON.stringify({ model: 'gpt-5-5', effort: 'extended' }))}`;
  assert.equal(sandbox.modelSelectorTestApi.readNewChatCurrentState(), null);
  assert.equal(sandbox.modelSelectorTestApi.normalizeGpt56ModelSlug('gpt-5-6-thinking').modelSuffix, 'Sol');
  assert.equal(sandbox.modelSelectorTestApi.normalizeGpt56ModelSlug('gpt_5_6_terra_wm').modelSuffix, 'Terra');
  assert.doesNotMatch(setupSource, /sessionStorage|arcaia\.modelSelectorRich|oai\/apps\/tpp\/last-started-model-config/);
});





test('popup auto-injects split content scripts in dependency order', () => {
  assert.match(popupSource, /const CONTENT_SCRIPT_FILES = \[[\s\S]*?'content_toolbar\.js'[\s\S]*?'content_diagnostics\.js'[\s\S]*?'content_markdown\.js'[\s\S]*?'content_filename\.js'[\s\S]*?'content_model_selector\.js'[\s\S]*?'content\.js'[\s\S]*?\]/);
  assert.doesNotMatch(popupSource, /content_zip\.js/);
  assert.match(popupSource, /chrome\.scripting\.executeScript\(\{ target: \{ tabId \}, files: CONTENT_SCRIPT_FILES \}\)/);
  assert.doesNotMatch(contentToolbarSourceFile, /\bAPP_VERSION\b/);
  assert.doesNotMatch(contentToolbarSourceFile, /\bdebugModeEnabled\b/);
  assert.match(contentDiagnosticsSource, /window\.ArcaiaContentDiagnostics = Object\.freeze/);
  assert.doesNotMatch(contentDiagnosticsSource, /\bAPP_VERSION\b/);
  assert.doesNotMatch(contentDiagnosticsSource, /\bdebugModeEnabled\b/);
  assert.doesNotMatch(contentDiagnosticsSource, /chrome\.storage/);
  assert.match(contentMarkdownSource, /window\.ArcaiaContentMarkdown = Object\.freeze/);
  assert.doesNotMatch(contentMarkdownSource, /APP_VERSION|chrome\.|document\.|fetch\s*\(/);
  assert.match(contentFilenameSource, /window\.ArcaiaContentFilename = Object\.freeze/);
  assert.doesNotMatch(contentFilenameSource, /APP_VERSION|chrome\.|document\.|fetch\s*\(/);
});

test('content message dispatcher supports synchronous status handlers', () => {
  const listenerStart = source.indexOf('  chrome.runtime.onMessage.addListener');
  const listenerEnd = source.indexOf('\n  });\n})();', listenerStart);
  const listenerSource = source.slice(listenerStart, listenerEnd);
  assert.match(listenerSource, /Promise\.resolve\(\)\s*\.then\(\(\) => handler\(\)\)/);
  assert.doesNotMatch(listenerSource, /\n\s*handler\(\)\s*\.then/);
});

test('content toolbar popup wrappers stay inside the content IIFE scope', () => {
  const depsIndex = source.indexOf('  function getToolbarOperationDeps() {');
  const listenerIndex = source.indexOf('  chrome.runtime.onMessage.addListener', depsIndex);
  const closeIndex = source.lastIndexOf('\n})();');
  assert.ok(depsIndex > -1);
  assert.ok(listenerIndex > depsIndex);
  assert.ok(closeIndex > listenerIndex);
  assert.equal(source.indexOf('  function getToolbarOperationDeps() {', closeIndex), -1);
  assert.match(source.slice(depsIndex, listenerIndex), /appVersion: APP_VERSION/);
});

test('content toolbar helper is split into content_toolbar.js and loaded before content.js', () => {
  const scripts = manifest.content_scripts[0].js;
  assert.equal(scripts.includes('content_zip.js'), false);
  assert.ok(scripts.includes('content_toolbar.js'));
  assert.ok(scripts.includes('content_diagnostics.js'));
  assert.ok(scripts.includes('content_markdown.js'));
  assert.ok(scripts.includes('content_filename.js'));
  assert.ok(scripts.includes('content_model_selector.js'));
  assert.ok(scripts.indexOf('content_toolbar.js') < scripts.indexOf('content_diagnostics.js'));
  assert.ok(scripts.indexOf('content_diagnostics.js') < scripts.indexOf('content_markdown.js'));
  assert.ok(scripts.indexOf('content_markdown.js') < scripts.indexOf('content_filename.js'));
  assert.ok(scripts.indexOf('content_filename.js') < scripts.indexOf('content_model_selector.js'));
  assert.ok(scripts.indexOf('content_model_selector.js') < scripts.indexOf('content.js'));
  assert.match(contentToolbarSourceFile, /window\.ArcaiaContentToolbar = Object\.freeze/);
  assert.match(contentToolbarSourceFile, /function startToolbarPageJob\(deps\)/);
  assert.match(contentToolbarSourceFile, /function startToolbarMarkdownSaveFromPopup\(deps\)/);
  assert.doesNotMatch(contentToolbarSourceFile, /startToolbarDiagnosticZipFromPopup|diagnostic_zip|appendStoredDebugEvent|isDebugModeEnabled/);
  assert.match(contentToolbarSourceFile, /REQUIRED_TOOLBAR_DEPS/);
  assert.match(source, /function getToolbarOperationDeps\(\)/);
  assert.match(source, /window\.ArcaiaContentToolbar/);
  assert.doesNotMatch(source, /function showToolbarOperationModal\(title, detail/);
  assert.doesNotMatch(source, /function startToolbarPageJob\(deps\)/);
});

test('content diagnostics helper is split into content_diagnostics.js and loaded before content.js', () => {
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('content_diagnostics.js'));
  assert.ok(scripts.indexOf('content_diagnostics.js') < scripts.indexOf('content.js'));
  assert.match(contentDiagnosticsSource, /function simpleDiagnosticHash\(text\)/);
  assert.match(contentDiagnosticsSource, /function normalizeRectForDiagnostics\(rect\)/);
  assert.match(source, /function simpleDiagnosticHash\(text\) \{[\s\S]*return getContentDiagnostics\(\)\.simpleDiagnosticHash\(text\);[\s\S]*\}/);
  assert.match(source, /return getContentDiagnostics\(\)\.normalizeRectForDiagnostics\(rect\)/);
  assert.doesNotMatch(source, /let hash = 2166136261/);
  const rectStart = source.indexOf('  function getElementRectForDiagnostics(el) {');
  const rectEnd = source.indexOf('  function getElementVisibilityDiagnostics(el)', rectStart);
  assert.doesNotMatch(source.slice(rectStart, rectEnd), /top: Math\.round\(r\.top\)/);
  assert.doesNotMatch(contentDiagnosticsSource, /APP_VERSION|debugModeEnabled|chrome\.runtime|chrome\.storage/);
});

test('generic diagnostic ZIP helper is removed from the extension runtime', () => {
  assert.equal(manifest.content_scripts[0].js.includes('content_zip.js'), false);
  assert.doesNotMatch(popupSource, /content_zip\.js|diagnosticZip/);
  assert.doesNotMatch(contentToolbarSourceFile, /diagnostic_zip|DiagnosticZip|createToolbarZipBlob/);
});


test('content_markdown helper is split and remains pure/dependency-light', () => {
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('content_markdown.js'));
  assert.ok(scripts.indexOf('content_diagnostics.js') < scripts.indexOf('content_markdown.js'));
  assert.ok(scripts.indexOf('content_markdown.js') < scripts.indexOf('content_filename.js'));
  assert.ok(scripts.indexOf('content_filename.js') < scripts.indexOf('content.js'));
  assert.match(contentMarkdownSource, /window\.ArcaiaContentMarkdown = Object\.freeze/);
  assert.match(contentMarkdownSource, /function sanitizeMarkdownText\(text\)/);
  assert.match(contentMarkdownSource, /function buildNonTextMarkdownBody\(msg, roleLabel\)/);
  assert.match(contentMarkdownSource, /function renderMarkdownMessageBody\(msg, roleLabel\)/);
  assert.match(contentMarkdownSource, /function pickMarkdownUserMessages\(turn\)/);
  assert.match(contentMarkdownSource, /function pickFinalAssistantMessageForMarkdown\(turn\)/);
  assert.match(contentMarkdownSource, /function buildMarkdownHeaderLines\(\{ title, url, conversationId, exportMode, appVersion, generatedAt \} = \{\}\)/);
  assert.match(contentMarkdownSource, /function buildMarkdownTurnHeading\(turnIndex, totalTurnCount\)/);
  assert.match(contentMarkdownSource, /function buildMarkdownRoleHeading\(roleLabel, index = 0, total = 1\)/);
  assert.match(contentMarkdownSource, /function buildMarkdownMessageMetadataLines\(msg, roleLabel\)/);
  assert.match(contentMarkdownSource, /- Sent at: \$\{sentAt \|\| 'unknown'\}/);
  assert.match(contentMarkdownSource, /role === 'assistant'[\s\S]*msg\.update_time_iso \|\| msg\.create_time_iso/);
  assert.match(contentMarkdownSource, /msg\.create_time_iso \|\| msg\.update_time_iso/);
  assert.doesNotMatch(contentMarkdownSource, /APP_VERSION|chrome\.|document\.|fetch\s*\(/);

  const wrapperStart = source.indexOf('  function getContentMarkdown() {');
  const wrapperEnd = source.indexOf('  function buildMarkdownDraft(', wrapperStart);
  const wrapperSource = source.slice(wrapperStart, wrapperEnd);
  assert.match(wrapperSource, /window\.ArcaiaContentMarkdown/);
  assert.match(wrapperSource, /return getContentMarkdown\(\)\.sanitizeMarkdownText\(text\);/);
  assert.match(wrapperSource, /return getContentMarkdown\(\)\.buildMarkdownHeaderLines\(options\);/);
  assert.match(wrapperSource, /return getContentMarkdown\(\)\.buildMarkdownTurnHeading\(turnIndex, totalTurnCount\);/);
  assert.match(wrapperSource, /return getContentMarkdown\(\)\.buildMarkdownRoleHeading\(roleLabel, index, total\);/);
  assert.match(wrapperSource, /return getContentMarkdown\(\)\.buildMarkdownMessageMetadataLines\(msg, roleLabel\);/);
  assert.doesNotMatch(wrapperSource, /const IMAGE_OUTPUT_PLACEHOLDER_TEXT = \[/);

  const draftStart = source.indexOf('  function buildMarkdownDraft(');
  const draftEnd = source.indexOf('  function makeSafeFileName', draftStart);
  const draftSource = source.slice(draftStart, draftEnd);
  assert.match(draftSource, /APP_VERSION/);
  assert.match(draftSource, /nowIso\(\)/);
});

test('small Markdown draft formatter extraction passes version/time values as arguments', () => {
  const draftStart = source.indexOf('  function buildMarkdownDraft(');
  const singleStart = source.indexOf('  function buildSingleTurnMarkdownDraft(');
  const filenameStart = source.indexOf('  function makeSafeFileName', singleStart);
  const draftSource = source.slice(draftStart, filenameStart);
  assert.match(draftSource, /buildMarkdownHeaderLines\(\{/);
  assert.match(draftSource, /appVersion: APP_VERSION/);
  assert.match(draftSource, /generatedAt: nowIso\(\)/);
  assert.match(draftSource, /buildMarkdownTurnHeading\(turn\.turnIndex, totalTurnCount\)/);
  assert.match(draftSource, /buildMarkdownTurnHeading\(turn\.turnIndex, safeTotal\)/);
  assert.match(draftSource, /buildMarkdownRoleHeading\('User', i, turn\.userMessages\.length\)/);
  assert.match(draftSource, /buildMarkdownMessageMetadataLines\(msg, 'user'\)/);
  assert.match(draftSource, /buildMarkdownMessageMetadataLines\(assistantMessage, 'assistant'\)/);
  assert.doesNotMatch(contentMarkdownSource, /APP_VERSION|nowIso\(\)/);
});

test('content_filename helper is split and keeps filename/date logic dependency-light', () => {
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('content_filename.js'));
  assert.ok(scripts.indexOf('content_markdown.js') < scripts.indexOf('content_filename.js'));
  assert.ok(scripts.indexOf('content_filename.js') < scripts.indexOf('content.js'));
  assert.match(contentFilenameSource, /window\.ArcaiaContentFilename = Object\.freeze/);
  assert.match(contentFilenameSource, /function makeSafeFileName\(input\)/);
  assert.match(contentFilenameSource, /function formatDateTimeForFile\(inputDate, normalizeDate\)/);
  assert.match(contentFilenameSource, /function pickLatestAssistantDateFromTurn\(turn\)/);
  assert.match(contentFilenameSource, /function pickLatestAssistantDateFromResult\(result\)/);
  assert.match(contentFilenameSource, /function makeBaseExportName\(result, normalizeDate\)/);
  assert.match(contentFilenameSource, /function makeSingleTurnExportName\(result, turn, normalizeDate\)/);
  assert.match(contentFilenameSource, /function formatTurnNumberForFile\(turn, result\)/);
  assert.match(contentFilenameSource, /return `\$\{date\}_\$\{title\}_\$\{formatTurnNumberForFile\(turn, result\)\}`/);
  assert.match(contentFilenameSource, /turn_\$\{current\}-of-\$\{String\(total\)\.padStart\(width, '0'\)\}/);
  assert.doesNotMatch(contentFilenameSource, /APP_VERSION|chrome\.|document\.|fetch\s*\(|URL\.createObjectURL/);

  const filenameStart = source.indexOf('  function getContentFilename() {');
  const filenameEnd = source.indexOf('  function downloadBlob(filename, blob) {', filenameStart);
  const filenameWrapperSource = source.slice(filenameStart, filenameEnd);
  assert.match(filenameWrapperSource, /window\.ArcaiaContentFilename/);
  assert.match(filenameWrapperSource, /formatDateTimeForFile\(inputDate, normalizeTimestampToDate\)/);
  assert.match(filenameWrapperSource, /makeBaseExportName\(result, normalizeTimestampToDate\)/);
  assert.match(filenameWrapperSource, /makeSingleTurnExportName\(result, turn, normalizeTimestampToDate\)/);
  assert.doesNotMatch(filenameWrapperSource, /replace\(\/\[\\\/:\*\?"<>\|\]/);
});

test('Markdown draft metadata boundary remains content-side before formatter extraction', () => {
  const draftStart = source.indexOf('  function buildMarkdownDraft(');
  const singleStart = source.indexOf('  function buildSingleTurnMarkdownDraft(');
  const filenameStart = source.indexOf('  function makeSafeFileName', singleStart);
  const draftSource = source.slice(draftStart, filenameStart);
  assert.match(draftSource, /APP_VERSION/);
  assert.match(draftSource, /nowIso\(\)/);
  assert.match(draftSource, /exportMode: 'turn_final_assistant_candidate_only'/);
  assert.match(draftSource, /exportMode: 'single_turn'/);
  assert.doesNotMatch(contentMarkdownSource, /APP_VERSION|nowIso\(\)|buildMarkdownDraft|buildSingleTurnMarkdownDraft/);
});

test('Markdown export boundary keeps data extraction in content and UI orchestration in toolbar helper', () => {
  const exportStart = source.indexOf('  function sanitizeMarkdownText(text) {');
  const exportEnd = source.indexOf('  function collectModelSlugsFromRaw', exportStart);
  const exportSource = source.slice(exportStart, exportEnd);
  assert.match(exportSource, /function buildMarkdownDraft\(title, url, conversationId, turns\)/);
  assert.match(exportSource, /function buildSingleTurnMarkdownDraft\(title, url, conversationId, turn, totalTurnCount\)/);
  assert.match(exportSource, /function makeBaseExportName\(result\)/);
  assert.match(exportSource, /function downloadText\(filename, text, mimeType = 'text\/plain;charset=utf-8'\)/);
  assert.match(source, /async function extractChatGPTInternal\(includeRaw = false\)/);

  const toolbarStart = contentToolbarSourceFile.indexOf('  async function runToolbarMarkdownSave(');
  const toolbarEnd = contentToolbarSourceFile.indexOf('  async function runToolbarDiagnosticZipSave', toolbarStart);
  const toolbarSource = contentToolbarSourceFile.slice(toolbarStart, toolbarEnd);
  assert.match(toolbarSource, /deps\.extractChatGPTInternal\(false\)/);
  assert.match(toolbarSource, /result\?\.exportPlan\?\.markdownDraft/);
  assert.match(toolbarSource, /deps\.makeBaseExportName\(result\)/);
  assert.match(toolbarSource, /deps\.downloadText\(filename, markdown, 'text\/markdown;charset=utf-8'\)/);
  assert.doesNotMatch(contentToolbarSourceFile, /function buildMarkdownDraft\(/);
  assert.doesNotMatch(contentToolbarSourceFile, /function extractChatGPTInternal\(/);
});

test.skip('legacy diagnostic ZIP popup flow was removed in v0.1.257', () => {
  const popupStart = popupSource.indexOf('  async function startPageToolbarOperationAndClose(');
  const popupEnd = popupSource.indexOf('  async function saveMarkdownFromCurrentChat', popupStart);
  const popupToolbarSource = popupSource.slice(popupStart, popupEnd);
  assert.match(popupToolbarSource, /sendMessageWithAutoInject\(tab\.id, \{/);
  assert.match(popupToolbarSource, /setTimeout\(\(\) => \{ try \{ window\.close\(\); \} catch \{\} \}, 40\)/);
  assert.match(popupSource, /startPageToolbarOperationAndClose\('AICE_TOOLBAR_SAVE_MARKDOWN', 'Markdown保存'\)/);
  assert.match(popupSource, /startPageToolbarOperationAndClose\('AICE_TOOLBAR_SAVE_DIAGNOSTIC_ZIP', '診断ZIP保存'\)/);

  const contentToolbarSource = contentToolbarSourceFile;
  assert.match(contentToolbarSource, /showToolbarOperationModal\('Arcaia', 'Markdown/);
  assert.match(contentToolbarSource, /showToolbarOperationModal\('Arcaia', '診断ZIP/);
  assert.match(contentToolbarSource, /deps\.downloadText\(filename, markdown/);
  assert.match(contentToolbarSource, /deps\.createToolbarZipBlob\(makeFiles\(\), new Date\(exportedAt\)\)/);
  assert.match(contentToolbarSource, /debugModePolicy: 'manual_only'/);
  assert.match(contentToolbarSource, /debugModeEnabledAfterZip: Boolean\(deps\.isDebugModeEnabled\(\)\)/);
  assert.doesNotMatch(contentToolbarSource, /setContentDebugMode\((true|false)/);
  assert.doesNotMatch(contentToolbarSource, /autoOff/);
  assert.match(source, /AICE_TOOLBAR_SAVE_MARKDOWN: async \(\) => startToolbarMarkdownSaveFromPopup\(\)/);
  assert.match(source, /AICE_TOOLBAR_SAVE_DIAGNOSTIC_ZIP: async \(\) => startToolbarDiagnosticZipFromPopup\(\)/);
});

test('turn export buttons anchor to copy toolbar leading side and avoid polling', () => {
  const start = source.indexOf('  const TURN_EXPORT_BUTTON_ATTR');
  const end = source.indexOf('  function startArcaiaPageUi', start);
  const turnExportSource = source.slice(start, end);
  assert.match(turnExportSource, /const TURN_EXPORT_TOOLBAR_ATTR = 'data-arcaia-turn-export-toolbar'/);
  assert.match(turnExportSource, /const TURN_COPY_BUTTON_SELECTOR = 'button\[data-testid=\"copy-turn-action-button\"\]'/);
  assert.match(turnExportSource, /const ASSISTANT_COMPLETION_TURN_SELECTOR = 'section\[data-turn=\"assistant\"\]'/);
  assert.match(turnExportSource, /const CHATGPT_STREAM_ERROR_RETRY_BUTTON_SELECTOR = 'button\[data-testid=\"regenerate-thread-error-button\"\]'/);
  assert.match(turnExportSource, /const CHATGPT_STREAM_ERROR_BLOCK_SELECTOR = '\.text-token-text-error'/);
  assert.match(turnExportSource, /function isNativeBranchNavigationElement/);
  assert.doesNotMatch(turnExportSource, /function collectNativeBranchNavigationDiagnostics/);
  assert.match(turnExportSource, /function getTurnExportToolbarContainer/);
  assert.match(turnExportSource, /copyButton\?\.parentElement/);
  assert.match(turnExportSource, /if \(isNativeBranchNavigationElement\(container\)\) return null/);
  assert.match(turnExportSource, /if \(isNativeBranchNavigationElement\(node\)\) return false/);
  assert.match(turnExportSource, /container\.setAttribute\(TURN_EXPORT_TOOLBAR_ATTR, 'true'\)/);
  assert.match(turnExportSource, /container\.insertBefore\(button, container\.firstChild\)/);
  assert.match(turnExportSource, /text-token-text-secondary hover:bg-token-surface-hover rounded-lg/);
  assert.doesNotMatch(turnExportSource, /focus:bg-token-surface-hover|focus-visible:bg-token-surface-hover/);
  assert.doesNotMatch(turnExportSource, /data-arcaia-turn-export-focused|button\.addEventListener\('focusin'|button\.addEventListener\('focusout'/);
  assert.doesNotMatch(turnExportSource, /background-color: var\(--token-surface-hover|opacity: 0\.78|color-mix\(in srgb, currentColor 10%, transparent\)|margin-left: 2px|width: 28px|height: 28px|color: inherit/);
  assert.match(turnExportSource, /nodeContainsTurnCopyButton/);
  assert.match(turnExportSource, /getAddedTurnCopyButtonsFromMutations/);
  assert.match(turnExportSource, /function getLatestAssistantCompletionTurn\(\)/);
  assert.match(turnExportSource, /function isElementInsideLatestAssistantCompletionTurn\(element\)/);
  assert.match(turnExportSource, /function buildLatestAssistantCompletionSignal\(\)/);
  assert.match(turnExportSource, /function isConfirmedChatGPTStreamErrorRetryButton\(button\)/);
  assert.match(turnExportSource, /button\.closest\?\.\(CHATGPT_STREAM_ERROR_BLOCK_SELECTOR\)/);
  assert.match(turnExportSource, /function getAddedChatGPTStreamErrorRetryButtonsFromMutations\(mutations\)/);
  assert.match(turnExportSource, /markAssistantCompletedFromStreamErrorRetryButton\(retryButton\)/);
  assert.match(turnExportSource, /buildAssistantCompletionSignal\(button\)/);
  assert.doesNotMatch(turnExportSource, /markAssistantCompletedFromCopyButton/);
  assert.match(turnExportSource, /function handleTurnExportMutations\(mutations\)/);
  assert.match(turnExportSource, /installTurnExportButtons\(conversationDomObservedContentRoot, addedCopyButtons\)/);
  assert.match(turnExportSource, /scheduleApplyMessageTimestamps\('assistant_toolbar_ready'\)/);
  assert.doesNotMatch(turnExportSource, /\.click\(\)/);
  assert.match(turnExportSource, /installTurnExportInteractionTriggers/);
  assert.match(turnExportSource, /nextRoot\.addEventListener\('pointerover', turnExportInteractionHandler, true\)/);
  assert.match(turnExportSource, /nextRoot\.addEventListener\('focusin', turnExportInteractionHandler, true\)/);
  assert.match(turnExportSource, /turnExportInteractionRoot\.removeEventListener\('pointerover', turnExportInteractionHandler, true\)/);
  assert.match(turnExportSource, /turnExportInteractionRoot\.removeEventListener\('focusin', turnExportInteractionHandler, true\)/);
  assert.match(turnExportSource, /queueMicrotask\(\(\) => \{/);
  assert.doesNotMatch(turnExportSource, /scheduleInitialTurnExportScans|turnExportInitialScanTimers|turnExportStartupRetryTimer/);
  assert.doesNotMatch(turnExportSource, /setInterval/);
});

test('native branch navigation generic diagnostics are removed and toolbar logic stays observer-free', () => {
  assert.doesNotMatch(source, /function collectNativeBranchNavigationDiagnostics\(root = document\)/);
  const turnExportStart = source.indexOf('  const TURN_EXPORT_BUTTON_ATTR');
  const turnExportEnd = source.indexOf('  function startArcaiaPageUi', turnExportStart);
  const turnExportSource = source.slice(turnExportStart, turnExportEnd);
  assert.doesNotMatch(turnExportSource, /setInterval/);
});

test('normal Lite keeps short conversations as no-op without restoring the removed toolbar', () => {
  const start = source.indexOf('  async function applyRollingLiteDom(');
  const end = source.indexOf('  function getRollingLiteDelayMs', start);
  const liteSource = source.slice(start, end);
  assert.match(source, /function shouldNoopLiteForShortConversation/);
  assert.match(liteSource, /shouldNoopLiteForShortConversation\(plan, turnCount\)/);
  assert.match(liteSource, /below_lite_turn_threshold/);
  assert.match(liteSource, /short_conversation_noop/);
  assert.match(liteSource, /updateLiteBar\(lite, rollingLiteState\)/);
  assert.match(source, /function updateLiteBar\(lite, summary = \{\}\) \{[\s\S]*?document\.getElementById\(LITE_BAR_ID\)\?\.remove\?\.\(\)/);
  assert.match(liteSource, /enabled: true/);
});

test('Lite turn count is configurable and persisted between popup and content runtime', () => {
  assert.match(popupHtmlSource, /id="liteTurnCountSelect"/);
  assert.match(popupHtmlSource, /Recent Viewで保持する直近ターン数/);
  assert.match(popupSource, /const LITE_TURN_COUNT_STORAGE_KEY = 'arcaia_lite_turn_count_v1'/);
  assert.match(popupSource, /function normalizeLiteTurnCount\(value\)/);
  assert.match(popupSource, /controls\.liteTurnCountSelect\?\.addEventListener\('change'/);
  assert.match(popupSource, /const nextValue = controls\.liteTurnCountSelect\.value/);
  assert.match(popupSource, /liteTurnCount = normalizeLiteTurnCount\(nextValue\)/);
  assert.match(popupSource, /\[LITE_TURN_COUNT_STORAGE_KEY\]: payload\.liteTurnCount/);
  assert.match(source, /const LITE_TURN_COUNT_STORAGE_KEY = 'arcaia_lite_turn_count_v1'/);
  assert.match(source, /function getConfiguredLiteTurnCount\(\)/);
  assert.match(source, /function getEffectiveLiteTurnCount\(conversationId = tryExtractConversationIdFromUrl\(window\.location\.href\)\)/);
  assert.match(source, /previous\.liteTurnCount !== next\.liteTurnCount/);
  assert.match(source, /buildLiteGroupingPlan\(document, getEffectiveLiteTurnCount\(\), generationDetector\.generating\)/);
  assert.match(source, /const turnCount = normalizeLiteTurnCount\(message\?\.turnCount \?\? getConfiguredLiteTurnCount\(\)\)/);
  assert.match(injectedSource, /turnCountOverrideConversationId/);
  assert.match(injectedSource, /turnCountOverrideConversationId === currentConversationId/);
  assert.match(injectedSource, /RECENT_VIEW_EXPANDED_TURN_COUNT_MAX = 50/);
});

test('main-world Recent View override applies only to its target conversation', () => {
  const normalizeStart = injectedSource.indexOf('  function normalizeLiteDisplayConfig(');
  const normalizeEnd = injectedSource.indexOf('  function writeLiteDisplayConfigToStorage', normalizeStart);
  assert.ok(normalizeStart > -1 && normalizeEnd > normalizeStart);
  const sandbox = {
    Math,
    Number,
    String,
    Boolean,
    currentConversationId: 'conversation-a',
    APP_VERSION: '0.1.275',
    NATIVE_LITE_TURN_COUNT: 3,
    CONFIGURED_LITE_TURN_COUNT_MAX: 10,
    RECENT_VIEW_EXPANDED_TURN_COUNT_MAX: 50,
    BACKEND_REWRITE_DEFAULT_ENABLED: true,
    getArcaiaCaptureMode: () => ({ enabled: false }),
    extractConversationIdFromCurrentUrl() { return this.currentConversationId; },
    isHistorySearchNavigationUrl: () => false
  };
  vm.runInNewContext(`
    const APP_VERSION = this.APP_VERSION;
    const NATIVE_LITE_TURN_COUNT = this.NATIVE_LITE_TURN_COUNT;
    const CONFIGURED_LITE_TURN_COUNT_MAX = this.CONFIGURED_LITE_TURN_COUNT_MAX;
    const RECENT_VIEW_EXPANDED_TURN_COUNT_MAX = this.RECENT_VIEW_EXPANDED_TURN_COUNT_MAX;
    const BACKEND_REWRITE_DEFAULT_ENABLED = this.BACKEND_REWRITE_DEFAULT_ENABLED;
    const getArcaiaCaptureMode = this.getArcaiaCaptureMode;
    const extractConversationIdFromCurrentUrl = () => this.currentConversationId;
    const isHistorySearchNavigationUrl = this.isHistorySearchNavigationUrl;
    ${injectedSource.slice(normalizeStart, normalizeEnd)}
    this.normalizeLiteDisplayConfig = normalizeLiteDisplayConfig;
  `, sandbox);

  const baseConfig = sandbox.normalizeLiteDisplayConfig({ turnCount: 3, turnCountOverride: null });
  assert.equal(baseConfig.turnCount, 3);
  assert.equal(baseConfig.turnCountOverride, null);

  const expandedConfig = sandbox.normalizeLiteDisplayConfig({
    turnCount: 3,
    turnCountOverride: 13,
    turnCountOverrideConversationId: 'conversation-a'
  });
  assert.equal(expandedConfig.baseTurnCount, 3);
  assert.equal(expandedConfig.turnCount, 13);
  assert.equal(expandedConfig.turnCountOverride, 13);

  sandbox.currentConversationId = 'conversation-b';
  const otherConversationConfig = sandbox.normalizeLiteDisplayConfig(expandedConfig);
  assert.equal(otherConversationConfig.turnCount, 3);
  assert.equal(otherConversationConfig.turnCountOverride, 13);
  assert.equal(otherConversationConfig.turnCountOverrideConversationId, 'conversation-a');
});

test('full-log Markdown action is placed before the native Share button in the page header', () => {
  assert.doesNotMatch(popupHtmlSource, /id="mainSaveMarkdown"/);
  assert.match(popupHtmlSource, /id="headerMarkdownButtonToggle"/);
  assert.match(popupSource, /headerMarkdownButton: true/);
  assert.match(popupSource, /headerMarkdownButton: 'headerMarkdownButtonToggle'/);
  assert.match(source, /const HEADER_MARKDOWN_BUTTON_ID = 'arcaia-header-markdown-button'/);
  assert.match(source, /const HEADER_MARKDOWN_CONTENT_VERSION = 'download-icon-v1'/);
  assert.match(source, /function findNativeShareButton\(root = document\)/);
  assert.match(source, /if \(!button\.closest\?\.\('header'\)\) return false/);
  assert.match(source, /function findHeaderMarkdownObserverBinding\(\)/);
  assert.match(source, /return \{ target: actionsContainer, subtree: false \}/);
  assert.match(source, /headerMarkdownObserver\.observe\(target, \{ childList: true, subtree \}\)/);
  assert.match(source, /syncHeaderMarkdownButtonUi\('startup_after_settings_sync'\)/);
  assert.match(source, /syncHeaderMarkdownButtonUi\(conversationChanged \? 'conversation_changed' : 'url_changed'\)/);
  assert.doesNotMatch(source, /headerMarkdownScanTimer|scheduleHeaderMarkdownButtonScan/);
  assert.match(source, /function createHeaderMarkdownDownloadIcon\(\)/);
  assert.match(source, /svg\.setAttribute\('width', '20'\)/);
  assert.match(source, /path\.setAttribute\('d', 'M12 3v12/);
  assert.match(source, /function renderHeaderMarkdownButtonContent\(button, shareButton\)/);
  assert.match(source, /button\.replaceChildren\(\)/);
  assert.match(source, /button\.dataset\.arcaiaContentVersion = HEADER_MARKDOWN_CONTENT_VERSION/);
  assert.match(source, /existing\.dataset\.arcaiaContentVersion !== HEADER_MARKDOWN_CONTENT_VERSION/);
  assert.match(source, /button\.setAttribute\('aria-label', '全ログをMarkdownでダウンロード'\)/);
  assert.match(source, /button\.setAttribute\('data-testid', 'arcaia-header-markdown-button'\)/);
  assert.doesNotMatch(source, /button\.textContent = 'Markdown'/);
  assert.match(source, /parent\.insertBefore\(button, shareButton\)/);
  assert.match(source, /await startToolbarMarkdownSaveFromPopup\(\)/);
  assert.match(source, /if \(isArcaiaFeatureEnabled\('headerMarkdownButton'\)\) startHeaderMarkdownButtonUi\(\)/);
  assert.match(source, /startHeaderMarkdownButtonUi\(\)/);
  assert.match(source, /stopHeaderMarkdownButtonUi\(\)/);
});

test('normal Lite implementation contains no internal API fetch', () => {
  const start = source.indexOf('  async function applyRollingLiteDom(');
  const end = source.indexOf('  function getRollingLiteDelayMs', start);
  const liteSource = source.slice(start, end)
    + extractFunction('buildLiteGroupingPlan')
    + extractFunction('reconcileRollingLiteSections');
  assert.doesNotMatch(liteSource, /fetch\s*\(/);
  assert.doesNotMatch(liteSource, /\/backend-api\/conversation|\/api\/auth\/session/);
});

test('backend conversation rewrite is enabled by default for normal pages', () => {
  assert.match(injectedSource, /const BACKEND_REWRITE_DEFAULT_ENABLED = true;/);
  assert.match(injectedSource, /default_on_backend_rewrite_enabled_css_hide_fallback/);
  assert.match(injectedSource, /lite_config_ignored_legacy_rewrite_storage/);
});

test('backend rewrite gate checks Lite, GET, successful JSON response, conversation id, fullLoadOnce and backend flag', () => {
  const helperStart = injectedSource.indexOf('  function isConversationJsonFetchResponse(');
  const helperEnd = injectedSource.indexOf('  function shouldApplyLiteDisplayToFetch', helperStart);
  const helperSource = injectedSource.slice(helperStart, helperEnd);
  const start = injectedSource.indexOf('  function shouldApplyLiteDisplayToFetch(');
  const end = injectedSource.indexOf('  async function maybeRewriteFetchResponseForLiteDisplay', start);
  const gateSource = injectedSource.slice(start, end);
  assert.match(helperSource, /toUpperCase\(\) !== 'GET'/);
  assert.match(helperSource, /!response \|\| !response\.ok/);
  assert.match(helperSource, /extractConversationIdFromConversationDetailUrl/);
  assert.match(helperSource, /contentType\.includes\('application\/json'\)/);
  assert.match(gateSource, /if \(!config\.enabled\) return false/);
  assert.match(gateSource, /!isConversationJsonFetchResponse\(method, url, response\)/);
  assert.match(gateSource, /config\.fullLoadOnce/);
  assert.match(gateSource, /conversationId !== config\.conversationId/);
  assert.match(gateSource, /!config\.backendRewriteEnabled/);
});

test('full load requests one backend rewrite skip through the probe-backed native SPA round trip', () => {
  const start = source.indexOf('  async function loadFullConversationInPlace(');
  const end = source.indexOf('  function getLiteMessageContainer', start);
  const fullLoadSource = source.slice(start, end);
  assert.match(fullLoadSource, /requestMainWorldFullLoadOnce/);
  assert.match(fullLoadSource, /runRecentViewSpaRoundTrip/);
  assert.match(fullLoadSource, /findRecentViewNativeNewChatControl/);
  assert.match(fullLoadSource, /findRecentViewNativeConversationLink/);
  assert.match(fullLoadSource, /native_new_chat_round_trip/);
  assert.match(fullLoadSource, /contentRoot === sourceContentRoot/);
  assert.doesNotMatch(fullLoadSource, /window\.location\.href\s*=/);
  assert.doesNotMatch(fullLoadSource, /arcaia_full_load/);
  assert.doesNotMatch(fullLoadSource, /fetch\s*\(/);
});

test('Recent View top controls progressively load ten turns or all history without a scroll listener', () => {
  const start = source.indexOf('  function updateRecentViewHistoryControls(');
  const end = source.indexOf('  function getLiteMessageContainer', start);
  const recentViewSource = source.slice(start, end);
  assert.match(source, /RECENT_VIEW_EXPANSION_STEP = 10/);
  assert.match(recentViewSource, /RECENT_VIEW_HISTORY_CONTROLS_ID/);
  assert.match(recentViewSource, /firstVisibleSection\.insertAdjacentElement\('beforebegin', controls\)/);
  assert.match(recentViewSource, /`さらに\$\{increment\}件表示`/);
  assert.match(recentViewSource, /fullButton\.textContent = '全部表示'/);
  assert.match(recentViewSource, /mode: 'expand'/);
  assert.match(recentViewSource, /mode: 'full'/);
  assert.match(recentViewSource, /turnCountOverride: targetTurnCount/);
  assert.match(recentViewSource, /requestMainWorldFullLoadOnce/);
  assert.match(recentViewSource, /restoreRecentViewScrollAnchor/);
  assert.doesNotMatch(recentViewSource, /addEventListener\('scroll'/);
});

test('Recent View reports only failed history actions with a temporary accessible notice', () => {
  const start = source.indexOf('  function removeRecentViewFailureNotice(');
  const end = source.indexOf('  function getLiteMessageContainer', start);
  const failureNoticeSource = source.slice(start, end);
  assert.match(source, /RECENT_VIEW_FAILURE_NOTICE_ID = 'arcaia-recent-view-failure-notice'/);
  assert.match(failureNoticeSource, /notice\.setAttribute\('role', 'alert'\)/);
  assert.match(failureNoticeSource, /notice\.setAttribute\('aria-live', 'assertive'\)/);
  assert.match(failureNoticeSource, /firstVisibleSection\.insertAdjacentElement\('beforebegin', notice\)/);
  assert.match(failureNoticeSource, /notice\.dataset\.position = 'fixed'/);
  assert.match(failureNoticeSource, /}, 7000\)/);
  assert.match(failureNoticeSource, /以前の履歴を表示できませんでした。元の会話を表示しています。/);
  assert.match(failureNoticeSource, /以前の履歴を表示できませんでした。左サイドバーから元の会話を開いてください。/);
  assert.match(failureNoticeSource, /action: 'recent_view_history_action_failed'/);
  assert.match(failureNoticeSource, /showRecentViewHistoryActionFailure\(conversationId\)/);
  assert.match(failureNoticeSource, /return await loadFullConversationInPlace\('recent_view_history_full'/);
  assert.match(failureNoticeSource, /return await runRecentViewSpaRoundTrip\(\{/);
  assert.doesNotMatch(failureNoticeSource, /showRecentViewFailureNotice\([^)]*成功/);
});

test('Recent View no longer contains the unreachable three-stage soft-refresh fallback', () => {
  assert.doesNotMatch(source, /triggerCurrentConversationContentRefresh|findCurrentConversationSidebarLink|dispatchClickSequence/);
  assert.doesNotMatch(source, /sidebar_link_click_with_refresh_query|history_pushstate_popstate_with_refresh_query|synthetic_anchor_click_with_refresh_query/);
  assert.doesNotMatch(source, /arcaia_soft_refresh|contentRefreshInFlight|CONTENT_REFRESH_COOLDOWN_MS/);
});

test('backend rewrite diagnostics expose rewrite summary, render anchor, and byte reduction', () => {
  assert.match(injectedSource, /liteDisplayLastRewrite/);
  assert.match(injectedSource, /liteDisplayRewriteCount/);
  assert.match(injectedSource, /displayTargetTurnCount/);
  assert.match(injectedSource, /backendRetainedTurnCount/);
  assert.match(injectedSource, /renderAnchorTargetExtraTurnCount/);
  assert.match(injectedSource, /renderAnchorExtraTurnCount/);
  assert.match(injectedSource, /retainedTurnCount: summary\?\.retainedTurnCount/);
  assert.match(injectedSource, /totalTurnCount: summary\?\.totalTurnCount/);
  assert.match(injectedSource, /bytesReductionPct/);
});

test('backend rewrite uses latest-path three-turn target plus two render-anchor turns', () => {
  const start = injectedSource.indexOf('  function buildLiteRawForPage(');
  const end = injectedSource.indexOf('  function summarizeNetworkLiteJsonForProbe', start);
  const builderSource = injectedSource.slice(start, end);
  assert.match(builderSource, /renderAnchorTargetExtraTurnCount = 2/);
  assert.match(builderSource, /backendRetainedTurnCount = Math\.min\(turns\.length, safeTurnCount \+ renderAnchorTargetExtraTurnCount\)/);
  assert.match(builderSource, /const retainedTurns = turns\.slice/);
  assert.match(builderSource, /requestedTurnCount: safeTurnCount/);
  assert.match(builderSource, /displayTargetTurnCount: safeTurnCount/);
  assert.match(builderSource, /backendRetainedTurnCount/);
  assert.match(builderSource, /renderAnchorTargetExtraTurnCount/);
  assert.match(builderSource, /renderAnchorExtraTurnCount/);
  assert.match(builderSource, /retainedTurnCount: retainedTurns\.length/);
  assert.match(injectedSource, /buildLiteRawForPage\(raw, config\.turnCount, \{ liteShowImages: config\.liteShowImages !== false \}\)/);
});

test('patched fetch rewrites the original response without issuing a second normal-page fetch', () => {
  const start = injectedSource.indexOf('      window.fetch = function patchedFetch(');
  const end = injectedSource.indexOf('      state.fetchHooked = true;', start);
  const patchedFetchSource = injectedSource.slice(start, end);
  assert.equal((patchedFetchSource.match(/state\.originalFetch\.apply/g) || []).length, 2);
  assert.match(patchedFetchSource, /if \(!observedRequest\) return state\.originalFetch\.apply\(this, arguments\)/);
  assert.match(patchedFetchSource, /const fetchPromise = state\.originalFetch\.apply\(this, arguments\)/);
  assert.match(patchedFetchSource, /shouldProcessConversationFetchResponse\(method, url, response\)/);
  assert.match(patchedFetchSource, /maybeRewriteFetchResponseForLiteDisplay/);
  assert.match(injectedSource, /function shouldProcessConversationFetchResponse/);
  assert.match(injectedSource, /function isConversationJsonFetchResponse/);
  assert.match(injectedSource, /isHistoryProbeArmed\(\) && isConversationHistoryUrl\(this\.__aice_probe_url\)/);

  const rewriteStart = injectedSource.indexOf('  async function maybeRewriteFetchResponseForLiteDisplay(');
  const rewriteEnd = injectedSource.indexOf('  function recordResponseProbe', rewriteStart);
  assert.doesNotMatch(injectedSource.slice(rewriteStart, rewriteEnd), /originalFetch|fetch\s*\(/);
});


test('content split plan documents the first low-risk extraction boundary', () => {
  const planPath = path.join(__dirname, '..', 'docs', 'content_split_plan.md');
  const plan = fs.readFileSync(planPath, 'utf8');
  assert.match(plan, /v0\.1\.112 was the planning milestone/);
  assert.match(plan, /Completed in v0\.1\.113: `content_zip\.js`/);
  assert.match(plan, /Completed in v0\.1\.114: `content_toolbar\.js`/);
  assert.match(plan, /Do not split Lite implementation yet/);
  assert.match(plan, /content_shared\.js/);
  assert.match(plan, /Chrome extension multiple content scripts/);
  assert.match(plan, /small diagnostics split continuation/);
  assert.match(plan, /pause broad diagnostics extraction/);
  assert.match(plan, /post-split stabilization review/);
  assert.match(plan, /Real-world verification reported no current behavior problem/);
  assert.match(plan, /Verify no content-local wrapper is left after the final `\}\)\(\);`/);
  assert.match(plan, /next-boundary planning/);
  assert.match(plan, /Markdown\/export boundary review/);
  assert.match(plan, /Markdown\/export boundary review/);
  assert.match(plan, /Keep Markdown body generation and ChatGPT internal extraction in `content.js`/);
  assert.match(plan, /content_markdown boundary plan/);
  assert.match(plan, /First extraction candidate: pure Markdown message-body helpers/);
  assert.match(plan, /content_markdown small helper extraction/);
  assert.match(plan, /`content_markdown.js` contains only pure Markdown message-body helpers/);
  assert.match(plan, /Markdown draft metadata boundary review/);
  assert.match(plan, /metadata line formatter may be moved only if/);
  assert.match(plan, /passed as arguments/);
  assert.match(plan, /small Markdown draft formatter extraction/);
  assert.match(plan, /passes/);
  assert.match(plan, /pure helper arguments/);
  assert.match(plan, /filename \/ export name helper final split/);
  assert.match(plan, /downloadText/);
  assert.match(plan, /downloadBlob/);
  assert.match(plan, /remain in `content.js`/);
  assert.match(plan, /Markdown export filenames include the turn number/);
});
