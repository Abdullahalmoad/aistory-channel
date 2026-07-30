const fs = require('fs');

function patch(file, replacements) {
  const bak = file + '.bak-fix';
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(bak, original);
  let content = original;
  for (const { old, next, label } of replacements) {
    const count = content.split(old).length - 1;
    if (count !== 1) {
      throw new Error(`${file}: expected exactly 1 match for "${label}", found ${count}. Aborting, no files changed beyond backups already written.`);
    }
    content = content.replace(old, next);
  }
  fs.writeFileSync(file, content);
  console.log(`OK  patched ${file} (backup at ${bak})`);
}

patch('services/pexels.service.js', [
  {
    label: 'pexels video resolution filter',
    old: `  const files = (pick.video_files || []).filter((f) => f.width && f.width <= 1920 && f.file_type === 'video/mp4');
  files.sort((a, b) => b.width - a.width);
  const file = files[0] || pick.video_files?.[0];
  return file ? file.link : null;`,
    next: `  const files = (pick.video_files || []).filter((f) => f.width && f.width >= 1920 && f.width <= 3840 && f.file_type === 'video/mp4');
  files.sort((a, b) => a.width - b.width);
  const file = files[0];
  return file ? file.link : null;`,
  },
]);

patch('services/pixabay.service.js', [
  {
    label: 'pixabay video resolution filter',
    old: `  const videos = pick.videos || {};
  return (videos.large && videos.large.url) || (videos.medium && videos.medium.url) || (videos.small && videos.small.url) || null;`,
    next: `  const videos = pick.videos || {};
  if (videos.large && videos.large.width >= 1920) return videos.large.url;
  return null;`,
  },
]);

patch('services/thumbnail.service.js', [
  {
    label: 'generateThumbnail signature + real-photo source',
    old: `async function generateThumbnail(script, outputDir) {
  const rawText = (script.thumbnail_text || script.title || '').toUpperCase();
  const imagePrompt = script.thumbnail_image_prompt || script.title || 'a mysterious dramatic scene';

  const bgPath = path.join(outputDir, 'thumb-bg.jpg');
  const outputPath = path.join(outputDir, 'thumbnail.jpg');

  const STYLE_SUFFIX = ', flat vector illustration, dramatic lighting, high contrast, cinematic, no text, no watermark';
  const fullPrompt = \`\${imagePrompt}\${STYLE_SUFFIX}\`;
  const encodedPrompt = encodeURIComponent(fullPrompt);
  const url = \`https://image.pollinations.ai/prompt/\${encodedPrompt}?width=\${THUMB_WIDTH}&height=\${THUMB_HEIGHT}&nologo=true&model=flux\`;

  await downloadToFile(url, bgPath);`,
    next: `async function generateThumbnail(script, outputDir, scenes = null) {
  const rawText = (script.thumbnail_text || script.title || '').toUpperCase();

  const bgPath = path.join(outputDir, 'thumb-bg.jpg');
  const outputPath = path.join(outputDir, 'thumbnail.jpg');

  const scored = (scenes || []).filter((s) => s.image_file);
  const realPhotoScene =
    scored.find((s) => s.is_hook && !s.is_video) ||
    scored.find((s) => s.is_hook) ||
    scored.find((s) => !s.is_video) ||
    scored[0] ||
    null;

  if (realPhotoScene) {
    fs.copyFileSync(realPhotoScene.image_file, bgPath);
  } else {
    const imagePrompt = script.thumbnail_image_prompt || script.title || 'a mysterious dramatic scene';
    const STYLE_SUFFIX = ', flat vector illustration, dramatic lighting, high contrast, cinematic, no text, no watermark';
    const fullPrompt = \`\${imagePrompt}\${STYLE_SUFFIX}\`;
    const encodedPrompt = encodeURIComponent(fullPrompt);
    const url = \`https://image.pollinations.ai/prompt/\${encodedPrompt}?width=\${THUMB_WIDTH}&height=\${THUMB_HEIGHT}&nologo=true&model=flux\`;
    await downloadToFile(url, bgPath);
  }`,
  },
  {
    label: 'thumbnail scale/crop to canvas size',
    old: `  const darkOverlay = \`drawbox=x=0:y=ih*0.62:w=iw:h=ih*0.38:color=black@0.45:t=fill\`;
  let filters;
  if (line2) {
    filters = [
      darkOverlay,`,
    next: `  const scaleCrop = \`scale=\${THUMB_WIDTH}:\${THUMB_HEIGHT}:force_original_aspect_ratio=increase,crop=\${THUMB_WIDTH}:\${THUMB_HEIGHT}\`;
  const darkOverlay = \`drawbox=x=0:y=ih*0.62:w=iw:h=ih*0.38:color=black@0.45:t=fill\`;
  let filters;
  if (line2) {
    filters = [
      scaleCrop,
      darkOverlay,`,
  },
  {
    label: 'thumbnail scale/crop for single-line branch',
    old: `  } else {
    filters = [
      darkOverlay,
      \`drawtext=fontfile=\${FONT_PATH}:text='\${escLine1}':fontsize=95:fontcolor=white:borderw=8:bordercolor=black:x=(w-text_w)/2:y=h*0.75\`,
    ].join(',');
  }`,
    next: `  } else {
    filters = [
      scaleCrop,
      darkOverlay,
      \`drawtext=fontfile=\${FONT_PATH}:text='\${escLine1}':fontsize=95:fontcolor=white:borderw=8:bordercolor=black:x=(w-text_w)/2:y=h*0.75\`,
    ].join(',');
  }`,
  },
]);

patch('pipeline.js', [
  {
    label: 'thumbnail call site 1 (runPipelineForTopic)',
    old: `    console.log('  -> Generating thumbnail...');
    const thumbnailPath = await generateThumbnail(script, workDir).catch((err) => {`,
    next: `    console.log('  -> Generating thumbnail...');
    const thumbnailPath = await generateThumbnail(script, workDir, scenesWithImages).catch((err) => {`,
  },
  {
    label: 'thumbnail call site 2 (runMorningPipeline)',
    old: `  console.log('  -> Generating thumbnail...');
  const thumbnailPath = await generateThumbnail(script, workDir).catch((err) => {`,
    next: `  console.log('  -> Generating thumbnail...');
  const thumbnailPath = await generateThumbnail(script, workDir, scenesWithImages).catch((err) => {`,
  },
]);

console.log('\nAll 4 patches applied successfully.');
