const fs = require('fs');

function patch(file, replacements) {
  const bak = file + '.bak-revert';
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(bak, original);
  let content = original;
  for (const { old, next, label } of replacements) {
    const count = content.split(old).length - 1;
    if (count !== 1) {
      throw new Error(`${file}: expected exactly 1 match for "${label}", found ${count}. Aborting, no files changed beyond backups already written.`);
    }
    content = content.replace(old, next);
  }
  fs.writeFileSync(file, content);
  console.log(`OK  patched ${file} (backup at ${bak})`);
}

patch('services/script.service.js', [
  {
    label: 'pickTargetWords simplify (no more list-topic branching)',
    old: `function pickTargetWords(topic) {
  const isListTopic = /d/.test(topic);
  const mid = Math.round((MIN_TARGET_WORDS + MAX_TARGET_WORDS) / 2);
  const rangeStart = isListTopic ? mid : MIN_TARGET_WORDS;
  const rangeEnd = isListTopic ? MAX_TARGET_WORDS : mid + Math.round((MAX_TARGET_WORDS - mid) * 0.3);
  return Math.round(rangeStart + Math.random() * (rangeEnd - rangeStart));
}`,
    next: `function pickTargetWords() {
  return Math.round(MIN_TARGET_WORDS + Math.random() * (MAX_TARGET_WORDS - MIN_TARGET_WORDS));
}`,
  },
  {
    label: 'main system prompt: Did-you-know/Top10 -> horror/mystery narrative',
    old: `const SYSTEM_PROMPT = \`You are a scriptwriter for a YouTube channel that publishes "Did you know", "What if", and ranked list videos about science, history, and nature - video length varies naturally by topic, roughly 7 to 15 minutes - narrated over real photos and real stock video footage (not AI-illustrated animation, not cartoons).

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
- If the topic is a ranked/superlative list of N items (e.g. "Top 10 X", "10 strangest facts about Y", "the N most Z"), you MUST cover ALL N items in order (counting down or up as appropriate) - scale the scene count up accordingly rather than staying capped low, and never skip or cut the list short. Each item's image_prompt must depict a REAL, SPECIFIC example of that exact item (a real named planet, animal, person, place, or fact) - never a generic filler visual.
- Do NOT just name or briefly mention each item or fact and move on - explain it properly. For list topics, spend 2-4 scenes per item covering what it actually is, the specific real numbers/facts that make it notable, and concretely how or why it relates to the topic's theme (e.g. for "planets most similar to Earth", explain its actual size, distance from its star, surface temperature, or atmosphere compared to Earth's, with real figures). For single-fact or "what if" topics, don't just state the fact - explain the real mechanism, cause, or chain of consequences behind it across multiple scenes with specific supporting details, like a mini explainer, not a one-line trivia drop.
- The response MUST be valid JSON, parsable directly with JSON.parse, with no trailing commas.\`;`,
    next: `const SYSTEM_PROMPT = \`You are a scriptwriter for a YouTube channel that publishes true mystery, horror, and unsolved-case stories - video length varies naturally by topic, roughly 7 to 15 minutes - narrated over real photos and real stock video footage (not AI-illustrated animation, not cartoons; AI illustration is only used as a last-resort visual fallback for scenes with no real match, so never rely on it in your writing).

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
      "text": "1-3 sentences of narration for this scene only",
      "is_hook": true or false,
      "image_prompt": "Short, concrete English description of a REAL, PHOTOGRAPHABLE subject or scene that a stock photo/video search would actually return results for, e.g. 'a foggy forest at night' or 'an abandoned house at dusk' or 'a police car with flashing lights' or 'a handwritten letter on a desk'. Describe real objects, real places, real weather, or real generic scenes that fit the mood - never fictional, never abstract, never text/words in the image itself, and never a recreation of a specific unnamed real person's face."
    }
  ]
}

Rules:
- Each scene should cover about 8-15 seconds of spoken narration (2-4 sentences).
- Total scenes should be enough to reach the target word count given in the user message - do not artificially cap the scene count, let it scale naturally with the target word count (this channel's videos run roughly 7-15 minutes depending on the topic).
- Tell the case as ONE continuous story with a clear beginning, escalation, and ending - not a list of disconnected facts. Build tension gradually; let strange or unsettling details accumulate in a logical chronological or investigative order.
- Stick to what is actually documented or credibly reported about the case; when theories are disputed or unconfirmed, say so honestly rather than presenting speculation as fact.
- image_prompt must describe something that genuinely exists and could be found as a real photo or real video clip - avoid describing imagined recreations of specific unnamed people; prefer general real subjects (locations, weather, objects, generic figures, evidence-style shots, nature) that match the scene's mood.
- Mark is_hook = true on roughly 2 to 5 scenes (scale with video length) that are the MOST chilling or curiosity-driving moments in the whole story (these will later be cut into a short vertical teaser with a link to the full video). Prefer the opening hook and the single biggest reveal or twist.
- The narration should read naturally when spoken aloud (avoid text formatting like bullet points, avoid emoji in the "text" field).
- The LAST scene must be a genuine closing thought in your own voice (e.g. what remains unexplained, why the case still matters, a question left open) - NOT a recap of the plot. This is required editorial content, not filler.
- The response MUST be valid JSON, parsable directly with JSON.parse, with no trailing commas.\`;`,
  },
  {
    label: 'narrative styles: Did-you-know hooks -> mystery/horror storytelling angles',
    old: `const NARRATIVE_STYLES = [
  'Open with a bold "Did you know" hook fact, then build up supporting facts that make it even more surprising.',
  'Frame it as a "What if" hypothetical scenario, walking through what would realistically happen step by step.',
  'Structure it as a rapid countdown of surprising facts about the topic, saving the most shocking one for last.',
  'Open with a common misconception people believe, then reveal the surprising truth with supporting facts.',
  'Tell it as a chain of cause-and-effect: each surprising fact leads naturally into the next one.',
];`,
    next: `const NARRATIVE_STYLES = [
  'Open with the central unanswered question of the case, then unfold the story chronologically from the beginning.',
  'Start in the middle of the most chilling moment of the case, then rewind to explain how events led there.',
  'Structure it as a slow build of small strange details that escalate into the central mystery.',
  'Frame it around the competing theories investigators or witnesses proposed, weighing each against the actual evidence.',
  'Tell it as a countdown of the strangest documented details in the case, saving the eeriest for last.',
];`,
  },
]);

