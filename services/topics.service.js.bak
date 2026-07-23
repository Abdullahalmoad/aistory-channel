const fs = require('fs');
const path = require('path');

const TOPICS_PATH = path.join(__dirname, '..', 'topics.json');

function loadTopics() {
  const raw = fs.readFileSync(TOPICS_PATH, 'utf-8');
  return JSON.parse(raw);
}

function saveTopics(data) {
  fs.writeFileSync(TOPICS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function getNextTopic() {
  const data = loadTopics();
  const next = data.topics.find((t) => !t.used);
  if (!next) {
    throw new Error('Topic queue is empty - add more topics to topics.json');
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
