const fs = require('fs');

function formatSrtTime(seconds) {
  const ms = Math.round((seconds % 1) * 1000);
  const totalSec = Math.floor(seconds);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function buildSrtFromWords(words, outputPath, wordsPerCaption = 4) {
  let srt = '';
  let index = 1;

  for (let i = 0; i < words.length; i += wordsPerCaption) {
    const chunk = words.slice(i, i + wordsPerCaption);
    const start = chunk[0].start;
    const end = chunk[chunk.length - 1].end;
    const text = chunk.map((w) => w.word).join(' ');

    srt += `${index}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n\n`;
    index++;
  }

  fs.writeFileSync(outputPath, srt, 'utf-8');
  return outputPath;
}

function buildSrtFromScenes(scenes, outputPath) {
  let srt = '';
  let index = 1;

  for (const scene of scenes) {
    if (scene.start_time == null || scene.end_time == null) continue;
    srt += `${index}\n${formatSrtTime(scene.start_time)} --> ${formatSrtTime(scene.end_time)}\n${scene.text}\n\n`;
    index++;
  }

  fs.writeFileSync(outputPath, srt, 'utf-8');
  return outputPath;
}

module.exports = { buildSrtFromWords, buildSrtFromScenes, formatSrtTime };
