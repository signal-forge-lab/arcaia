const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'tools', 'model_selector_thinking_level_probe.js'),
  'utf8'
);

test('thinking-level probe captures slider semantics and confirmed selection boundaries', () => {
  assert.match(source, /\[role=\"slider\"\], input\[type=\"range\"\]/);
  assert.match(source, /data-slot=\"slider-thumb\"/);
  assert.match(source, /sliderPartSummary/);
  assert.match(source, /aria-valuenow/);
  assert.match(source, /aria-valuetext/);
  assert.match(source, /aria-valuemin/);
  assert.match(source, /aria-valuemax/);
  assert.match(source, /document\.addEventListener\(eventType, handleUiEvent, true\)/);
  assert.match(source, /'input', 'change'/);
  assert.match(source, /knownPerformance/);
  assert.match(source, /knownDetailLabel/);
  assert.match(source, /inlinePositionSignal/);
  assert.match(source, /ancestorChain/);
  assert.match(source, /data-slot/);
});

test('thinking-level probe correlates storage, Arcaia state, and rendered decoration', () => {
  assert.match(source, /oai\/apps\/tpp\/thinking-effort/);
  assert.match(source, /oai\/apps\/tpp\/model-settings/);
  assert.match(source, /__ARCAIA_MODEL_SELECTOR_UI__\?\.getStatus/);
  assert.match(source, /data-arcaia-model-performance/);
  assert.match(source, /richPerformance/);
  assert.match(source, /current_conversation_model_config/);
  assert.match(source, /modelSource/);
  assert.match(source, /lastScanResult/);
});

test('thinking-level probe tracks portal relationships and DOM replacement identities', () => {
  assert.match(source, /aria-labelledby/);
  assert.match(source, /aria-controls/);
  assert.match(source, /controllingTriggerToken/);
  assert.match(source, /const nodeTokens = new WeakMap\(\)/);
  assert.match(source, /relevantMutationCallbackCount/);
  assert.match(source, /document-root observer, short settle timers, a 500ms watchdog/);
});

test('thinking-level probe is privacy bounded and downloads after complete cleanup', () => {
  assert.match(source, /arbitraryMenuTextCollected: false/);
  assert.match(source, /rawCookieValuesCollected: false/);
  assert.match(source, /rawStorageValuesCollected: false/);
  assert.doesNotMatch(source, /navigator\.clipboard|writeText\(/);
  assert.match(source, /observer\?\.disconnect\?\.\(\)/);
  assert.match(source, /clearInterval\(watchdog\)/);
  assert.match(source, /clearTimeout\(timer\)/);
  assert.match(source, /removeEventListener\(eventType, handleUiEvent, true\)/);
  assert.match(source, /anchor\.download = 'arcaia-model-selector-thinking-level-probe-'/);
  assert.match(source, /setTimeout\(\(\) => URL\.revokeObjectURL\(objectUrl\), 2000\)/);
});
