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

function formatAssTime(seconds) {
  const totalCs = Math.round(seconds * 100);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\uFF5B')
    .replace(/}/g, '\uFF5D')
    .replace(/\n/g, ' ');
}

const ASS_HIGHLIGHT_COLORS = ['&H00E1FF&', '&H00D7FF&', '&H4DE7FF&', '&H6BFF6B&'];

/**
 * Builds a CapCut/TikTok-style karaoke caption file (.ass):
 * a small rolling group of words stays on screen while the word
 * currently being spoken pops (scales up) and changes color.
 */
function buildAssFromWords(words, outputPath, {
  groupSize = 4,
  videoWidth = 1920,
  videoHeight = 1080,
  fontSize = 62,
  marginV = 130,
} = {}) {
  const highlightColor = ASS_HIGHLIGHT_COLORS[Math.floor(Math.random() * ASS_HIGHLIGHT_COLORS.length)];

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,4,1,2,60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = [];
  for (let i = 0; i < words.length; i += groupSize) {
    const group = words.slice(i, i + groupSize);
    const nextGroupStart = words[i + groupSize] ? words[i + groupSize].start : null;

    for (let j = 0; j < group.length; j++) {
      const w = group[j];
      const isLastWordOfGroup = j === group.length - 1;
      const start = w.start;
      const end = isLastWordOfGroup
        ? (nextGroupStart != null ? nextGroupStart : w.end + 0.3)
        : group[j + 1].start;

      const text = group
        .map((gw, gi) => {
          const clean = escapeAssText(gw.word.trim());
          if (gi === j) {
            return `{\\c${highlightColor}\\fscx118\\fscy118\\t(0,120,\\fscx100\\fscy100)}${clean}{\\r}`;
          }
          return clean;
        })
        .join(' ');

      lines.push(
        `Dialogue: 0,${formatAssTime(start)},${formatAssTime(Math.max(end, start + 0.05))},Default,,0,0,0,,${text}`
      );
    }
  }

  fs.writeFileSync(outputPath, header + lines.join('\n') + '\n', 'utf-8');
  return outputPath;
}

module.exports = { buildSrtFromWords, buildSrtFromScenes, buildAssFromWords, formatSrtTime, formatAssTime };