patch('services/topics.service.js', [
  {
    label: 'topic categories: science facts -> mystery/horror cases',
    old: `const CATEGORIES = ['science and space', 'history and ancient civilizations', 'nature and animals', 'technology', 'the human body and mind'];`,
    next: `const CATEGORIES = ['unsolved disappearances', 'unexplained deaths', 'true crime cold cases', 'haunted or allegedly haunted places', 'strange unexplained phenomena', 'historical mysteries'];`,
  },
  {
    label: 'generateNewTopics prompt: Did-you-know/Top10 -> single-case mystery/horror stories',
    old: `  const prompt = \`You generate topic ideas for a YouTube channel that makes short "Did you know", "What if", and ranked/superlative list videos about \${categoryList}.

Here are topics already used - do NOT repeat these or anything too similar:
\${existingList}

Generate \${count} brand new topic ideas, mixing across all the categories above (not just one). Use a mix of THREE formats:
1. Single surprising fact (one sentence).
2. "What if" hypothetical scenario (one sentence).
3. A ranked or superlative list of exactly 10 real, distinct, well-known items - vary the superlative and structure each time instead of repeating the same pattern. Examples of the STYLE (do not reuse these literally, invent new specific ones): "The 10 smartest people in history", "10 strangest facts about black holes", "The 10 most Earth-like planets ever discovered", "10 weirdest animals in the ocean", "The 10 deadliest diseases in history", "10 fastest animals on Earth", "The 10 most mysterious ancient ruins". Mix superlatives like smartest, weirdest, strangest, deadliest, fastest, rarest, oldest, most successful, most Earth-like, most mysterious - and mix the sentence structure too (not always "Top 10 X", also try "N strangest facts about X").

Aim for roughly a third of each format. Each topic must be a single sentence, specific enough to research and script (for list topics, make sure 10 real distinct examples genuinely exist), not vague. Return ONLY a JSON array of strings, nothing else, no markdown formatting.\`;`,
    next: `  const prompt = \`You generate topic ideas for a YouTube channel that makes long-form true mystery, horror, and unsolved-case story videos about \${categoryList}.

Here are topics already used - do NOT repeat these or anything too similar:
\${existingList}

Generate \${count} brand new topic ideas, mixing across all the categories above (not just one). Each topic must be a single REAL, documented case, place, or event (not a fictional story, not a vague generic idea) with enough publicly known detail to support a 7-15 minute narrated story - e.g. a specific unsolved disappearance, an unexplained death, a cold case, a reportedly haunted location with a documented history, or a genuinely unexplained phenomenon. Each topic should be a single sentence naming the specific case/place/event plus a short clause on what makes it notable. Return ONLY a JSON array of strings, nothing else, no markdown formatting.\`;`,
  },
]);

console.log('\nBoth files patched successfully.');
