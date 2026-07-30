#!/usr/bin/env bash
set -e

# Run this from the root of your aistory-channel repo (in your Codespaces terminal).

mkdir -p "services"
cat > "services/topics.service.js" << 'CLAUDE_PATCH_EOF'
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const TOPICS_PATH = path.join(__dirname, '..', 'topics.json');

const CATEGORIES = ['ancient human survival in harsh conditions', 'strange prehistoric habits and rituals', 'medicine and healing before modern science', 'animal behavior and its link to early humans', 'daily-life challenges in the Stone Age', 'archaeological discoveries that changed what we know about our ancestors'];

function loadTopics() {
  const raw = fs.readFileSync(TOPICS_PATH, 'utf-8');
  return JSON.parse(raw);
}

function saveTopics(data) {
  fs.writeFileSync(TOPICS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

async function generateNewTopics(existingTopics, count = 10) {
  const existingList = existingTopics.map((t) => `- ${t.topic}`).join('\n');
  const categoryList = CATEGORIES.join(', ');
  const prompt = `You generate topic ideas for a YouTube channel that makes long-form (10-15 minute) videos about fascinating facts and survival questions from prehistory and the ancient human past, across these angles: ${categoryList}. The channel's whole identity is curiosity and "did you know / what would happen if" intrigue - NOT a horror or true-crime channel.

Here are topics already used - do NOT repeat these or anything too similar:
${existingList}

Generate ${count} brand new topic ideas, mixing across all the categories above (not just one).

Hard requirements for every topic:
- Phrase it as a short curiosity-driven question or hook, under 12 words - matching this exact style: "How did ancient humans keep a fire burning for days without matches?" or "What happened if someone got separated from their tribe in the Stone Age?".
- Ground it in a real, generally-known anthropological or historical fact/theory (simplified for narration is fine, but it must not be pure invention with no basis).
- It needs a clear "survival or human challenge" angle that can support a full narrative with a beginning, build-up, and payoff - not just a flat one-line trivia fact.
- Avoid anything purely academic/abstract with no concrete survival or human-challenge angle.

Return ONLY a JSON array of strings, nothing else, no markdown formatting.`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.9,
  });

  const raw = completion.choices[0]?.message?.content || '';
  const cleaned = raw.replace(/```json\n?|```\n?/g, '').trim();
  const topics = JSON.parse(cleaned);
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error('generateNewTopics: Groq did not return a valid topic array');
  }
  return topics;
}

async function getNextTopic() {
  const data = loadTopics();
  let next = data.topics.find((t) => !t.used);

  if (!next) {
    console.log('  -> Topic queue empty, generating new topics via Groq...');
    const newTopics = await generateNewTopics(data.topics, 10);
    for (const topic of newTopics) {
      data.topics.push({ topic, used: false });
    }
    saveTopics(data);
    next = data.topics.find((t) => !t.used);
    if (!next) {
      throw new Error('Topic queue is empty - failed to generate new topics');
    }
    console.log(`  -> Added ${newTopics.length} new topics`);
  }

  next.used = true;
  saveTopics(data);
  return next.topic;
}

function addTopic(topic) {
  const data = loadTopics();
  data.topics.push({ topic, used: false });
  saveTopics(data);
}

module.exports = { getNextTopic, addTopic };
CLAUDE_PATCH_EOF

