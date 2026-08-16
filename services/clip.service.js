const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EdgeTTS } = require('edge-tts-universal');
const { buildSrtFromWords } = require('./srt.util');

const NARRATOR_VOICE = process.env.SUMMARY_TTS_VOICE || 'en-US-EricNeural';
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const WORKER_SCRIPT = path.join(__dirname, 'transcribe_worker_auto.py');

function runFfmpeg(args, label = 'ffmpeg', timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`${label} failed:\n${stderr.slice(-2000)}`));
      resolve();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Generates the new English narration audio from the summary script.
async function generateEnglishNarration(narrationText, outputPath) {
  const tts = new EdgeTTS(narrationText, NARRATOR_VOICE, { rate: '+0%', volume: '+0%', pitch: '+0Hz' });
  const result = await tts.synthesize();
  const buffer = Buffer.from(await result.audio.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// Gets word-level timestamps for the (English) narration we just generated,
// so we can burn in synced captions.
function getNarrationWordTimestamps(audioPath) {
  return new Promise((resolve, reject) => {
    const outputJsonPath = audioPath.replace(/\.mp3$/, '') + '.words.json';
    const proc = spawn(PYTHON_BIN, [WORKER_SCRIPT, audioPath, outputJsonPath]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`caption timing failed: ${stderr}`));
      try {
        resolve(JSON.parse(fs.readFileSync(outputJsonPath, 'utf-8')).words);
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Cuts each selected clip from the source video (video only, no original
// audio), crops/scales to vertical 1080x1920, and concatenates them.
async function buildClippedVideo(sourceVideoPath, clips, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const segmentPaths = [];

  for (let i = 0; i < clips.length; i++) {
    const { start, end } = clips[i];
    const duration = Math.max(0.3, end - start);
    const segPath = path.join(workDir, `seg_${String(i).padStart(3, '0')}.mp4`);
    await runFfmpeg(
      [
        '-ss', String(start),
        '-i', sourceVideoPath,
        '-t', String(duration),
        '-an',
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
        '-r', '30',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        segPath,
      ],
      `cut segment ${i}`
    );
    segmentPaths.push(segPath);
  }

  const concatListPath = path.join(workDir, 'concat-list.txt');
  fs.writeFileSync(concatListPath, segmentPaths.map((p) => `file '${path.resolve(p)}'`).join('\n'));

  const concatenatedPath = path.join(workDir, 'clipped-silent.mp4');
  await runFfmpeg(
    ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', concatenatedPath],
    'concat segments'
  );

  return concatenatedPath;
}

// Combines the silent clipped video with the new narration audio, looping/
// trimming the video to match narration length, and burns in captions.
function getDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('close', (code) => (code === 0 ? resolve(parseFloat(out.trim())) : reject(new Error('ffprobe failed'))));
  });
}

async function assembleFinalShort({ clippedVideoPath, narrationAudioPath, words, workDir, outputPath }) {
  const srtStylePath = path.join(workDir, 'captions.srt');
  buildSrtFromWords(words, srtStylePath, 5);

  const captionStyle = "FontName=Arial,Bold=1,FontSize=26,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=100";

  // If narration ends up longer than the clipped video (speech is slower
  // than expected), loop the clipped video so it never runs out under the
  // narration instead of getting cut off mid-sentence.
  const [videoDur, narrationDur] = await Promise.all([
    getDurationSeconds(clippedVideoPath),
    getDurationSeconds(narrationAudioPath),
  ]);

  let videoInput = clippedVideoPath;
  if (videoDur > 0 && narrationDur > videoDur) {
    const loopsNeeded = Math.ceil(narrationDur / videoDur);
    const loopedPath = path.join(workDir, 'clipped-looped.mp4');
    await runFfmpeg(['-stream_loop', String(loopsNeeded - 1), '-i', clippedVideoPath, '-c', 'copy', loopedPath], 'loop clipped video');
    videoInput = loopedPath;
  }

  await runFfmpeg(
    [
      '-i', videoInput,
      '-i', narrationAudioPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-vf', `subtitles=${srtStylePath}:force_style='${captionStyle}'`,
      '-shortest',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-c:a', 'aac', '-b:a', '160k',
      outputPath,
    ],
    'assemble final short'
  );

  return outputPath;
}

module.exports = { generateEnglishNarration, getNarrationWordTimestamps, buildClippedVideo, assembleFinalShort };
