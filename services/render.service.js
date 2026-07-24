const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildSrtFromScenes, buildSrtFromWords } = require('./srt.util');
const { getHostAvatarPath } = require('./host.service');

const TRANSITION_DURATION = 0.4;

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

const CAPTION_STYLES = [
  "FontName=Arial,Bold=1,FontSize=26,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=80",
  "FontName=Verdana,Bold=1,FontSize=25,PrimaryColour=&H0000E5FF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=85",
  "FontName=Georgia,Bold=1,FontSize=27,PrimaryColour=&H00E0E0E0,OutlineColour=&H00101010,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=75",
];

function pickCaptionStyle() {
  return CAPTION_STYLES[Math.floor(Math.random() * CAPTION_STYLES.length)];
}

async function renderSceneClip(scene, outputPath, { width = 1920, height = 1080, avatarPath = null, captionStyle = null, workDir = null, words = null, extraTail = 0 } = {}) {
  const baseDuration = Math.max(scene.end_time - scene.start_time, 0.5);
  const duration = baseDuration + extraTail;
  const fps = 60;
  const totalFrames = Math.round(duration * fps);
  const revealSec = Math.min(0.4, baseDuration / 3);
  const isVideo = Boolean(scene.is_video);

  let baseFilter;
  if (isVideo) {
    baseFilter =
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
      `zoompan=z='min(zoom+0.0006,1.1)':d=${totalFrames}:s=${width}x${height}:fps=${fps},` +
      `fade=t=in:st=0:d=${revealSec}:alpha=0,format=yuv420p`;
  } else {
    baseFilter =
      `scale=${Math.round(width * 1.3)}:${Math.round(height * 1.3)}:force_original_aspect_ratio=increase,crop=${Math.round(width * 1.3)}:${Math.round(height * 1.3)},` +
      `zoompan=z='if(lte(on,${Math.round(revealSec * fps)}),1.08-0.08*on/${Math.round(revealSec * fps)},min(zoom+0.0007,1.15))':` +
      `d=${totalFrames}:s=${width}x${height}:fps=${fps},` +
      `fade=t=in:st=0:d=${revealSec}:alpha=0,` +
      `format=yuv420p`;
  }

  const inputs = [
    ...(isVideo ? ['-stream_loop', '-1'] : ['-loop', '1']),
    '-i', scene.image_file,
    ...(avatarPath ? ['-loop', '1', '-i', avatarPath] : []),
  ];

  let videoFilter;
  if (scene.text && workDir) {
    const srtPath = path.join(workDir, `scene-${scene.scene_order}.srt`);

    const sceneWords = words
      ? words
          .filter((w) => w.start >= scene.start_time && w.start < scene.end_time)
          .map((w) => ({
            ...w,
            start: Math.max(0, w.start - scene.start_time),
            end: Math.min(baseDuration, w.end - scene.start_time),
          }))
      : null;

    if (sceneWords && sceneWords.length > 0) {
      buildSrtFromWords(sceneWords, srtPath, 3);
    } else {
      buildSrtFromScenes([{ start_time: 0, end_time: baseDuration, text: scene.text }], srtPath);
    }

    const style = captionStyle || pickCaptionStyle();
    const subtitleFilter = `subtitles=${srtPath.replace(/:/g, '\\:')}:force_style='${style}'`;
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
    filter += `[${prevLabel}][${i}:v]xfade=transition=fade:duration=${transitionDuration}:offset=${offset.toFixed(3)}[${outLabel}];`;
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

async function renderShortTeaser({ longVideoPath, scenes, workDir, outputPath }) {
  fs.mkdirSync(workDir, { recursive: true });

  const hookScenes = scenes
    .filter((s) => s.is_hook)
    .sort((a, b) => a.scene_order - b.scene_order);

  if (hookScenes.length === 0) {
    throw new Error('No hook scenes marked - cannot build teaser Short');
  }

  const HOOK_CONCURRENCY = 4;
  const hookClipsByOrder = {};
  for (let i = 0; i < hookScenes.length; i += HOOK_CONCURRENCY) {
    const batch = hookScenes.slice(i, i + HOOK_CONCURRENCY);
    await Promise.all(
      batch.map(async (scene) => {
        const duration = Math.max(scene.end_time - scene.start_time, 0.5);
        const clipPath = path.join(workDir, `hook-${scene.scene_order}.mp4`);

        const vf =
          `[0:v]split=2[bg][fg];` +
          `[bg]scale=320:568,boxblur=6:1,scale=1080:1920[bgblur];` +
          `[fg]scale=1080:-1[fgscaled];` +
          `[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2[vout]`;

        await runFfmpeg(
          [
            '-ss', String(scene.start_time),
            '-t', String(duration),
            '-i', longVideoPath,
            '-filter_complex', vf,
            '-map', '[vout]',
            '-map', '0:a',
            '-c:v', 'libx264',
            '-c:a', 'aac',
            clipPath,
          ],
          `hook clip ${scene.scene_order}`
        );
        hookClipsByOrder[scene.scene_order] = clipPath;
      })
    );
  }
  const vertClips = hookScenes.map((s) => hookClipsByOrder[s.scene_order]);

  const concatListPath = path.join(workDir, 'short-concat-list.txt');
  fs.writeFileSync(
    concatListPath,
    vertClips.map((p) => `file '${path.resolve(p)}'`).join('\n')
  );

  const stitchedPath = path.join(workDir, 'short-stitched.mp4');
  await runFfmpeg(
    ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', stitchedPath],
    'concat hook clips'
  );

  const ctaText = pickCtaText();
  await runFfmpeg(
    [
      '-i', stitchedPath,
      '-vf',
      `drawtext=text='${ctaText}':fontcolor=white:fontsize=48:` +
        `x=(w-text_w)/2:y=h-200:box=1:boxcolor=black@0.5:boxborderw=20:` +
        `enable='gte(t,${'0'})'`,
      '-c:v', 'libx264',
      '-c:a', 'copy',
      outputPath,
    ],
    'add end-card text'
  );

  return outputPath;
}

const CTA_TEXTS = [
  'Full story on the channel',
  'The full case is on the channel',
  'Watch the whole story now',
];

function pickCtaText() {
  return CTA_TEXTS[Math.floor(Math.random() * CTA_TEXTS.length)];
}

module.exports = { renderLongVideo, renderShortTeaser, renderSceneClip };
