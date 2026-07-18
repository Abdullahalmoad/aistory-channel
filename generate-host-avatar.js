// generate-host-avatar.js
// RUN THIS ONCE MANUALLY (not part of the daily pipeline). It generates the
// channel's fixed host character once, with a solid green background, then
// uses ffmpeg's colorkey filter to strip the green and produce a transparent
// PNG that gets overlaid on EVERY video from then on. Fully free (Pollinations
// + ffmpeg, no paid background-removal API needed).
//
// Usage: node generate-host-avatar.js
//
// After running, check assets/host/avatar.png - if the edges look rough
// (green fringing around the character), tweak COLORKEY_SIMILARITY below
// and re-run just the ffmpeg step (see the comment near the bottom).

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const OUTPUT_DIR = path.join(__dirname, 'assets', 'host');
const RAW_PATH = path.join(OUTPUT_DIR, 'avatar-raw.png');
const FINAL_PATH = path.join(OUTPUT_DIR, 'avatar.png');

// Edit this description to design your channel's mascot/host character.
// Keep "solid pure green background" in the prompt - required for the
// background removal step below to work cleanly.
const AVATAR_PROMPT =
  'a friendly cartoon narrator character, young man wearing a beanie hat and glasses, ' +
  'flat vector illustration, minimalist flat design, simple 2D vector art, thin clean outlines, ' +
  'chest-up portrait, facing forward, solid pure green background, no text, no watermark';

// A fixed seed makes this reproducible if you ever need to regenerate
// (e.g. after tweaking the prompt) and get a similar-looking result.
const SEED = 42;

const COLORKEY_COLOR = '0x00FF00'; // must match "pure green" in the prompt
const COLORKEY_SIMILARITY = '0.20'; // increase if green fringing remains, decrease if character is see-through
const COLORKEY_BLEND = '0.05';

function downloadToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadToFile(res.headers.location, destPath).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);
        fileStream.on('finish', () => fileStream.close(() => resolve(destPath)));
      })
      .on('error', reject);
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-1500)))));
  });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Generating host avatar via Pollinations.ai...');
  const encodedPrompt = encodeURIComponent(AVATAR_PROMPT);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=800&seed=${SEED}&nologo=true&model=flux`;
  await downloadToFile(url, RAW_PATH);
  console.log(`Raw avatar saved: ${RAW_PATH}`);

  console.log('Removing green background with ffmpeg colorkey...');
  await runFfmpeg([
    '-i', RAW_PATH,
    '-vf', `colorkey=${COLORKEY_COLOR}:${COLORKEY_SIMILARITY}:${COLORKEY_BLEND}`,
    FINAL_PATH,
  ]);

  console.log(`\nDone. Final transparent avatar: ${FINAL_PATH}`);
  console.log('Open it and check the edges. If green fringing remains, edit');
  console.log('COLORKEY_SIMILARITY in this file (try 0.25-0.35) and re-run.');
  console.log('This avatar.png is what gets overlaid on every future video.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
