const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildSrtFromScenes, buildAssFromWords, buildTiktokAssFromWords } = require('./srt.util');
const { getHostAvatarPath } = require('./host.service');

const TRANSITION_DURATION = 0.5;

function runFfmpeg(args, label = 'ffmpeg', timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
      reject(new Error(`${label} timed out after ${timeoutMs / 1000}s and was killed`));
    }, timeoutMs);
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      const m = s.match(/frame=\s*(\d+).*fps=\s*([\d.]+).*speed=\s*([\d.]+)x/);
      if (m) console.log(`   [ffmpeg ${label}] frame=${m[1]} fps=${m[2]} speed=${m[3]}x`);
    });
    proc.on('close', (code) => {
      if (timedOut) return;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`${label} failed (exit ${code}):\n${stderr.slice(-2000)}`));
      }
      resolve();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Legacy fallback caption styles (used only when word-level timestamps aren't available)
const CAPTION_STYLES = [
  "FontName=Arial,Bold=1,FontSize=26,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=80",
  "FontName=Verdana,Bold=1,FontSize=25,PrimaryColour=&H0000E5FF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=85",
  "FontName=Georgia,Bold=1,FontSize=27,PrimaryColour=&H00E0E0E0,OutlineColour=&H00101010,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=75",
];

function pickCaptionStyle() {
  return CAPTION_STYLES[Math.floor(Math.random() * CAPTION_STYLES.length)];
}

// Cinematic color grade: slight contrast/desaturation, cool shadows, subtle vignette + film grain.
// Keeps a "mystery/horror" mood instead of the flat, un-graded look of raw AI/stock media.
const COLOR_GRADE =
  'eq=contrast=1.10:saturation=0.90:gamma=0.96:brightness=-0.02,' +
  'vignette=PI/6,' +
  'noise=alls=5:allf=t+u';

// Several Ken Burns pan directions instead of always "zoom into center" - CapCut-style variety.
const PAN_DIRECTIONS = [
  { x: 0, y: 0 },      // straight zoom-in, no pan
  { x: -60, y: 0 },    // pan left
  { x: 60, y: 0 },     // pan right
  { x: 0, y: -40 },    // pan up
  { x: 0, y: 40 },     // pan down
];

function pickPanDirection() {
  return PAN_DIRECTIONS[Math.floor(Math.random() * PAN_DIRECTIONS.length)];
}

// Varied xfade transitions between scenes instead of a single repeated "fade".
const TRANSITIONS = [
  'fade', 'fadeblack', 'wipeleft', 'wiperight', 'slideleft', 'slideright',
  'smoothleft', 'smoothright', 'circleopen', 'distance', 'hblur', 'radial',
];

function pickTransition() {
  return TRANSITIONS[Math.floor(Math.random() * TRANSITIONS.length)];
}

async function renderSceneClip(scene, outputPath, { width = 1080, height = 1920, avatarPath = null, captionStyle = null, workDir = null, words = null, extraTail = 0, captionMode = 'karaoke' } = {}) {
  const baseDuration = Math.max(scene.end_time - scene.start_time, 0.5);
  const duration = baseDuration + extraTail;
  const fps = 60;
  const totalFrames = Math.round(duration * fps);
  const revealSec = Math.min(0.4, baseDuration / 3);
  const isVideo = Boolean(scene.is_video);
  const pan = pickPanDirection();

  let baseFilter;
  if (isVideo) {
    baseFilter =
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
      `zoompan=z='min(zoom+0.0006,1.1)':x='iw/2-(iw/zoom/2)+${pan.x}*(on/${totalFrames})':y='ih/2-(ih/zoom/2)+${pan.y}*(on/${totalFrames})':d=${totalFrames}:s=${width}x${height}:fps=${fps},` +
      `fade=t=in:st=0:d=${revealSec}:alpha=0,` +
      `${COLOR_GRADE},format=yuv420p`;
  } else {
    baseFilter =
      `scale=${Math.round(width * 1.12)}:${Math.round(height * 1.12)}:force_original_aspect_ratio=increase,crop=${Math.round(width * 1.12)}:${Math.round(height * 1.12)},` +
      `zoompan=z='if(lte(on,${Math.round(revealSec * fps)}),1.03-0.03*on/${Math.round(revealSec * fps)},min(zoom+0.0004,1.06))':` +
      `x='iw/2-(iw/zoom/2)+${pan.x}*(on/${totalFrames})':y='ih/2-(ih/zoom/2)+${pan.y}*(on/${totalFrames})':` +
      `d=${totalFrames}:s=${width}x${height}:fps=${fps},` +
      `fade=t=in:st=0:d=${revealSec}:alpha=0,` +
      `${COLOR_GRADE},format=yuv420p`;
  }

  const inputs = [
    ...(isVideo ? ['-stream_loop', '-1'] : ['-loop', '1']),
    '-i', scene.image_file,
    ...(avatarPath ? ['-loop', '1', '-i', avatarPath] : []),
  ];

  let videoFilter;
  if (scene.text && workDir) {
    const sceneWords = words
      ? words
          .filter((w) => w.start >= scene.start_time && w.start < scene.end_time)
          .map((w) => ({
            ...w,
            start: Math.max(0, w.start - scene.start_time),
            end: Math.min(baseDuration, w.end - scene.start_time),
          }))
      : null;

    let subtitleFilter;
    if (sceneWords && sceneWords.length > 0) {
      const assPath = path.join(workDir, `scene-${scene.scene_order}.ass`);
      if (captionMode === 'tiktok') {
        buildTiktokAssFromWords(sceneWords, assPath, { videoWidth: width, videoHeight: height });
      } else {
        buildAssFromWords(sceneWords, assPath, { videoWidth: width, videoHeight: height });
      }
      subtitleFilter = `ass=${assPath.replace(/:/g, '\\:')}`;
    } else {
      // Fallback: no word timestamps for this scene, use plain styled subtitle.
      const srtPath = path.join(workDir, `scene-${scene.scene_order}.srt`);
      buildSrtFromScenes([{ start_time: 0, end_time: baseDuration, text: scene.text }], srtPath);
      const style = captionStyle || pickCaptionStyle();
      subtitleFilter = `subtitles=${srtPath.replace(/:/g, '\\:')}:force_style='${style}'`;
    }

    videoFilter = avatarPath
      ? `[0:v]${baseFilter},${subtitleFilter}[vsub];[1:v]scale=280:-1[avatarScaled];[vsub][avatarScaled]overlay=W-w-20:H-h-20[vout]`
      : `[0:v]${baseFilter},${subtitleFilter}[vout]`;
  } else {
    videoFilter = avatarPath
      ? `[0:v]${baseFilter}[vsub];[1:v]scale=280:-1[avatarScaled];[vsub][avatarScaled]overlay=W-w-20:H-h-20[vout]`
      : `[0:v]${baseFilter}[vout]`;
  }

  await runFfmpeg(
    [
      ...inputs,
      '-t', String(duration),
      '-filter_complex', videoFilter,
      '-map', '[vout]',
      '-r', String(fps),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outputPath,
    ],
    `scene ${scene.scene_order} render`
  );

  return duration;
}

function buildXfadeChain(n, transitionDuration, renderedDurations) {
  let filter = '';
  let prevLabel = '0:v';
  let cumulative = renderedDurations[0];
  for (let i = 1; i < n; i++) {
    const offset = Math.max(0, cumulative - transitionDuration);
    const outLabel = i === n - 1 ? 'vout' : `vx${i}`;
    const transition = pickTransition();
    filter += `[${prevLabel}][${i}:v]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offset.toFixed(3)}[${outLabel}];`;
    cumulative = cumulative + renderedDurations[i] - transitionDuration;
    prevLabel = outLabel;
  }
  return filter.replace(/;$/, '');
}

async function renderLongVideo({ scenes, words = null, audioPath, musicPath, workDir, outputPath }) {
  fs.mkdirSync(workDir, { recursive: true });

  const validScenes = scenes.filter((scene) => {
    if (!scene.image_file) {
      console.warn(`Skipping scene ${scene.scene_order} - no image_file`);
      return false;
    }
    return true;
  });

  const avatarPath = getHostAvatarPath();
  const captionStyle = pickCaptionStyle();

  const RENDER_CONCURRENCY = 4;
  const clipPathsBySceneOrder = {};
  const renderedDurationBySceneOrder = {};

  for (let i = 0; i < validScenes.length; i += RENDER_CONCURRENCY) {
    const batch = validScenes.slice(i, i + RENDER_CONCURRENCY);
    console.log(`  -> Rendering scenes ${i + 1}-${Math.min(i + RENDER_CONCURRENCY, validScenes.length)}/${validScenes.length}...`);
    await Promise.all(
      batch.map(async (scene, batchIdx) => {
        const globalIdx = i + batchIdx;
        const isLast = globalIdx === validScenes.length - 1;
        const extraTail = isLast ? 0 : TRANSITION_DURATION;
        const clipPath = path.join(workDir, `clip-${scene.scene_order}.mp4`);
        const clipStart = Date.now();
        const renderedDuration = await renderSceneClip(scene, clipPath, { avatarPath, captionStyle, workDir, words, extraTail });
        clipPathsBySceneOrder[scene.scene_order] = clipPath;
        renderedDurationBySceneOrder[scene.scene_order] = renderedDuration;
        console.log(`     scene ${scene.scene_order} done in ${((Date.now() - clipStart) / 1000).toFixed(1)}s`);
      })
    );
  }

  const clipPaths = validScenes.map((s) => clipPathsBySceneOrder[s.scene_order]);
  const renderedDurations = validScenes.map((s) => renderedDurationBySceneOrder[s.scene_order]);

  console.log(`  -> validScenes=${validScenes.length}, clipPaths=${clipPaths.length}, renderedDurations=${JSON.stringify(renderedDurations)}`);
  const silentVideoPath = path.join(workDir, 'silent-video.mp4');

  if (clipPaths.length === 1) {
    fs.copyFileSync(clipPaths[0], silentVideoPath);
  } else {
    const inputArgs = clipPaths.flatMap((p) => ['-i', p]);
    const xfadeFilter = buildXfadeChain(clipPaths.length, TRANSITION_DURATION, renderedDurations);
    await runFfmpeg(
      [
        ...inputArgs,
        '-filter_complex', xfadeFilter,
        '-map', '[vout]',
        '-r', '60',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        silentVideoPath,
      ],
      'crossfade concat',
      600000
    );
  }

  const inputs = [
    '-i', silentVideoPath,
    '-i', audioPath,
    ...(musicPath ? ['-i', musicPath] : []),
  ];

  const audioFilter = musicPath
    ? `[1:a]volume=1.0[narr];[2:a]volume=0.12[music];[narr][music]amix=inputs=2:duration=first[aout]`
    : `[1:a]anull[aout]`;

  await runFfmpeg(
    [
      ...inputs,
      '-filter_complex', audioFilter,
      '-map', '0:v',
      '-map', '[aout]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      outputPath,
    ],
    'final mux',
    120000
  );

  return outputPath;
}

const MIN_SHORT_SECONDS = 60;   // never build a Short shorter than ~1 minute
const MAX_SHORT_SECONDS = 175;  // stay safely under YouTube's 180s Shorts cap

// Picks the scenes for the teaser Short using REAL spoken durations (from
// Whisper timestamps assigned in transcribe.service.js), not the word-count
// estimate used when the script was first written. Guarantees the final
// Short lands between MIN_SHORT_SECONDS and MAX_SHORT_SECONDS.
function selectHookScenesForShort(scenes, { min = MIN_SHORT_SECONDS, max = MAX_SHORT_SECONDS } = {}) {
  const byOrder = [...scenes].sort((a, b) => a.scene_order - b.scene_order);
  const sceneDuration = (s) => Math.max((s.end_time ?? 0) - (s.start_time ?? 0), 0.5);

  let selected = byOrder.filter((s) => s.is_hook);
  let total = selected.reduce((sum, s) => sum + sceneDuration(s), 0);

  // Too short: pull in additional scenes (in story order) until we cross
  // the minimum length, so the Short is never just a couple of seconds.
  if (total < min) {
    const selectedOrders = new Set(selected.map((s) => s.scene_order));
    for (const scene of byOrder) {
      if (total >= min) break;
      if (selectedOrders.has(scene.scene_order)) continue;
      selected.push(scene);
      selectedOrders.add(scene.scene_order);
      total += sceneDuration(scene);
    }
    selected.sort((a, b) => a.scene_order - b.scene_order);
  }

  // Too long: trim scenes from the middle/end (always keep the opening hook
  // and the closing scene) until we're back under the hard cap.
  while (selected.length > 2 && total > max) {
    const dropIdx = selected.length - 2;
    const [dropped] = selected.splice(dropIdx, 1);
    total -= sceneDuration(dropped);
  }

  console.log(`  -> Short teaser: ${selected.length} scenes, ~${total.toFixed(1)}s total (target ${min}-${max}s)`);
  return selected;
}

async function renderShortTeaser({ longVideoPath, scenes, words = null, workDir, outputPath }) {
  fs.mkdirSync(workDir, { recursive: true });

  const hookScenes = selectHookScenesForShort(scenes);

  if (hookScenes.length === 0) {
    throw new Error('No hook scenes marked - cannot build teaser Short');
  }

  const avatarPath = getHostAvatarPath();
  const HOOK_CONCURRENCY = 4;
  const clipPathByOrder = {};
  const audioPathByOrder = {};
  const durationByOrder = {};

  for (let i = 0; i < hookScenes.length; i += HOOK_CONCURRENCY) {
    const batch = hookScenes.slice(i, i + HOOK_CONCURRENCY);
    await Promise.all(
      batch.map(async (scene, batchIdx) => {
        const globalIdx = i + batchIdx;
        const isLast = globalIdx === hookScenes.length - 1;
        const extraTail = isLast ? 0 : TRANSITION_DURATION;

        const clipPath = path.join(workDir, `hook-${scene.scene_order}.mp4`);
        const renderedDuration = await renderSceneClip(scene, clipPath, {
          avatarPath,
          workDir,
          words,
          extraTail,
          captionMode: 'tiktok',
        });
        clipPathByOrder[scene.scene_order] = clipPath;
        durationByOrder[scene.scene_order] = renderedDuration;

        const audioClipPath = path.join(workDir, `hook-audio-${scene.scene_order}.aac`);
        const audioDuration = Math.max(scene.end_time - scene.start_time, 0.5);
        await runFfmpeg(
          [
            '-ss', String(scene.start_time),
            '-t', String(audioDuration),
            '-i', longVideoPath,
            '-map', '0:a',
            '-c:a', 'aac',
            audioClipPath,
          ],
          `hook audio ${scene.scene_order}`
        );
        audioPathByOrder[scene.scene_order] = audioClipPath;
      })
    );
  }

  const clipPaths = hookScenes.map((s) => clipPathByOrder[s.scene_order]);
  const durations = hookScenes.map((s) => durationByOrder[s.scene_order]);

  const silentPath = path.join(workDir, 'short-silent.mp4');
  if (clipPaths.length === 1) {
    fs.copyFileSync(clipPaths[0], silentPath);
  } else {
    const inputArgs = clipPaths.flatMap((p) => ['-i', p]);
    const xfadeFilter = buildXfadeChain(clipPaths.length, TRANSITION_DURATION, durations);
    await runFfmpeg(
      [
        ...inputArgs,
        '-filter_complex', xfadeFilter,
        '-map', '[vout]',
        '-r', '60',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        silentPath,
      ],
      'short crossfade concat',
      300000
    );
  }

  const audioConcatListPath = path.join(workDir, 'short-audio-list.txt');
  fs.writeFileSync(
    audioConcatListPath,
    hookScenes.map((s) => `file '${path.resolve(audioPathByOrder[s.scene_order])}'`).join('\n')
  );
  const stitchedAudioPath = path.join(workDir, 'short-audio.aac');
  await runFfmpeg(
    ['-f', 'concat', '-safe', '0', '-i', audioConcatListPath, '-c', 'copy', stitchedAudioPath],
    'concat hook audio'
  );

  const ctaText = pickCtaText();
  await runFfmpeg(
    [
      '-i', silentPath,
      '-i', stitchedAudioPath,
      '-vf',
      `drawtext=text='${ctaText}':fontcolor=white:fontsize=44:` +
        `x=(w-text_w)/2:y=h-160:box=1:boxcolor=black@0.5:boxborderw=20`,
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-shortest',
      outputPath,
    ],
    'mux short + end-card text'
  );

  return outputPath;
}

const CTA_TEXTS = [
  'Like this video and follow for more',
  'Follow for the full story',
  'Like & Follow for more stories like this',
  'If you enjoyed this, hit like and follow',
  'Full story on the channel - Like & Follow',
];

function pickCtaText() {
  return CTA_TEXTS[Math.floor(Math.random() * CTA_TEXTS.length)];
}

module.exports = { renderLongVideo, renderShortTeaser, renderSceneClip };
