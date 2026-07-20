// pipeline.js
// Full end-to-end run for ONE topic: script -> narration -> images ->
// timestamps -> render long video -> cut Short teaser -> upload both to
// YouTube -> Telegram notification.

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

  console.log('[1/6] Generating script...');
  const narrativeStyle = pickNarrativeStyle();
  const script = await generateScript(topic, { targetWords: 1800, narrativeStyle });
  console.log(`  -> "${script.title}" | ${script.scenes.length} scenes | ~${script.estimated_word_count} words | style: ${narrativeStyle}`);

  console.log('[2/6] Generating narration audio...');
  const audioPath = path.join(workDir, 'narration.mp3');
  await generateNarrationAudio(script.scenes, { outputPath: audioPath });

  console.log('[3/6] Fetching/generating images...');
  const imagesDir = path.join(workDir, 'images');
  const scenesWithImages = await getAllSceneImages(script.scenes, imagesDir);

  console.log('[4/6] Transcribing narration for caption timing...');
  const { scenes: scenesWithTimestamps } = await transcribeAndAssign(audioPath, scenesWithImages);

  console.log('[5/6] Rendering long video + Short teaser (this is the slow step)...');
  const musicPath = getRandomMusicTrack();
  const longVideoPath = path.join(workDir, 'long-video.mp4');
  await renderLongVideo({
    scenes: scenesWithTimestamps,
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

  console.log('[6/6] Uploading to YouTube...');
  const isFirstWeekMode = process.env.FIRST_WEEK_MODE !== 'false';
  const uploadPrivacy = isFirstWeekMode ? 'private' : 'public';
  if (isFirstWeekMode) {
    console.log('  -> FIRST_WEEK_MODE is on: uploading as PRIVATE');
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

async function runMorningPipeline(topic) {
  const jobId = `job-${Date.now()}`;
  const workDir = path.join('/tmp', jobId);
  fs.mkdirSync(workDir, { recursive: true });

  console.log(`\n=== Morning run for: "${topic}" (${jobId}) ===`);

  console.log('[1/6] Generating script...');
  const narrativeStyle = pickNarrativeStyle();
  const script = await generateScript(topic, { targetWords: 1800, narrativeStyle });
  console.log(`  -> "${script.title}" | ${script.scenes.length} scenes | style: ${narrativeStyle}`);

  console.log('[2/6] Generating narration audio...');
  const audioPath = path.join(workDir, 'narration.mp3');
  await generateNarrationAudio(script.scenes, { outputPath: audioPath });

  console.log('[3/6] Fetching/generating images...');
  const imagesDir = path.join(workDir, 'images');
  const scenesWithImages = await getAllSceneImages(script.scenes, imagesDir);

  console.log('[4/6] Transcribing narration for caption timing...');
  const { scenes: scenesWithTimestamps } = await transcribeAndAssign(audioPath, scenesWithImages);

  console.log('[5/6] Rendering long video + Short teaser...');
  const musicPath = getRandomMusicTrack();
  const longVideoPath = path.join(workDir, 'long-video.mp4');
  await renderLongVideo({
    scenes: scenesWithTimestamps,
    audioPath,
    musicPath,
    workDir: path.join(workDir, 'render-work'),
    outputPath: longVideoPath,
  });

  const shortVideoPath = path.join(workDir, 'short-video.mp4');
  await renderShortTeaser({
    longVideoPath,
    scenes: scenesWithTimestamps,
    workDir: path.join(workDir, 'short-work'),
    outputPath: shortVideoPath,
  });

  console.log('[6/6] Uploading long video now...');
  const isFirstWeekMode = process.env.FIRST_WEEK_MODE !== 'false';
  const uploadPrivacy = isFirstWeekMode ? 'private' : 'public';

  const longUpload = await uploadVideo({
    videoPath: longVideoPath,
    title: script.title,
    description: script.description,
    tags: script.tags,
    privacyStatus: uploadPrivacy,
    containsSyntheticMedia: true,
  });

  console.log(`  -> Long video uploaded: ${longUpload.url}`);
  await notifySuccess({ title: script.title, longUrl: longUpload.url, shortUrl: '(pending, later today)', narrativeStyle });

  const statePath = path.join(workDir, 'pending-short.json');
  const state = {
    shortVideoPath,
    title: `${script.title} #shorts`,
    description: `Full story on the channel.\n\n${script.description}`,
    tags: [...script.tags, 'shorts'],
    privacyStatus: uploadPrivacy,
  };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`  -> Short teaser saved for later upload: ${statePath}`);

  return { script, longUpload, statePath, shortVideoPath };
}

async function uploadPendingShort(statePath) {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

  console.log(`Uploading pending Short: ${state.shortVideoPath}`);
  const shortUpload = await uploadVideo({
    videoPath: state.shortVideoPath,
    title: state.title,
    description: state.description,
    tags: state.tags,
    privacyStatus: state.privacyStatus,
    containsSyntheticMedia: true,
  });

  console.log(`  -> Short uploaded: ${shortUpload.url}`);
  await notifySuccess({ title: state.title, longUrl: '(uploaded this morning)', shortUrl: shortUpload.url });
  return shortUpload;
}

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

async function runDailyWithStagger() {
  const topic = getNextTopic();
  let morning;
  try {
    morning = await runMorningPipeline(topic);
  } catch (err) {
    console.error('Morning phase failed:', err);
    await notifyFailure('morning pipeline', err);
    throw err;
  }

  const minDelayMs = 90 * 60 * 1000;
  const maxDelayMs = 4 * 60 * 60 * 1000;
  const delayMs = minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs));
  console.log(`\nWaiting ${Math.round(delayMs / 60000)} minutes before uploading the Short...`);
  await new Promise((r) => setTimeout(r, delayMs));

  try {
    await uploadPendingShort(morning.statePath);
  } catch (err) {
    console.error('Short upload failed:', err);
    await notifyFailure('short upload', err);
    throw err;
  }
}

module.exports = { runPipelineForTopic, runDailyPipeline, runMorningPipeline, uploadPendingShort, runDailyWithStagger };
