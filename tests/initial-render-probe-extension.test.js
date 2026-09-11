const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const probeRoot = path.join(root, 'tools', 'arcaia_initial_render_probe_extension');
const manifest = JSON.parse(fs.readFileSync(path.join(probeRoot, 'manifest.json'), 'utf8'));
const probeSource = fs.readFileSync(path.join(probeRoot, 'probe.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(probeRoot, 'popup.js'), 'utf8');
const readme = fs.readFileSync(path.join(probeRoot, 'README.md'), 'utf8');

test('initial render probe is a minimal standalone document_start extension', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
  assert.equal(manifest.content_scripts.length, 1);
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.equal(manifest.content_scripts[0].all_frames, false);
  assert.deepEqual(manifest.content_scripts[0].js, ['probe.js']);
  assert.equal(manifest.background, undefined);
});

test('initial render probe observes bounded structural timing and existing Arcaia messages', () => {
  assert.match(probeSource, /const WATCH_DURATION_MS = 15000/);
  assert.match(probeSource, /const MAX_EVENTS = 240/);
  assert.match(probeSource, /new MutationObserver/);
  assert.match(probeSource, /observer\.observe\(document/);
  assert.match(probeSource, /stop\('watch_duration_complete'\)/);
  assert.match(probeSource, /observer\?\.disconnect/);
  assert.match(probeSource, /GET_LITE_DISPLAY_CONFIG/);
  assert.match(probeSource, /aice-probe-main-v159/);
  assert.match(probeSource, /data-arcaia-turn-export-button/);
  assert.match(probeSource, /arcaia-header-markdown-button/);
  assert.match(probeSource, /arcaia-recent-view-history-controls/);
});

test('initial render probe does not collect sensitive page content or patch networking', () => {
  assert.doesNotMatch(probeSource, /document\.cookie/);
  assert.doesNotMatch(probeSource, /localStorage/);
  assert.doesNotMatch(probeSource, /sessionStorage/);
  assert.doesNotMatch(probeSource, /innerHTML/);
  assert.doesNotMatch(probeSource, /\bfetch\s*\(/);
  assert.doesNotMatch(probeSource, /XMLHttpRequest/);
  assert.doesNotMatch(probeSource, /getAttribute\(['"]authorization['"]\)/i);
  assert.doesNotMatch(probeSource, /headers\s*\[/i);
  assert.match(probeSource, /conversationTextCollected: false/);
  assert.match(probeSource, /conversationIdsCollected: false/);
  assert.match(probeSource, /urlsCollected: false/);
  assert.match(probeSource, /otherExtensionStorageCollected: false/);
});

test('probe popup saves and resets the stored JSON report', () => {
  assert.match(popupSource, /chrome\.storage\.local\.get/);
  assert.match(popupSource, /chrome\.storage\.local\.remove/);
  assert.match(popupSource, /JSON\.stringify\(currentReport, null, 2\)/);
  assert.match(popupSource, /anchor\.download = `arcaia-initial-render-probe-/);
});

test('probe readme requires coexistence with normal Arcaia and documents isolated-world limits', () => {
  assert.match(readme, /通常版Arcaiaは有効のまま/);
  assert.match(readme, /Arcaia Content Scriptのisolated world/);
  assert.match(readme, /Arcaia本体へ範囲を限定した一時probe/);
});
