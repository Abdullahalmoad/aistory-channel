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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Downloads the source video (video+audio muxed, capped at 1080p to keep
// things fast) into workDir and returns the local file path.
//
// YouTube's anti-bot JS challenge currently fails intermittently for yt-dlp
// (a known, widely-reported upstream issue as of mid-2026 - see
// yt-dlp/yt-dlp#17405). It's not something we can fix on our end, but
// retrying a few times with a short delay resolves it most of the time.
async function downloadSourceVideo(url, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const outputTemplate = path.join(workDir, 'source.%(ext)s');

  const args = [
    '-f', 'bv*[height<=1080]+ba/b[height<=1080]',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    // GitHub Actions runner IPs are commonly bot-flagged by YouTube, which
    // requires signed-in cookies to pass. The "tv"/"tv_simply" clients don't
    // support cookies at all (yt-dlp skips them silently), so we use "web"
    // here, which does honor --cookies.
    '--extractor-args', 'youtube:player_client=web,mweb',
    '-o', outputTemplate,
    url,
  ];

  if (process.env.YT_COOKIES_FILE && fs.existsSync(process.env.YT_COOKIES_FILE)) {
    args.push('--cookies', process.env.YT_COOKIES_FILE);
  }

  const MAX_ATTEMPTS = 4;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await runYtDlp(args, 'yt-dlp download');
      const produced = fs.readdirSync(workDir).find((f) => f.startsWith('source.'));
      if (!produced) throw new Error('yt-dlp did not produce an output file');
      return path.join(workDir, produced);
    } catch (err) {
      lastErr = err;
      // Log the full error (not just the first line) so failures are
      // actually diagnosable from the GitHub Actions log.
      console.warn(`  -> yt-dlp download attempt ${attempt}/${MAX_ATTEMPTS} failed:\n${err.message}`);
      if (attempt < MAX_ATTEMPTS) await sleep(15000);
    }
  }
  throw lastErr;
}

module.exports = { downloadSourceVideo };
