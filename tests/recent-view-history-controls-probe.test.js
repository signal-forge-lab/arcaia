const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'tools', 'recent_view_history_controls_probe.js'),
  'utf8'
);

test('Recent View controls probe reads the existing main-world status and mirrors runtime gates', () => {
  assert.match(source, /GET_LITE_DISPLAY_CONFIG/);
  assert.match(source, /LITE_DISPLAY_CONFIG_RESULT/);
  assert.match(source, /section\[data-testid\^="conversation-turn-"\]/);
  assert.match(source, /data-arcaia-lite-rolling-hidden/);
  assert.match(source, /arcaia-recent-view-history-controls/);
  assert.match(source, /last_rewrite_missing/);
  assert.match(source, /rewrite_summary_missing/);
  assert.match(source, /total_turn_count_missing/);
  assert.match(source, /first_visible_section_missing/);
  assert.match(source, /no_remaining_turns/);
});

test('Recent View controls probe detects add/remove behavior with one bounded observer', () => {
  assert.match(source, /new MutationObserver/);
  assert.match(source, /controls_added/);
  assert.match(source, /controls_removed/);
  assert.match(source, /WATCH_DURATION_MS = 10000/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test('Recent View controls probe exports a bounded privacy-safe JSON report', () => {
  assert.match(source, /conversationTextCollected: false/);
  assert.match(source, /conversationIdsCollected: false/);
  assert.match(source, /urlsCollected: false/);
  assert.match(source, /cookiesCollected: false/);
  assert.match(source, /sessionStorageRawValuesCollected: false/);
  assert.match(source, /JSON\.stringify\(report, null, 2\)/);
  assert.match(source, /URL\.createObjectURL/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|document\.cookie/);
});