cat > "topics.json" << 'CLAUDE_PATCH_EOF'
{
  "topics": [
    { "topic": "How did ancient humans keep a fire burning for days without matches?", "used": false },
    { "topic": "What did ancient humans do when it rained for weeks straight?", "used": false },
    { "topic": "What did people do about a toothache 9,000 years ago?", "used": false },
    { "topic": "Do animals actually understand the meaning of death?", "used": false },
    { "topic": "The harshest survival methods ancient humans used during the Ice Age", "used": false },
    { "topic": "How did ancient tribes predict a storm before it hit?", "used": false },
    { "topic": "What happened if someone got separated from their tribe in the Stone Age?", "used": false },
    { "topic": "How did ancient humans treat a broken bone with no doctor?", "used": false },
    { "topic": "Why did some prehistoric animals go extinct while others survived to today?", "used": false },
    { "topic": "How did ancient people cross a wide river with no boats or bridges?", "used": false },
    { "topic": "How did ancient humans find clean water with no tools at all?", "used": false },
    { "topic": "What was the most dangerous moment in a Stone Age hunter's ordinary day?", "used": false },
    { "topic": "How did ancient women give birth with no medical help at all?", "used": false },
    { "topic": "How did ancient humans know which plants were poisonous before tasting them?", "used": false },
    { "topic": "How did ancient humans sleep at night without fear of predators?", "used": false },
    { "topic": "How did ancient tribes choose where to permanently settle down?", "used": false },
    { "topic": "What happened to elders who could no longer keep up with the tribe?", "used": false },
    { "topic": "How did ancient humans first discover they could tame wild animals?", "used": false }
  ]
}
CLAUDE_PATCH_EOF

mkdir -p "services"
cat > "services/script.service.js" << 'CLAUDE_PATCH_EOF'
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const NARRATION_WPM = 145;
const MIN_TARGET_WORDS = 1450; // ~10 minutes
const MAX_TARGET_WORDS = 2200; // ~15 minutes

function pickTargetWords() {
  return Math.round(MIN_TARGET_WORDS + Math.random() * (MAX_TARGET_WORDS - MIN_TARGET_WORDS));
}

const SYSTEM_PROMPT = `You are a scriptwriter for a YouTube channel about fascinating facts and survival questions from prehistory and the ancient human past - long-form videos (10-15 minutes), narrated over a fixed hand-drawn sketch illustration style (one consistent recurring character across every scene, NOT real photos, NOT real stock video, NOT a photorealistic style).

Your job: turn the given topic into a single continuous, curiosity-driven narrative script split into short scenes, suitable for text-to-speech narration and one generated illustration per scene.

Respond with STRICT JSON only. No markdown code fences, no commentary before or after the JSON.

Exact shape required:
{
  "title": "Compelling YouTube title phrased as a short question or hook, under 12 words",
  "description": "2-4 sentence YouTube description mentioning the topic naturally, plus 3-5 relevant hashtags at the end",
  "tags": ["tag1", "tag2", "..."],
  "thumbnail_text": "2-4 punchy ALL CAPS words for a YouTube thumbnail overlay, maximum curiosity, no punctuation",
  "thumbnail_image_prompt": "Short, concrete English description of ONE scene's setting and action for use as the thumbnail background (the character itself is fixed elsewhere in the pipeline - do not describe their appearance here, just the scene)",
  "estimated_word_count": 1800,
  "scenes": [
    {
      "scene_order": 1,
      "text": "2-4 sentences of narration for this scene only (aim for roughly 15-25 seconds spoken aloud)",
      "is_hook": true or false,
      "image_prompt": "Short, concrete English description of the setting, action, and mood for THIS scene only, e.g. 'the character running through heavy rain, chasing a herd of bison across a plain, storm clouds overhead'. Do NOT describe the character's appearance, clothing, or the art style - that is fixed automatically elsewhere in the pipeline. No text or words inside the image."
    }
  ]
}

Rules:
- Each scene should cover roughly 15-25 seconds of spoken narration (3-5 short sentences) - never write a much longer or much shorter block as a single scene. If a moment needs more narration, split it across consecutive scenes instead.
- Total scene count should scale naturally with the target word count given in the user message - do not artificially cap or pad it.
- Build the script with a clear structure: an opening hook (first 15-20 seconds) that poses the question or scenario in a striking, direct way -> 3-4 sections that expand on the topic in escalating detail (accumulating facts, examples, historical/scientific context in a logical order) -> a genuine closing "payoff" that actually answers the opening question or lands the biggest takeaway - not a recap of what was already said.
- Stick to information that is generally accepted or credibly theorized by historians/anthropologists; when something is disputed or uncertain, say so honestly (e.g. "researchers believe" or "most likely") instead of presenting speculation as settled fact.
- Mark is_hook = true on roughly 3 to 6 scenes (scale with video length) that are the single most curiosity-driving or surprising moments in the whole video (these will later be cut into a vertical teaser Short/Reels that links to the full video). Prefer the opening hook and the biggest single reveal or turning point.
- The narration should read naturally when spoken aloud (avoid text formatting like bullet points, avoid emoji in the "text" field).
- The LAST scene must be a genuine closing thought in your own voice (e.g. the real answer to the opening question, why it still matters today, a lingering open question) - NOT a summary of the plot. This is required editorial content, not filler.
- The response MUST be valid JSON, parsable directly with JSON.parse, with no trailing commas.`;

