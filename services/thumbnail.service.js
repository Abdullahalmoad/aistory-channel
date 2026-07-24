const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const THUMB_WIDTH = 1280;
const THUMB_HEIGHT = 720;
const FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const ACCENT_COLOR = 'yellow'; // punchy accent line, like a professional CapCut/YouTube thumbnail

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

async function generateThumbnail(script, outputDir, scenes = null) {
  const rawText = (script.thumbnail_text || script.title || '').toUpperCase();

  const bgPath = path.join(outputDir, 'thumb-bg.jpg');
  const outputPath = path.join(outputDir, 'thumbnail.jpg');

  const scored = (scenes || []).filter((s) => s.image_file);
  const realPhotoScene =
    scored.find((s) => s.is_hook && !s.is_video) ||
    scored.find((s) => s.is_hook) ||
    scored.find((s) => !s.is_video) ||
    scored[0] ||
    null;

  if (realPhotoScene) {
    fs.copyFileSync(realPhotoScene.image_file, bgPath);
  } else {
    const imagePrompt = script.thumbnail_image_prompt || script.title || 'a mysterious dramatic scene';
    const STYLE_SUFFIX = ', flat vector illustration, dramatic lighting, high contrast, cinematic, no text, no watermark';
    const fullPrompt = `${imagePrompt}${STYLE_SUFFIX}`;
    const encodedPrompt = encodeURIComponent(fullPrompt);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${THUMB_WIDTH}&height=${THUMB_HEIGHT}&nologo=true&model=flux`;
    await downloadToFile(url, bgPath);
  }

  // Split text into two lines; the LAST line is the punchline and gets the accent color
  // so the eye has a clear hierarchy (this is what separates a "designed" thumbnail
  // from a plain caption slapped on a photo).
  const words = rawText.split(' ').filter(Boolean);
  const mid = Math.ceil(words.length / 2);
  const line1 = words.slice(0, mid).join(' ');
  const line2 = words.slice(mid).join(' ');
  const escLine1 = escapeDrawtext(line1);
  const escLine2 = escapeDrawtext(line2);

  const scaleCrop = `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=increase,crop=${THUMB_WIDTH}:${THUMB_HEIGHT}`;
  // Darken + slight contrast/vignette pass on the background photo so text always stays readable
  // regardless of what the source image looks like, and the frame feels graded, not raw.
  const gradePass = `eq=contrast=1.08:saturation=1.05:gamma=0.95,vignette=PI/5`;
  const darkOverlay = `drawbox=x=0:y=ih*0.60:w=iw:h=ih*0.40:color=black@0.55:t=fill`;

  let filters;
  if (line2) {
    filters = [
      scaleCrop,
      gradePass,
      darkOverlay,
      `drawtext=fontfile=${FONT_PATH}:text='${escLine1}':fontsize=90:fontcolor=white:borderw=9:bordercolor=black:x=(w-text_w)/2:y=h*0.67`,
      `drawtext=fontfile=${FONT_PATH}:text='${escLine2}':fontsize=100:fontcolor=${ACCENT_COLOR}:borderw=9:bordercolor=black:x=(w-text_w)/2:y=h*0.82`,
    ].join(',');
  } else {
    filters = [
      scaleCrop,
      gradePass,
      darkOverlay,
      `drawtext=fontfile=${FONT_PATH}:text='${escLine1}':fontsize=100:fontcolor=${ACCENT_COLOR}:borderw=9:bordercolor=black:x=(w-text_w)/2:y=h*0.75`,
    ].join(',');
  }

  await runFfmpeg(['-y', '-i', bgPath, '-vf', filters, '-frames:v', '1', outputPath], 'thumbnail render');

  return outputPath;
}

module.exports = { generateThumbnail };
