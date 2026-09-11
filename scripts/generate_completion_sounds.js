'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('../tools/playwright_browser');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'sounds');
const targetRmsDb = -21;
const peakCeilingDb = -1.7;
const targetRms = 10 ** (targetRmsDb / 20);
const peakCeiling = 10 ** (peakCeilingDb / 20);

const presets = [
  { number: 1, duration: 1.28, voices: [[659.25, 0.00, .018, .34, .42, -.25], [987.77, .07, .018, .42, .31, .25], [1318.51, .13, .015, .30, .12, .45]] },
  { number: 2, duration: .88, voices: [[739.99, 0.00, .006, .14, .38, -.30], [987.77, .105, .006, .17, .34, .30]], pulse: true }
];

function filenameFor(number) {
  return `notification-${String(number).padStart(2, '0')}.wav`;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const filename of fs.readdirSync(outputDir)) {
    if (/^notification-\d{2}\.(?:webm|wav)$/i.test(filename)) fs.rmSync(path.join(outputDir, filename));
  }
  const browser = await launchBrowser({ headless: true });
  const page = await browser.newPage();
  const report = [];
  try {
    for (const preset of presets) {
      const result = await page.evaluate(async ({ preset, targetRms, peakCeiling }) => {
        const sampleRate = 48000;
        const sampleCount = Math.ceil(preset.duration * sampleRate);
        const left = new Float32Array(sampleCount);
        const right = new Float32Array(sampleCount);

        function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
        function addTone([frequency, start, attack, decay, gain, pan]) {
          const startSample = Math.max(0, Math.floor(start * sampleRate));
          const leftGain = Math.cos((clamp(pan, -1, 1) + 1) * Math.PI / 4);
          const rightGain = Math.sin((clamp(pan, -1, 1) + 1) * Math.PI / 4);
          for (let index = startSample; index < sampleCount; index += 1) {
            const localTime = index / sampleRate - start;
            const attackEnvelope = Math.sin(Math.PI * .5 * clamp(localTime / Math.max(attack, .001), 0, 1));
            const decayEnvelope = Math.exp(-localTime / Math.max(decay, .001));
            const endFade = clamp((preset.duration - index / sampleRate) / .12, 0, 1);
            const phase = 2 * Math.PI * frequency * localTime;
            let sample = Math.sin(phase) + .12 * Math.sin(phase * 2.003) + .035 * Math.sin(phase * 3.011);
            if (preset.pulse) sample *= .78 + .22 * Math.sin(2 * Math.PI * 7 * localTime);
            sample *= attackEnvelope * decayEnvelope * endFade * gain;
            left[index] += sample * leftGain;
            right[index] += sample * rightGain;
          }
        }
        for (const voice of preset.voices) addTone(voice);

        if (preset.noise) {
          let seed = 1000 + preset.number;
          let smoothed = 0;
          for (let index = 0; index < sampleCount; index += 1) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const noise = seed / 0xffffffff * 2 - 1;
            smoothed = .88 * smoothed + .12 * noise;
            const time = index / sampleRate;
            const envelope = Math.sin(Math.PI * .5 * clamp(time / .025, 0, 1)) * Math.exp(-time / .34);
            const sample = smoothed * envelope * preset.noise;
            left[index] += sample * .82;
            right[index] += sample;
          }
        }

        const soften = Number(preset.soften || 0);
        if (soften > 0) {
          let smoothL = 0;
          let smoothR = 0;
          for (let index = 0; index < sampleCount; index += 1) {
            smoothL = soften * smoothL + (1 - soften) * left[index];
            smoothR = soften * smoothR + (1 - soften) * right[index];
            left[index] = .7 * left[index] + .3 * smoothL;
            right[index] = .7 * right[index] + .3 * smoothR;
          }
        }

        let sumSquares = 0;
        let peak = 0;
        for (let index = 0; index < sampleCount; index += 1) {
          sumSquares += (left[index] ** 2 + right[index] ** 2) / 2;
          peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
        }
        const rms = Math.sqrt(sumSquares / sampleCount);
        const gain = Math.min(targetRms / Math.max(rms, 1e-9), peakCeiling / Math.max(peak, 1e-9));
        for (let index = 0; index < sampleCount; index += 1) {
          left[index] *= gain;
          right[index] *= gain;
        }

        const channelCount = 2;
        const bitsPerSample = 16;
        const blockAlign = channelCount * bitsPerSample / 8;
        const dataByteLength = sampleCount * blockAlign;
        const wavBuffer = new ArrayBuffer(44 + dataByteLength);
        const view = new DataView(wavBuffer);
        function writeAscii(offset, text) {
          for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
        }
        writeAscii(0, 'RIFF');
        view.setUint32(4, 36 + dataByteLength, true);
        writeAscii(8, 'WAVE');
        writeAscii(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channelCount, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeAscii(36, 'data');
        view.setUint32(40, dataByteLength, true);
        let offset = 44;
        let decodedSquares = 0;
        let decodedPeak = 0;
        for (let index = 0; index < sampleCount; index += 1) {
          for (const sample of [left[index], right[index]]) {
            const clamped = clamp(sample, -1, 1);
            const quantized = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
            view.setInt16(offset, quantized, true);
            offset += 2;
            const decodedSample = quantized / 32768;
            decodedSquares += decodedSample ** 2;
            decodedPeak = Math.max(decodedPeak, Math.abs(decodedSample));
          }
        }
        const decodedRms = Math.sqrt(decodedSquares / Math.max(sampleCount * channelCount, 1));
        const bytes = new Uint8Array(wavBuffer);
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        return {
          base64: btoa(binary),
          bytes: bytes.length,
          sourceRmsDb: 20 * Math.log10(rms * gain),
          sourcePeakDb: 20 * Math.log10(peak * gain),
          decodedRmsDb: 20 * Math.log10(decodedRms),
          decodedPeakDb: 20 * Math.log10(decodedPeak),
          durationSeconds: sampleCount / sampleRate
        };
      }, { preset, targetRms, peakCeiling });

      const filename = filenameFor(preset.number);
      fs.writeFileSync(path.join(outputDir, filename), Buffer.from(result.base64, 'base64'));
      report.push({
        number: preset.number,
        filename,
        codec: 'PCM signed 16-bit little-endian',
        container: 'WAV',
        bytes: result.bytes,
        durationSeconds: Number(result.durationSeconds.toFixed(3)),
        sourceRmsDb: Number(result.sourceRmsDb.toFixed(2)),
        sourcePeakDb: Number(result.sourcePeakDb.toFixed(2)),
        decodedRmsDb: Number(result.decodedRmsDb.toFixed(2)),
        decodedPeakDb: Number(result.decodedPeakDb.toFixed(2))
      });
    }
  } finally {
    await browser.close();
  }

  const decodedLevels = report.map((item) => item.decodedRmsDb);
  const spreadDb = Math.max(...decodedLevels) - Math.min(...decodedLevels);
  const normalization = {
    method: 'full-duration stereo RMS normalization written directly as PCM 16-bit WAV, verified after quantization',
    targetRmsDb,
    peakCeilingDb,
    decodedRmsSpreadDb: Number(spreadDb.toFixed(2)),
    files: report
  };
  fs.writeFileSync(
    path.join(outputDir, 'completion-sound-normalization.json'),
    `${JSON.stringify(normalization, null, 2)}\n`,
    'utf8'
  );
  if (spreadDb > 1.5) throw new Error(`Decoded RMS spread is too large: ${spreadDb.toFixed(2)} dB`);
  console.log(JSON.stringify(normalization, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