const NARRATIVE_STYLES = [
  'Open with the central curiosity question of the topic, then unfold the answer chronologically/logically from the start.',
  'Start at the most dramatic or surprising moment related to the topic, then rewind to build the full context that leads there.',
  'Structure it as a gradual build of smaller, stranger details that accumulate into the full picture.',
  'Frame it around different theories or explanations researchers have proposed, weighing each against the actual evidence.',
  'Tell it as one representative day in the life of a person facing this exact challenge, start to finish.',
];

function pickNarrativeStyle() {
  return NARRATIVE_STYLES[Math.floor(Math.random() * NARRATIVE_STYLES.length)];
}

async function generateScript(topic, options = {}) {
  const { targetWords = pickTargetWords(topic) } = options;

  const userPrompt = `Topic: ${topic}
Target narration word count: approximately ${targetWords} words (~${Math.round(targetWords / NARRATION_WPM)} minutes of spoken video - videos on this channel run 10 to 15 minutes).
Language: English.
Choose the narrative structure that best fits THIS specific topic's content and tone. Pick exactly ONE of the following approaches (do not blend them, do not default to the same one every time - base your choice on what suits this topic best):
${NARRATIVE_STYLES.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return the full script now as strict JSON matching the required shape exactly.`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.85,
    max_tokens: 8000,
    response_format: { type: 'json_object' },
  });

  const rawText = completion.choices[0]?.message?.content;
  if (!rawText) {
    throw new Error('Groq returned no content');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  }

  if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error('Generated script has no valid scenes');
  }

  parsed.scenes = parsed.scenes.map((scene, idx) => ({
    scene_order: scene.scene_order ?? idx + 1,
    text: (scene.text || '').trim(),
    is_hook: Boolean(scene.is_hook),
    image_prompt: scene.image_prompt || null,
  }));

  const hookCount = parsed.scenes.filter((s) => s.is_hook).length;
  if (hookCount === 0) {
    parsed.scenes[0].is_hook = true;
    if (parsed.scenes.length > 1) {
      const lastIdx = parsed.scenes.length - 1;
      parsed.scenes[lastIdx].is_hook = true;
    }
  }

  const actualWordCount = parsed.scenes.reduce(
    (sum, s) => sum + s.text.split(/\s+/).filter(Boolean).length,
    0
  );

  const proofreadScenesResult = await proofreadScenes(parsed.scenes);

  return {
    title: parsed.title || topic,
    description: parsed.description || '',
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    thumbnail_text: parsed.thumbnail_text || '',
    thumbnail_image_prompt: parsed.thumbnail_image_prompt || null,
    estimated_word_count: actualWordCount,
    scenes: proofreadScenesResult,
  };
}

const PROOFREAD_SYSTEM_PROMPT = `You are a strict English copy editor. You will receive a JSON array of narration lines that will be converted to speech by a text-to-speech engine.

Your ONLY job: fix spelling mistakes, typos, and grammar errors. Do NOT change the meaning, do NOT rewrite for style, do NOT shorten or lengthen lines, do NOT change facts.

If a line is already correct, return it completely unchanged.

Respond with STRICT JSON only, no markdown code fences, no commentary. Exact shape:
{
  "lines": ["corrected line 1", "corrected line 2", "..."]
}
The "lines" array MUST have exactly the same number of items, in the same order, as the input array.`;

