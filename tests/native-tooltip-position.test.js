const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const start = contentSource.indexOf('  const ARCAIA_TOOLTIP_GAP_PX');
const end = contentSource.indexOf('  function positionArcaiaTooltip', start);
const positionSource = contentSource.slice(start, end);

function getPosition(triggerRect, tooltipRect, viewportWidth = 1920, viewportHeight = 598) {
  const sandbox = { triggerRect, tooltipRect, viewportWidth, viewportHeight, result: null };
  vm.runInNewContext(`${positionSource}\nresult = getArcaiaTooltipPosition(triggerRect, tooltipRect, viewportWidth, viewportHeight);`, sandbox);
  return JSON.parse(JSON.stringify(sandbox.result));
}

test('native tooltip flips below a trigger near the viewport top', () => {
  assert.deepEqual(
    getPosition(
      { left: 1777, top: 5.5, width: 36, height: 36, right: 1813, bottom: 41.5 },
      { width: 160, height: 24 }
    ),
    { side: 'bottom', left: 1715, top: 50 }
  );
});

test('native tooltip clamps inside the viewport right edge', () => {
  assert.deepEqual(
    getPosition(
      { left: 1890, top: 100, width: 36, height: 36, right: 1926, bottom: 136 },
      { width: 160, height: 24 }
    ),
    { side: 'top', left: 1752, top: 68 }
  );
});

test('native tooltip stays above when space is available', () => {
  assert.deepEqual(
    getPosition(
      { left: 200, top: 200, width: 36, height: 36, right: 236, bottom: 236 },
      { width: 100, height: 24 },
      800,
      600
    ),
    { side: 'top', left: 168, top: 168 }
  );
});

test('native tooltip uses ChatGPT tooltip tokens and a bounded delay without observers', () => {
  const startIndex = contentSource.indexOf('  const ARCAIA_NATIVE_TOOLTIP_ID');
  const endIndex = contentSource.indexOf('  const TURN_EXPORT_BUTTON_ATTR', startIndex);
  const source = contentSource.slice(startIndex, endIndex);
  assert.match(source, /ARCAIA_TOOLTIP_DELAY_MS = 200/);
  assert.match(source, /bg-token-bg-tooltip/);
  assert.match(source, /dark:border-token-border-tooltip/);
  assert.match(source, /px-2 py-1 rounded-lg overflow-hidden/);
  assert.match(source, /max-w-xs/);
  assert.match(source, /tooltip\.dataset\.side = position\.side/);
  assert.doesNotMatch(source, /MutationObserver|setInterval/);
});
