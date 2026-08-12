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

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const POLLINATIONS_KEY = process.env.POLLINATIONS_KEY;
const IMAGE_MODEL = process.env.POLLINATIONS_IMAGE_MODEL || 'kontext';

const OUTPUT_DIR = path.join(__dirname, 'assets', 'host');
const RAW_PATH = path.join(OUTPUT_DIR, 'avatar-raw.png');
const FINAL_PATH = path.join(OUTPUT_DIR, 'avatar.png');

// نفس وصف الشخصية المستخدم بمشاهد الفيديو (STYLE_LOCK بملف image.service.js) -
// خلها متطابقة عشان الأفتار بالزاوية يطابق شخصية الفيديو نفسها. لازم تبقى
// عبارة "solid pure green background" موجودة - الخطوة اللي تحت تعتمد عليها
// لإزالة الخلفية.
const AVATAR_PROMPT =
  'Hand-drawn sketch illustration style, minimalist stick-figure detective/narrator ' +
  'character with a round head, wearing a trench coat and fedora hat, simple dot eyes, ' +
  'holding a magnifying glass. Muted noir tones, visible paper texture, loose hand-inked ' +
  'linework, flat cartoon coloring. Chest-up portrait, facing forward, solid pure green ' +
  'background, no text, no watermark';

// seed غير مستخدم مع موديلات kontext/nanobanana (يدعمه بس flux/zimage) - يبقى هنا
// كتوثيق فقط لو رجعت تستخدم موديل يدعمه.
const SEED = 42;

const COLORKEY_COLOR = '0x00FF00'; // must match "pure green" in the prompt
const COLORKEY_SIMILARITY = '0.20'; // increase if green fringing remains, decrease if character is see-through
const COLORKEY_BLEND = '0.05';

async function downloadToFile(url, destPath) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${POLLINATIONS_KEY}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Download failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
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
  if (!POLLINATIONS_KEY) {
    throw new Error('POLLINATIONS_KEY is not set. Get a free key at https://enter.pollinations.ai first.');
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Generating host avatar via Pollinations.ai...');
  const encodedPrompt = encodeURIComponent(AVATAR_PROMPT);
  const url = `https://gen.pollinations.ai/image/${encodedPrompt}?model=${IMAGE_MODEL}&width=800&height=800`;
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