async function proofreadScenes(scenes) {
  const originalLines = scenes.map((s) => s.text);

  let completion;
  try {
    completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: PROOFREAD_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ lines: originalLines }) },
      ],
      temperature: 0.1,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
    });
  } catch (err) {
    console.warn(`Proofread pass failed (${err.message}) - keeping original text unmodified`);
    return scenes.map((s) => ({ ...s, was_corrected: false }));
  }

  const rawText = completion.choices[0]?.message?.content;
  if (!rawText) {
    console.warn('Proofread pass returned no content - keeping original text unmodified');
    return scenes.map((s) => ({ ...s, was_corrected: false }));
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    console.warn('Proofread pass returned invalid JSON - keeping original text unmodified');
    return scenes.map((s) => ({ ...s, was_corrected: false }));
  }

  const correctedLines = parsed.lines;
  if (!Array.isArray(correctedLines) || correctedLines.length !== originalLines.length) {
    console.warn(
      `Proofread pass returned ${correctedLines?.length ?? 0} lines, expected ${originalLines.length} - keeping original text unmodified`
    );
    return scenes.map((s) => ({ ...s, was_corrected: false }));
  }

  let correctionCount = 0;
  const result = scenes.map((scene, idx) => {
    const corrected = (correctedLines[idx] || '').trim();
    const wasCorrected = corrected && corrected !== scene.text;
    if (wasCorrected) correctionCount++;
    return {
      ...scene,
      text: corrected || scene.text,
      was_corrected: Boolean(wasCorrected),
    };
  });

  console.log(`  -> Proofread pass: ${correctionCount}/${scenes.length} line(s) corrected`);
  return result;
}

module.exports = { generateScript, pickNarrativeStyle, NARRATIVE_STYLES, proofreadScenes };
CLAUDE_PATCH_EOF

mkdir -p "services"
cat > "services/image.service.js" << 'CLAUDE_PATCH_EOF'
const fs = require('fs');
const path = require('path');

const POLLINATIONS_KEY = process.env.POLLINATIONS_KEY;
const GEN_BASE = 'https://gen.pollinations.ai';
// kontext = Flux Kontext, strong at consistent image editing/reference-following.
// nanobanana / nanobanana-2 are alternatives - compare cost/quality via GET /image/models.
const IMAGE_MODEL = process.env.POLLINATIONS_IMAGE_MODEL || 'kontext';

const CHARACTER_REF_PATH = path.join(__dirname, '..', 'assets', 'character-reference.png');

// وصف الشخصية والستايل الثابت - يُضاف تلقائياً لكل مشهد. السكربت (script.service.js)
// لا يعيد وصف الشخصية أبداً، فقط يصف الفعل/المكان لكل مشهد.
const STYLE_LOCK =
  'Hand-drawn sketch illustration style, minimalist stick-figure prehistoric human ' +
  'character with a round head, messy dark hair, simple dot eyes, wearing rough ' +
  'fur/hide clothing. Muted earthy color palette: sepia, dusty beige, warm brown, ' +
  'faded tan. Visible paper texture, loose hand-inked linework, flat cartoon coloring, ' +
  'no gradients, no 3D render look. Wide cinematic landscape composition. No text, ' +
  'no watermark, no logo, no captions.';

function assertKey() {
  if (!POLLINATIONS_KEY) {
    throw new Error(
      'POLLINATIONS_KEY is not set. Get a free key at https://enter.pollinations.ai and add it as a GitHub secret / env var.'
    );
  }
}

function isValidImage(filePath) {
  try {
    // format-agnostic (kontext/nanobanana can return jpeg or png) - just guard against
    // empty/error/tiny responses.
    return fs.statSync(filePath).size > 15000;
  } catch {
    return false;
  }
}

async function downloadImageResponse(res, destPath) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pollinations request failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

