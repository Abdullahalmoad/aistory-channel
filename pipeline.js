// pipeline.js
// Full end-to-end run for ONE topic: script -> narration -> images ->
// timestamps -> render long video -> cut Short teaser -> upload both to
// YouTube -> Telegram notification. This is the single function the daily
// scheduler calls.

const fs = require('fs');
const path = require('path');

const { generateScript, pickNarrativeStyle } = require('./services/script.service');
const { generateNarrationAudio } = require('./services/tts.service');
const { getAllSceneImages } = require('./services/image.service');
const { transcribeAndAssign } = require('./services/transcribe.service');
const { renderLongVideo, renderShortTeaser } = require('./services/render.service');
const { uploadVideo } = require('./services/youtube.service');
const { getNextTopic } = require('./services/topics.service');
const { getRandomMusicTrack } = require('./services/music.service');
const { notifySuccess, notifyFailure } = require('./services/telegram.service');

async function runPipelineForTopic(topic) {
  const jobId = `job-${Date.now()}`;
  const workDir = path.join('/tmp', jobId);
  fs.mkdirSync(workDir, { recursive: true });

  console.log(`\n=== Starting pipeline for: "${topic}" (${jobId}) ===`);

  // 1) Script
  console.log('[1/6] Generating script...');
  const narrativeStyle = pickNarrativeStyle();
  const script = await generateScript(topic, { targetWords: 1800, narrativeStyle });
  console.log(`  -> "${script.title}" | ${script.scenes.length} scenes | ~${script.estimated_word_count} words | style: ${narrativeStyle}`);

  // 2) Narration audio
  console.log('[2/6] Generating narration audio...');
  const audioPath = path.join(workDir, 'narration.mp3');
  await generateNarrationAudio(script.scenes, { outputPath: audioPath });

  // 3) Images per scene
  console.log('[3/6] Fetching/generating images...');
  const imagesDir = path.join(workDir, 'images');
  const scenesWithImages = await getAllSceneImages(script.scenes, imagesDir);
  const failedImages = scenesWithImages.filter((s) => s.image_error);
  if (failedImages.length > 0) {
    console.warn(`  -> ${failedImages.length} scene(s) missing images, they will be skipped in render`);
  }

  // 4) Word timestamps + assign to scenes
  console.log('[4/6] Transcribing narration for caption timing...');
  const { scenes: scenesWithTimestamps } = await transcribeAndAssign(audioPath, scenesWithImages);

  // 5) Render long video + Short teaser
  console.log('[5/6] Rendering long video (this is the slow step)...');
  const musicPath = getRandomMusicTrack();
  const longVideoPath = path.join(workDir, 'long-video.mp4');
  await renderLongVideo({
    scenes: scenesWithTimestamps.filter((s) => s.image_file),
    audioPath,
    musicPath,
    workDir: path.join(workDir, 'render-work'),
    outputPath: longVideoPath,
  });

  console.log('  -> Rendering Short teaser from hook scenes...');
  const shortVideoPath = path.join(workDir, 'short-video.mp4');
  await renderShortTeaser({
    longVideoPath,
    scenes: scenesWithTimestamps,
    workDir: path.join(workDir, 'short-work'),
    outputPath: shortVideoPath,
  });

  // 6) Upload both to YouTube
  console.log('[6/6] Uploading to YouTube...');
  // First 7 days default to "private" so nothing public goes out unreviewed
  // while you're still confirming the pipeline works end-to-end. Flip
  // FIRST_WEEK_MODE=false in .env once you've checked a few runs are solid.
  const isFirstWeekMode = process.env.FIRST_WEEK_MODE !== 'false';
  const uploadPrivacy = isFirstWeekMode ? 'private' : 'public';
  if (isFirstWeekMode) {
    console.log('  -> FIRST_WEEK_MODE is on: uploading as PRIVATE (set FIRST_WEEK_MODE=false in .env once you trust the output)');
  }

  const longUpload = await uploadVideo({
    videoPath: longVideoPath,
    title: script.title,
    description: script.description,
    tags: script.tags,
    privacyStatus: uploadPrivacy,
    containsSyntheticMedia: true,
  });

  const shortUpload = await uploadVideo({
    videoPath: shortVideoPath,
    title: `${script.title} #shorts`,
    description: `Full story on the channel.\n\n${script.description}`,
    tags: [...script.tags, 'shorts'],
    privacyStatus: uploadPrivacy,
    containsSyntheticMedia: true,
  });

  console.log(`\nDone!\nLong: ${longUpload.url}\nShort: ${shortUpload.url}`);

  await notifySuccess({
    title: script.title,
    longUrl: longUpload.url,
    shortUrl: shortUpload.url,
    narrativeStyle,
  });

  return { script, longUpload, shortUpload };
}

/** Entry point used by the scheduler: pulls the next topic automatically. */
async function runDailyPipeline() {
  const topic = getNextTopic();
  try {
    return await runPipelineForTopic(topic);
  } catch (err) {
    console.error('Pipeline failed:', err);
    await notifyFailure('pipeline', err);
    throw err;
  }
}

module.exports = { runPipelineForTopic, runDailyPipeline };
