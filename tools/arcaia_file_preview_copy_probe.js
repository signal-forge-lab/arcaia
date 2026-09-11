(() => {
  'use strict';

  const API_KEY = '__ARCAIA_FILE_PREVIEW_COPY_PROBE__';
  const MAX_ANCESTORS = 16;
  const MAX_CLASSES = 12;
  const MAX_BUTTONS = 24;
  const MAX_TOOLBARS = 12;
  const TEXT_SELECTOR = 'textarea,pre,.cm-content,.monaco-editor .view-lines,[contenteditable="true"],[role="textbox"],code';
  const RESOURCE_SELECTOR = 'iframe,object,embed,img,canvas,video,audio,table';

  try { window[API_KEY]?.cancel?.(); } catch {}

  let clickListener = null;
  let result = null;

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function safeToken(value, maxLength = 80) {
    const text = normalize(value);
    if (!text || text.length > maxLength) return null;
    if (/https?:\/\/|blob:|data:|@|[\\/]{2,}/i.test(text)) return null;
    if (/^[0-9a-f]{24,}$/i.test(text) || /^[0-9a-f-]{32,}$/i.test(text)) return null;
    return text;
  }

  function round(value) {
    return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  }

  function describeRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
      right: round(rect.right),
      bottom: round(rect.bottom)
    };
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) !== 0;
  }

  function describeElement(element) {
    if (!(element instanceof Element)) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      role: safeToken(element.getAttribute('role')),
      dataTestId: safeToken(element.getAttribute('data-testid')),
      classTokens: Array.from(element.classList || [])
        .map((token) => safeToken(token, 64))
        .filter(Boolean)
        .slice(0, MAX_CLASSES),
      visible: isVisible(element),
      directChildCount: element.children.length,
      buttonCount: element.querySelectorAll('button,[role="button"],a[download]').length,
      textSourceCount: element.querySelectorAll(TEXT_SELECTOR).length,
      resourceCount: element.querySelectorAll(RESOURCE_SELECTOR).length,
      rect: describeRect(element),
      style: {
        display: style.display,
        position: style.position,
        flexDirection: style.flexDirection,
        justifyContent: style.justifyContent,
        alignItems: style.alignItems,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        zIndex: style.zIndex
      }
    };
  }

  function classifyAction(element) {
    const label = normalize([
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.textContent
    ].filter(Boolean).join(' ')).toLowerCase();
    if (/コピー|copy/.test(label)) return 'copy';
    if (/ダウンロード|download/.test(label)) return 'download';
    if (/閉じる|close/.test(label)) return 'close';
    if (/共有|share/.test(label)) return 'share';
    if (/その他|more|menu/.test(label)) return 'more';
    if (/開く|open/.test(label)) return 'open';
    return 'other';
  }

  function describeButton(button) {
    return {
      actionKind: classifyAction(button),
      tag: button.tagName.toLowerCase(),
      role: safeToken(button.getAttribute('role')),
      dataTestId: safeToken(button.getAttribute('data-testid')),
      classTokens: Array.from(button.classList || [])
        .map((token) => safeToken(token, 64))
        .filter(Boolean)
        .slice(0, MAX_CLASSES),
      disabled: Boolean(button.matches(':disabled,[aria-disabled="true"]')),
      hasSvg: Boolean(button.querySelector('svg')),
      rect: describeRect(button)
    };
  }

  function describeTextSource(element) {
    const text = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
      ? String(element.value || '')
      : String(element.textContent || '');
    const style = getComputedStyle(element);
    return {
      kind: element.matches('textarea') ? 'textarea'
        : element.matches('pre') ? 'pre'
          : element.matches('.cm-content') ? 'codemirror'
            : element.matches('.monaco-editor .view-lines') ? 'monaco'
              : element.matches('[contenteditable="true"]') ? 'contenteditable'
                : element.matches('[role="textbox"]') ? 'textbox'
                  : element.matches('code') ? 'code'
                    : 'text',
      visible: isVisible(element),
      charCount: text.length,
      lineCount: text ? text.split(/\r?\n/).length : 0,
      selectionPossible: style.userSelect !== 'none',
      whiteSpace: style.whiteSpace,
      overflowX: style.overflowX,
      overflowY: style.overflowY
    };
  }

  function collectToolbars(panel) {
    const containers = new Set();
    for (const button of panel.querySelectorAll('button,[role="button"],a[download]')) {
      let current = button.parentElement;
      for (let depth = 0; current instanceof Element && panel.contains(current) && depth < 6; depth += 1) {
        const style = getComputedStyle(current);
        const buttonCount = current.querySelectorAll('button,[role="button"],a[download]').length;
        if (current.getAttribute('role') === 'toolbar'
          || ((style.display === 'flex' || style.display === 'inline-flex' || style.display === 'grid') && buttonCount > 0)) {
          containers.add(current);
          break;
        }
        if (current === panel) break;
        current = current.parentElement;
      }
    }
    return Array.from(containers).slice(0, MAX_TOOLBARS).map((element) => describeElement(element));
  }

  function panelScore(element, depth) {
    if (!(element instanceof Element) || element === document.body || element === document.documentElement) return -1000;
    const rect = element.getBoundingClientRect();
    if (rect.width < 180 || rect.height < 120) return -1000;
    let score = 0;
    if (element.matches('aside,[role="dialog"]')) score += 8;
    if (rect.left >= window.innerWidth * 0.38) score += 4;
    if (rect.right >= window.innerWidth - 40) score += 3;
    if (rect.height >= window.innerHeight * 0.45) score += 3;
    if (rect.width <= window.innerWidth * 0.75) score += 2;
    if (element.querySelector('button,[role="button"]')) score += 2;
    if (element.querySelector(TEXT_SELECTOR)) score += 3;
    if (element.querySelector(RESOURCE_SELECTOR)) score += 2;
    score += Math.max(0, 4 - depth * 0.25);
    return round(score);
  }

  function buildPanelSnapshot(panel) {
    if (!(panel instanceof Element)) return null;
    const textSources = Array.from(panel.querySelectorAll(TEXT_SELECTOR))
      .filter((element) => !(element.matches('code') && element.closest('pre')))
      .slice(0, 16)
      .map(describeTextSource);
    return {
      element: describeElement(panel),
      buttons: Array.from(panel.querySelectorAll('button,[role="button"],a[download]'))
        .filter(isVisible)
        .slice(0, MAX_BUTTONS)
        .map(describeButton),
      toolbars: collectToolbars(panel),
      textSources,
      resources: {
        iframeCount: panel.querySelectorAll('iframe').length,
        objectEmbedCount: panel.querySelectorAll('object,embed').length,
        imageCount: panel.querySelectorAll('img').length,
        canvasCount: panel.querySelectorAll('canvas').length,
        videoCount: panel.querySelectorAll('video').length,
        audioCount: panel.querySelectorAll('audio').length,
        tableCount: panel.querySelectorAll('table').length
      }
    };
  }

  function cancel() {
    if (clickListener) document.removeEventListener('click', clickListener, true);
    clickListener = null;
  }

  function capture(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();

    const target = Array.from(event.composedPath?.() || []).find((item) => item instanceof Element)
      || event.target;
    const ancestors = [];
    let current = target;
    while (current instanceof Element && ancestors.length < MAX_ANCESTORS) {
      ancestors.push(current);
      if (current === document.body) break;
      current = current.parentElement;
    }
    const candidates = ancestors
      .map((element, depth) => ({ element, depth, score: panelScore(element, depth) }))
      .filter((candidate) => candidate.score > -1000)
      .sort((left, right) => right.score - left.score);
    const panel = candidates[0]?.element || target.parentElement || target;

    result = {
      probe: {
        name: 'Arcaia File Preview Copy Console Probe',
        version: '1.0.0',
        capturedAtIso: new Date().toISOString(),
        mode: 'one_shot_click_target'
      },
      privacy: {
        fileContentsCollected: false,
        fileNamesCollected: false,
        urlsCollected: false,
        conversationTextCollected: false,
        htmlCollected: false,
        cookiesCollected: false,
        authorizationCollected: false,
        storageValuesCollected: false
      },
      target: describeElement(target),
      ancestorChain: ancestors.map(describeElement),
      panelCandidates: candidates.slice(0, 8).map(({ element, depth, score }) => ({
        depth,
        score,
        element: describeElement(element)
      })),
      selectedPanel: buildPanelSnapshot(panel)
    };

    const json = `${JSON.stringify(result, null, 2)}\n`;
    let copied = false;
    try {
      copy(json);
      copied = true;
    } catch {}
    console.log('[Arcaia File Preview Copy Probe]', result);
    console.info(copied
      ? 'Probe JSONをクリップボードへコピーしました。'
      : `copy(${API_KEY}.json()) を実行してJSONをコピーしてください。`);
  }

  clickListener = capture;
  document.addEventListener('click', clickListener, true);
  window[API_KEY] = Object.freeze({
    cancel,
    get result() { return result; },
    json() { return result ? `${JSON.stringify(result, null, 2)}\n` : ''; }
  });

  console.info('Arcaia File Preview Copy Probeを待機しました。右ペイン内の本文または余白を1回クリックしてください。クリック操作自体は実行されません。');
})();
