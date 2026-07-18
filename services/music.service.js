const fs = require('fs');
const path = require('path');

const MUSIC_DIR = path.join(__dirname, '..', 'assets', 'music');

function getRandomMusicTrack() {
  if (!fs.existsSync(MUSIC_DIR)) return null;
  const files = fs
    .readdirSync(MUSIC_DIR)
    .filter((f) => /\.(mp3|wav|m4a)$/i.test(f));
  if (files.length === 0) return null;
  const pick = files[Math.floor(Math.random() * files.length)];
  return path.join(MUSIC_DIR, pick);
}

module.exports = { getRandomMusicTrack, MUSIC_DIR };
