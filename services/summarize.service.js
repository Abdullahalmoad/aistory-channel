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
  // Free-tier Groq accounts have an 8000 tokens-per-minute limit. A long
  // source video can produce a transcript big enough to blow past that on
  // its own, causing a 413 "Request too large" error. Cap how much of the
  // transcript we send (~1 token ≈ 4 chars, so this keeps the prompt safely
  // under the limit even with the rest of the instructions included).
  const MAX_TRANSCRIPT_CHARS = 7000;
  let transcriptBlock = transcriptSegments
    .map((s) => `[${fmtTime(s.start)}-${fmtTime(s.end)}] ${s.text}`)
    .join('\n');
  if (transcriptBlock.length > MAX_TRANSCRIPT_CHARS) {
    transcriptBlock = transcriptBlock.slice(0, MAX_TRANSCRIPT_CHARS) + '\n[...transcript truncated...]';
  }

  const prompt = `You are producing a viral English-language YouTube Short that summarizes a source video (source may be Arabic or English - your narration must ALWAYS be English).

Source video title: "${title}"

Timestamped transcript of the source video:
${transcriptBlock}

Your task: build a list of 12 to 18 narration "segments". Each segment has:
- "text": one punchy English sentence that will be spoken aloud - MUST be 12 to 20 words long (not shorter than 12 words - short choppy fragments make the video too short)
- "start" and "end": the timestamp range (in seconds, numbers) from the ORIGINAL video transcript above that visually matches this sentence - this is what will play on screen WHILE this sentence is narrated

Rules for a high-retention Short:
1. THE FIRST 3 SECONDS ARE EVERYTHING. Segment 1's text is the single most important sentence in the whole video - most viewers decide whether to keep watching within 3 seconds. Make it a jaw-dropping hook: a shocking claim, a bizarre fact, an urgent question, or "Most people don't know..." - it must create instant curiosity or disbelief. Never open with a slow setup, background info, or the video's general topic - open with the single most surprising or dramatic thing in the whole story.
2. TONE: Write like a fun, thrilling, energetic YouTuber talking to a friend - NOT a documentary narrator or textbook. Use casual, punchy phrasing, excitement/disbelief ("wait, it gets crazier", "here's the wild part", "and that's not even the craziest part"), and a sense of humor where it fits naturally. Keep this same high energy through EVERY segment, not just the hook - the excitement should never dip. Avoid dry academic phrasing like "it is believed that" or "historians suggest" - just say the interesting thing directly and with energy.
3. Keep sentences punchy, spoken English, EACH sentence must be 12-20 words (never shorter than 12 words) - no markdown, no stage directions.
4. Each segment's start/end range should be 2 to 10 seconds long. Never use more than 10 seconds for a single segment., taken from moments in the transcript above that best match what the sentence describes.
5. Total of all (end-start) across segments must stay under ${maxDurationSeconds} seconds.
6. End with a punchy closing line (a twist, a question, or a call to keep watching for more) - keep the fun, thrilling tone here too, not a flat summary.
7. Vary pacing: mix short and longer clips, but NEVER exceed 10 seconds for any single clip. Prefer 12 to 18 distinct clips from different moments of the source video.

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
    max_tokens: 2200,
    reasoning_effort: 'low',
    response_format: { type: 'json_object' },
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

  const MIN_SEGMENTS = 10;
  // The final Short's length is driven by the spoken narration duration,
  // not by how long the matched source clips are - so estimate narration
  // time from word count (~2.5 spoken words/sec) instead of `total`.
  const totalWords = parsed.segments.reduce((sum, s) => sum + String(s.text || '').trim().split(/\s+/).filter(Boolean).length, 0);
  const estimatedNarrationSeconds = totalWords / 2.3;
  const MIN_NARRATION_SECONDS = 60; // safety margin over the 60s target
  if (parsed.segments.length < MIN_SEGMENTS || estimatedNarrationSeconds < MIN_NARRATION_SECONDS) {
    throw new Error(
      `summarizeAndPickClips: Groq returned too few/short segments (${parsed.segments.length} segments, ~${estimatedNarrationSeconds.toFixed(1)}s estimated narration). Rejecting to avoid a too-short Short.`
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
