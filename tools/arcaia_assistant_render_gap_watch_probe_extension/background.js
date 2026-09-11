(() => {
  'use strict';

  const SOURCE = 'arcaia-assistant-render-gap-watch-v1';
  const REPORT_KEY = 'arcaiaAssistantRenderGapWatchReportV1';
  const PROBE_VERSION = '1.0.0';
  const MAX_EVENTS = 80;
  const MAX_INCIDENTS = 8;
  const RELOAD_MIN_DELTA = 160;
  const RELOAD_MIN_RATIO = 1.5;
  let mutationQueue = Promise.resolve();

  function emptyReport() {
    return {
      probe: { name: 'Arcaia Assistant Render Gap Watch Probe', version: PROBE_VERSION },
      tabs: {}
    };
  }

  async function loadReport() {
    const data = await chrome.storage.local.get(REPORT_KEY);
    const report = data?.[REPORT_KEY];
    return report && typeof report === 'object' ? report : emptyReport();
  }

  async function saveReport(report) {
    await chrome.storage.local.set({ [REPORT_KEY]: report });
  }

  function newTabReport() {
    return {
      status: 'watching',
      marked: false,
      sessionId: null,
      navigationType: null,
      updatedAtIso: null,
      lastDom: null,
      lastRaw: null,
      lastRewritten: null,
      lastArcaiaRewrite: null,
      previousSession: null,
      reloadComparisonDone: false,
      incidentCount: 0,
      lastIncident: null,
      incidents: [],
      events: []
    };
  }

  function pushBounded(array, value, max) {
    array.push(value);
    if (array.length > max) array.splice(0, array.length - max);
  }

  function addIncident(tab, incident, atIso) {
    const record = { ...incident, detectedAtIso: atIso || new Date().toISOString() };
    tab.marked = true;
    tab.status = 'lost';
    tab.incidentCount = Number(tab.incidentCount || 0) + 1;
    tab.lastIncident = record;
    pushBounded(tab.incidents, record, MAX_INCIDENTS);
  }

  function maybeMarkReloadRestoration(tab, event) {
    if (tab.reloadComparisonDone || tab.navigationType !== 'reload' || !tab.previousSession?.lastDom) return;
    const before = tab.previousSession.lastDom;
    const after = event.snapshot;
    if (!after || Number(after.userTurnCount || 0) <= 0 || Number(after.assistantTextLength || 0) <= 0) return;
    tab.reloadComparisonDone = true;
    const sameTurn = Number(before.userTurnCount || 0) === Number(after.userTurnCount || 0);
    const beforeLength = Number(before.assistantTextLength || 0);
    const afterLength = Number(after.assistantTextLength || 0);
    if (
      sameTurn
      && beforeLength > 0
      && afterLength - beforeLength >= RELOAD_MIN_DELTA
      && afterLength >= beforeLength * RELOAD_MIN_RATIO
      && after.streamActive !== true
    ) {
      addIncident(tab, {
        kind: 'reload_restored_assistant_content',
        userTurnCount: Number(after.userTurnCount || 0),
        beforeAssistantTextLength: beforeLength,
        afterAssistantTextLength: afterLength,
        beforeAssistantTurnTextLength: Number(before.assistantTurnTextLength || 0),
        afterAssistantTurnTextLength: Number(after.assistantTurnTextLength || 0),
        previousRawFinalAssistantTextLength: Number(tab.previousSession.lastRaw?.finalAssistantTextLength || 0),
        previousRewrittenFinalAssistantTextLength: Number(tab.previousSession.lastRewritten?.finalAssistantTextLength || 0),
        previousArcaiaRewriteObserved: Boolean(tab.previousSession.lastArcaiaRewrite)
      }, event.atIso);
    }
  }

  async function updateBadge(tabId, tab) {
    try {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d14b4b' });
      await chrome.action.setBadgeText({ tabId, text: tab?.marked ? '!' : '' });
      await chrome.action.setTitle({
        tabId,
        title: tab?.marked ? 'Assistant render gap detected' : 'Arcaia Assistant Render Gap Watch Probe'
      });
    } catch {}
  }

  async function recordProbeEvent(tabId, event) {
    const report = await loadReport();
    const key = String(tabId);
    const tab = report.tabs[key] || newTabReport();

    if (event.type === 'probe_started') {
      if (tab.sessionId && tab.sessionId !== event.sessionId) {
        tab.previousSession = {
          sessionId: tab.sessionId,
          navigationType: tab.navigationType,
          lastDom: tab.lastDom,
          lastRaw: tab.lastRaw,
          lastRewritten: tab.lastRewritten,
          lastArcaiaRewrite: tab.lastArcaiaRewrite,
          endedAtIso: tab.updatedAtIso
        };
      }
      tab.sessionId = event.sessionId || null;
      tab.navigationType = event.navigationType || null;
      tab.lastDom = null;
      tab.lastRaw = null;
      tab.lastRewritten = null;
      tab.lastArcaiaRewrite = null;
      tab.reloadComparisonDone = false;
      if (!tab.marked) tab.status = 'watching';
    } else if (event.type === 'dom_snapshot') {
      maybeMarkReloadRestoration(tab, event);
      tab.lastDom = event.snapshot || null;
    } else if (event.type === 'pagehide_snapshot') {
      tab.lastDom = event.snapshot || tab.lastDom;
    } else if (event.type === 'raw_payload_summary') {
      tab.lastRaw = event.summary || null;
    } else if (event.type === 'rewritten_payload_summary') {
      tab.lastRewritten = event.summary || null;
    } else if (event.type === 'arcaia_rewrite_summary') {
      tab.lastArcaiaRewrite = event.summary || null;
    } else if (event.type === 'incident' && event.incident) {
      addIncident(tab, event.incident, event.atIso);
      if (event.snapshot) tab.lastDom = event.snapshot;
    } else if (event.type === 'manual_snapshot') {
      if (event.snapshot?.dom) tab.lastDom = event.snapshot.dom;
    } else if (event.type === 'probe_stopped') {
      tab.status = tab.marked ? 'lost' : 'stopped';
      if (event.snapshot) tab.lastDom = event.snapshot;
    }

    tab.updatedAtIso = event.atIso || new Date().toISOString();
    pushBounded(tab.events, event, MAX_EVENTS);
    report.tabs[key] = tab;
    await saveReport(report);
    await updateBadge(tabId, tab);
    return tab;
  }

  function enqueue(task) {
    mutationQueue = mutationQueue.then(task, task);
    return mutationQueue;
  }

  async function getTabReport(tabId) {
    const report = await loadReport();
    return report.tabs?.[String(tabId)] || null;
  }

  async function acknowledge(tabId) {
    const report = await loadReport();
    const tab = report.tabs?.[String(tabId)];
    if (!tab) return null;
    tab.marked = false;
    tab.status = 'acknowledged';
    await saveReport(report);
    await updateBadge(tabId, tab);
    return tab;
  }

  async function resetTab(tabId) {
    const report = await loadReport();
    report.tabs[String(tabId)] = newTabReport();
    await saveReport(report);
    await updateBadge(tabId, report.tabs[String(tabId)]);
    return report.tabs[String(tabId)];
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.source !== SOURCE) return false;
    const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : Number(message.tabId);
    if (message.type === 'PROBE_EVENT' && Number.isInteger(tabId)) {
      void enqueue(() => recordProbeEvent(tabId, message.event || {})).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
      return true;
    }
    if (message.type === 'GET_TAB' && Number.isInteger(tabId)) {
      void getTabReport(tabId).then((tab) => sendResponse({ ok: true, tab }));
      return true;
    }
    if (message.type === 'ACK_TAB' && Number.isInteger(tabId)) {
      void enqueue(() => acknowledge(tabId)).then((tab) => sendResponse({ ok: true, tab }));
      return true;
    }
    if (message.type === 'RESET_TAB' && Number.isInteger(tabId)) {
      void enqueue(() => resetTab(tabId)).then((tab) => sendResponse({ ok: true, tab }));
      return true;
    }
    return false;
  });

  async function restoreMarkedBadges() {
    const report = await loadReport();
    for (const [tabId, tab] of Object.entries(report.tabs || {})) {
      if (Number.isInteger(Number(tabId))) await updateBadge(Number(tabId), tab);
    }
  }
  chrome.runtime.onStartup.addListener(() => { void restoreMarkedBadges(); });
  chrome.runtime.onInstalled.addListener(() => { void restoreMarkedBadges(); });
})();