async function uploadReferenceImage(filePath) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)]), 'character.png');
  const res = await fetch(`${GEN_BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${POLLINATIONS_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Reference upload failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.url; // https://media.pollinations.ai/<hash> - valid 30 days, so we re-upload every run
}

/**
 * تولد صورة الشخصية المرجعية مرة وحدة إذا مو موجودة، وتحفظها بالريبو.
 * تشغيلة GitHub Actions الأولى تولدها تلقائياً؛ يُفضّل بعدها تسوي commit
 * لملف assets/character-reference.png عشان نفس الشخصية تثبت لكل الفيديوهات القادمة.
 */
async function generateCharacterReferenceIfMissing() {
  if (fs.existsSync(CHARACTER_REF_PATH)) return CHARACTER_REF_PATH;

  assertKey();
  console.log('  -> No character reference found - generating one now (first run only)...');
  const prompt = encodeURIComponent(
    `${STYLE_LOCK} Full-body reference portrait of the main character, standing neutrally, facing camera, holding a simple wooden spear.`
  );
  const res = await fetch(`${GEN_BASE}/image/${prompt}?model=${IMAGE_MODEL}&width=1024&height=1536`, {
    headers: { Authorization: `Bearer ${POLLINATIONS_KEY}` },
  });

  fs.mkdirSync(path.dirname(CHARACTER_REF_PATH), { recursive: true });
  await downloadImageResponse(res, CHARACTER_REF_PATH);
  console.log(`  -> Character reference saved: ${CHARACTER_REF_PATH}`);
  console.log('  -> IMPORTANT: commit this file to your repo so future runs reuse the same character.');
  return CHARACTER_REF_PATH;
}

async function getSceneImageFromAI(scene, outputDir, referenceUrl) {
  if (!scene.image_prompt) {
    throw new Error(`Scene ${scene.scene_order} has no image_prompt`);
  }
  const destPath = path.join(outputDir, `scene-${scene.scene_order}.png`);

  const prompt = encodeURIComponent(
    `${STYLE_LOCK} Use the exact same character shown in the reference image (same face, hair, and outfit) - do not change their appearance. Scene: ${scene.image_prompt}`
  );
  const url = `${GEN_BASE}/image/${prompt}?model=${IMAGE_MODEL}&image=${encodeURIComponent(referenceUrl)}&width=1920&height=1080`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${POLLINATIONS_KEY}` } });
  await downloadImageResponse(res, destPath);

  if (!isValidImage(destPath)) {
    try { fs.unlinkSync(destPath); } catch {}
    throw new Error(`Image failed quality check for scene ${scene.scene_order}`);
  }

  return { filePath: destPath, source: `pollinations-${IMAGE_MODEL}` };
}

async function getAllSceneImages(scenes, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  assertKey();

  await generateCharacterReferenceIfMissing();
  const referenceUrl = await uploadReferenceImage(CHARACTER_REF_PATH);

  const BATCH_SIZE = 2;
  const rawResults = new Array(scenes.length);

  for (let i = 0; i < scenes.length; i += BATCH_SIZE) {
    const batch = scenes.slice(i, i + BATCH_SIZE);
    console.log(`  -> Generating images ${i + 1}-${Math.min(i + BATCH_SIZE, scenes.length)}/${scenes.length}...`);
    const batchResults = await Promise.all(
      batch.map(async (scene, idx) => {
        await new Promise((r) => setTimeout(r, idx * 300));
        let filePath = null;
        let source = null;
        let error = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const result = await getSceneImageFromAI(scene, outputDir, referenceUrl);
            filePath = result.filePath;
            source = result.source;
            break;
          } catch (err) {
            error = err.message;
            console.warn(`Image attempt ${attempt}/3 failed for scene ${scene.scene_order}: ${err.message}`);
            if (attempt < 3) {
              const backoff = Math.min(8000, 1500 * Math.pow(2, attempt - 1));
              await new Promise((r) => setTimeout(r, backoff));
            }
          }
        }
        return { filePath, source, error };
      })
    );
    batchResults.forEach((r, idx) => { rawResults[i + idx] = r; });
  }

  const results = [];
  let lastGood = null;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    let { filePath, source, error } = rawResults[i];

    if (!filePath) {
      if (lastGood) {
        filePath = lastGood;
        console.warn(`  -> Falling back to previous scene's image for scene ${scene.scene_order}`);
      } else {
        filePath = CHARACTER_REF_PATH;
        console.warn(`  -> No previous image available, using character reference for scene ${scene.scene_order}`);
      }
    } else {
      lastGood = filePath;
    }

    results.push({ ...scene, image_file: filePath, is_video: false, media_source: source, image_error: error });
  }
  return results;
}

