'use strict';

const ARCAIA_OFFSCREEN_PLAY_COMPLETION_SOUND = 'ARCAIA_OFFSCREEN_PLAY_COMPLETION_SOUND';
const DEFAULT_COMPLETION_SOUND_ID = 'classic_chime';
const DEFAULT_COMPLETION_SOUND_VOLUME = 0.153;
const COMPLETION_SOUND_ASSETS = Object.freeze({
  classic_chime: 'sounds/notification-01.wav',
  soft_chime: 'sounds/notification-02.wav',
  notification_sound_03: 'sounds/notification-03.opus',
  notification_sound_04: 'sounds/notification-04.opus',
  notification_sound_05: 'sounds/notification-05.opus',
  notification_sound_06: 'sounds/notification-06.opus',
  notification_sound_07: 'sounds/notification-07.opus',
  notification_sound_08: 'sounds/notification-08.opus',
  notification_sound_09: 'sounds/notification-09.opus',
  notification_sound_10: 'sounds/notification-10.opus',
  notification_sound_11: 'sounds/notification-11.opus',
  notification_sound_12: 'sounds/notification-12.opus',
  notification_sound_13: 'sounds/notification-13.opus',
  notification_sound_14: 'sounds/notification-14.opus'
});

let completionSoundAudioElement = null;

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function normalizeSoundId(value) {
  const soundId = String(value || '');
  if (soundId === 'notification_08') return 'soft_chime';
  return Object.prototype.hasOwnProperty.call(COMPLETION_SOUND_ASSETS, soundId)
    ? soundId
    : DEFAULT_COMPLETION_SOUND_ID;
}

function getAudioElement(soundId) {
  const normalizedSoundId = normalizeSoundId(soundId);
  const src = chrome.runtime.getURL(COMPLETION_SOUND_ASSETS[normalizedSoundId]);
  if (!completionSoundAudioElement || completionSoundAudioElement.src !== src) {
    completionSoundAudioElement = new Audio(src);
    completionSoundAudioElement.preload = 'auto';
  }
  return { audio: completionSoundAudioElement, soundId: normalizedSoundId };
}

async function playCompletionSound(message) {
  const { audio, soundId } = getAudioElement(message?.soundId || DEFAULT_COMPLETION_SOUND_ID);
  const appliedVolume = clamp(Number(message?.volume ?? DEFAULT_COMPLETION_SOUND_VOLUME), 0, 1);
  audio.volume = appliedVolume;
  audio.currentTime = 0;
  const playResult = audio.play();
  if (playResult && typeof playResult.then === 'function') await playResult;
  return {
    ok: true,
    route: 'offscreen_html_audio_asset',
    soundId,
    appliedVolume
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== ARCAIA_OFFSCREEN_PLAY_COMPLETION_SOUND) return false;
  (async () => {
    try {
      sendResponse(await playCompletionSound(message));
    } catch (error) {
      sendResponse({ ok: false, route: 'offscreen_html_audio', error: getErrorMessage(error) });
    }
  })();
  return true;
});
