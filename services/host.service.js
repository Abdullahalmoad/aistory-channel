const fs = require('fs');
const path = require('path');

const AVATAR_PATH = path.join(__dirname, '..', 'assets', 'host', 'avatar.png');

function getHostAvatarPath() {
  return fs.existsSync(AVATAR_PATH) ? AVATAR_PATH : null;
}

module.exports = { getHostAvatarPath, AVATAR_PATH };
