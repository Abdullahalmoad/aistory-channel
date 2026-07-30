const fs = require('fs');
const path = require('path');

// endpoint قديم منفصل عن gen.pollinations.ai - مجاني تماماً بدون مفتاح API،
// بدون حد يومي موثق، بس موديل flux بس (بدون kontext).
const IMAGE_BASE = 'https://image.pollinations.ai/prompt';
const IMAGE_MODEL = process.env.POLLINATIONS_IMAGE_MODEL || 'flux';
const FETCH_TIMEOUT_MS = 180000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EVAL_MODEL = process.env.GEMINI_EVAL_MODEL || 'gemini-2.5-flash';
const GEMINI_EVAL_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EVAL_MODEL}:generateContent`;

const CANDIDATE_COUNT = Math.max(1, parseInt(process.env.IMAGE_CANDIDATE_COUNT || '2', 10));

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

function isValidImage(filePath) {
  try {
    return fs.statSync(filePath).size > 15000;
  } catch {
    return false;
  }
}

function fileToInlinePart(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  const data = fs.readFileSync(filePath).toString('base64');
  return { inline_data: { mime_type: mimeType, data } };
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

async function generateOneCandidate(scene, destPath) {
  const prompt = `${STYLE_LOCK} The main character is ${CHARACTER_DESCRIPTION}. Scene: ${scene.image_prompt}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await generateFluxImage(prompt, destPath);
      return destPath;
    } catch (err) {
      console.warn(`Image attempt ${attempt}/3 failed for scene ${scene.scene_order}: ${err.message}`);
      if (attempt < 3) {
        const backoff = Math.min(8000, 1500 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        return null;
      }
    }
  }
  return null;
}

async function pickBestCandidate(scene, candidatePaths) {
  if (!GEMINI_API_KEY) return 0;

  const imageParts = candidatePaths.map(fileToInlinePart);
  const prompt =
    `You are judging ${candidatePaths.length} candidate illustrations for the same video scene, ` +
    `shown in order (Image 1, Image 2, ...). Scene description: "${scene.image_prompt}". ` +
    `Pick the image that best matches the scene description and has the clearest composition. ` +
    `Respond with ONLY a JSON object like {"best": 1} - no explanation, no markdown.`;

  const res = await fetch(`${GEMINI_EVAL_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [...imageParts, { text: prompt }] }] }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Evaluation request failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text || '';
  const match = text.match(/"best"\s*:\s*(\d+)/) || text.match(/\d+/);
  if (!match) throw new Error(`Could not parse evaluation response: ${text.slice(0, 150)}`);

  const chosen = parseInt(match[1] || match[0], 10);
  if (!chosen || chosen < 1 || chosen > candidatePaths.length) {
    throw new Error(`Evaluation returned out-of-range choice: ${chosen}`);
  }
  console.log(`  -> Scene ${scene.scene_order}: picked candidate ${chosen}/${candidatePaths.length}`);
  return chosen - 1;
}

async function generateSceneImageBestOf(scene, outputDir) {
  if (!scene.image_prompt) {
    throw new Error(`Scene ${scene.scene_order} has no image_prompt`);
  }

  const candidatePaths = [];
  for (let i = 0; i < CANDIDATE_COUNT; i++) {
    const candDest = path.join(outputDir, `scene-${scene.scene_order}-cand${i + 1}.png`);
    const result = await generateOneCandidate(scene, candDest);
    if (result) candidatePaths.push(result);
  }

  if (candidatePaths.length === 0) {
    return { filePath: null, source: null };
  }

  const finalPath = path.join(outputDir, `scene-${scene.scene_order}.png`);

  if (candidatePaths.length === 1) {
    fs.renameSync(candidatePaths[0], finalPath);
    return { filePath: finalPath, source: `pollinations-${IMAGE_MODEL}` };
  }

  let bestIndex = 0;
  try {
    bestIndex = await pickBestCandidate(scene, candidatePaths);
  } catch (err) {
    console.warn(`  -> Evaluation failed for scene ${scene.scene_order}, keeping first candidate: ${err.message}`);
  }

  candidatePaths.forEach((p, i) => {
    if (i === bestIndex) {
      fs.renameSync(p, finalPath);
    } else {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  return { filePath: finalPath, source: `pollinations-${IMAGE_MODEL}` };
}

async function getAllSceneImages(scenes, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  await generateCharacterReferenceIfMissing();

  const BATCH_SIZE = 2;
  const rawResults = new Array(scenes.length);

  for (let i = 0; i < scenes.length; i += BATCH_SIZE) {
    const batch = scenes.slice(i, i + BATCH_SIZE);
    console.log(`  -> Generating images ${i + 1}-${Math.min(i + BATCH_SIZE, scenes.length)}/${scenes.length} (${CANDIDATE_COUNT} candidate(s) each)...`);
    const batchResults = await Promise.all(
      batch.map(async (scene, idx) => {
        await new Promise((r) => setTimeout(r, idx * 500));
        try {
          const { filePath, source } = await generateSceneImageBestOf(scene, outputDir);
          return { filePath, source, error: filePath ? null : 'All candidates failed' };
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
