(function () {
  'use strict';

  function makeSafeFileName(input) {
    return String(input || 'chatgpt-conversation')
      .replace(/[\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'chatgpt-conversation';
  }

  function normalizeDateInput(value, normalizeDate) {
    if (typeof normalizeDate === 'function') return normalizeDate(value);
    if (value == null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateTimeForFile(inputDate, normalizeDate) {
    const date = normalizeDateInput(inputDate, normalizeDate) || new Date();
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    const pad = (value) => String(value).padStart(2, '0');
    return [
      safeDate.getFullYear(),
      pad(safeDate.getMonth() + 1),
      pad(safeDate.getDate()),
      '_',
      pad(safeDate.getHours()),
      pad(safeDate.getMinutes()),
      pad(safeDate.getSeconds())
    ].join('');
  }

  function getMessageCreatedAtForFilename(msg) {
    return msg?.create_time_iso || msg?.create_time || msg?.update_time_iso || msg?.update_time || null;
  }

  function pickLatestAssistantDateFromTurn(turn) {
    const assistantMessages = Array.isArray(turn?.assistantMessages) ? turn.assistantMessages : [];
    for (let i = assistantMessages.length - 1; i >= 0; i -= 1) {
      const value = getMessageCreatedAtForFilename(assistantMessages[i]);
      if (value != null) return value;
    }
    const messages = Array.isArray(turn?.messages) ? turn.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role !== 'assistant') continue;
      const value = getMessageCreatedAtForFilename(messages[i]);
      if (value != null) return value;
    }
    return null;
  }

  function pickLatestAssistantDateFromResult(result) {
    const turnSources = [result?.turns, result?.exportPlan?.turnBlocks];
    for (const turns of turnSources) {
      if (!Array.isArray(turns)) continue;
      for (let i = turns.length - 1; i >= 0; i -= 1) {
        const value = pickLatestAssistantDateFromTurn(turns[i]);
        if (value != null) return value;
      }
    }
    const messageSources = [result?.messages, result?.exportCandidates, result?.exportPlan?.sequence];
    for (const messages of messageSources) {
      if (!Array.isArray(messages)) continue;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i]?.role !== 'assistant') continue;
        const value = getMessageCreatedAtForFilename(messages[i]);
        if (value != null) return value;
      }
    }
    return result?.extractionDebug?.branch?.latestLeafCreateTimeIso || result?.extractionDebug?.branch?.latestLeafCreateTime || result?.extractedAt || null;
  }

  function formatTurnNumberForFile(turn, result) {
    const rawIndex = Number(turn?.turnIndex);
    if (!Number.isFinite(rawIndex) || rawIndex < 0) return 'turn_unknown';
    const rawTotal = Number(result?.turnCount || result?.turns?.length || result?.exportPlan?.turnBlocks?.length || 0);
    const total = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : null;
    const width = Math.max(2, String(total || rawIndex + 1).length);
    const current = String(rawIndex + 1).padStart(width, '0');
    if (!total) return `turn_${current}`;
    return `turn_${current}-of-${String(total).padStart(width, '0')}`;
  }

  function makeBaseExportName(result, normalizeDate) {
    const title = makeSafeFileName(result?.title || result?.conversationId || 'chatgpt-conversation');
    const date = formatDateTimeForFile(pickLatestAssistantDateFromResult(result), normalizeDate);
    return `${date}_${title}`;
  }

  function makeSingleTurnExportName(result, turn, normalizeDate) {
    const title = makeSafeFileName(result?.title || result?.conversationId || 'chatgpt-conversation');
    const date = formatDateTimeForFile(pickLatestAssistantDateFromTurn(turn) || pickLatestAssistantDateFromResult(result), normalizeDate);
    return `${date}_${title}_${formatTurnNumberForFile(turn, result)}`;
  }

  window.ArcaiaContentFilename = Object.freeze({
    formatDateTimeForFile,
    formatTurnNumberForFile,
    getMessageCreatedAtForFilename,
    makeBaseExportName,
    makeSafeFileName,
    makeSingleTurnExportName,
    pickLatestAssistantDateFromResult,
    pickLatestAssistantDateFromTurn
  });
})();
