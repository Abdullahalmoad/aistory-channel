const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function runYtDlp(args, label = 'yt-dlp', timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`${label} failed (exit ${code}):\n${stderr.slice(-2000)}`));
      resolve(stdout);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Downloads the source video (video+audio muxed, capped at 1080p to keep
// things fast) into workDir and returns the local file path.
async function downloadSourceVideo(url, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const outputTemplate = path.join(workDir, 'source.%(ext)s');

  const args = [
    '-f', 'bv*[height<=1080]+ba/b[height<=1080]',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '-o', outputTemplate,
    url,
  ];

  // If cookies file is configured (some videos need auth), pass it through -
  // same pattern already used in YouTube-Bot-2- project.
  if (process.env.YT_COOKIES_FILE && fs.existsSync(process.env.YT_COOKIES_FILE)) {
    args.push('--cookies', process.env.YT_COOKIES_FILE);
  }

  await runYtDlp(args, 'yt-dlp download');

  const produced = fs.readdirSync(workDir).find((f) => f.startsWith('source.'));
  if (!produced) throw new Error('yt-dlp did not produce an output file');
  return path.join(workDir, produced);
}

module.exports = { downloadSourceVideo };
