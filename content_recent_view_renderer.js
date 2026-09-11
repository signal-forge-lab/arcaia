(() => {
  'use strict';

  const ROOT_ID = 'arcaia-recent-view-read-only-root';
  const STYLE_ID = 'arcaia-recent-view-read-only-style';
  const NATIVE_HIDDEN_ATTR = 'data-arcaia-read-only-native-hidden';
  let activeView = null;

  function isTransparentColor(value) {
    const normalized = String(value || '').replace(/\s+/g, '').toLowerCase();
    return !normalized || normalized === 'transparent' || /^rgba\([^)]*,0(?:\.0+)?\)$/.test(normalized);
  }

  function findPaintedBackground(element, { descend = false } = {}) {
    if (!(element instanceof Element)) return null;
    const queue = [{ element, depth: 0 }];
    let visited = 0;
    while (queue.length && visited < 48) {
      const current = queue.shift();
      const candidate = current.element;
      visited += 1;
      const style = getComputedStyle(candidate);
      if (!isTransparentColor(style.backgroundColor)) return style;
      if (descend && current.depth < 4) {
        for (const child of candidate.children) queue.push({ element: child, depth: current.depth + 1 });
      }
    }
    return null;
  }

  function syncNativeAppearance(root, nativeContentRoot) {
    if (!(root instanceof HTMLElement) || !(nativeContentRoot instanceof Element)) return;
    const assistantRole = nativeContentRoot.querySelector('[data-message-author-role="assistant"]');
    const assistantText = assistantRole?.querySelector('p, li, blockquote, [class*="markdown"], [class*="prose"]') || assistantRole || nativeContentRoot;
    const userRole = nativeContentRoot.querySelector('[data-message-author-role="user"]');
    const userSurface = findPaintedBackground(userRole, { descend: true });
    const pageSurface = findPaintedBackground(nativeContentRoot);
    const textStyle = getComputedStyle(assistantText);
    const link = nativeContentRoot.querySelector('a[href]');
    const linkStyle = link ? getComputedStyle(link) : null;
    const code = nativeContentRoot.querySelector('pre');
    const codeStyle = code ? (findPaintedBackground(code, { descend: true }) || getComputedStyle(code)) : null;
    const codeBorder = codeStyle
      && codeStyle.borderTopStyle !== 'none'
      && Number.parseFloat(codeStyle.borderTopWidth) > 0
      ? codeStyle.borderTopColor
      : null;

    const values = {
      '--arcaia-ror-text': textStyle.color,
      '--arcaia-ror-page-bg': pageSurface?.backgroundColor,
      '--arcaia-ror-font-family': textStyle.fontFamily,
      '--arcaia-ror-font-size': textStyle.fontSize,
      '--arcaia-ror-line-height': textStyle.lineHeight,
      '--arcaia-ror-user-text': userSurface?.color || (userRole ? getComputedStyle(userRole).color : textStyle.color),
      '--arcaia-ror-user-bg': userSurface?.backgroundColor,
      '--arcaia-ror-link': linkStyle?.color,
      '--arcaia-ror-code-text': codeStyle?.color,
      '--arcaia-ror-code-bg': codeStyle?.backgroundColor,
      '--arcaia-ror-border': codeBorder
    };
    for (const [name, value] of Object.entries(values)) {
      if (value && !isTransparentColor(value)) root.style.setProperty(name, value);
    }
  }

  function safeHttpUrl(value) {
    const raw = String(value || '').trim();
    if (!/^https?:\/\//i.test(raw)) return null;
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function sandboxFileName(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^sandbox:\/mnt\/data\/(.+?)(?:[?#].*)?$/i);
    if (!match) return null;
    const leaf = match[1].split('/').filter(Boolean).pop() || '';
    if (!leaf) return null;
    try { return decodeURIComponent(leaf); } catch { return leaf; }
  }

  function sandboxFilePath(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^sandbox:(\/mnt\/data\/[^?#]+)(?:[?#].*)?$/i);
    if (!match) return null;
    let path;
    try { path = decodeURIComponent(match[1]); } catch { path = match[1]; }
    if (!path.startsWith('/mnt/data/') || path.includes('\0') || path.split('/').includes('..')) return null;
    return path;
  }

  function findSandboxDownloadResource(href, label, resources = []) {
    const fileName = sandboxFileName(href);
    if (!fileName) return null;
    const names = new Set([fileName, String(label || '').trim()].filter(Boolean));
    return (Array.isArray(resources) ? resources : []).find((resource) => (
      names.has(String(resource?.name || '').trim())
      && Boolean(resource?.assetPointer || resource?.fileId || resource?.url)
    )) || null;
  }

  function buildSandboxDownloadTarget(href, label, resources = [], context = null) {
    const sandboxPath = sandboxFilePath(href);
    if (!sandboxPath) return null;
    const resource = findSandboxDownloadResource(href, label, resources);
    const conversationId = String(context?.conversationId || '').trim() || null;
    const messageId = String(context?.messageId || '').trim() || null;
    if (!resource && (!conversationId || !messageId)) return null;
    return {
      assetPointer: resource?.assetPointer || null,
      fileId: resource?.fileId || null,
      url: resource?.url || null,
      mimeType: resource?.mimeType || null,
      isImage: Boolean(resource?.isImage),
      name: String(resource?.name || sandboxFileName(href) || label || 'download').trim() || 'download',
      conversationId,
      messageId,
      sandboxPath
    };
  }

  function createSandboxFileButton(label, resource, resolveAsset) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'arcaia-ror-file-link';
    const fileName = String(resource?.name || label || 'download').trim() || 'download';
    button.setAttribute('aria-label', fileName);
    const icon = document.createElement('span');
    icon.className = 'arcaia-ror-file-link-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M5.5 2.75h6.25L16 7v9.25a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.5-1.5v-12a1.5 1.5 0 0 1 1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/><path d="M11.75 2.75V6a1 1 0 0 0 1 1H16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    button.append(icon, document.createTextNode(label || fileName));
    button.addEventListener('click', () => {
      if (button.disabled || typeof resolveAsset !== 'function') return;
      button.disabled = true;
      Promise.resolve(resolveAsset(resource)).then((result) => {
        if (!result?.blob) return;
        const objectUrl = URL.createObjectURL(result.blob);
        const download = document.createElement('a');
        download.href = objectUrl;
        download.download = fileName;
        download.hidden = true;
        (document.body || document.documentElement).appendChild(download);
        download.click();
        download.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }).catch(() => null).finally(() => {
        if (button.isConnected) button.disabled = false;
      });
    });
    return button;
  }

  function parseTableRow(line) {
    const trimmed = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map((cell) => cell.trim());
  }

  function isTableDivider(line) {
    const cells = parseTableRow(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function isBlockStart(lines, index) {
    const line = lines[index] || '';
    if (!line.trim()) return true;
    if (/^```/.test(line) || /^(#{1,6})\s+/.test(line) || /^\s*>\s?/.test(line)) return true;
    if (/^\s*([-+*]|\d+\.)\s+/.test(line) || /^\s*((-{3,})|(\*{3,})|(_{3,}))\s*$/.test(line)) return true;
    return index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1]);
  }

  function parseMarkdown(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }
      const fence = line.match(/^```\s*([^\s`]*)\s*$/);
      if (fence) {
        const body = [];
        index += 1;
        while (index < lines.length && !/^```\s*$/.test(lines[index])) {
          body.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        blocks.push({ type: 'code', language: fence[1] || '', text: body.join('\n') });
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
        index += 1;
        continue;
      }
      if (/^\s*((-{3,})|(\*{3,})|(_{3,}))\s*$/.test(line)) {
        blocks.push({ type: 'hr' });
        index += 1;
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const body = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          body.push(lines[index].replace(/^\s*>\s?/, ''));
          index += 1;
        }
        blocks.push({ type: 'quote', text: body.join('\n') });
        continue;
      }
      const listMatch = line.match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
      if (listMatch) {
        const ordered = /\d+\./.test(listMatch[1]);
        const items = [];
        while (index < lines.length) {
          const item = lines[index].match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
          if (!item || /\d+\./.test(item[1]) !== ordered) break;
          items.push(item[2]);
          index += 1;
        }
        blocks.push({ type: 'list', ordered, items });
        continue;
      }
      if (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1])) {
        const header = parseTableRow(line);
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
          rows.push(parseTableRow(lines[index]));
          index += 1;
        }
        blocks.push({ type: 'table', header, rows });
        continue;
      }
      const paragraph = [line];
      index += 1;
      while (index < lines.length && !isBlockStart(lines, index)) {
        paragraph.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
    }
    return blocks;
  }

  function nextInlineMatch(text) {
    const patterns = [
      { type: 'citation', re: /(?:file)?cite[^]+/ },
      { type: 'image', re: /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/ },
      { type: 'link', re: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/ },
      { type: 'code', re: /`([^`\n]+)`/ },
      { type: 'strong', re: /\*\*([^*\n]+)\*\*/ },
      { type: 'strike', re: /~~([^~\n]+)~~/ },
      { type: 'em', re: /(?<!\*)\*([^*\n]+)\*(?!\*)/ }
    ];
    let selected = null;
    for (const pattern of patterns) {
      const match = pattern.re.exec(text);
      if (!match) continue;
      if (!selected || match.index < selected.match.index) selected = { ...pattern, match };
    }
    return selected;
  }

  function appendInline(parent, text, context = {}) {
    let remaining = String(text || '');
    while (remaining) {
      const selected = nextInlineMatch(remaining);
      if (!selected) {
        parent.appendChild(document.createTextNode(remaining));
        break;
      }
      if (selected.match.index > 0) {
        parent.appendChild(document.createTextNode(remaining.slice(0, selected.match.index)));
      }
      const full = selected.match[0];
      if (selected.type === 'citation') {
        const citation = document.createElement('span');
        citation.className = 'arcaia-ror-inline-citation';
        citation.textContent = '出典';
        parent.appendChild(citation);
      } else if (selected.type === 'code') {
        const code = document.createElement('code');
        code.textContent = selected.match[1];
        parent.appendChild(code);
      } else if (selected.type === 'strong' || selected.type === 'em' || selected.type === 'strike') {
        const element = document.createElement(selected.type === 'strong' ? 'strong' : selected.type === 'em' ? 'em' : 's');
        element.textContent = selected.match[1];
        parent.appendChild(element);
      } else {
        const href = selected.match[2];
        const sandboxTarget = selected.type === 'link'
          ? buildSandboxDownloadTarget(href, selected.match[1], context.resources, context)
          : null;
        const url = safeHttpUrl(href);
        if (sandboxTarget && typeof context.resolveAsset === 'function') {
          parent.appendChild(createSandboxFileButton(
            selected.match[1] || sandboxTarget.name,
            sandboxTarget,
            context.resolveAsset
          ));
        } else if (!url) {
          parent.appendChild(document.createTextNode(full));
        } else {
          const link = document.createElement('a');
          link.href = url;
          link.target = '_blank';
          link.rel = 'noreferrer noopener';
          link.textContent = selected.match[1] || url;
          parent.appendChild(link);
        }
      }
      remaining = remaining.slice(selected.match.index + full.length);
    }
  }

  function appendTextWithBreaks(parent, text, context = {}) {
    const parts = String(text || '').split('\n');
    parts.forEach((part, index) => {
      if (index > 0) parent.appendChild(document.createElement('br'));
      appendInline(parent, part, context);
    });
  }

  function renderMarkdown(text, context = {}) {
    const fragment = document.createDocumentFragment();
    for (const block of parseMarkdown(text)) {
      if (block.type === 'hr') {
        fragment.appendChild(document.createElement('hr'));
        continue;
      }
      if (block.type === 'code') {
        const surface = document.createElement('div');
        surface.className = 'arcaia-ror-code-surface';
        const toolbar = document.createElement('div');
        toolbar.className = 'arcaia-ror-code-toolbar';
        toolbar.textContent = block.language || 'code';
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = block.text;
        pre.appendChild(code);
        surface.append(toolbar, pre);
        fragment.appendChild(surface);
        continue;
      }
      if (block.type === 'table') {
        const wrapper = document.createElement('div');
        wrapper.className = 'arcaia-ror-table-wrap';
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const value of block.header) {
          const cell = document.createElement('th');
          appendInline(cell, value, context);
          headRow.appendChild(cell);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        for (const row of block.rows) {
          const rowElement = document.createElement('tr');
          for (let index = 0; index < block.header.length; index += 1) {
            const cell = document.createElement('td');
            appendInline(cell, row[index] || '', context);
            rowElement.appendChild(cell);
          }
          tbody.appendChild(rowElement);
        }
        table.appendChild(tbody);
        wrapper.appendChild(table);
        fragment.appendChild(wrapper);
        continue;
      }
      if (block.type === 'list') {
        const list = document.createElement(block.ordered ? 'ol' : 'ul');
        for (const item of block.items) {
          const li = document.createElement('li');
          appendInline(li, item, context);
          list.appendChild(li);
        }
        fragment.appendChild(list);
        continue;
      }
      const tag = block.type === 'heading' ? `h${block.level}` : block.type === 'quote' ? 'blockquote' : 'p';
      const element = document.createElement(tag);
      appendTextWithBreaks(element, block.text, context);
      fragment.appendChild(element);
    }
    return fragment;
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${NATIVE_HIDDEN_ATTR}="true"] { display: none !important; }
      #${ROOT_ID} {
        width: 100%;
        box-sizing: border-box;
        color: var(--arcaia-ror-text, inherit);
        background: var(--arcaia-ror-page-bg, transparent);
        font-family: var(--arcaia-ror-font-family, inherit);
        font-size: var(--arcaia-ror-font-size, inherit);
        line-height: var(--arcaia-ror-line-height, inherit);
      }
      #${ROOT_ID} * { box-sizing: border-box; }
      #${ROOT_ID} .arcaia-ror-controls {
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        width: min(48rem, calc(100% - 32px));
        margin: 0 auto 18px;
        padding: 10px 12px;
        border: 1px solid var(--arcaia-ror-border, color-mix(in srgb, currentColor 16%, transparent));
        border-radius: 12px;
        background: transparent;
      }
      #${ROOT_ID} .arcaia-ror-title { font-size: 13px; font-weight: 600; }
      #${ROOT_ID} .arcaia-ror-count { color: inherit; opacity: 0.68; font-size: 12px; }
      #${ROOT_ID} .arcaia-ror-spacer { flex: 1 1 auto; }
      #${ROOT_ID} button {
        min-height: 30px;
        padding: 4px 10px;
        border: 1px solid var(--arcaia-ror-border, color-mix(in srgb, currentColor 16%, transparent));
        border-radius: 8px;
        color: inherit;
        background: transparent;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      #${ROOT_ID} button:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
      #${ROOT_ID} button:disabled { cursor: default; opacity: 0.5; }
      #${ROOT_ID} .arcaia-ror-turn {
        width: min(48rem, calc(100% - 32px));
        margin: 0 auto;
        padding: 18px 0;
      }
      #${ROOT_ID} .arcaia-ror-message { display: flex; flex-direction: column; width: 100%; }
      #${ROOT_ID} .arcaia-ror-message + .arcaia-ror-message { margin-top: 24px; }
      #${ROOT_ID} .arcaia-ror-message-user { align-items: flex-end; }
      #${ROOT_ID} .arcaia-ror-body {
        min-width: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
      }
      #${ROOT_ID} .arcaia-ror-message-user .arcaia-ror-body {
        max-width: min(70%, 42rem);
        padding: 10px 16px;
        border-radius: 18px;
        color: var(--arcaia-ror-user-text, inherit);
        background: var(--arcaia-ror-user-bg, transparent);
      }
      #${ROOT_ID} .arcaia-ror-message-assistant .arcaia-ror-body { width: 100%; }
      #${ROOT_ID} .arcaia-ror-meta {
        margin: 5px 2px 0;
        color: inherit;
        opacity: 0.68;
        font-size: 11px;
        line-height: 1.35;
      }
      #${ROOT_ID} p { margin: 0 0 1em; white-space: normal; }
      #${ROOT_ID} p:last-child { margin-bottom: 0; }
      #${ROOT_ID} h1, #${ROOT_ID} h2, #${ROOT_ID} h3,
      #${ROOT_ID} h4, #${ROOT_ID} h5, #${ROOT_ID} h6 {
        margin: 1.35em 0 0.55em;
        font-weight: 650;
        line-height: 1.3;
      }
      #${ROOT_ID} h1 { font-size: 1.75em; }
      #${ROOT_ID} h2 { font-size: 1.45em; }
      #${ROOT_ID} h3 { font-size: 1.2em; }
      #${ROOT_ID} ul, #${ROOT_ID} ol { margin: 0.6em 0 1em; padding-left: 1.6em; }
      #${ROOT_ID} li { margin: 0.25em 0; }
      #${ROOT_ID} blockquote {
        margin: 0.8em 0;
        padding-left: 1em;
        border-left: 3px solid var(--arcaia-ror-border, color-mix(in srgb, currentColor 24%, transparent));
        color: inherit;
        opacity: 0.82;
      }
      #${ROOT_ID} a { color: var(--arcaia-ror-link, currentColor); text-decoration: underline; text-underline-offset: 2px; }
      #${ROOT_ID} .arcaia-ror-file-link {
        display: inline-flex;
        align-items: baseline;
        min-height: 0;
        padding: 0 4px;
        border: 0;
        border-radius: 0;
        color: var(--arcaia-ror-link, currentColor);
        background: transparent;
        font: inherit;
        font-weight: 500;
        line-height: inherit;
        text-align: start;
        text-decoration: underline;
        text-underline-offset: 2px;
        vertical-align: baseline;
      }
      #${ROOT_ID} .arcaia-ror-file-link:hover { background: transparent; }
      #${ROOT_ID} .arcaia-ror-file-link:disabled { cursor: wait; opacity: 0.65; }
      #${ROOT_ID} .arcaia-ror-file-link-icon {
        display: inline-flex;
        width: 16px;
        height: 1.65em;
        margin-right: 3px;
        align-items: center;
        vertical-align: bottom;
      }
      #${ROOT_ID} .arcaia-ror-file-link-icon svg { width: 16px; height: 16px; }
      #${ROOT_ID} :not(pre) > code {
        padding: 0.14em 0.35em;
        border-radius: 5px;
        background: var(--arcaia-ror-code-bg, color-mix(in srgb, currentColor 8%, transparent));
        font: 0.9em/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      #${ROOT_ID} .arcaia-ror-code-surface {
        margin: 1em 0;
        overflow: hidden;
        border: 1px solid var(--arcaia-ror-border, color-mix(in srgb, currentColor 16%, transparent));
        border-radius: 10px;
        color: var(--arcaia-ror-code-text, inherit);
        background: var(--arcaia-ror-code-bg, transparent);
      }
      #${ROOT_ID} .arcaia-ror-code-toolbar {
        padding: 7px 12px;
        border-bottom: 1px solid var(--arcaia-ror-border, color-mix(in srgb, currentColor 16%, transparent));
        color: inherit;
        opacity: 0.72;
        font-size: 12px;
      }
      #${ROOT_ID} pre { margin: 0; padding: 14px; overflow: auto; }
      #${ROOT_ID} pre code {
        font: 13px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
        white-space: pre;
      }
      #${ROOT_ID} .arcaia-ror-table-wrap { margin: 1em 0; overflow-x: auto; }
      #${ROOT_ID} table { width: 100%; border-collapse: collapse; font-size: 0.94em; }
      #${ROOT_ID} th, #${ROOT_ID} td {
        padding: 8px 10px;
        border: 1px solid var(--arcaia-ror-border, color-mix(in srgb, currentColor 16%, transparent));
        text-align: left;
        vertical-align: top;
      }
      #${ROOT_ID} th { background: color-mix(in srgb, currentColor 5%, transparent); font-weight: 600; }
      #${ROOT_ID} .arcaia-ror-resources {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
        gap: 10px;
        margin-top: 12px;
      }
      #${ROOT_ID} .arcaia-ror-resource {
        min-height: 54px;
        overflow: hidden;
        border: 1px solid var(--arcaia-ror-border, color-mix(in srgb, currentColor 16%, transparent));
        border-radius: 12px;
        background: transparent;
      }
      #${ROOT_ID} .arcaia-ror-resource-label { padding: 10px 12px; color: inherit; opacity: 0.72; font-size: 12px; }
      #${ROOT_ID} .arcaia-ror-resource img { display: block; width: 100%; height: auto; max-height: 640px; object-fit: contain; }
      #${ROOT_ID} .arcaia-ror-citations { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
      #${ROOT_ID} .arcaia-ror-citation, #${ROOT_ID} .arcaia-ror-inline-citation {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 2px 8px;
        border: 1px solid var(--arcaia-ror-border, color-mix(in srgb, currentColor 16%, transparent));
        border-radius: 999px;
        color: inherit;
        background: transparent;
        font-size: 11px;
        text-decoration: none;
      }
      #${ROOT_ID} hr { margin: 1.4em 0; border: 0; border-top: 1px solid var(--arcaia-ror-border, color-mix(in srgb, currentColor 16%, transparent)); }
      @media (max-width: 720px) {
        #${ROOT_ID} .arcaia-ror-controls, #${ROOT_ID} .arcaia-ror-turn { width: calc(100% - 20px); }
        #${ROOT_ID} .arcaia-ror-message-user .arcaia-ror-body { max-width: 88%; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function formatMessageMeta(message, turnNumber) {
    const parts = [`Turn ${turnNumber}`];
    if (message?.createdAtIso) {
      const date = new Date(message.createdAtIso);
      if (!Number.isNaN(date.getTime())) {
        parts.push(date.toLocaleString('ja-JP', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }));
      }
    }
    return parts.join(' ・ ');
  }

  function renderCitations(message, body) {
    const citations = Array.isArray(message?.citations) ? message.citations : [];
    if (!citations.length) return;
    const container = document.createElement('div');
    container.className = 'arcaia-ror-citations';
    for (const citation of citations) {
      const url = safeHttpUrl(citation?.url);
      const element = document.createElement(url ? 'a' : 'span');
      element.className = 'arcaia-ror-citation';
      element.textContent = citation?.title || citation?.domain || '出典';
      if (url) {
        element.href = url;
        element.target = '_blank';
        element.rel = 'noreferrer noopener';
      }
      container.appendChild(element);
    }
    body.appendChild(container);
  }

  function renderResources(message, body, resolveAsset) {
    const resources = Array.isArray(message?.resources) ? message.resources : [];
    if (!resources.length) return;
    const container = document.createElement('div');
    container.className = 'arcaia-ror-resources';
    for (const resource of resources) {
      const card = document.createElement('div');
      card.className = 'arcaia-ror-resource';
      const fileName = resource?.name || (resource?.isImage ? '画像' : '添付ファイル');
      const label = document.createElement('div');
      label.className = 'arcaia-ror-resource-label';
      label.textContent = fileName;
      card.appendChild(label);
      container.appendChild(card);
      const downloadable = Boolean(resource?.assetPointer || resource?.fileId || resource?.url);
      if (!resource?.isImage && typeof resolveAsset === 'function' && downloadable) {
        const button = createSandboxFileButton(fileName, resource, resolveAsset);
        button.classList.add('arcaia-ror-resource-label');
        card.replaceChildren(button);
        continue;
      }
      if (resource?.isImage && typeof resolveAsset === 'function') {
        Promise.resolve(resolveAsset(resource)).then((result) => {
          if (!activeView || !card.isConnected || !result?.blob) return;
          const objectUrl = URL.createObjectURL(result.blob);
          activeView.objectUrls.add(objectUrl);
          const image = document.createElement('img');
          image.alt = resource?.name || '添付画像';
          image.loading = 'lazy';
          image.decoding = 'async';
          image.addEventListener('error', () => {
            try { URL.revokeObjectURL(objectUrl); } catch {}
            activeView?.objectUrls?.delete?.(objectUrl);
            if (card.isConnected) card.replaceChildren(label);
          }, { once: true });
          image.src = objectUrl;
          card.replaceChildren(image);
        }).catch(() => null);
      }
    }
    body.appendChild(container);
  }

  function renderMessage(role, message, turnNumber, resolveAsset, conversationId) {
    if (!message) return null;
    const wrapper = document.createElement('section');
    wrapper.className = `arcaia-ror-message arcaia-ror-message-${role}`;
    wrapper.dataset.role = role;
    const body = document.createElement('div');
    body.className = 'arcaia-ror-body';
    if (message.text) body.appendChild(renderMarkdown(message.text, {
      resources: message.resources,
      resolveAsset,
      conversationId,
      messageId: message.messageId || null
    }));
    renderResources(message, body, resolveAsset);
    renderCitations(message, body);
    wrapper.appendChild(body);
    const meta = document.createElement('div');
    meta.className = 'arcaia-ror-meta';
    meta.textContent = formatMessageMeta(message, turnNumber);
    wrapper.appendChild(meta);
    return wrapper;
  }

  function createControls(model, handlers) {
    const controls = document.createElement('div');
    controls.className = 'arcaia-ror-controls';
    controls.setAttribute('role', 'navigation');
    controls.setAttribute('aria-label', 'Recent View 閲覧モード');
    const title = document.createElement('span');
    title.className = 'arcaia-ror-title';
    title.textContent = 'Recent View ・ 閲覧モード';
    const count = document.createElement('span');
    count.className = 'arcaia-ror-count';
    count.textContent = `${model.visibleTurnCount} / ${model.totalTurnCount}ターン`;
    const spacer = document.createElement('span');
    spacer.className = 'arcaia-ror-spacer';
    controls.append(title, count, spacer);
    const runAction = async (action) => {
      for (const button of controls.querySelectorAll('button')) button.disabled = true;
      try {
        await action?.();
      } finally {
        if (controls.isConnected) {
          for (const button of controls.querySelectorAll('button')) button.disabled = false;
        }
      }
    };
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Recent Viewへ戻る';
    close.addEventListener('click', () => void runAction(() => handlers?.onClose?.()));
    controls.appendChild(close);
    return controls;
  }

  function restoreScrollAnchor(root, scrollAnchor) {
    const turnNumber = Number(scrollAnchor?.turnNumber);
    const viewportTop = Number(scrollAnchor?.viewportTop);
    if (!Number.isFinite(turnNumber) || !Number.isFinite(viewportTop)) return false;
    const turn = Array.from(root.querySelectorAll('.arcaia-ror-turn'))
      .find((element) => Number(element.dataset.turnNumber) === turnNumber);
    if (!turn) return false;
    const delta = turn.getBoundingClientRect().top - viewportTop;
    if (Math.abs(delta) >= 0.5) {
      let scrollContainer = turn.parentElement;
      while (scrollContainer && scrollContainer !== document.documentElement) {
        const overflowY = getComputedStyle(scrollContainer).overflowY;
        if (/^(?:auto|scroll)$/.test(overflowY) && scrollContainer.scrollHeight > scrollContainer.clientHeight) break;
        scrollContainer = scrollContainer.parentElement;
      }
      if (scrollContainer && scrollContainer !== document.documentElement) scrollContainer.scrollTop += delta;
      else window.scrollBy(0, delta);
    }
    return true;
  }

  function cleanup(reason = 'cleanup') {
    const previous = activeView;
    activeView = null;
    if (!previous) {
      document.getElementById(ROOT_ID)?.remove?.();
      return { ok: true, active: false, reason };
    }
    for (const objectUrl of previous.objectUrls) {
      try { URL.revokeObjectURL(objectUrl); } catch {}
    }
    try { previous.root?.remove?.(); } catch {}
    try {
      previous.nativeContentRoot?.removeAttribute?.(NATIVE_HIDDEN_ATTR);
      if (previous.previousAriaHidden == null) previous.nativeContentRoot?.removeAttribute?.('aria-hidden');
      else previous.nativeContentRoot?.setAttribute?.('aria-hidden', previous.previousAriaHidden);
    } catch {}
    return { ok: true, active: false, reason };
  }

  function mount({ nativeContentRoot, model, resolveAsset, onClose, scrollAnchor = null } = {}) {
    if (!(nativeContentRoot instanceof Element) || !nativeContentRoot.parentElement) {
      throw new Error('recent_view_native_content_root_not_found');
    }
    if (!model || !Array.isArray(model.turns) || !Number.isFinite(Number(model.totalTurnCount))) {
      throw new Error('recent_view_renderer_model_invalid');
    }
    installStyles();
    cleanup('remount');
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.dataset.conversationId = String(model.conversationId || '');
    syncNativeAppearance(root, nativeContentRoot);
    root.appendChild(createControls(model, { onClose }));
    for (const turn of model.turns) {
      const section = document.createElement('article');
      section.className = 'arcaia-ror-turn';
      section.dataset.turnNumber = String(turn.turnNumber || '');
      const user = renderMessage('user', turn.user, turn.turnNumber, resolveAsset, model.conversationId);
      const assistant = renderMessage('assistant', turn.assistant, turn.turnNumber, resolveAsset, model.conversationId);
      if (user) section.appendChild(user);
      if (assistant) section.appendChild(assistant);
      if (section.childElementCount) root.appendChild(section);
    }
    const previousAriaHidden = nativeContentRoot.getAttribute('aria-hidden');
    nativeContentRoot.setAttribute(NATIVE_HIDDEN_ATTR, 'true');
    nativeContentRoot.setAttribute('aria-hidden', 'true');
    nativeContentRoot.insertAdjacentElement('beforebegin', root);
    activeView = {
      root,
      nativeContentRoot,
      previousAriaHidden,
      conversationId: model.conversationId || null,
      objectUrls: new Set()
    };
    if (!restoreScrollAnchor(root, scrollAnchor)) {
      try { root.scrollIntoView({ block: 'start' }); } catch {}
    }
    return {
      ok: true,
      active: true,
      conversationId: activeView.conversationId,
      visibleTurnCount: model.visibleTurnCount,
      totalTurnCount: model.totalTurnCount
    };
  }

  function isActive(conversationId = null) {
    if (!activeView?.root?.isConnected) return false;
    return conversationId ? activeView.conversationId === conversationId : true;
  }

  window.ArcaiaRecentViewRenderer = Object.freeze({
    mount,
    cleanup,
    isActive,
    parseMarkdown,
    safeHttpUrl
  });
})();
