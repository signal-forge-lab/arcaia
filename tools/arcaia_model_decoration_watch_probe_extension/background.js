(() => {
  'use strict';

  const SOURCE = 'arcaia-model-decoration-watch-v1';
  const REPORT_KEY = 'arcaiaModelDecorationWatchReportV1';
  const PROBE_VERSION = '1.0.28';
  const MAX_EVENTS = 160;
  const MAX_INCIDENTS = 12;
  const DEFAULT_TITLE = 'Arcaia Model Decoration Watch Probe';
  const LOST_TITLE = 'モデルセレクター装飾の消失を検出';
  let reportMutationQueue = Promise.resolve();

  function enqueueReportMutation(run) {
    const result = reportMutationQueue.then(run);
    reportMutationQueue = result.catch(() => {});
    return result;
  }

  async function readReport() {
    const data = await chrome.storage.local.get(REPORT_KEY);
    const report = data?.[REPORT_KEY];
    if (report && typeof report === 'object') return report;
    return {
      probe: {
        name: 'Arcaia Model Decoration Watch Probe',
        version: PROBE_VERSION
      },
      tabs: {}
    };
  }

  async function writeReport(report) {
    report.probe = {
      name: 'Arcaia Model Decoration Watch Probe',
      version: PROBE_VERSION
    };
    report.updatedAtIso = new Date().toISOString();
    await chrome.storage.local.set({ [REPORT_KEY]: report });
  }

  function trim(array, max) {
    if (array.length > max) array.splice(0, array.length - max);
    return array;
  }

  function ensureTabReport(report, tabId, event = {}) {
    const key = String(tabId);
    const existing = report.tabs[key];
    if (existing && typeof existing === 'object') return existing;
    const created = {
      tabId,
      sessionId: event.sessionId || null,
      status: 'waiting',
      marked: false,
      startedAtIso: event.atIso || new Date().toISOString(),
      updatedAtIso: event.atIso || new Date().toISOString(),
      baseline: null,
      latestSnapshot: null,
      lastIncident: null,
      incidentCount: 0,
      incidents: [],
      events: []
    };
    report.tabs[key] = created;
    return created;
  }

  async function setBadge(tabId, marked) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
    await chrome.action.setBadgeText({ tabId, text: marked ? '!' : '' });
    await chrome.action.setTitle({ tabId, title: marked ? LOST_TITLE : DEFAULT_TITLE });
  }

  async function recordProbeEvent(tabId, event) {
    const report = await readReport();
    const tabReport = ensureTabReport(report, tabId, event);
    tabReport.sessionId = event.sessionId || tabReport.sessionId;
    tabReport.updatedAtIso = event.atIso || new Date().toISOString();
    tabReport.latestSnapshot = event.snapshot || tabReport.latestSnapshot;
    tabReport.events.push(event);
    trim(tabReport.events, MAX_EVENTS);

    if (event.type === 'probe_started') {
      if (!tabReport.marked) tabReport.status = 'watching';
      tabReport.startedAtIso = event.atIso || tabReport.startedAtIso;
      tabReport.baseline = null;
    } else if (event.type === 'probe_reset') {
      tabReport.status = 'watching';
      tabReport.startedAtIso = event.atIso || tabReport.startedAtIso;
      tabReport.baseline = null;
      tabReport.lastIncident = null;
      tabReport.incidentCount = 0;
      tabReport.incidents = [];
      tabReport.marked = false;
      await setBadge(tabId, false);
    } else if (event.type === 'baseline_armed' || event.type === 'baseline_rearmed') {
      tabReport.baseline = event.baseline || null;
      if (!tabReport.marked) tabReport.status = 'watching';
    } else if (event.type === 'incident') {
      tabReport.status = 'lost';
      tabReport.marked = true;
      tabReport.lastIncident = event.incident || null;
      tabReport.incidentCount += 1;
      tabReport.incidents.push(event.incident || null);
      trim(tabReport.incidents, MAX_INCIDENTS);
      await setBadge(tabId, true);
    } else if (event.type === 'recovered') {
      tabReport.status = tabReport.marked ? 'recovered_marked' : 'watching';
    } else if (event.type === 'manual_snapshot' && tabReport.status === 'waiting') {
      tabReport.status = 'watching';
    }

    await writeReport(report);
    return tabReport;
  }

  async function acknowledgeTab(tabId) {
    const report = await readReport();
    const tabReport = report.tabs[String(tabId)];
    if (tabReport) {
      tabReport.marked = false;
      tabReport.status = tabReport.status === 'lost' || tabReport.status === 'recovered_marked'
        ? 'acknowledged'
        : tabReport.status;
      tabReport.updatedAtIso = new Date().toISOString();
      await writeReport(report);
    }
    await setBadge(tabId, false);
  }

  async function resetTab(tabId) {
    const report = await readReport();
    delete report.tabs[String(tabId)];
    await writeReport(report);
    await setBadge(tabId, false);
  }

  async function restoreMarkedBadges() {
    const report = await readReport();
    const tasks = Object.values(report.tabs || {})
      .filter((tabReport) => Number.isInteger(tabReport?.tabId) && tabReport.marked)
      .map((tabReport) => setBadge(tabReport.tabId, true));
    await Promise.allSettled(tasks);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== SOURCE) return false;

    if (message.type === 'PROBE_EVENT') {
      const tabId = sender.tab?.id;
      if (!Number.isInteger(tabId)) return false;
      void enqueueReportMutation(() => recordProbeEvent(tabId, message.event || {})).then(
        (tabReport) => sendResponse({ ok: true, status: tabReport.status }),
        (error) => sendResponse({ ok: false, error: String(error?.message || error) })
      );
      return true;
    }

    if (message.type === 'ACK_TAB') {
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) return false;
      void enqueueReportMutation(() => acknowledgeTab(tabId)).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: String(error?.message || error) })
      );
      return true;
    }

    if (message.type === 'RESET_TAB') {
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) return false;
      void enqueueReportMutation(() => resetTab(tabId)).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: String(error?.message || error) })
      );
      return true;
    }

    return false;
  });

  chrome.runtime.onStartup.addListener(() => { void restoreMarkedBadges(); });
  chrome.runtime.onInstalled.addListener(() => { void restoreMarkedBadges(); });
})();
