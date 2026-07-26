const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'tools', 'timestamp_model_selector_transition_probe.js'),
  'utf8'
);

test('combined transition probe captures timestamp protocol boundaries', () => {
  assert.match(source, /GET_MESSAGE_TIMESTAMP_INDEX/);
  assert.match(source, /MESSAGE_TIMESTAMP_INDEX_RESULT/);
  assert.match(source, /message_timestamp_index_updated/);
  assert.match(source, /PAGE_CONVERSATION_SYNC_RESULT/);
  assert.match(source, /authoritativeBadgeCount/);
});

test('combined transition probe captures Work and conversation model authority', () => {
  assert.match(source, /oai\/apps\/tpp\/model-settings/);
  assert.match(source, /oai\/apps\/tpp\/thinking-effort/);
  assert.match(source, /current_conversation_model_config/);
  assert.match(source, /conversation_detail_not_observed/);
  assert.match(source, /decorationMissing/);
});

test('combined transition probe is diagnostic-only, sanitized, and downloads JSON', () => {
  assert.match(source, /diagnosticOnly: true/);
  assert.match(source, /document-root observer, settle timers, and a 1-second watchdog/);
  assert.match(source, /rawConversationIdsCollected: false/);
  assert.match(source, /rawMessageIdsCollected: false/);
  assert.match(source, /rawCookieValuesCollected: false/);
  assert.match(source, /anchor\.download = 'arcaia-timestamp-model-selector-transition-probe-'/);
  assert.match(source, /setTimeout\(\(\) => URL\.revokeObjectURL\(objectUrl\), 2000\)/);
  assert.doesNotMatch(source, /\bcopy\(/);
});

test('combined transition probe disconnects every diagnostic trigger on stop', () => {
  assert.match(source, /observer\?\.disconnect\?\.\(\)/);
  assert.match(source, /clearInterval\(watchdog\)/);
  assert.match(source, /for \(const timer of timers\) clearTimeout\(timer\)/);
  assert.match(source, /window\.removeEventListener\('message', handleProtocol\)/);
  assert.match(source, /window\.removeEventListener\('error', handleError, true\)/);
});
