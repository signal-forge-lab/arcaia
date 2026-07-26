const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const probePath = path.join(__dirname, '..', 'tools', 'chat_ui_observer_scope_probe.js');
const source = fs.readFileSync(probePath, 'utf8');

test('chat UI observer scope probe covers all requested UI features', () => {
  assert.match(source, /__ARCAIA_CHAT_UI_OBSERVER_SCOPE_PROBE__/);
  assert.match(source, /header_markdown/);
  assert.match(source, /turn_download/);
  assert.match(source, /code_folding/);
  assert.match(source, /message_timestamp/);
  assert.match(source, /button\[data-testid="copy-turn-action-button"\]/);
  assert.match(source, /pre\[data-start\]\[data-end\]/);
  assert.match(source, /data-message-author-role="user"/);
});

test('probe compares candidate ancestry and records DOM versus watchdog changes', () => {
  assert.match(source, /const MAX_CHAIN_DEPTH = 8/);
  assert.match(source, /function buildChain/);
  assert.match(source, /function reconcileCandidateObservers/);
  assert.match(source, /mutationAtCandidateRootCount/);
  assert.match(source, /mutationBelowCandidateCount/);
  assert.match(source, /timeOnlySemanticChangeCount/);
  assert.match(source, /timeOnlySemanticChangeByFeature/);
  assert.match(source, /changedFeatures/);
  assert.match(source, /peakCandidateObserverCount/);
  assert.match(source, /source === 'watchdog'/);
  assert.match(source, /diagnosticOnly: true/);
  assert.match(source, /Do not copy those mechanisms into normal runtime code/);
});

test('probe downloads a bounded privacy-safe report instead of copying it', () => {
  assert.match(source, /const MAX_RECORDS = 720/);
  assert.match(source, /function download\(\)/);
  assert.match(source, /anchor\.download = 'arcaia-chat-ui-observer-scope-probe-'/);
  assert.match(source, /conversationTextCollected: false/);
  assert.match(source, /htmlCollected: false/);
  assert.match(source, /urlCollected: false/);
  assert.doesNotMatch(source, /navigator\.clipboard/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /innerHTML|outerHTML/);
  assert.doesNotMatch(source, /location\.(href|pathname|search|hash)/);
});
