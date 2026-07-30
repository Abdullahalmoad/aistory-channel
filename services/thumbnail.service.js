const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const POLLINATIONS_KEY = process.env.POLLINATIONS_KEY;
const IMAGE_MODEL = process.env.POLLINATIONS_IMAGE_MODEL || 'kontext';

const THUMB_WIDTH = 1280;
const THUMB_HEIGHT = 720;
const FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const ACCENT_COLOR = 'yellow'; // punchy accent line, like a professional CapCut/YouTube thumbnail

async function downloadToFile(url, destPath, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Download failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
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
    const scenePrompt = script.thumbnail_image_prompt || script.title || 'a dramatic prehistoric scene';
    const STYLE_LOCK =
      'Hand-drawn sketch illustration style, minimalist stick-figure prehistoric human character ' +
      'with a round head, messy dark hair, simple dot eyes, wearing rough fur/hide clothing. ' +
      'Muted earthy color palette, visible paper texture, loose hand-inked linework, flat cartoon ' +
      'coloring, dramatic lighting, high contrast, cinematic. No text, no watermark.';
    const fullPrompt = `${STYLE_LOCK} Scene: ${scenePrompt}`;
    const encodedPrompt = encodeURIComponent(fullPrompt);
    const url = `https://gen.pollinations.ai/image/${encodedPrompt}?model=${IMAGE_MODEL}&width=${THUMB_WIDTH}&height=${THUMB_HEIGHT}`;
    await downloadToFile(url, bgPath, { Authorization: `Bearer ${POLLINATIONS_KEY}` });
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
