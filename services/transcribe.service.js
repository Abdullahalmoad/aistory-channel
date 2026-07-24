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

function assignSceneTimestamps(scenes, words, { maxSceneSeconds = 10 } = {}) {
  let wordCursor = 0;
  const rawAssigned = [];

  for (const scene of scenes) {
    const sceneWordCount = scene.text.split(/\s+/).filter(Boolean).length;
    const sliceEnd = Math.min(wordCursor + sceneWordCount, words.length);
    const sceneWords = words.slice(wordCursor, sliceEnd);
    rawAssigned.push({ scene, sceneWords });
    wordCursor = sliceEnd;
  }

  // Hard cap: split any scene whose REAL spoken duration (from Whisper word
  // timestamps, not estimated) exceeds maxSceneSeconds into multiple sub-clips.
  // Sub-clips reuse the same image/video (same visual moment) but get their
  // own caption timing and their own camera pan/zoom + transition in render.service.js,
  // so a long narration block still cuts to a "new shot" every ~10s instead of
  // sitting on one static frame.
  const result = [];
  let nextOrder = 1;
  for (const { scene, sceneWords } of rawAssigned) {
    if (sceneWords.length === 0) {
      result.push({ ...scene, scene_order: nextOrder++, start_time: null, end_time: null });
      continue;
    }

    const chunks = splitWordsByMaxDuration(sceneWords, maxSceneSeconds);
    chunks.forEach((chunkWords, idx) => {
      const start_time = chunkWords[0].start;
      const end_time = chunkWords[chunkWords.length - 1].end;
      const text = chunkWords.map((w) => w.word).join(' ');
      result.push({
        ...scene,
        scene_order: nextOrder++,
        text,
        is_hook: idx === 0 ? scene.is_hook : false,
        start_time,
        end_time,
      });
    });
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

// Greedily groups consecutive words so that no group spans more than
// maxSeconds of real audio (based on actual Whisper start/end timestamps).
function splitWordsByMaxDuration(words, maxSeconds) {
  const chunks = [];
  let current = [];
  let chunkStart = null;

  for (const w of words) {
    if (chunkStart == null) chunkStart = w.start;
    const wouldBeDuration = w.end - chunkStart;
    if (current.length > 0 && wouldBeDuration > maxSeconds) {
      chunks.push(current);
      current = [w];
      chunkStart = w.start;
    } else {
      current.push(w);
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
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
