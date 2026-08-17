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
        resolve(JSON.parse(fs.readFileSync(outputJsonPath, 'utf-8')));
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

// Returns { segments: [{text, start, end}], title, description }
// Each segment's `text` is the English narration line that plays exactly
// while the video shows `start`-`end` from the ORIGINAL source video.
// This is the key to frame-accurate sync: the LLM picks matching pairs
// instead of one big narration + a separate clip list.
async function summarizeAndPickClips(transcriptSegments, { title, maxDurationSeconds = 175 } = {}) {
  const transcriptBlock = transcriptSegments
    .map((s) => `[${fmtTime(s.start)}-${fmtTime(s.end)}] ${s.text}`)
    .join('\n');

  const prompt = `You are producing a viral English-language YouTube Short that summarizes a source video (source may be Arabic or English - your narration must ALWAYS be English).

Source video title: "${title}"

Timestamped transcript of the source video:
${transcriptBlock}

Your task: build a list of 12 to 18 narration "segments". Each segment has:
- "text": one short punchy English sentence (max ~15 words) that will be spoken aloud
- "start" and "end": the timestamp range (in seconds, numbers) from the ORIGINAL video transcript above that visually matches this sentence - this is what will play on screen WHILE this sentence is narrated

Rules for a high-retention Short:
1. Segment 1's text MUST be a strong hook in the first sentence (a question, a shocking claim, or "Most people don't know...") - this determines if viewers keep watching past 3 seconds.
2. Keep sentences short, punchy, spoken English - no markdown, no stage directions.
3. Each segment's start/end range should be 2 to 10 seconds long. Never use more than 10 seconds for a single segment., taken from moments in the transcript above that best match what the sentence describes.
4. Total of all (end-start) across segments must stay under ${maxDurationSeconds} seconds.
5. End with a punchy closing line (a twist, a question, or a call to keep watching for more).
6. Vary pacing: mix short and longer clips, but NEVER exceed 10 seconds for any single clip. Prefer 12 to 18 distinct clips from different moments of the source video.

Also write a short catchy English YouTube title and a 1-2 sentence English description.

Return ONLY valid JSON, no markdown fences, in this exact shape:
{
  "segments": [{"text": "...", "start": 12.5, "end": 16.0}, ...],
  "title": "short catchy english title",
  "description": "1-2 sentence english description"
}`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
  });

  const raw = completion.choices[0]?.message?.content || '';
  const cleaned = raw.replace(/```json\n?|```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!parsed.segments || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    throw new Error('summarizeAndPickClips: Groq did not return valid segments');
  }

  // Clamp total source-clip duration to maxDurationSeconds (narration length
  // is handled later per-segment once TTS is generated).
  let total = 0;
  const clamped = [];
  for (const s of parsed.segments) {
    const start = Math.max(0, Number(s.start));
    const originalEnd = Number(s.end);
    if (!Number.isFinite(start) || !Number.isFinite(originalEnd) || originalEnd <= start) continue;

    // HARD CAP: every source clip is maximum 10 seconds.
    const end = Math.min(originalEnd, start + 10);
    const dur = Math.max(0.5, end - start);

    if (total + dur > maxDurationSeconds) continue; // skip this one, keep checking the rest

    clamped.push({
      ...s,
      start,
      end
    });

    total += dur;
  }
  parsed.segments = clamped;

  const MIN_SEGMENTS = 12;
  const MIN_TOTAL_SECONDS = 70; // ensures the final Short comfortably clears 60s
  if (parsed.segments.length < MIN_SEGMENTS || total < MIN_TOTAL_SECONDS) {
    throw new Error(
      `summarizeAndPickClips: Groq returned too few/short segments (${parsed.segments.length} segments, ${total.toFixed(1)}s total). Rejecting to avoid a too-short Short.`
    );
  }

  return parsed;
}

async function transcribeAndSummarize(videoPath, workDir, { title, maxDurationSeconds = 175 } = {}) {
  console.log('  -> Extracting audio...');
  const audioPath = await extractAudio(videoPath, workDir);

  console.log('  -> Transcribing (auto language detection)...');
  const { words, language } = await getWordTimestampsAuto(audioPath);
  if (!words || words.length === 0) throw new Error('No speech detected in source video');
  console.log(`  -> Detected language: ${language}, ${words.length} words`);

  const transcriptSegments = buildTimestampedTranscript(words);

  console.log('  -> Summarizing into synced English segments...');
  let result;
  let lastErr;
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      result = await summarizeAndPickClips(transcriptSegments, { title, maxDurationSeconds });
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`  -> summarizeAndPickClips attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`);
    }
  }
  if (!result) throw lastErr;

  return { ...result, sourceLanguage: language };
}

module.exports = { transcribeAndSummarize, extractAudio, buildTimestampedTranscript, summarizeAndPickClips };
