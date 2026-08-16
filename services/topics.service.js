const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const TOPICS_PATH = path.join(__dirname, '..', 'topics.json');

const CATEGORIES = ['unsolved murder cases', 'mysterious disappearances', 'strange true crime investigations', 'chilling cold cases', 'bizarre unexplained events', 'conspiracy-worthy real-life mysteries'];

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
  const prompt = `You generate topic ideas for a YouTube channel that makes long-form (10-15 minute) videos about true crime cases and real unsolved mysteries, across these angles: ${categoryList}. The channel's whole identity is investigative curiosity and "what really happened" intrigue - grounded in real, publicly documented cases, not fabricated horror stories.

Here are topics already used - do NOT repeat these or anything too similar:
${existingList}

Generate ${count} brand new topic ideas, mixing across all the categories above (not just one).

Hard requirements for every topic:
- Phrase it as a short curiosity-driven question or hook, under 12 words - matching this exact style: "What really happened to the family that vanished from their locked house?" or "Who killed the hitchhiker no one could identify for 40 years?".
- Ground it in a real, publicly documented case or credibly reported event (simplified for narration is fine, but it must not be pure invention with no basis).
- It needs a clear "investigation or mystery" angle that can support a full narrative with a beginning, build-up, and payoff - not just a flat one-line trivia fact.
- Avoid anything purely academic/abstract with no concrete investigative or mystery angle.

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
