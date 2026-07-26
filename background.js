'use strict';

const ARCAIA_PLAY_COMPLETION_SOUND = 'ARCAIA_PLAY_COMPLETION_SOUND';
const ARCAIA_COMPLETION_SOUND_STATUS = 'ARCAIA_COMPLETION_SOUND_STATUS';
const ARCAIA_OFFSCREEN_PLAY_COMPLETION_SOUND = 'ARCAIA_OFFSCREEN_PLAY_COMPLETION_SOUND';
const ARCAIA_OFFSCREEN_DOCUMENT = 'offscreen.html';
const ARCAIA_OPERATION_MODE_STORAGE_KEY = 'arcaia_operation_mode_v1';
const ARCAIA_COMPLETION_SOUND_ID_STORAGE_KEY = 'arcaia_assistant_completion_sound_id_v1';
const ARCAIA_COMPLETION_SOUND_VOLUME_STORAGE_KEY = 'arcaia_assistant_completion_sound_volume_v1';
const DEFAULT_COMPLETION_SOUND_ID = 'classic_chime';
const DEFAULT_COMPLETION_SOUND_VOLUME = 0.153;
const VALID_COMPLETION_SOUND_IDS = new Set(['classic_chime', 'soft_chime']);

let creatingOffscreenDocument = null;
let completionSoundState = {
  requestCount: 0,
  successCount: 0,
  failCount: 0,
  offscreenCreateAttemptCount: 0,
  lastRequestAtIso: null,
  lastResponseAtIso: null,
  lastError: null,
  lastRoute: null,
  lastResponse: null,
  lastAppliedSoundId: null,
  lastAppliedVolume: null
};

function nowIso(ts = Date.now()) {
  return new Date(ts).toISOString();
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

function normalizeCompletionSoundId(value) {
  const id = String(value || '');
  return VALID_COMPLETION_SOUND_IDS.has(id) ? id : DEFAULT_COMPLETION_SOUND_ID;
}

function normalizeCompletionSoundVolume(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_COMPLETION_SOUND_VOLUME;
  return Math.max(0, Math.min(1, parsed));
}

async function resolveCompletionSoundSettings(message = {}) {
  let stored = {};
  try {
    stored = await chrome.storage.local.get([
      ARCAIA_COMPLETION_SOUND_ID_STORAGE_KEY,
      ARCAIA_COMPLETION_SOUND_VOLUME_STORAGE_KEY
    ]);
  } catch {}
  const storedSoundId = stored?.[ARCAIA_COMPLETION_SOUND_ID_STORAGE_KEY];
  const storedVolume = stored?.[ARCAIA_COMPLETION_SOUND_VOLUME_STORAGE_KEY];
  return {
    soundId: normalizeCompletionSoundId(
      VALID_COMPLETION_SOUND_IDS.has(String(storedSoundId || '')) ? storedSoundId : message.soundId
    ),
    volume: normalizeCompletionSoundVolume(Number.isFinite(Number(storedVolume)) ? storedVolume : message.volume)
  };
}

async function syncArcaiaActionBadge(mode = null) {
  let resolvedMode = mode;
  if (!['normal', 'diagnostic', 'off'].includes(resolvedMode)) {
    try {
      const data = await chrome.storage.local.get(ARCAIA_OPERATION_MODE_STORAGE_KEY);
      resolvedMode = data?.[ARCAIA_OPERATION_MODE_STORAGE_KEY] || 'normal';
    } catch {
      resolvedMode = 'normal';
    }
  }
  const text = resolvedMode === 'diagnostic' ? 'LOG' : (resolvedMode === 'off' ? 'OFF' : '');
  try {
    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color: resolvedMode === 'diagnostic' ? '#b77900' : '#666666' });
  } catch {}
}

void syncArcaiaActionBadge();
chrome.runtime.onStartup?.addListener?.(() => { void syncArcaiaActionBadge(); });
chrome.runtime.onInstalled?.addListener?.(() => { void syncArcaiaActionBadge(); });
chrome.storage.onChanged?.addListener?.((changes, areaName) => {
  if (areaName !== 'local' || !changes?.[ARCAIA_OPERATION_MODE_STORAGE_KEY]) return;
  void syncArcaiaActionBadge(changes[ARCAIA_OPERATION_MODE_STORAGE_KEY].newValue);
});

async function hasArcaiaOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(ARCAIA_OFFSCREEN_DOCUMENT);
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureArcaiaOffscreenDocument() {
  if (await hasArcaiaOffscreenDocument()) return;
  if (!creatingOffscreenDocument) {
    completionSoundState.offscreenCreateAttemptCount += 1;
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: ARCAIA_OFFSCREEN_DOCUMENT,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play the optional Arcaia answer completion notification sound.'
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }
  await creatingOffscreenDocument;
}

function sendRuntimeMessage(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || String(error)));
        else resolve(response || { ok: false, error: 'empty offscreen response' });
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function playCompletionSoundInOffscreen(message) {
  const settings = await resolveCompletionSoundSettings(message);
  completionSoundState = {
    ...completionSoundState,
    requestCount: completionSoundState.requestCount + 1,
    lastRequestAtIso: nowIso(),
    lastError: null,
    lastResponse: null
  };
  await ensureArcaiaOffscreenDocument();
  const response = await sendRuntimeMessage({
    type: ARCAIA_OFFSCREEN_PLAY_COMPLETION_SOUND,
    reason: message.reason || 'assistant_completed',
    soundId: settings.soundId,
    volume: settings.volume
  });
  const routedResponse = {
    ...response,
    route: 'background_offscreen_audio',
    appliedSoundId: settings.soundId,
    appliedVolume: settings.volume
  };
  completionSoundState = {
    ...completionSoundState,
    successCount: routedResponse.ok ? completionSoundState.successCount + 1 : completionSoundState.successCount,
    failCount: routedResponse.ok ? completionSoundState.failCount : completionSoundState.failCount + 1,
    lastResponseAtIso: nowIso(),
    lastError: routedResponse.ok ? null : (routedResponse.error || routedResponse.reason || 'offscreen playback failed'),
    lastRoute: routedResponse.route,
    lastResponse: routedResponse,
    lastAppliedSoundId: settings.soundId,
    lastAppliedVolume: settings.volume
  };
  return routedResponse;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === ARCAIA_COMPLETION_SOUND_STATUS) {
    sendResponse({ ok: true, route: 'background_offscreen_audio', state: completionSoundState });
    return false;
  }
  if (!message || message.type !== ARCAIA_PLAY_COMPLETION_SOUND) return false;
  (async () => {
    try {
      const response = await playCompletionSoundInOffscreen(message);
      sendResponse(response);
    } catch (error) {
      const errorResponse = {
        ok: false,
        route: 'background_offscreen_audio',
        error: getErrorMessage(error)
      };
      completionSoundState = {
        ...completionSoundState,
        failCount: completionSoundState.failCount + 1,
        lastResponseAtIso: nowIso(),
        lastError: errorResponse.error,
        lastRoute: errorResponse.route,
        lastResponse: errorResponse
      };
      sendResponse(errorResponse);
    }
  })();
  return true;
});