module.exports = { getAllSceneImages, generateCharacterReferenceIfMissing, STYLE_LOCK };
CLAUDE_PATCH_EOF

cat > "generate-host-avatar.js" << 'CLAUDE_PATCH_EOF'
// generate-host-avatar.js
// RUN THIS ONCE MANUALLY (not part of the daily pipeline). It generates the
// channel's fixed host character once, with a solid green background, then
// uses ffmpeg's colorkey filter to strip the green and produce a transparent
// PNG that gets overlaid on EVERY video from then on. Fully free (Pollinations
// + ffmpeg, no paid background-removal API needed).
//
// Usage: node generate-host-avatar.js
//
// After running, check assets/host/avatar.png - if the edges look rough
// (green fringing around the character), tweak COLORKEY_SIMILARITY below
// and re-run just the ffmpeg step (see the comment near the bottom).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const POLLINATIONS_KEY = process.env.POLLINATIONS_KEY;
const IMAGE_MODEL = process.env.POLLINATIONS_IMAGE_MODEL || 'kontext';

const OUTPUT_DIR = path.join(__dirname, 'assets', 'host');
const RAW_PATH = path.join(OUTPUT_DIR, 'avatar-raw.png');
const FINAL_PATH = path.join(OUTPUT_DIR, 'avatar.png');

// نفس وصف الشخصية المستخدم بمشاهد الفيديو (STYLE_LOCK بملف image.service.js) -
// خلها متطابقة عشان الأفتار بالزاوية يطابق شخصية الفيديو نفسها. لازم تبقى
// عبارة "solid pure green background" موجودة - الخطوة اللي تحت تعتمد عليها
// لإزالة الخلفية.
const AVATAR_PROMPT =
  'Hand-drawn sketch illustration style, minimalist stick-figure prehistoric human ' +
  'character with a round head, messy dark hair, simple dot eyes, wearing rough ' +
  'fur/hide clothing, holding a simple wooden spear. Muted earthy tones, visible ' +
  'paper texture, loose hand-inked linework, flat cartoon coloring. Chest-up ' +
  'portrait, facing forward, solid pure green background, no text, no watermark';

// seed غير مستخدم مع موديلات kontext/nanobanana (يدعمه بس flux/zimage) - يبقى هنا
// كتوثيق فقط لو رجعت تستخدم موديل يدعمه.
const SEED = 42;

const COLORKEY_COLOR = '0x00FF00'; // must match "pure green" in the prompt
const COLORKEY_SIMILARITY = '0.20'; // increase if green fringing remains, decrease if character is see-through
const COLORKEY_BLEND = '0.05';

async function downloadToFile(url, destPath) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${POLLINATIONS_KEY}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Download failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-1500)))));
  });
}

