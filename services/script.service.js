const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const NARRATION_WPM = 145;
const MIN_TARGET_WORDS = 1000; // ~7 minutes
const MAX_TARGET_WORDS = 2200; // ~15 minutes

function pickTargetWords(topic) {
  const isListTopic = /d/.test(topic);
  const mid = Math.round((MIN_TARGET_WORDS + MAX_TARGET_WORDS) / 2);
  const rangeStart = isListTopic ? mid : MIN_TARGET_WORDS;
  const rangeEnd = isListTopic ? MAX_TARGET_WORDS : mid + Math.round((MAX_TARGET_WORDS - mid) * 0.3);
  return Math.round(rangeStart + Math.random() * (rangeEnd - rangeStart));
}

const SYSTEM_PROMPT = `You are a scriptwriter for a YouTube channel that publishes "Did you know", "What if", and ranked list videos about science, history, and nature - video length varies naturally by topic, roughly 7 to 15 minutes - narrated over real photos and real stock video footage (not AI-illustrated animation, not cartoons).

Your job: turn the given topic into a full narration script split into short scenes, suitable for text-to-speech narration and scene-by-scene real-footage visuals.

Respond with STRICT JSON only. No markdown code fences, no commentary before or after the JSON.

Exact shape required:
{
  "title": "Compelling, clickable YouTube title (avoid excessive clickbait, keep it honest)",
  "description": "2-4 sentence YouTube description including a natural mention of the topic, plus 3-5 relevant hashtags at the end",
  "tags": ["tag1", "tag2", "..."],
  "thumbnail_text": "2-4 punchy ALL CAPS words for a YouTube thumbnail overlay, e.g. MIND BLOWN or NOT REAL, maximum curiosity, no punctuation",
  "thumbnail_image_prompt": "Short, concrete English description of ONE real-world visual moment for use as the thumbnail background, the single most striking or curious image related to the topic",
  "estimated_word_count": 600,
  "scenes": [
    {
      "scene_order": 1,
      "text": "1-3 sentences of narration for this scene only",
      "is_hook": true or false,
      "image_prompt": "Short, concrete English description of a REAL, PHOTOGRAPHABLE subject or scene that a stock photo/video search would actually return results for, e.g. 'a scientist looking through a microscope' or 'the pyramids of Giza at sunset' or 'a blue whale swimming underwater'. Describe real objects, real places, real animals, or real everyday scenes only - never fictional, never abstract, never text/words in the image itself."
    }
  ]
}

Rules:
- Each scene should cover about 8-15 seconds of spoken narration (2-4 sentences).
- Total scenes should be enough to reach the target word count given in the user message - do not artificially cap the scene count, let it scale naturally with the target word count (this channel's videos run roughly 7-15 minutes depending on the topic).
- image_prompt must describe something that genuinely exists and could be found as a real photo or real video clip - avoid describing imagined recreations of specific unnamed people; prefer general real subjects (nature, science equipment, landmarks, animals, everyday human activity).
- Mark is_hook = true on roughly 2 to 5 scenes (scale with video length) that are the MOST surprising or curiosity-driving moments in the whole script (these will later be cut into a short vertical teaser). Prefer the opening hook and the single biggest reveal.
- The narration should read naturally when spoken aloud (avoid text formatting like bullet points, avoid emoji in the "text" field).
- The LAST scene must be a genuine closing thought in your own voice (e.g. why this fact matters, what it implies, a related question left open) - NOT a recap of the plot. This is required editorial content, not filler.
- If the topic is a ranked/superlative list of N items (e.g. "Top 10 X", "10 strangest facts about Y", "the N most Z"), you MUST cover ALL N items in order (counting down or up as appropriate), one item per scene - scale the scene count up accordingly (often 12-18 scenes) rather than staying capped low, and never skip or cut the list short. Each item's image_prompt must depict a REAL, SPECIFIC example of that exact item (a real named planet, animal, person, place, or fact) - never a generic filler visual.
- The response MUST be valid JSON, parsable directly with JSON.parse, with no trailing commas.`;

const NARRATIVE_STYLES = [
  'Open with a bold "Did you know" hook fact, then build up supporting facts that make it even more surprising.',
  'Frame it as a "What if" hypothetical scenario, walking through what would realistically happen step by step.',
  'Structure it as a rapid countdown of surprising facts about the topic, saving the most shocking one for last.',
  'Open with a common misconception people believe, then reveal the surprising truth with supporting facts.',
  'Tell it as a chain of cause-and-effect: each surprising fact leads naturally into the next one.',
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
