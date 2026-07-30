const fs = require('fs');
const path = require('path');

const POLLINATIONS_KEY = process.env.POLLINATIONS_KEY;
const GEN_BASE = 'https://gen.pollinations.ai';
// kontext = Flux Kontext, strong at consistent image editing/reference-following.
// nanobanana / nanobanana-2 are alternatives - compare cost/quality via GET /image/models.
const IMAGE_MODEL = process.env.POLLINATIONS_IMAGE_MODEL || 'kontext';

const CHARACTER_REF_PATH = path.join(__dirname, '..', 'assets', 'character-reference.png');

// وصف الشخصية والستايل الثابت - يُضاف تلقائياً لكل مشهد. السكربت (script.service.js)
// لا يعيد وصف الشخصية أبداً، فقط يصف الفعل/المكان لكل مشهد.
const STYLE_LOCK =
  'Hand-drawn sketch illustration style, minimalist stick-figure prehistoric human ' +
  'character with a round head, messy dark hair, simple dot eyes, wearing rough ' +
  'fur/hide clothing. Muted earthy color palette: sepia, dusty beige, warm brown, ' +
  'faded tan. Visible paper texture, loose hand-inked linework, flat cartoon coloring, ' +
  'no gradients, no 3D render look. Wide cinematic landscape composition. No text, ' +
  'no watermark, no logo, no captions.';

function assertKey() {
  if (!POLLINATIONS_KEY) {
    throw new Error(
      'POLLINATIONS_KEY is not set. Get a free key at https://enter.pollinations.ai and add it as a GitHub secret / env var.'
    );
  }
}

function isValidImage(filePath) {
  try {
    // format-agnostic (kontext/nanobanana can return jpeg or png) - just guard against
    // empty/error/tiny responses.
    return fs.statSync(filePath).size > 15000;
  } catch {
    return false;
  }
}

async function downloadImageResponse(res, destPath) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pollinations request failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

async function uploadReferenceImage(filePath) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)]), 'character.png');
  const res = await fetch(`${GEN_BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${POLLINATIONS_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Reference upload failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.url; // https://media.pollinations.ai/<hash> - valid 30 days, so we re-upload every run
}

/**
 * تولد صورة الشخصية المرجعية مرة وحدة إذا مو موجودة، وتحفظها بالريبو.
 * تشغيلة GitHub Actions الأولى تولدها تلقائياً؛ يُفضّل بعدها تسوي commit
 * لملف assets/character-reference.png عشان نفس الشخصية تثبت لكل الفيديوهات القادمة.
 */
async function generateCharacterReferenceIfMissing() {
  if (fs.existsSync(CHARACTER_REF_PATH)) return CHARACTER_REF_PATH;

  assertKey();
  console.log('  -> No character reference found - generating one now (first run only)...');
  const prompt = encodeURIComponent(
    `${STYLE_LOCK} Full-body reference portrait of the main character, standing neutrally, facing camera, holding a simple wooden spear.`
  );
  const res = await fetch(`${GEN_BASE}/image/${prompt}?model=${IMAGE_MODEL}&width=1024&height=1536`, {
    headers: { Authorization: `Bearer ${POLLINATIONS_KEY}` },
  });

  fs.mkdirSync(path.dirname(CHARACTER_REF_PATH), { recursive: true });
  await downloadImageResponse(res, CHARACTER_REF_PATH);
  console.log(`  -> Character reference saved: ${CHARACTER_REF_PATH}`);
  console.log('  -> IMPORTANT: commit this file to your repo so future runs reuse the same character.');
  return CHARACTER_REF_PATH;
}

async function getSceneImageFromAI(scene, outputDir, referenceUrl) {
  if (!scene.image_prompt) {
    throw new Error(`Scene ${scene.scene_order} has no image_prompt`);
  }
  const destPath = path.join(outputDir, `scene-${scene.scene_order}.png`);

  const prompt = encodeURIComponent(
    `${STYLE_LOCK} Use the exact same character shown in the reference image (same face, hair, and outfit) - do not change their appearance. Scene: ${scene.image_prompt}`
  );
  const url = `${GEN_BASE}/image/${prompt}?model=${IMAGE_MODEL}&image=${encodeURIComponent(referenceUrl)}&width=1920&height=1080`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${POLLINATIONS_KEY}` } });
  await downloadImageResponse(res, destPath);

  if (!isValidImage(destPath)) {
    try { fs.unlinkSync(destPath); } catch {}
    throw new Error(`Image failed quality check for scene ${scene.scene_order}`);
  }

  return { filePath: destPath, source: `pollinations-${IMAGE_MODEL}` };
}

async function getAllSceneImages(scenes, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  assertKey();

  await generateCharacterReferenceIfMissing();
  const referenceUrl = await uploadReferenceImage(CHARACTER_REF_PATH);

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
            const result = await getSceneImageFromAI(scene, outputDir, referenceUrl);
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

module.exports = { getAllSceneImages, generateCharacterReferenceIfMissing, STYLE_LOCK };
