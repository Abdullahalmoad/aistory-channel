const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const WORKER_SCRIPT = path.join(__dirname, 'transcribe_worker.py');

function getWordTimestamps(audioPath) {
  return new Promise((resolve, reject) => {
    const outputJsonPath = audioPath.replace(/\.mp3$/, '') + '.words.json';

    const proc = spawn(PYTHON_BIN, [WORKER_SCRIPT, audioPath, outputJsonPath]);

    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`transcribe_worker.py exited with code ${code}: ${stderr}`));
      }
      try {
        const json = JSON.parse(fs.readFileSync(outputJsonPath, 'utf-8'));
        resolve(json.words);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function assignSceneTimestamps(scenes, words) {
  let wordCursor = 0;
  const result = [];

  for (const scene of scenes) {
    const sceneWordCount = scene.text.split(/\s+/).filter(Boolean).length;
    const sliceEnd = Math.min(wordCursor + sceneWordCount, words.length);
    const sceneWords = words.slice(wordCursor, sliceEnd);

    const start_time = sceneWords[0]?.start ?? null;
    const end_time = sceneWords[sceneWords.length - 1]?.end ?? null;

    result.push({ ...scene, start_time, end_time });
    wordCursor = sliceEnd;
  }

  for (let i = 0; i < result.length; i++) {
    if (result[i].start_time == null) {
      result[i].start_time = result[i - 1]?.end_time ?? 0;
    }
    if (result[i].end_time == null) {
      const next = result[i + 1];
      result[i].end_time = next?.start_time ?? result[i].start_time + 3;
    }
  }

  return result;
}

async function transcribeAndAssign(audioPath, scenes) {
  const words = await getWordTimestamps(audioPath);
  if (!words || words.length === 0) {
    throw new Error('Whisper returned no words - check audio file and worker logs');
  }
  const scenesWithTimestamps = assignSceneTimestamps(scenes, words);
  return { words, scenes: scenesWithTimestamps };
}

module.exports = { transcribeAndAssign, getWordTimestamps, assignSceneTimestamps };
