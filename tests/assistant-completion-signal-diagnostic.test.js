const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'tools', 'assistant_completion_signal_diagnostic.js'),
  'utf8'
);

test('assistant completion diagnostic observes targeted DOM, lifecycle, and resource signals', () => {
  assert.match(source, /__ARCAIA_ASSISTANT_COMPLETION_SIGNAL_DIAG__/);
  assert.match(source, /button\[data-testid="copy-turn-action-button"\]/);
  assert.match(source, /button\[data-testid="regenerate-thread-error-button"\]/);
  assert.match(source, /button\[data-testid="stop-button"\]/);
  assert.match(source, /form\[data-type="unified-composer"\] #prompt-textarea\[contenteditable="true"\]\[role="textbox"\]\[aria-multiline="true"\]/);
  assert.doesNotMatch(source, /form\[data-type="unified-composer"\] textarea/);
  assert.match(source, /\[data-scroll-root\]/);
  assert.match(source, /section\[data-turn="assistant"\]/);
  assert.match(source, /new MutationObserver/);
  assert.match(source, /childList: true/);
  assert.match(source, /subtree: true/);
  assert.match(source, /attributes: true/);
  assert.match(source, /attributeOldValue: true/);
  assert.match(source, /characterData: true/);
  assert.match(source, /oldValue: mutation\.oldValue/);
  assert.match(source, /currentValue: target\?\.getAttribute/);
  assert.match(source, /exactStreamRoot: isStreamAttribute \? target === getStreamRoot\(\) : null/);
  assert.match(source, /composerHasText/);
  assert.match(source, /composerTextLength/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /pageshow/);
  assert.match(source, /pagehide/);
  assert.match(source, /new PerformanceObserver/);
  assert.match(source, /type: 'resource_complete'/);
  assert.match(source, /\/backend-api\//);
  assert.match(source, /type: 'heartbeat'/);
  assert.match(source, /candidateEvents/);
  assert.match(source, /data-arcaia-assistant-loading-title/);
  assert.match(source, /latestAssistantImageElementCount/);
  assert.match(source, /latestAssistantCanvasCount/);
  assert.match(source, /latestAssistantProgressbarCount/);
  assert.match(source, /latestAssistantAriaBusyTrueCount/);
  assert.match(source, /latestAssistantGenerationTestIds/);
});

test('assistant completion diagnostic does not retain conversation bodies or patch networking', () => {
  assert.doesNotMatch(source, /\.innerText|\.innerHTML|\.outerHTML/);
  assert.doesNotMatch(source, /composerText\s*:/);
  assert.match(source, /rawComposerValue/);
  assert.match(source, /composerTextLength: normalizedLength/);
  assert.doesNotMatch(source, /document\.cookie|authorization|requestBody|responseBody/);
  assert.doesNotMatch(source, /window\.fetch\s*=|XMLHttpRequest\.prototype/);
  assert.match(source, /Conversation text, innerHTML, outerHTML, request bodies, response bodies, cookies, and headers are not collected/);
});

test('assistant completion diagnostic exposes manual dump and cleanup methods', () => {
  assert.match(source, /Object\.freeze\(\{ stop, dump, json, download, snapshot, mark, clear \}\)/);
  assert.match(source, /window\.__ARCAIA_ASSISTANT_COMPLETION_SIGNAL_DIAG__\.download\(\)/);
  assert.match(source, /observer\.disconnect\(\)/);
  assert.match(source, /resourceObserver\?\.disconnect\?\.\(\)/);
});
