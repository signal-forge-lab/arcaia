(function () {
  'use strict';

  function normalizeRectForDiagnostics(rect) {
    if (!rect) return null;
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      bottom: Math.round(rect.bottom),
      right: Math.round(rect.right)
    };
  }

  function simpleDiagnosticHash(text) {
    const str = String(text || '');
    let hash = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  window.ArcaiaContentDiagnostics = Object.freeze({
    normalizeRectForDiagnostics,
    simpleDiagnosticHash
  });
})();
