const { EdgeTTS } = require('edge-tts-universal');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DEFAULT_VOICE = process.env.TTS_VOICE || 'en-US-EricNeural';
const SCENES_PER_BATCH = 8;

function buildBatchText(scenes) {
  return scenes.map((scene) => scene.text).join(' ... ');
}

async function synthesizeBatch(text, outputPath, voice) {
  const tts = new EdgeTTS(text, voice, { rate: '+0%', volume: '+0%', pitch: '+0Hz' });
  const result = await tts.synthesize();
  const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
  await fsp.writeFile(outputPath, audioBuffer);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-1500)))));
  });
}

async function generateNarrationAudio(scenes, options = {}) {
  const {
    outputPath = path.join('/tmp', `narration-${Date.now()}.mp3`),
    voice = DEFAULT_VOICE,
  } = options;

  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('No scenes provided for narration');
  }

  const batchDir = path.join('/tmp', `tts-batches-${Date.now()}`);
  fs.mkdirSync(batchDir, { recursive: true });

  const batchPaths = [];
  for (let i = 0; i < scenes.length; i += SCENES_PER_BATCH) {
    const batchScenes = scenes.slice(i, i + SCENES_PER_BATCH);
    const batchText = buildBatchText(batchScenes);
    const batchPath = path.join(batchDir, `batch-${String(i).padStart(4, '0')}.mp3`);

    try {
      await synthesizeBatch(batchText, batchPath, voice);
    } catch (err) {
      console.warn(`TTS batch ${i} failed once (${err.message}), retrying...`);
      await new Promise((r) => setTimeout(r, 1000));
      await synthesizeBatch(batchText, batchPath, voice);
    }
    batchPaths.push(batchPath);
  }

  const concatListPath = path.join(batchDir, 'concat-list.txt');
  fs.writeFileSync(
    concatListPath,
    batchPaths.map((p) => `file '${path.resolve(p)}'`).join('\n')
  );
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', outputPath]);

  return { filePath: outputPath, voice };
}

module.exports = { generateNarrationAudio, DEFAULT_VOICE };
