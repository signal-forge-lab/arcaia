'use strict';

const ARCAIA_OFFSCREEN_PLAY_COMPLETION_SOUND = 'ARCAIA_OFFSCREEN_PLAY_COMPLETION_SOUND';
const COMPLETION_SOUND_ASSET_PATH = 'sounds/assistant-complete.ogg';
const DEFAULT_COMPLETION_SOUND_ID = 'classic_chime';
const DEFAULT_COMPLETION_SOUND_VOLUME = 0.153;

const COMPLETION_SOUND_PRESETS = Object.freeze({
  classic_chime: Object.freeze({
    id: 'classic_chime',
    kind: 'synth',
    sampleRate: 48000,
    durationSeconds: 1.32,
    volume: DEFAULT_COMPLETION_SOUND_VOLUME,
    finalFadeSeconds: 0.34,
    finalSilenceSeconds: 0.08,
    targetPeak: 0.66,
    softenAlpha: 0.34,
    voices: Object.freeze([
      Object.freeze({ frequency: 659.25, start: 0, attack: 0.018, decay: 0.32, gain: 0.22, vibratoHz: 4.2, vibratoCents: 0.55, harmonics: Object.freeze([[2, 0.025], [3, 0.008]]) }),
      Object.freeze({ frequency: 987.77, start: 0.058, attack: 0.02, decay: 0.38, gain: 0.15, detuneCents: 0.8, harmonics: Object.freeze([[2.002, 0.018]]) }),
      Object.freeze({ frequency: 1318.51, start: 0.105, attack: 0.018, decay: 0.31, gain: 0.058, detuneCents: -0.7, harmonics: Object.freeze([[2.006, 0.008]]) }),
      Object.freeze({ frequency: 329.63, start: 0, attack: 0.022, decay: 0.24, gain: 0.028, harmonics: Object.freeze([[2, 0.025]]) })
    ]),
    sweep: Object.freeze({ startFrequency: 740, endFrequency: 1180, start: 0.018, duration: 0.23, attack: 0.012, decay: 0.18, gain: 0.055, leftGain: 0.82, rightGain: 1.08, harmonics: Object.freeze([[2, 0.012]]) }),
    shimmerLeft: Object.freeze({ frequency: 2637.02, start: 0.12, attack: 0.016, decay: 0.22, gain: 0.0075, harmonics: Object.freeze([[2, 0.006]]) }),
    shimmerRight: Object.freeze({ frequency: 2654.4, start: 0.135, attack: 0.016, decay: 0.22, gain: 0.0075, harmonics: Object.freeze([[2, 0.006]]) }),
    breath: Object.freeze({ start: 0.015, attack: 0.012, decay: 0.22, gain: 0.009, smoothing: 0.78, seed: 560 }),
    reflections: Object.freeze([
      Object.freeze({ delay: 0.018, leftGain: 0.035, rightGain: 0.06 }),
      Object.freeze({ delay: 0.043, leftGain: 0.055, rightGain: 0.025 })
    ]),
    tail: Object.freeze({
      amount: 0.09,
      decay: 0.28,
      taps: Object.freeze([
        Object.freeze({ delay: 0.047, leftGain: 0.42, rightGain: 0.28 }),
        Object.freeze({ delay: 0.082, leftGain: 0.22, rightGain: 0.39 }),
        Object.freeze({ delay: 0.121, leftGain: 0.16, rightGain: 0.12 })
      ])
    })
  }),
  soft_chime: Object.freeze({
    id: 'soft_chime',
    kind: 'asset',
    assetPath: COMPLETION_SOUND_ASSET_PATH,
    volume: DEFAULT_COMPLETION_SOUND_VOLUME
  })
});

const completionSoundObjectUrls = new Map();
let completionSoundAudioElement = null;

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

function getPreset(soundId = DEFAULT_COMPLETION_SOUND_ID) {
  return COMPLETION_SOUND_PRESETS[soundId] || COMPLETION_SOUND_PRESETS[DEFAULT_COMPLETION_SOUND_ID];
}

