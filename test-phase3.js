require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { generateScript } = require('./services/script.service');
const { generateNarrationAudio } = require('./services/tts.service');
const { getAllSceneImages } = require('./services/image.service');
const { transcribeAndAssign } = require('./services/transcribe.service');
const { renderLongVideo, renderShortTeaser } = require('./services/render.service');

const SCRIPT_CACHE_PATH = './test-phase3-script.json';

async function getScriptCachedOrFresh() {
  if (fs.existsSync(SCRIPT_CACHE_PATH)) {
    console.log('[1/5] Using cached script (delete test-phase3-script.json for a fresh one)...');
    return JSON.parse(fs.readFileSync(SCRIPT_CACHE_PATH, 'utf-8'));
  }
  console.log('[1/5] Generating SHORT test script (~300 words)...');
  const topic = 'The Dyatlov Pass Incident: a real unsolved mystery';
  const script = await generateScript(topic, { targetWords: 300 });
  fs.writeFileSync(SCRIPT_CACHE_PATH, JSON.stringify(script, null, 2));
  return script;
}

async function main() {
  const script = await getScriptCachedOrFresh();
  console.log(`  -> ${script.scenes.length} scenes, hooks: ${script.scenes.filter(s => s.is_hook).length}`);

  console.log('[2/5] Generating narration audio...');
  const audioPath = './test-phase3-narration.mp3';
  if (fs.existsSync(audioPath)) {
    console.log('  -> Reusing existing narration audio (delete the .mp3 file to regenerate)');
  } else {
    await generateNarrationAudio(script.scenes, { outputPath: audioPath });
  }

  console.log('[3/5] Generating images for all scenes...');
  const imagesDir = './test-phase3-images';
  const existingImages = fs.existsSync(imagesDir) ? fs.readdirSync(imagesDir).filter(f => f.endsWith('.jpg')) : [];
  let scenesWithImages;
  if (existingImages.length >= script.scenes.length) {
    console.log('  -> Reusing existing images (delete test-phase3-images/ to regenerate)');
    scenesWithImages = script.scenes.map((s) => ({
      ...s,
      image_file: path.join(imagesDir, `scene-${s.scene_order}.jpg`),
      image_error: fs.existsSync(path.join(imagesDir, `scene-${s.scene_order}.jpg`)) ? null : 'missing',
    }));
  } else {
    scenesWithImages = await getAllSceneImages(script.scenes, imagesDir);
  }
  const failed = scenesWithImages.filter((s) => s.image_error);
  if (failed.length > 0) console.warn(`  -> ${failed.length} image(s) failed, will be skipped`);

  console.log('[4/5] Transcribing for caption timing...');
  const { scenes: scenesWithTimestamps } = await transcribeAndAssign(audioPath, scenesWithImages);

  console.log('[5/5] Rendering long video + Short teaser (slow step, be patient)...');
  const longVideoPath = './test-phase3-long.mp4';
  await renderLongVideo({
    scenes: scenesWithTimestamps.filter((s) => s.image_file),
    audioPath,
    workDir: './test-phase3-render-work',
    outputPath: longVideoPath,
  });
  console.log(`  -> Long video: ${longVideoPath}`);

  const shortVideoPath = './test-phase3-short.mp4';
  await renderShortTeaser({
    longVideoPath,
    scenes: scenesWithTimestamps,
    workDir: './test-phase3-short-work',
    outputPath: shortVideoPath,
  });
  console.log(`  -> Short teaser: ${shortVideoPath}`);

  console.log('\nDone! Open both .mp4 files and check: video plays, captions show, host avatar visible, audio synced.');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
