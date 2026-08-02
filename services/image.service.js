const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IMAGE_BASE = 'https://image.pollinations.ai/prompt';
const IMAGE_MODEL = process.env.POLLINATIONS_IMAGE_MODEL || 'flux';
const FETCH_TIMEOUT_MS = 180000;

const CHARACTER_REF_PATH = path.join(__dirname, '..', 'assets', 'character-reference.png');

const CHARACTER_DESCRIPTION =
  'a prehistoric caveman character: round head, short messy dark brown hair, ' +
  'a thick dark brown beard, deep-set simple dot eyes, medium tan skin, stocky build, ' +
  'wearing a rough brown/beige animal-hide tunic wrapped over one shoulder with a ' +
  'simple rope belt, carrying a wooden spear with a flint tip';

const STYLE_LOCK =
  'Hand-drawn sketch illustration style, minimalist stick-figure character design. ' +
  'Muted earthy color palette: sepia, dusty beige, warm brown, faded tan. ' +
  'Visible paper texture, loose hand-inked linework, flat cartoon coloring, ' +
  'no gradients, no 3D render look, no photorealism. Wide cinematic landscape ' +
  'composition. No text, no watermark, no logo, no captions.';

// Detects the emotional tone of a scene from its narration/image prompt text
// and appends a matching facial-expression / body-language description so
// the recurring character's pose stays consistent with the scene's mood
// (text-only, no extra images or API calls - works with Pollinations as-is).
const MOOD_EXPRESSIONS = [
  { keywords: ['fear', 'afraid', 'terrified', 'danger', 'threat', 'predator', 'attack'],
    expression: 'wide fearful eyes, tense crouched posture, alert defensive stance' },
  { keywords: ['angry', 'furious', 'rage', 'fight', 'conflict'],
    expression: 'furrowed brow, clenched jaw, aggressive forward-leaning stance' },
  { keywords: ['surprise', 'shock', 'sudden', 'unexpected', 'discover'],
    expression: 'wide-open eyes, raised eyebrows, mouth slightly open in surprise' },
  { keywords: ['sad', 'grief', 'loss', 'mourn', 'alone', 'lonely'],
    expression: 'downcast eyes, slumped shoulders, weary posture' },
  { keywords: ['happy', 'joy', 'celebrate', 'relief', 'success', 'triumph'],
    expression: 'warm content expression, relaxed open posture' },
  { keywords: ['curious', 'wonder', 'examine', 'investigate', 'study'],
    expression: 'tilted head, focused curious gaze, leaning in slightly' },
  { keywords: ['exhaust', 'tired', 'weak', 'struggle', 'starving', 'cold'],
    expression: 'hunched exhausted posture, heavy tired eyes' },
];

function detectExpression(sceneText) {
  const lower = (sceneText || '').toLowerCase();
  for (const mood of MOOD_EXPRESSIONS) {
    if (mood.keywords.some((k) => lower.includes(k))) {
      return mood.expression;
    }
  }
  return null;
}

function isValidImage(filePath) {
  try {
    return fs.statSync(filePath).size > 15000;
  } catch {
    return false;
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-1500)))));
  });
}

