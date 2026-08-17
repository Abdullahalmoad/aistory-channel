const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EdgeTTS } = require('edge-tts-universal');
const { buildSrtFromWords } = require('./srt.util');

const NARRATOR_VOICE = process.env.SUMMARY_TTS_VOICE || 'en-US-EricNeural';
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const WORKER_SCRIPT = path.join(__dirname, 'transcribe_worker_auto.py');

function runFfmpeg(args, label = 'ffmpeg', timeoutMs = 6 * 60 * 1000) {
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

function getDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('close', (code) => (code === 0 ? resolve(parseFloat(out.trim())) : reject(new Error('ffprobe failed'))));
  });
}

async function generateSegmentNarration(text, outputPath) {
  const tts = new EdgeTTS(text, NARRATOR_VOICE, { rate: '+2%', volume: '+0%', pitch: '+0Hz' });
  const result = await tts.synthesize();
  const buffer = Buffer.from(await result.audio.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

function getWordTimestamps(audioPath) {
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

// Builds ONE final vertical Short where every narration sentence is
// frame-accurately synced to its matching original-video moment:
// for each segment -> generate its narration audio -> measure its exact
// duration -> stretch/compress that segment's source video clip (speed
// change, not freeze-frames or jarring loops) to match that exact duration
// -> mux video+narration+captions for that segment -> concat all segments.
async function buildSyncedShort({ sourceVideoPath, segments, workDir, outputPath }) {
  fs.mkdirSync(workDir, { recursive: true });
  const segmentOutputs = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const idx = String(i).padStart(3, '0');
    console.log(`    segment ${idx}: "${seg.text.slice(0, 50)}..."`);

    // 1) Narration audio for this sentence only
    const narrationPath = path.join(workDir, `narration_${idx}.mp3`);
    await generateSegmentNarration(seg.text, narrationPath);
    const narrationDur = await getDurationSeconds(narrationPath);

    // 2) Word timestamps for this segment's captions
    const words = await getWordTimestamps(narrationPath);

    // 3) Cut the matching source clip, scale to vertical
    const rawClipPath = path.join(workDir, `raw_${idx}.mp4`);
    const clipDur = Math.max(0.3, seg.end - seg.start);
    // Keep the source video's full frame centered (no cropping of the
    // sides/top), with a blurred, filled copy of itself behind it as a
    // letterbox background instead of hard black bars.
    const letterboxFilter =
      '[0:v]split=2[bg][fg];' +
      '[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=25[bgblur];' +
      '[fg]scale=1080:-2:force_original_aspect_ratio=decrease[fgscaled];' +
      '[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2';
    await runFfmpeg(
      [
        '-ss', String(seg.start),
        '-i', sourceVideoPath,
        '-t', String(clipDur),
        '-an',
        '-filter_complex', letterboxFilter,
        '-r', '30',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        rawClipPath,
      ],
      `cut raw clip ${idx}`
    );

    // 4) Stretch/compress video speed so it matches narration length exactly
    //    (smoother than freeze-frames or abrupt loops).
    const speedFactor = clipDur / narrationDur; // ffmpeg setpts multiplier
    const clampedFactor = Math.min(4, Math.max(0.25, speedFactor));
    const matchedClipPath = path.join(workDir, `matched_${idx}.mp4`);
    await runFfmpeg(
      [
        '-i', rawClipPath,
        '-vf', `setpts=${clampedFactor}*PTS`,
        '-an',
        '-r', '30',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        matchedClipPath,
      ],
      `time-stretch clip ${idx}`
    );

    // 5) Burn per-segment captions (word-level, punchy style)
    const srtPath = path.join(workDir, `captions_${idx}.srt`);
    buildSrtFromWords(words, srtPath, 3);
    const captionStyle = "FontName=Arial,Bold=1,FontSize=58,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=6,Shadow=2,Alignment=2,MarginV=160";

    // 6) Mux this segment's matched video + its narration + captions
    const segOutPath = path.join(workDir, `final_seg_${idx}.mp4`);
    await runFfmpeg(
      [
        '-i', matchedClipPath,
        '-i', narrationPath,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-vf', `subtitles=${srtPath}:force_style='${captionStyle}'`,
        '-shortest',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-c:a', 'aac', '-b:a', '160k',
        segOutPath,
      ],
      `mux segment ${idx}`
    );

    segmentOutputs.push(segOutPath);
  }

  // 7) Concat all synced segments into the final Short
  const concatListPath = path.join(workDir, 'concat-list.txt');
  fs.writeFileSync(concatListPath, segmentOutputs.map((p) => `file '${path.resolve(p)}'`).join('\n'));
  await runFfmpeg(
    ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', outputPath],
    'concat final segments'
  );

  return outputPath;
}

module.exports = { buildSyncedShort, getDurationSeconds };
