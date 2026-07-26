const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const probePath = path.join(__dirname, '..', 'tools', 'model_selector_observer_scope_probe.js');
const source = fs.readFileSync(probePath, 'utf8');

test('model selector observer-scope probe captures composer, trigger, and portal structure', () => {
  assert.match(source, /__ARCAIA_MODEL_SELECTOR_OBSERVER_SCOPE_PROBE__/);
  assert.match(source, /form\[data-type="unified-composer"\]/);
  assert.match(source, /composer-intelligence-picker-content/);
  assert.match(source, /describeAncestorChain/);
  assert.match(source, /pickerInsertionParent/);
  assert.match(source, /triggerPickerCommonAncestor/);
  assert.match(source, /identityFrequency/);
});

test('model selector observer-scope probe measures broad observer noise without changing runtime', () => {
  assert.match(source, /totalObserverCallbacks/);
  assert.match(source, /relevantObserverCallbacks/);
  assert.match(source, /irrelevantCallbackRatio/);
  assert.match(source, /observer\.observe\(document\.documentElement/);
  assert.match(source, /The broad observer exists only inside this manually executed probe/);
  assert.doesNotMatch(source, /chrome\.storage/);
  assert.doesNotMatch(source, /indexedDB/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
  assert.doesNotMatch(source, /window\.fetch\s*=/);
});

test('model selector observer-scope probe exports bounded JSON and fully cleans up', () => {
  assert.match(source, /const MAX_RECORDS = 1200/);
  assert.match(source, /JSON\.stringify\(report, null, 2\)/);
  assert.match(source, /arcaia-model-selector-observer-scope-probe-/);
  assert.match(source, /observer\?\.disconnect/);
  assert.match(source, /clearInterval\(watchdogTimer\)/);
  assert.match(source, /removeEventListener/);
  assert.match(source, /download,/);
  assert.match(source, /stop/);
});

test('model selector observer-scope probe stores only bounded structural identity and known UI labels', () => {
  assert.match(source, /function sanitizeUiText\(value\)/);
  assert.match(source, /rawUrlStored: false/);
  assert.match(source, /rawDomIdsStored: false/);
  assert.match(source, /arbitraryUiTextStored: false/);
  assert.doesNotMatch(source, /return `#\$\{CSS\.escape\(element\.id\)\}`/);
  assert.doesNotMatch(source, /normalizeText\(element\.textContent\)\.slice/);
});
