const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const TOPICS_PATH = path.join(__dirname, '..', 'topics.json');

const CATEGORIES = ['unsolved disappearances', 'unexplained deaths', 'true crime cold cases', 'haunted or allegedly haunted places', 'strange unexplained phenomena', 'eerie historical mysteries with a real human story'];

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
  const prompt = `You generate topic ideas for a YouTube channel that makes long-form true HORROR and MYSTERY story videos about ${categoryList}. The channel's entire identity is dread, suspense, and unease - think true crime and paranormal storytelling channels, NOT a history or science trivia channel.

Here are topics already used - do NOT repeat these or anything too similar:
${existingList}

Generate ${count} brand new topic ideas, mixing across all the categories above (not just one).

Hard requirements for every topic:
- It must be a single REAL, documented case, place, or event (not fictional, not a vague generic idea) with enough publicly known detail to support a 7-15 minute narrated story.
- It must have a genuine chilling, unsettling, or dread-inducing angle centered on real people, real deaths, real disappearances, or real reported hauntings/encounters - a real human or paranormal story, not just an abstract theory, scientific curiosity, or historical trivia fact with no eerie narrative pull.
- REJECT anything that is purely intellectual/academic (e.g. a calendar theory, a math puzzle, a historical dating debate) unless it is tied to a specific unsettling real event or disappearance - "interesting to know" is not enough, it must feel scary or mysterious when narrated aloud to a horror audience.
- Each topic should be a single sentence naming the specific case/place/event plus a short clause on what makes it notable or frightening.

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
