const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { fetchRealMedia } = require('./pexels.service');

const STYLE_SUFFIX =
  ', photorealistic, natural lighting, high detail, sharp focus, professional photography, no text, no watermark, no signature, no blur';

function downloadToFile(url, destPath, headers = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 70000 }, (res) => {
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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 70s'));
    });
    req.on('error', reject);
  });
}

function isValidImage(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 25000) return false;
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
    return true;
  } catch {
    return false;
  }
}

function isValidVideo(filePath) {
  try {
    return fs.statSync(filePath).size > 50000;
  } catch {
    return false;
  }
}

async function getSceneImageFromAI(scene, outputDir, options = {}) {
  if (!scene.image_prompt) {
    throw new Error(`Scene ${scene.scene_order} has no image_prompt`);
  }
  const destPath = path.join(outputDir, `scene-${scene.scene_order}.jpg`);

  const fullPrompt = `${scene.image_prompt}${STYLE_SUFFIX}`;
  const encodedPrompt = encodeURIComponent(fullPrompt);

  let url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1920&height=1080&nologo=true&model=flux`;
  if (options.seed != null) {
    url += `&seed=${options.seed}`;
  }

  await downloadToFile(url, destPath);

  if (!isValidImage(destPath)) {
    try { fs.unlinkSync(destPath); } catch {}
    throw new Error(`Image failed quality check for scene ${scene.scene_order}`);
  }

  return { filePath: destPath, isVideo: false, source: 'pollinations' };
}

async function getSceneMedia(scene, outputDir) {
  if (!scene.image_prompt) {
    throw new Error(`Scene ${scene.scene_order} has no image_prompt`);
  }

  const preferVideo = true; // videos are the primary media for this channel - always try a real video clip first, only fall back to a photo when no matching video exists
  const real = await fetchRealMedia(scene.image_prompt, outputDir, scene.scene_order, preferVideo);
  if (real && (real.isVideo ? isValidVideo(real.filePath) : isValidImage(real.filePath))) {
    return real;
  }

  return getSceneImageFromAI(scene, outputDir);
}

async function getAllSceneImages(scenes, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const BATCH_SIZE = 2;
  const rawResults = new Array(scenes.length);

  for (let i = 0; i < scenes.length; i += BATCH_SIZE) {
    const batch = scenes.slice(i, i + BATCH_SIZE);
    console.log(`  -> Fetching media ${i + 1}-${Math.min(i + BATCH_SIZE, scenes.length)}/${scenes.length}...`);
    const batchResults = await Promise.all(
      batch.map(async (scene, idx) => {
        await new Promise((r) => setTimeout(r, idx * 300));
        let filePath = null;
        let isVideo = false;
        let source = null;
        let error = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const result = await getSceneMedia(scene, outputDir);
            filePath = result.filePath;
            isVideo = result.isVideo;
            source = result.source;
            break;
          } catch (err) {
            error = err.message;
            console.warn(`Media attempt ${attempt}/3 failed for scene ${scene.scene_order}: ${err.message}`);
            if (attempt < 3) {
              const backoff = Math.min(8000, 1500 * Math.pow(2, attempt - 1));
              await new Promise((r) => setTimeout(r, backoff));
            }
          }
        }
        return { filePath, isVideo, source, error };
      })
    );
    batchResults.forEach((r, idx) => { rawResults[i + idx] = r; });
  }

  const results = [];
  let lastGood = null;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    let { filePath, isVideo, source, error } = rawResults[i];

    if (!filePath) {
      if (lastGood) {
        filePath = lastGood.filePath;
        isVideo = lastGood.isVideo;
        console.warn(`  -> Falling back to previous scene's media for scene ${scene.scene_order}`);
      } else {
        filePath = await ensureFallbackImage(outputDir);
        isVideo = false;
        console.warn(`  -> No previous media available, using plain fallback for scene ${scene.scene_order}`);
      }
    } else {
      lastGood = { filePath, isVideo };
    }

    results.push({ ...scene, image_file: filePath, is_video: isVideo, media_source: source, image_error: error });
  }
  return results;
}

async function ensureFallbackImage(outputDir) {
  const fallbackPath = path.join(outputDir, 'fallback.jpg');
  if (fs.existsSync(fallbackPath)) return fallbackPath;

  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=0x1a1a2e:s=1920x1080',
      '-frames:v', '1', fallbackPath,
    ]);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg fallback failed'))));
    proc.on('error', reject);
  });
  return fallbackPath;
}

module.exports = { getAllSceneImages, getSceneMedia, STYLE_SUFFIX };
