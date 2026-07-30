const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const FETCH_TIMEOUT_MS = 180000;

const CHARACTER_REF_PATH = path.join(__dirname, '..', 'assets', 'character-reference.png');

const STYLE_LOCK =
  'Hand-drawn sketch illustration style, minimalist stick-figure prehistoric human ' +
  'character with a round head, messy dark hair, simple dot eyes, wearing rough ' +
  'fur/hide clothing. Muted earthy color palette: sepia, dusty beige, warm brown, ' +
  'faded tan. Visible paper texture, loose hand-inked linework, flat cartoon coloring, ' +
  'no gradients, no 3D render look. Wide cinematic landscape composition. No text, ' +
  'no watermark, no logo, no captions.';

function assertKey() {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey and add it as a GitHub secret / env var.'
    );
  }
}

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

async function callGeminiImage(parts, destPath) {
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini request failed: ${res.status} ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const responseParts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = responseParts.find((p) => p.inlineData || p.inline_data);
  const inline = imagePart?.inlineData || imagePart?.inline_data;

  if (!inline?.data) {
    const textPart = responseParts.find((p) => p.text)?.text;
    throw new Error(`Gemini returned no image${textPart ? `: ${textPart.slice(0, 200)}` : ''}`);
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(inline.data, 'base64'));

  if (!isValidImage(destPath)) {
    try { fs.unlinkSync(destPath); } catch {}
    throw new Error('Image failed quality check');
  }

  return destPath;
}

async function generateCharacterReferenceIfMissing() {
  if (fs.existsSync(CHARACTER_REF_PATH)) return CHARACTER_REF_PATH;

  assertKey();
  console.log('  -> No character reference found - generating one now (first run only)...');
  const prompt =
    `${STYLE_LOCK} Full-body reference portrait of the main character, standing neutrally, ` +
    `facing camera, holding a simple wooden spear.`;

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await callGeminiImage([{ text: prompt }], CHARACTER_REF_PATH);
      console.log(`  -> Character reference saved: ${CHARACTER_REF_PATH}`);
      console.log('  -> IMPORTANT: commit this file to your repo so future runs reuse the same character.');
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

async function getSceneImageFromAI(scene, outputDir, referencePart) {
  if (!scene.image_prompt) {
    throw new Error(`Scene ${scene.scene_order} has no image_prompt`);
  }
  const destPath = path.join(outputDir, `scene-${scene.scene_order}.png`);

  const prompt =
    `${STYLE_LOCK} Use the exact same character shown in the reference image (same face, ` +
    `hair, and outfit) - do not change their appearance. Scene: ${scene.image_prompt}`;

  await callGeminiImage([referencePart, { text: prompt }], destPath);
  return { filePath: destPath, source: `gemini-${GEMINI_MODEL}` };
}

async function getAllSceneImages(scenes, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  assertKey();

  await generateCharacterReferenceIfMissing();
  const referencePart = fileToInlinePart(CHARACTER_REF_PATH);

  const BATCH_SIZE = 2;
  const rawResults = new Array(scenes.length);

  for (let i = 0; i < scenes.length; i += BATCH_SIZE) {
    const batch = scenes.slice(i, i + BATCH_SIZE);
    console.log(`  -> Generating images ${i + 1}-${Math.min(i + BATCH_SIZE, scenes.length)}/${scenes.length}...`);
    const batchResults = await Promise.all(
      batch.map(async (scene, idx) => {
        await new Promise((r) => setTimeout(r, idx * 300));
        let filePath = null;
        let source = null;
        let error = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const result = await getSceneImageFromAI(scene, outputDir, referencePart);
            filePath = result.filePath;
            source = result.source;
            break;
          } catch (err) {
            error = err.message;
            console.warn(`Image attempt ${attempt}/3 failed for scene ${scene.scene_order}: ${err.message}`);
            if (attempt < 3) {
              const backoff = Math.min(8000, 1500 * Math.pow(2, attempt - 1));
              await new Promise((r) => setTimeout(r, backoff));
            }
          }
        }
        return { filePath, source, error };
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
  assertKey();
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await callGeminiImage([{ text: prompt }], destPath);
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
