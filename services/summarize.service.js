const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const WORKER_SCRIPT = path.join(__dirname, 'transcribe_worker_auto.py');

function runFfmpeg(args, label = 'ffmpeg') {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed:\n${stderr.slice(-1500)}`))));
  });
}

async function extractAudio(videoPath, workDir) {
  const audioPath = path.join(workDir, 'source-audio.mp3');
  await runFfmpeg(['-i', videoPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', audioPath], 'extract audio');
  return audioPath;
}

function getWordTimestampsAuto(audioPath) {
  return new Promise((resolve, reject) => {
    const outputJsonPath = audioPath.replace(/\.mp3$/, '') + '.words.json';
    const proc = spawn(PYTHON_BIN, [WORKER_SCRIPT, audioPath, outputJsonPath]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`transcribe_worker_auto.py exited with code ${code}: ${stderr}`));
      try {
        const json = JSON.parse(fs.readFileSync(outputJsonPath, 'utf-8'));
        resolve(json);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function buildTimestampedTranscript(words, segmentSeconds = 5) {
  const segments = [];
  let current = [];
  let segStart = null;

  for (const w of words) {
    if (segStart == null) segStart = w.start;
    current.push(w);
    if (w.end - segStart >= segmentSeconds) {
      segments.push({ start: segStart, end: w.end, text: current.map((x) => x.word).join(' ') });
      current = [];
      segStart = null;
    }
  }
  if (current.length > 0) {
    segments.push({ start: segStart, end: current[current.length - 1].end, text: current.map((x) => x.word).join(' ') });
  }
  return segments;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

async function summarizeAndPickClips(segments, { title, maxDurationSeconds = 175 } = {}) {
  const transcriptBlock = segments
    .map((s) => `[${fmtTime(s.start)}-${fmtTime(s.end)}] ${s.text}`)
    .join('\n');

  const totalSourceSeconds = segments.length ? segments[segments.length - 1].end : null;
  const totalSourceLabel = totalSourceSeconds != null ? fmtTime(totalSourceSeconds) : 'unknown';

  const prompt = `You are producing an English-language YouTube Shorts summary of a source video (the source may be in Arabic or English - it doesn't matter, your output narration script must always be in English).

Source video title: "${title}"
Total source video length: ${totalSourceLabel} (timestamps below cover the FULL video from start to end)

Timestamped transcript of the source video:
${transcriptBlock}

Your task:
1. Write a punchy English narration script that summarizes the video's most interesting content, written for a ~${maxDurationSeconds}-second YouTube Short. Hook in the first sentence. Clear, energetic, simple spoken English (no markdown, no stage directions).
2. Select which original-video timestamp ranges best visually match/support this narration, in the order they should appear. Total selected duration should be close to but not exceed ${maxDurationSeconds} seconds.
   - Use AT LEAST 10 clips, ideally 12-18 clips, each roughly 2-6 seconds long, so the Short feels like a fast-paced visual summary, not a few long repeated shots.
   - Spread the selected clips across the ENTIRE source video timeline (beginning, middle, AND end) in rough proportion to its full length (${totalSourceLabel}) - do NOT cluster all clips in the first minute. The Short should visually represent the whole video, not just its intro.
   - Prefer the most visually interesting or information-dense moments, but make sure different sections/topics of the video are all represented.
3. Write a short English YouTube title and description for this Short.

Return ONLY valid JSON, no markdown fences, in this exact shape:
{
  "narration": "full english narration script as one string",
  "clips": [{"start": 12.5, "end": 18.0}, ...],
  "title": "short catchy english title",
  "description": "1-2 sentence english description"
}`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content || '';
  const cleaned = raw.replace(/```json\n?|```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!parsed.narration || !Array.isArray(parsed.clips) || parsed.clips.length === 0) {
    throw new Error('summarizeAndPickClips: Groq did not return valid narration/clips');
  }

  // The model doesn't always follow the "use many short clips" instruction.
  // Enforce it in code: split any clip longer than MAX_SEG_SECONDS into
  // several shorter back-to-back sub-clips, so the final Short always has
  // plenty of quick cuts (fast-paced summary feel) no matter what the model
  // returned, while still covering the exact same source timestamp ranges
  // (and therefore the same spread across the video) the model picked.
  const MAX_SEG_SECONDS = 5;
  const splitClips = [];
  for (const c of parsed.clips) {
    const dur = c.end - c.start;
    if (dur <= MAX_SEG_SECONDS) {
      splitClips.push(c);
      continue;
    }
    const pieces = Math.ceil(dur / MAX_SEG_SECONDS);
    const pieceLen = dur / pieces;
    for (let i = 0; i < pieces; i++) {
      splitClips.push({ start: c.start + i * pieceLen, end: c.start + (i + 1) * pieceLen });
    }
  }
  parsed.clips = splitClips;

  let total = 0;
  const clampedClips = [];
  for (const c of parsed.clips) {
    const dur = Math.max(0, c.end - c.start);
    if (total + dur > maxDurationSeconds) {
      const remaining = maxDurationSeconds - total;
      if (remaining > 1) clampedClips.push({ start: c.start, end: c.start + remaining });
      break;
    }
    clampedClips.push(c);
    total += dur;
  }
  parsed.clips = clampedClips;

  return parsed;
}

async function transcribeAndSummarize(videoPath, workDir, { title, maxDurationSeconds = 175 } = {}) {
  console.log('  -> Extracting audio...');
  const audioPath = await extractAudio(videoPath, workDir);

  console.log('  -> Transcribing (auto language detection)...');
  const { words, language } = await getWordTimestampsAuto(audioPath);
  if (!words || words.length === 0) throw new Error('No speech detected in source video');
  console.log(`  -> Detected language: ${language}, ${words.length} words`);

  const segments = buildTimestampedTranscript(words);

  console.log('  -> Summarizing + selecting clips (English)...');
  const result = await summarizeAndPickClips(segments, { title, maxDurationSeconds });

  return { ...result, sourceLanguage: language };
}

module.exports = { transcribeAndSummarize, extractAudio, buildTimestampedTranscript, summarizeAndPickClips };