function writeAsciiToDataView(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function raisedAttack(localTime, attackSeconds) {
  if (localTime <= 0) return 0;
  const x = clamp(localTime / Math.max(attackSeconds, 0.000001), 0, 1);
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

function toneSample(timeSeconds, voice) {
  const localTime = timeSeconds - Number(voice.start || 0);
  if (localTime < 0) return 0;
  const envelope = raisedAttack(localTime, Number(voice.attack || 0.02)) * Math.exp(-localTime / Math.max(Number(voice.decay || 0.5), 0.001));
  const detuneRatio = 2 ** (Number(voice.detuneCents || 0) / 1200);
  const vibratoCents = Number(voice.vibratoCents || 0) * Math.sin(2 * Math.PI * Number(voice.vibratoHz || 0) * localTime);
  const vibratoRatio = 2 ** (vibratoCents / 1200);
  const phase = 2 * Math.PI * Number(voice.frequency || 440) * detuneRatio * vibratoRatio * localTime;
  let value = Math.sin(phase);
  for (const harmonic of voice.harmonics || []) {
    value += Number(harmonic[1] || 0) * Math.sin(phase * Number(harmonic[0] || 1));
  }
  return value * envelope * Number(voice.gain || 0.1);
}

function glideToneSample(timeSeconds, sweep) {
  const localTime = timeSeconds - Number(sweep.start || 0);
  const duration = Math.max(Number(sweep.duration || 0.2), 0.001);
  if (localTime < 0 || localTime >= duration) return 0;
  const progress = clamp(localTime / duration, 0, 1);
  const startFrequency = Number(sweep.startFrequency || 660);
  const endFrequency = Number(sweep.endFrequency || startFrequency);
  const frequencyDelta = endFrequency - startFrequency;
  const phase = 2 * Math.PI * (startFrequency * localTime + 0.5 * frequencyDelta * localTime * localTime / duration);
  const attack = raisedAttack(localTime, Number(sweep.attack || 0.01));
  const endWindow = 0.5 + 0.5 * Math.cos(Math.PI * progress);
  const envelope = attack * Math.exp(-localTime / Math.max(Number(sweep.decay || 0.18), 0.001)) * endWindow;
  let value = Math.sin(phase);
  for (const harmonic of sweep.harmonics || []) {
    value += Number(harmonic[1] || 0) * Math.sin(phase * Number(harmonic[0] || 1));
  }
  return value * envelope * Number(sweep.gain || 0.05);
}

function createDeterministicNoiseGenerator(seed) {
  let state = Number(seed || 1) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

function synthesizeFutureGlass(preset) {
  const sampleRate = Math.max(8000, Math.min(48000, Number(preset.sampleRate || 48000)));
  const durationSeconds = Math.max(0.2, Math.min(4, Number(preset.durationSeconds || 1.32)));
  const sampleCount = Math.ceil(sampleRate * durationSeconds);
  const mono = new Float64Array(sampleCount);
  const left = new Float64Array(sampleCount);
  const right = new Float64Array(sampleCount);
  const nextNoise = createDeterministicNoiseGenerator(preset.breath?.seed || 202);
  let smoothedNoise = 0;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const timeSeconds = sampleIndex / sampleRate;
    let value = 0;
    for (const voice of preset.voices || []) value += toneSample(timeSeconds, voice);

    const breath = preset.breath || {};
    const breathLocal = timeSeconds - Number(breath.start || 0);
    if (breathLocal >= 0) {
      const smoothing = clamp(Number(breath.smoothing || 0.78), 0, 0.995);
      smoothedNoise = smoothing * smoothedNoise + (1 - smoothing) * nextNoise();
      const breathEnvelope = raisedAttack(breathLocal, Number(breath.attack || 0.025)) * Math.exp(-breathLocal / Math.max(Number(breath.decay || 0.62), 0.001));
      value += smoothedNoise * breathEnvelope * Number(breath.gain || 0.02);
    }
    const sweep = preset.sweep || {};
    const sweepValue = glideToneSample(timeSeconds, sweep);
    mono[sampleIndex] = value + sweepValue * 0.55;
    left[sampleIndex] = value + sweepValue * Number(sweep.leftGain || 1) + toneSample(timeSeconds, preset.shimmerLeft || {});
    right[sampleIndex] = value + sweepValue * Number(sweep.rightGain || 1) + toneSample(timeSeconds, preset.shimmerRight || {});
  }

  for (const reflection of preset.reflections || []) {
    const delaySamples = Math.round(Number(reflection.delay || 0) * sampleRate);
    if (delaySamples <= 0 || delaySamples >= sampleCount) continue;
    for (let sampleIndex = delaySamples; sampleIndex < sampleCount; sampleIndex += 1) {
      const source = mono[sampleIndex - delaySamples];
      left[sampleIndex] += source * Number(reflection.leftGain || 0);
      right[sampleIndex] += source * Number(reflection.rightGain || 0);
    }
  }

  const sourceLeft = left.slice();
  const sourceRight = right.slice();
  const tail = preset.tail || {};
  for (const tap of tail.taps || []) {
    const delaySamples = Math.round(Number(tap.delay || 0) * sampleRate);
    if (delaySamples <= 0 || delaySamples >= sampleCount) continue;
    for (let sampleIndex = delaySamples; sampleIndex < sampleCount; sampleIndex += 1) {
      const tailTime = (sampleIndex - delaySamples) / sampleRate;
      const tailEnvelope = Math.exp(-tailTime / Math.max(Number(tail.decay || 0.28), 0.001));
      left[sampleIndex] += sourceLeft[sampleIndex - delaySamples] * Number(tap.leftGain || 0) * Number(tail.amount || 0.09) * tailEnvelope;
      right[sampleIndex] += sourceRight[sampleIndex - delaySamples] * Number(tap.rightGain || 0) * Number(tail.amount || 0.09) * tailEnvelope;
    }
  }

  let smoothLeft = 0;
  let smoothRight = 0;
  let peak = 0;
  const softenAlpha = clamp(Number(preset.softenAlpha || 0.34), 0.01, 1);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    smoothLeft = softenAlpha * left[sampleIndex] + (1 - softenAlpha) * smoothLeft;
    smoothRight = softenAlpha * right[sampleIndex] + (1 - softenAlpha) * smoothRight;
    left[sampleIndex] = Math.tanh((0.72 * left[sampleIndex] + 0.28 * smoothLeft) * 1.08) / Math.tanh(1.08);
    right[sampleIndex] = Math.tanh((0.72 * right[sampleIndex] + 0.28 * smoothRight) * 1.08) / Math.tanh(1.08);
    peak = Math.max(peak, Math.abs(left[sampleIndex]), Math.abs(right[sampleIndex]));
  }

  const targetPeak = clamp(Number(preset.targetPeak || 0.66), 0.1, 0.98);
  const normalize = peak > 0 ? targetPeak / peak : 1;
  const startFadeSamples = Math.max(1, Math.round(sampleRate * 0.008));
  const finalSilenceSamples = Math.max(1, Math.round(sampleRate * Number(preset.finalSilenceSeconds || 0.08)));
  const finalFadeSamples = Math.max(1, Math.round(sampleRate * Number(preset.finalFadeSeconds || 0.34)));
  const finalFadeEnd = Math.max(1, sampleCount - finalSilenceSamples);
  const finalFadeStart = Math.max(0, finalFadeEnd - finalFadeSamples);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    let fade = 1;
    if (sampleIndex < startFadeSamples) fade *= sampleIndex / startFadeSamples;
    if (sampleIndex >= finalFadeEnd) {
      fade = 0;
    } else if (sampleIndex >= finalFadeStart) {
      const progress = (sampleIndex - finalFadeStart) / Math.max(1, finalFadeEnd - finalFadeStart - 1);
      const cosineFade = 0.5 + 0.5 * Math.cos(Math.PI * clamp(progress, 0, 1));
      fade *= cosineFade * cosineFade;
    }
    left[sampleIndex] *= normalize * fade;
    right[sampleIndex] *= normalize * fade;
  }

  return { sampleRate, sampleCount, left, right };
}

