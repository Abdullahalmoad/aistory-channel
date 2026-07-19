const fs = require('fs');
const path = require('path');
const https = require('https');

const STYLE_SUFFIX =
  ', flat vector illustration, minimalist flat design, simple 2D vector art, ' +
  'thin clean outlines, limited flat color palette, plain simple background, ' +
  'no text, no watermark, no signature';

function downloadToFile(url, destPath, headers = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 45000 }, (res) => {
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
      reject(new Error('Request timed out after 45s'));
    });
    req.on('error', reject);
  });
}

async function getSceneImage(scene, outputDir, options = {}) {
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
  return { source: 'pollinations', filePath: destPath };
}

async function getAllSceneImages(scenes, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const results = [];
  for (const scene of scenes) {
    try {
      const { filePath } = await getSceneImage(scene, outputDir);
      results.push({ ...scene, image_file: filePath, image_error: null });
    } catch (err) {
      console.error(`Image failed for scene ${scene.scene_order}: ${err.message}`);
      results.push({ ...scene, image_file: null, image_error: err.message });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return results;
}

module.exports = { getAllSceneImages, getSceneImage, STYLE_SUFFIX };
