const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildSrtFromScenes } = require('./srt.util');
const { getHostAvatarPath } = require('./host.service');

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
      if (m) console.log(`    [ffmpeg ${label}] frame=${m[1]} fps=${m[2]} speed=${m[3]}x`);
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
  "FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Alignment=2,MarginV=60",
  "FontName=Verdana,FontSize=19,PrimaryColour=&H0000E5FF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Alignment=2,MarginV=70",
  "FontName=Georgia,FontSize=21,PrimaryColour=&H00E0E0E0,OutlineColour=&H00101010,BorderStyle=1,Outline=2,Alignment=2,MarginV=55",
];

function pickCaptionStyle() {
  return CAPTION_STYLES[Math.floor(Math.random() * CAPTION_STYLES.length)];
}

async function renderSceneClip(scene, outputPath, { width = 1920, height = 1080 } = {}) {
  const duration = Math.max(scene.end_time - scene.start_time, 0.5);
  const fps = 30;
  const totalFrames = Math.round(duration * fps);
  const revealSec = Math.min(0.4, duration / 3);

  const zoompanFilter =
    `scale=${Math.round(width * 1.3)}:${Math.round(height * 1.3)},` +
    `zoompan=z='if(lte(on,${Math.round(revealSec * fps)}),1.08-0.08*on/${Math.round(revealSec * fps)},min(zoom+0.0007,1.15))':` +
    `d=${totalFrames}:s=${width}x${height}:fps=${fps},` +
    `fade=t=in:st=0:d=${revealSec}:alpha=0,` +
    `format=yuv420p`;

  await runFfmpeg(
    [
      '-loop', '1',
      '-i', scene.image_file,
      '-t', String(duration),
      '-vf', zoompanFilter,
      '-r', String(fps),
      outputPath,
    ],
    `scene ${scene.scene_order} render`
  );

  return outputPath;
}

async function renderLongVideo({ scenes, audioPath, musicPath, workDir, outputPath }) {
  fs.mkdirSync(workDir, { recursive: true });

  const validScenes = scenes.filter((scene) => {
    if (!scene.image_file) {
      console.warn(`Skipping scene ${scene.scene_order} - no image_file`);
      return false;
    }
    return true;
  });

  const RENDER_CONCURRENCY = 4;
  const clipPathsBySceneOrder = {};
  for (let i = 0; i < validScenes.length; i += RENDER_CONCURRENCY) {
    const batch = validScenes.slice(i, i + RENDER_CONCURRENCY);
    console.log(`  -> Rendering scenes ${i + 1}-${Math.min(i + RENDER_CONCURRENCY, validScenes.length)}/${validScenes.length}...`);
    await Promise.all(
      batch.map(async (scene) => {
        const clipPath = path.join(workDir, `clip-${scene.scene_order}.mp4`);
        const clipStart = Date.now();
        await renderSceneClip(scene, clipPath);
        clipPathsBySceneOrder[scene.scene_order] = clipPath;
        console.log(`     scene ${scene.scene_order} done in ${((Date.now() - clipStart)/1000).toFixed(1)}s`);
      })
    );
  }
  const clipPaths = validScenes.map((s) => clipPathsBySceneOrder[s.scene_order]);

  const concatListPath = path.join(workDir, 'concat-list.txt');
  fs.writeFileSync(
    concatListPath,
    clipPaths.map((p) => `file '${path.resolve(p)}'`).join('\n')
  );
  const silentVideoPath = path.join(workDir, 'silent-video.mp4');
  await runFfmpeg(
    ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', silentVideoPath],
    'concat scenes',
    300000
  );

  const srtPath = path.join(workDir, 'captions.srt');
  buildSrtFromScenes(scenes, srtPath);

  const captionStyle = pickCaptionStyle();
  const subtitleFilter = `subtitles=${srtPath.replace(/:/g, '\\:')}:force_style='${captionStyle}'`;

  const avatarPath = getHostAvatarPath();

  const inputs = [
    '-i', silentVideoPath,
    '-i', audioPath,
    ...(musicPath ? ['-i', musicPath] : []),
    ...(avatarPath ? ['-loop', '1', '-i', avatarPath] : []),
  ];

  const audioFilter = musicPath
    ? `[1:a]volume=1.0[narr];[${musicPath ? 2 : 1}:a]volume=0.12[music];[narr][music]amix=inputs=2:duration=first[aout]`
    : `[1:a]anull[aout]`;

  const videoFilterBase = `[0:v]${subtitleFilter}[vsub]`;
  const videoFilterFinal = avatarPath
    ? `${videoFilterBase};[${musicPath ? 3 : 2}:v]scale=280:-1[avatarScaled];[vsub][avatarScaled]overlay=W-w-20:H-h-20[vout]`
    : `${videoFilterBase};[vsub]null[vout]`;

  await runFfmpeg(
    [
      ...inputs,
      '-filter_complex', `${videoFilterFinal};${audioFilter}`,
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
          '-crf', '23',
          '-threads', '0',
          '-c:a', 'aac',
      '-shortest',
      outputPath,
    ],
    'final mux',
    1500000
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
