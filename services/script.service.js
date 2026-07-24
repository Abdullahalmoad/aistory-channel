const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const NARRATION_WPM = 145;
const MIN_TARGET_WORDS = 1000; // ~7 minutes
const MAX_TARGET_WORDS = 2200; // ~15 minutes

function pickTargetWords() {
  return Math.round(MIN_TARGET_WORDS + Math.random() * (MAX_TARGET_WORDS - MIN_TARGET_WORDS));
}

const SYSTEM_PROMPT = `You are a scriptwriter for a YouTube channel that publishes true mystery, horror, and unsolved-case stories - video length varies naturally by topic, roughly 7 to 15 minutes - narrated over real photos and real stock video footage (not AI-illustrated animation, not cartoons; AI illustration is only used as a last-resort visual fallback for scenes with no real match, so never rely on it in your writing).

Your job: turn the given topic into a single continuous suspenseful narrative script split into short scenes, suitable for text-to-speech narration and scene-by-scene real-footage visuals.

Respond with STRICT JSON only. No markdown code fences, no commentary before or after the JSON.

Exact shape required:
{
  "title": "Compelling, clickable YouTube title (avoid excessive clickbait, keep it honest)",
  "description": "2-4 sentence YouTube description including a natural mention of the case/topic, plus 3-5 relevant hashtags at the end",
  "tags": ["tag1", "tag2", "..."],
  "thumbnail_text": "2-4 punchy ALL CAPS words for a YouTube thumbnail overlay, maximum curiosity/dread, no punctuation",
  "thumbnail_image_prompt": "Short, concrete English description of ONE real-world visual moment for use as the thumbnail background, the single most striking or unsettling image related to the case",
  "estimated_word_count": 600,
  "scenes": [
    {
      "scene_order": 1,
      "text": "1-2 short sentences of narration for this scene only (aim for no more than about 10 seconds spoken aloud)",
      "is_hook": true or false,
      "image_prompt": "Short, concrete English description of a REAL, PHOTOGRAPHABLE subject or scene that a stock photo/video search would actually return results for, e.g. 'a foggy forest at night' or 'an abandoned house at dusk' or 'a police car with flashing lights' or 'a handwritten letter on a desk'. Describe real objects, real places, real weather, or real generic scenes that fit the mood - never fictional, never abstract, never text/words in the image itself, and never a recreation of a specific unnamed real person's face."
    }
  ]
}

Rules:
- Each scene must cover no more than 10 seconds of spoken narration (1-2 short sentences, roughly 18-22 words) - never write a longer block of narration as a single scene. If a moment needs more narration, split it across multiple consecutive scenes instead.
- Total scenes should be enough to reach the target word count given in the user message - do not artificially cap the scene count, let it scale naturally with the target word count (this channel's videos run roughly 7-15 minutes depending on the topic).
- Tell the case as ONE continuous story with a clear beginning, escalation, and ending - not a list of disconnected facts. Build tension gradually; let strange or unsettling details accumulate in a logical chronological or investigative order.
- Stick to what is actually documented or credibly reported about the case; when theories are disputed or unconfirmed, say so honestly rather than presenting speculation as fact.
- image_prompt must describe something that genuinely exists and could be found as a real photo or real video clip - avoid describing imagined recreations of specific unnamed people; prefer general real subjects (locations, weather, objects, generic figures, evidence-style shots, nature) that match the scene's mood.
- Mark is_hook = true on roughly 2 to 5 scenes (scale with video length) that are the MOST chilling or curiosity-driving moments in the whole story (these will later be cut into a short vertical teaser with a link to the full video). Prefer the opening hook and the single biggest reveal or twist.
- The narration should read naturally when spoken aloud (avoid text formatting like bullet points, avoid emoji in the "text" field).
- The LAST scene must be a genuine closing thought in your own voice (e.g. what remains unexplained, why the case still matters, a question left open) - NOT a recap of the plot. This is required editorial content, not filler.
- The response MUST be valid JSON, parsable directly with JSON.parse, with no trailing commas.`;

const NARRATIVE_STYLES = [
  'Open with the central unanswered question of the case, then unfold the story chronologically from the beginning.',
  'Start in the middle of the most chilling moment of the case, then rewind to explain how events led there.',
  'Structure it as a slow build of small strange details that escalate into the central mystery.',
  'Frame it around the competing theories investigators or witnesses proposed, weighing each against the actual evidence.',
  'Tell it as a countdown of the strangest documented details in the case, saving the eeriest for last.',
];

function pickNarrativeStyle() {
  return NARRATIVE_STYLES[Math.floor(Math.random() * NARRATIVE_STYLES.length)];
}

async function generateScript(topic, options = {}) {
  const { targetWords = pickTargetWords(topic) } = options;

  const userPrompt = `Topic: ${topic}
Target narration word count: approximately ${targetWords} words (~${Math.round(targetWords / NARRATION_WPM)} minutes of spoken video - videos on this channel run 7 to 15 minutes depending on the topic).
Language: English.
Choose the narrative structure that best fits THIS specific topic's content and tone. Pick exactly ONE of the following approaches (do not blend them, do not default to the same one every time - base your choice on what suits this fact/topic best):
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