async function enhanceImage(filePath) {
  const tmpPath = filePath.replace(/(\.\w+)$/, '.enhanced$1');
  try {
    await runFfmpeg([
      '-i', filePath,
      '-vf', "scale=iw*1.1:ih*1.1:flags=lanczos,unsharp=5:5:0.8:5:5:0.4",
      tmpPath,
    ]);
    if (isValidImage(tmpPath)) {
      fs.renameSync(tmpPath, filePath);
    } else {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  } catch (err) {
    console.warn(`  -> Sharpening skipped (${err.message})`);
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

async function downloadImageResponse(res, destPath) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pollinations request failed: ${res.status} ${body.slice(0, 300)}`);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);

  if (!isValidImage(destPath)) {
    try { fs.unlinkSync(destPath); } catch {}
    throw new Error('Image failed quality check');
  }
  await enhanceImage(destPath);
  return destPath;
}

async function generateFluxImage(prompt, destPath, { width = 1920, height = 1080 } = {}) {
  const encodedPrompt = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 1000000);
  const url = `${IMAGE_BASE}/${encodedPrompt}?model=${IMAGE_MODEL}&width=${width}&height=${height}&nologo=true&seed=${seed}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  return downloadImageResponse(res, destPath);
}

async function generateCharacterReferenceIfMissing() {
  if (fs.existsSync(CHARACTER_REF_PATH)) return CHARACTER_REF_PATH;

  console.log('  -> No character reference found - generating one now (first run only)...');
  const prompt =
    `${STYLE_LOCK} Full-body reference portrait of ${CHARACTER_DESCRIPTION}, standing ` +
    `neutrally, facing camera.`;

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await generateFluxImage(prompt, CHARACTER_REF_PATH, { width: 1024, height: 1536 });
      console.log(`  -> Character reference saved: ${CHARACTER_REF_PATH}`);
      return CHARACTER_REF_PATH;
    } catch (err) {
      lastError = err;
      console.warn(`Character reference attempt ${attempt}/3 failed: ${err.message}`);
      if (attempt < 3) {
        const backoff = Math.min(15000, 3000 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw new Error(`Character reference generation failed after 3 attempts: ${lastError?.message}`);
}

async function generateSceneImageBestOf(scene, outputDir) {
  if (!scene.image_prompt) {
    throw new Error(`Scene ${scene.scene_order} has no image_prompt`);
  }

  const expression = detectExpression(`${scene.text || ''} ${scene.image_prompt}`);
  const characterLine = expression
    ? `${CHARACTER_DESCRIPTION}, with ${expression}`
    : CHARACTER_DESCRIPTION;

  const prompt = `${STYLE_LOCK} The main character is ${characterLine}. Scene: ${scene.image_prompt}`;
  const finalPath = path.join(outputDir, `scene-${scene.scene_order}.png`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await generateFluxImage(prompt, finalPath);
      return { filePath: finalPath, source: `pollinations-${IMAGE_MODEL}` };
    } catch (err) {
      console.warn(`Image attempt ${attempt}/3 failed for scene ${scene.scene_order}: ${err.message}`);
      if (attempt < 3) {
        const backoff = Math.min(8000, 1500 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  return { filePath: null, source: null };
}

async function getAllSceneImages(scenes, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  await generateCharacterReferenceIfMissing();

  const BATCH_SIZE = 2;
  const rawResults = new Array(scenes.length);

  for (let i = 0; i < scenes.length; i += BATCH_SIZE) {
    const batch = scenes.slice(i, i + BATCH_SIZE);
    console.log(`  -> Generating images ${i + 1}-${Math.min(i + BATCH_SIZE, scenes.length)}/${scenes.length}...`);
    const batchResults = await Promise.all(
      batch.map(async (scene, idx) => {
        await new Promise((r) => setTimeout(r, idx * 500));
        try {
          const { filePath, source } = await generateSceneImageBestOf(scene, outputDir);
          return { filePath, source, error: filePath ? null : 'Image generation failed' };
        } catch (err) {
          return { filePath: null, source: null, error: err.message };
        }
      })
    );
    batchResults.forEach((r, idx) => { rawResults[i + idx] = r; });
  }

  const results = [];
  let lastGood = null;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    let { filePath, source, error } = rawResults[i];

    if (!filePath) {
      if (lastGood) {
        filePath = lastGood;
        console.warn(`  -> Falling back to previous scene's image for scene ${scene.scene_order}`);
      } else {
        filePath = CHARACTER_REF_PATH;
        console.warn(`  -> No previous image available, using character reference for scene ${scene.scene_order}`);
      }
    } else {
      lastGood = filePath;
    }

    results.push({ ...scene, image_file: filePath, is_video: false, media_source: source, image_error: error });
  }
  return results;
}

async function generateStandaloneImage(prompt, destPath) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await generateFluxImage(prompt, destPath, { width: 1280, height: 720 });
      return destPath;
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        const backoff = Math.min(8000, 1500 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw new Error(`Standalone image generation failed after 3 attempts: ${lastError?.message}`);
}

module.exports = {
  getAllSceneImages,
  generateCharacterReferenceIfMissing,
  generateStandaloneImage,
  STYLE_LOCK,
};
