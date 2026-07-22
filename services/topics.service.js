const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const TOPICS_PATH = path.join(__dirname, '..', 'topics.json');

function loadTopics() {
  const raw = fs.readFileSync(TOPICS_PATH, 'utf-8');
  return JSON.parse(raw);
}

function saveTopics(data) {
  fs.writeFileSync(TOPICS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

async function generateNewTopics(existingTopics, count = 10) {
  const existingList = existingTopics.map((t) => `- ${t.topic}`).join('\n');
  const prompt = `You generate topic ideas for a YouTube channel about real unsolved mysteries, disappearances, strange true stories, and unexplained phenomena (similar style to true crime / paranormal documentary channels).

Here are topics already used - do NOT repeat these or anything too similar:
${existingList}

Generate ${count} brand new topic ideas, each a single sentence describing a real (or real-sounding) mysterious/unsolved story, in the same style as the examples above. Return ONLY a JSON array of strings, nothing else, no markdown formatting.`;

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
