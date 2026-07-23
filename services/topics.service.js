const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const TOPICS_PATH = path.join(__dirname, '..', 'topics.json');

const CATEGORIES = ['science and space', 'history and ancient civilizations', 'nature and animals', 'technology', 'the human body and mind'];

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
  const prompt = `You generate topic ideas for a YouTube channel that makes short "Did you know", "What if", and ranked/superlative list videos about ${categoryList}.

Here are topics already used - do NOT repeat these or anything too similar:
${existingList}

Generate ${count} brand new topic ideas, mixing across all the categories above (not just one). Use a mix of THREE formats:
1. Single surprising fact (one sentence).
2. "What if" hypothetical scenario (one sentence).
3. A ranked or superlative list of exactly 10 real, distinct, well-known items - vary the superlative and structure each time instead of repeating the same pattern. Examples of the STYLE (do not reuse these literally, invent new specific ones): "The 10 smartest people in history", "10 strangest facts about black holes", "The 10 most Earth-like planets ever discovered", "10 weirdest animals in the ocean", "The 10 deadliest diseases in history", "10 fastest animals on Earth", "The 10 most mysterious ancient ruins". Mix superlatives like smartest, weirdest, strangest, deadliest, fastest, rarest, oldest, most successful, most Earth-like, most mysterious - and mix the sentence structure too (not always "Top 10 X", also try "N strangest facts about X").

Aim for roughly a third of each format. Each topic must be a single sentence, specific enough to research and script (for list topics, make sure 10 real distinct examples genuinely exist), not vague. Return ONLY a JSON array of strings, nothing else, no markdown formatting.`;

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
