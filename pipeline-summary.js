require('dotenv').config();
// pipeline-summary.js
// SEPARATE pipeline from pipeline.js - does NOT touch story generation or
// the long-form video. Finds a real source video automatically, downloads
// it, transcribes + summarizes it into English, cuts the best moments from
// the ORIGINAL footage, overlays new English narration, and uploads ONLY a
// Short (max ~175s to stay safely under YouTube's 180s Shorts cap).

const fs = require('fs');
const path = require('path');

const { findNextSourceVideo, markUsed } = require('./services/discover.service');
const { downloadSourceVideo } = require('./services/download.service');
const { transcribeAndSummarize } = require('./services/summarize.service');
const { generateEnglishNarration, getNarrationWordTimestamps, buildClippedVideo, assembleFinalShort } = require('./services/clip.service');
const { uploadVideo } = require('./services/youtube.service');
const { notifySuccess, notifyFailure } = require('./services/telegram.service');

const MAX_SHORT_SECONDS = 175; // stay safely under YouTube's 180s Shorts cap

async function runSummaryShortPipeline() {
  const jobId = `summary-job-${Date.now()}`;
  const workDir = path.join('/tmp', jobId);
  fs.mkdirSync(workDir, { recursive: true });

  console.log(`\n=== Summary Short pipeline (${jobId}) ===`);

  console.log('[1/5] Finding a source video...');
  const source = await findNextSourceVideo();
  console.log(`  -> "${source.title}" (${source.channelTitle}) ${source.url}`);

  console.log('[2/5] Downloading source video...');
  const sourceVideoPath = await downloadSourceVideo(source.url, workDir);

  console.log('[3/5] Transcribing + summarizing into English...');
  const { narration, clips, title, description, sourceLanguage } = await transcribeAndSummarize(
    sourceVideoPath,
    workDir,
    { title: source.title, maxDurationSeconds: MAX_SHORT_SECONDS }
  );
  console.log(`  -> Source language: ${sourceLanguage} | ${clips.length} clips selected`);

  console.log('[4/5] Building the Short (cutting clips + new English narration)...');
  const narrationAudioPath = path.join(workDir, 'narration.mp3');
  await generateEnglishNarration(narration, narrationAudioPath);
  const narrationWords = await getNarrationWordTimestamps(narrationAudioPath);

  const clippedVideoPath = await buildClippedVideo(sourceVideoPath, clips, path.join(workDir, 'clips'));

  const finalShortPath = path.join(workDir, 'final-short.mp4');
  await assembleFinalShort({
    clippedVideoPath,
    narrationAudioPath,
    words: narrationWords,
    workDir,
    outputPath: finalShortPath,
  });

  console.log('[5/5] Uploading Short to YouTube...');
  const isFirstWeekMode = process.env.FIRST_WEEK_MODE !== 'false';
  const uploadPrivacy = isFirstWeekMode ? 'private' : 'public';
  if (isFirstWeekMode) console.log('  -> FIRST_WEEK_MODE is on: uploading as PRIVATE');

  const upload = await uploadVideo({
    videoPath: finalShortPath,
    title: `${title} #shorts`,
    description,
    tags: ['shorts', 'history', 'ancienthistory'],
    privacyStatus: uploadPrivacy,
    containsSyntheticMedia: true,
  });

  markUsed(source.videoId);

  console.log(`\nDone! Short: ${upload.url}`);
  await notifySuccess({ title, longUrl: '(none - summary Shorts only)', shortUrl: upload.url });

  return { source, title, upload };
}

async function runDailySummaryShort() {
  try {
    return await runSummaryShortPipeline();
  } catch (err) {
    console.error('Summary Short pipeline failed:', err);
    await notifyFailure('summary short pipeline', err);
    throw err;
  }
}

module.exports = { runSummaryShortPipeline, runDailySummaryShort };