async function main() {
  if (!POLLINATIONS_KEY) {
    throw new Error('POLLINATIONS_KEY is not set. Get a free key at https://enter.pollinations.ai first.');
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Generating host avatar via Pollinations.ai...');
  const encodedPrompt = encodeURIComponent(AVATAR_PROMPT);
  const url = `https://gen.pollinations.ai/image/${encodedPrompt}?model=${IMAGE_MODEL}&width=800&height=800`;
  await downloadToFile(url, RAW_PATH);
  console.log(`Raw avatar saved: ${RAW_PATH}`);

  console.log('Removing green background with ffmpeg colorkey...');
  await runFfmpeg([
    '-i', RAW_PATH,
    '-vf', `colorkey=${COLORKEY_COLOR}:${COLORKEY_SIMILARITY}:${COLORKEY_BLEND}`,
    FINAL_PATH,
  ]);

  console.log(`\nDone. Final transparent avatar: ${FINAL_PATH}`);
  console.log('Open it and check the edges. If green fringing remains, edit');
  console.log('COLORKEY_SIMILARITY in this file (try 0.25-0.35) and re-run.');
  console.log('This avatar.png is what gets overlaid on every future video.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
CLAUDE_PATCH_EOF

mkdir -p "services"
cat > "services/thumbnail.service.js" << 'CLAUDE_PATCH_EOF'
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const POLLINATIONS_KEY = process.env.POLLINATIONS_KEY;
const IMAGE_MODEL = process.env.POLLINATIONS_IMAGE_MODEL || 'kontext';

const THUMB_WIDTH = 1280;
const THUMB_HEIGHT = 720;
const FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const ACCENT_COLOR = 'yellow'; // punchy accent line, like a professional CapCut/YouTube thumbnail

async function downloadToFile(url, destPath, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Download failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
}

function runFfmpeg(args, label = 'ffmpeg') {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (code ${code}): ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

function escapeDrawtext(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '\u2019')
    .replace(/%/g, '\\%');
}

async function generateThumbnail(script, outputDir, scenes = null) {
  const rawText = (script.thumbnail_text || script.title || '').toUpperCase();

  const bgPath = path.join(outputDir, 'thumb-bg.jpg');
  const outputPath = path.join(outputDir, 'thumbnail.jpg');

  const scored = (scenes || []).filter((s) => s.image_file);
  const realPhotoScene =
    scored.find((s) => s.is_hook && !s.is_video) ||
    scored.find((s) => s.is_hook) ||
    scored.find((s) => !s.is_video) ||
    scored[0] ||
    null;

  if (realPhotoScene) {
    fs.copyFileSync(realPhotoScene.image_file, bgPath);
  } else {
    const scenePrompt = script.thumbnail_image_prompt || script.title || 'a dramatic prehistoric scene';
    const STYLE_LOCK =
      'Hand-drawn sketch illustration style, minimalist stick-figure prehistoric human character ' +
      'with a round head, messy dark hair, simple dot eyes, wearing rough fur/hide clothing. ' +
      'Muted earthy color palette, visible paper texture, loose hand-inked linework, flat cartoon ' +
      'coloring, dramatic lighting, high contrast, cinematic. No text, no watermark.';
    const fullPrompt = `${STYLE_LOCK} Scene: ${scenePrompt}`;
    const encodedPrompt = encodeURIComponent(fullPrompt);
    const url = `https://gen.pollinations.ai/image/${encodedPrompt}?model=${IMAGE_MODEL}&width=${THUMB_WIDTH}&height=${THUMB_HEIGHT}`;
    await downloadToFile(url, bgPath, { Authorization: `Bearer ${POLLINATIONS_KEY}` });
  }

  // Split text into two lines; the LAST line is the punchline and gets the accent color
  // so the eye has a clear hierarchy (this is what separates a "designed" thumbnail
  // from a plain caption slapped on a photo).
  const words = rawText.split(' ').filter(Boolean);
  const mid = Math.ceil(words.length / 2);
  const line1 = words.slice(0, mid).join(' ');
  const line2 = words.slice(mid).join(' ');
  const escLine1 = escapeDrawtext(line1);
  const escLine2 = escapeDrawtext(line2);

  const scaleCrop = `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=increase,crop=${THUMB_WIDTH}:${THUMB_HEIGHT}`;
  // Darken + slight contrast/vignette pass on the background photo so text always stays readable
  // regardless of what the source image looks like, and the frame feels graded, not raw.
  const gradePass = `eq=contrast=1.08:saturation=1.05:gamma=0.95,vignette=PI/5`;
  const darkOverlay = `drawbox=x=0:y=ih*0.60:w=iw:h=ih*0.40:color=black@0.55:t=fill`;

  let filters;
  if (line2) {
    filters = [
      scaleCrop,
      gradePass,
      darkOverlay,
      `drawtext=fontfile=${FONT_PATH}:text='${escLine1}':fontsize=90:fontcolor=white:borderw=9:bordercolor=black:x=(w-text_w)/2:y=h*0.67`,
      `drawtext=fontfile=${FONT_PATH}:text='${escLine2}':fontsize=100:fontcolor=${ACCENT_COLOR}:borderw=9:bordercolor=black:x=(w-text_w)/2:y=h*0.82`,
    ].join(',');
  } else {
    filters = [
      scaleCrop,
      gradePass,
      darkOverlay,
      `drawtext=fontfile=${FONT_PATH}:text='${escLine1}':fontsize=100:fontcolor=${ACCENT_COLOR}:borderw=9:bordercolor=black:x=(w-text_w)/2:y=h*0.75`,
    ].join(',');
  }

  await runFfmpeg(['-y', '-i', bgPath, '-vf', filters, '-frames:v', '1', outputPath], 'thumbnail render');

  return outputPath;
}

module.exports = { generateThumbnail };
CLAUDE_PATCH_EOF

cat > ".env.example" << 'CLAUDE_PATCH_EOF'
# --- Groq (free) - script generation ---
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile

# --- Edge-TTS (free, no key needed) - calm storyteller male voice ---
TTS_VOICE=en-US-EricNeural

# --- Python worker (faster-whisper) ---
PYTHON_BIN=python3

# --- YouTube Data API v3 (free) ---
YT_CLIENT_ID=
YT_CLIENT_SECRET=
YT_REFRESH_TOKEN=
YT_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob

# --- Telegram notifications (free) ---
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# --- Scheduler ---
PIPELINE_CRON=0 9 * * 1,3,5,6

# --- Safety: keep uploads private for the first week while you verify output ---
FIRST_WEEK_MODE=true

# --- Pollinations (free key, image generation w/ character consistency) ---
# Get a free key at https://enter.pollinations.ai
POLLINATIONS_KEY=
POLLINATIONS_IMAGE_MODEL=kontext

# --- Stock media sources - no longer used now that every scene is the fixed
# illustrated character style, safe to leave blank or delete these lines ---
PEXELS_API_KEY=
PIXABAY_API_KEY=
UNSPLASH_ACCESS_KEY=
CLAUDE_PATCH_EOF

mkdir -p ".github/workflows"
cat > ".github/workflows/daily-publish.yml" << 'CLAUDE_PATCH_EOF'
name: Daily Video Publish

on:
  schedule:
    - cron: '0 9 * * *'
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 330

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Random delay to vary publish time
        run: |
          MINUTES=0
          echo "Sleeping $MINUTES minutes to randomize actual publish time"
          sleep $((MINUTES * 60))

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install ffmpeg
        run: sudo apt-get update && sudo apt-get install -y ffmpeg

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install faster-whisper
        run: pip install faster-whisper --break-system-packages || pip install faster-whisper

      - name: Install Node dependencies
        run: npm install

      - name: Run daily pipeline (generate, render, upload long + Short)
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
          GROQ_MODEL: llama-3.3-70b-versatile
          TTS_VOICE: en-US-EricNeural
          POLLINATIONS_KEY: ${{ secrets.POLLINATIONS_KEY }}
          POLLINATIONS_IMAGE_MODEL: kontext
          YT_CLIENT_ID: ${{ secrets.YT_CLIENT_ID }}
          YT_CLIENT_SECRET: ${{ secrets.YT_CLIENT_SECRET }}
          YT_REFRESH_TOKEN: ${{ secrets.YT_REFRESH_TOKEN }}
          YT_REDIRECT_URI: urn:ietf:wg:oauth:2.0:oob
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          FIRST_WEEK_MODE: ${{ vars.FIRST_WEEK_MODE || 'true' }}
        run: node run-daily.js

      - name: Commit updated topics.json (marks today's topic as used)
        if: always()
        run: |
          git config user.name "ai-story-channel-bot"
          git config user.email "actions@users.noreply.github.com"
          git add topics.json
          git diff --staged --quiet || git commit -m "Mark topic as used [skip ci]"
          git push || echo "Nothing to push or push failed - check manually"
CLAUDE_PATCH_EOF

echo "All files updated."
git add -A
git status --short
echo
echo "Review the changes above, then run:  git commit -m 'Switch to prehistoric-survival illustrated-style content' && git push"
