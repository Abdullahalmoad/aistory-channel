const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const DEFAULT_TARGET_WORDS = 1800;

const SYSTEM_PROMPT = `You are a scriptwriter for a YouTube channel that publishes long-form documentary-style videos about forbidden places, unexplained mysteries, and strange true stories - narrated over simple flat-vector illustrated animation (like an animated explainer video), not photorealistic footage.

Your job: turn the given topic into a full long-form narration script split into short scenes, suitable for text-to-speech narration and scene-by-scene illustrated visuals.

Respond with STRICT JSON only. No markdown code fences, no commentary before or after the JSON.

Exact shape required:
{
  "title": "Compelling, clickable YouTube title (avoid excessive clickbait, keep it honest)",
  "description": "2-4 sentence YouTube description including a natural mention of the topic, plus 3-5 relevant hashtags at the end",
  "tags": ["tag1", "tag2", "..."],
    "thumbnail_text": "2-4 punchy ALL CAPS words for a YouTube thumbnail overlay, e.g. NINE DEAD or STILL MISSING, maximum curiosity, no punctuation",
    "thumbnail_image_prompt": "Short, concrete English description of ONE dramatic high-impact visual moment from the story for use as a thumbnail background image, the single most shocking or mysterious image from the story",
  "estimated_word_count": 1800,
  "scenes": [
    {
      "scene_order": 1,
      "text": "1-3 sentences of narration for this scene only",
      "is_hook": true or false,
      "image_prompt": "Short, concrete English description of what should be illustrated for this scene (subject + setting only, e.g. 'a volcanic island rising out of the ocean with steam rising'). Do NOT include art-style words - those are added automatically."
    }
  ]
}

Rules:
- Each scene should cover about 5-12 seconds of spoken narration (1-3 short sentences).
- Total scenes should be enough to reach the target word count given in the user message (typically 35-55 scenes for a 10+ minute video).
- image_prompt must describe a single clear visual concept simple enough to draw as a flat 2D illustration (one main subject, one setting, no text/words in the image itself).
- Mark is_hook = true on exactly 3 to 6 scenes that are the MOST dramatic, shocking, or curiosity-driving moments in the whole script (these will later be cut into a short vertical teaser). Prefer scenes from the opening hook and from the biggest twist/climax. Hook scenes do not need to be contiguous, but note them clearly.
- The narration should read naturally when spoken aloud (avoid text formatting like bullet points, avoid emoji in the "text" field).
- The LAST 1-2 scenes must be a genuine closing analysis/commentary in your own voice (e.g. why the case remains unexplained, what the leading theories disagree on, what it says about human psychology) - NOT a recap of the plot. This is required editorial content, not filler.
- The response MUST be valid JSON, parsable directly with JSON.parse, with no trailing commas.`;

const NARRATIVE_STYLES = [
  'Tell it in chronological order, like a documentary retelling events as they happened.',
  'Frame it as an investigation: start from the strange discovery/clue, then work backward through what investigators found.',
  'Structure it as a countdown of the most disturbing facts about the topic, saving the strangest for last.',
  'Open with the unresolved question the case leaves behind, then tell the story, then return to that question at the end.',
];

function pickNarrativeStyle() {
  return NARRATIVE_STYLES[Math.floor(Math.random() * NARRATIVE_STYLES.length)];
}

async function generateScript(topic, options = {}) {
  const { targetWords = DEFAULT_TARGET_WORDS } = options;

  const userPrompt = `Topic: ${topic}
Target narration word count: approximately ${targetWords} words (this must produce a 10+ minute spoken video).
Language: English.
Choose the narrative structure that best fits THIS specific topic's content and tone. Pick exactly ONE of the following approaches (do not blend them, do not default to the same one every time - base your choice on what suits this story best):
${NARRATIVE_STYLES.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return the full script now as strict JSON, matching the required shape exactly.`;

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
    if (parsed.scenes.length > 1) parsed.scenes[1].is_hook = true;
    const lastIdx = parsed.scenes.length - 1;
    parsed.scenes[lastIdx].is_hook = true;
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
    estimated_word_count: actualWordCount,
    scenes: proofreadScenesResult,
  };
}

const PROOFREAD_SYSTEM_PROMPT = `You are a strict English copy editor. You will receive a JSON array of narration lines that will be converted to speech by a text-to-speech engine.

Your ONLY job: fix spelling mistakes, typos, and grammar errors. Do NOT change the meaning, do NOT rewrite for style, do NOT shorten or lengthen lines, do NOT change facts.

If a line is already correct, return it completely unchanged.

Respond with STRICT JSON only, no markdown fences, no commentary. Exact shape:
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
