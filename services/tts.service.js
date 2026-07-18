const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const fs = require('fs');
const path = require('path');

const DEFAULT_VOICE = process.env.TTS_VOICE || 'en-US-EricNeural';

function buildNarrationSSML(scenes) {
  const body = scenes
    .map((scene) => `${escapeSSML(scene.text)}<break time="500ms"/>`)
    .join('\n');
  return body;
}

function escapeSSML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function generateNarrationAudio(scenes, options = {}) {
  const {
    outputPath = path.join('/tmp', `narration-${Date.now()}.mp3`),
    voice = DEFAULT_VOICE,
  } = options;

  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('No scenes provided for narration');
  }

  const fullText = buildNarrationSSML(scenes);

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const { audioStream } = tts.toStream(fullText);

  await new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(outputPath);
    audioStream.pipe(writeStream);
    audioStream.on('error', reject);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  return { filePath: outputPath, voice };
}

module.exports = { generateNarrationAudio, DEFAULT_VOICE };