function getCompletionSoundObjectUrl(preset) {
  const cached = completionSoundObjectUrls.get(preset.id);
  if (cached) return cached;
  const sound = synthesizeFutureGlass(preset);
  const channels = 2;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = sound.sampleCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAsciiToDataView(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAsciiToDataView(view, 8, 'WAVE');
  writeAsciiToDataView(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sound.sampleRate, true);
  view.setUint32(28, sound.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAsciiToDataView(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let sampleIndex = 0; sampleIndex < sound.sampleCount; sampleIndex += 1) {
    const offset = 44 + sampleIndex * blockAlign;
    view.setInt16(offset, Math.round(clamp(sound.left[sampleIndex], -1, 1) * 32767), true);
    view.setInt16(offset + 2, Math.round(clamp(sound.right[sampleIndex], -1, 1) * 32767), true);
  }
  const objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  completionSoundObjectUrls.set(preset.id, objectUrl);
  return objectUrl;
}

function getPresetSource(preset) {
  return preset.kind === 'asset'
    ? chrome.runtime.getURL(preset.assetPath || COMPLETION_SOUND_ASSET_PATH)
    : getCompletionSoundObjectUrl(preset);
}

function getAudioElement(preset) {
  const src = getPresetSource(preset);
  if (!completionSoundAudioElement || completionSoundAudioElement.src !== src) {
    completionSoundAudioElement = new Audio(src);
    completionSoundAudioElement.preload = 'auto';
  }
  completionSoundAudioElement.volume = clamp(Number(preset.volume || DEFAULT_COMPLETION_SOUND_VOLUME), 0, 1);
  return completionSoundAudioElement;
}

async function playCompletionSound(message) {
  const preset = getPreset(message?.soundId || DEFAULT_COMPLETION_SOUND_ID);
  const audio = getAudioElement(preset);
  const appliedVolume = clamp(Number(message?.volume ?? preset.volume ?? DEFAULT_COMPLETION_SOUND_VOLUME), 0, 1);
  audio.volume = appliedVolume;
  audio.currentTime = 0;
  const playResult = audio.play();
  if (playResult && typeof playResult.then === 'function') await playResult;
  return {
    ok: true,
    route: preset.kind === 'asset' ? 'offscreen_html_audio_asset' : 'offscreen_html_audio_synth',
    soundId: preset.id,
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
