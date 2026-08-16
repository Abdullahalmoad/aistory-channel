const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const NARRATION_WPM = 145;
const MIN_TARGET_WORDS = 1450; // ~10 minutes
const MAX_TARGET_WORDS = 2200; // ~15 minutes

function pickTargetWords() {
  return Math.round(MIN_TARGET_WORDS + Math.random() * (MAX_TARGET_WORDS - MIN_TARGET_WORDS));
}

const SYSTEM_PROMPT = `You are a scriptwriter for a YouTube channel about true crime cases and strange unsolved mysteries - long-form videos (10-15 minutes), narrated over a fixed hand-drawn sketch illustration style (one consistent recurring detective/narrator character across every scene, NOT real photos, NOT real stock video, NOT a photorealistic style).

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
- Stick to information that is publicly documented (court records, police reports, credible journalism); when something is disputed, unconfirmed, or theorized, say so honestly (e.g. "investigators believe" or "it is alleged") instead of presenting speculation as settled fact. Do not invent dialogue or quotes attributed to real people. Avoid gratuitous graphic detail - focus on the mystery, investigation, and facts rather than violence itself.
- Mark is_hook = true on roughly 10 to 18 scenes (scale with video length) that are the single most curiosity-driving or surprising moments in the whole video (these will later be cut into a vertical teaser Short/Reels that links to the full video). Prefer the opening hook and the biggest single reveal or turning point. IMPORTANT: since each scene runs roughly 15-25 seconds and the teaser Short/Reels has a hard 3-minute (180 second) limit once stitched together, keep the TOTAL combined narration length of all is_hook scenes under approximately 170 seconds - if that means picking closer to 10 shorter, punchier hook scenes instead of 18 longer ones, prefer that over exceeding the limit.
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
