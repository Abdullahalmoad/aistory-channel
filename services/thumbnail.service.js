const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const THUMB_WIDTH = 1280;
const THUMB_HEIGHT = 720;
const FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

function downloadToFile(url, destPath, headers = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        return downloadToFile(res.headers.location, destPath, headers, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
      }
      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => fileStream.close(() => resolve(destPath)));
      fileStream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 60s')); });
    req.on('error', reject);
  });
}

function runFfmpeg(args, label = 'ffmpeg') {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (code ${code}): ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

function escapeDrawtext(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '\u2019')
    .replace(/%/g, '\\%');
}

async function generateThumbnail(script, outputDir) {
  const rawText = (script.thumbnail_text || script.title || '').toUpperCase();
  const imagePrompt = script.thumbnail_image_prompt || script.title || 'a mysterious dramatic scene';

  const bgPath = path.join(outputDir, 'thumb-bg.jpg');
  const outputPath = path.join(outputDir, 'thumbnail.jpg');

  const STYLE_SUFFIX = ', flat vector illustration, dramatic lighting, high contrast, cinematic, no text, no watermark';
  const fullPrompt = `${imagePrompt}${STYLE_SUFFIX}`;
  const encodedPrompt = encodeURIComponent(fullPrompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${THUMB_WIDTH}&height=${THUMB_HEIGHT}&nologo=true&model=flux`;

  await downloadToFile(url, bgPath);

  const words = rawText.split(' ').filter(Boolean);
  const mid = Math.ceil(words.length / 2);
  const line1 = words.slice(0, mid).join(' ');
  const line2 = words.slice(mid).join(' ');
  const escLine1 = escapeDrawtext(line1);
  const escLine2 = escapeDrawtext(line2);

  const darkOverlay = `drawbox=x=0:y=ih*0.62:w=iw:h=ih*0.38:color=black@0.45:t=fill`;
  let filters;
  if (line2) {
    filters = [
      darkOverlay,
      `drawtext=fontfile=${FONT_PATH}:text='${escLine1}':fontsize=95:fontcolor=white:borderw=8:bordercolor=black:x=(w-text_w)/2:y=h*0.68`,
      `drawtext=fontfile=${FONT_PATH}:text='${escLine2}':fontsize=95:fontcolor=white:borderw=8:bordercolor=black:x=(w-text_w)/2:y=h*0.82`,
    ].join(',');
  } else {
    filters = [
      darkOverlay,
      `drawtext=fontfile=${FONT_PATH}:text='${escLine1}':fontsize=95:fontcolor=white:borderw=8:bordercolor=black:x=(w-text_w)/2:y=h*0.75`,
    ].join(',');
  }

  await runFfmpeg(['-y', '-i', bgPath, '-vf', filters, '-frames:v', '1', outputPath], 'thumbnail render');

  return outputPath;
}

module.exports = { generateThumbnail };
