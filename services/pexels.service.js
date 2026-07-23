const https = require('https');
const fs = require('fs');
const path = require('path');

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const PEXELS_HOST = 'api.pexels.com';

function httpsGetJson(hostname, requestPath, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: requestPath, headers, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Pexels HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Pexels request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

function downloadToFile(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        return downloadToFile(res.headers.location, destPath, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`Download failed HTTP ${res.statusCode}`));
      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => fileStream.close(() => resolve(destPath)));
      fileStream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timed out')); });
    req.on('error', reject);
  });
}

function simplifyQuery(prompt) {
  return prompt
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
}

async function searchPexelsPhoto(query) {
  if (!PEXELS_API_KEY) return null;
  const q = encodeURIComponent(simplifyQuery(query));
  const json = await httpsGetJson(
    PEXELS_HOST,
    `/v1/search?query=${q}&per_page=6&orientation=landscape`,
    { Authorization: PEXELS_API_KEY }
  );
  const photos = json.photos || [];
  if (photos.length === 0) return null;
  const pick = photos[Math.floor(Math.random() * Math.min(photos.length, 3))];
  return pick.src.large2x || pick.src.large || pick.src.original;
}

async function searchPexelsVideo(query) {
  if (!PEXELS_API_KEY) return null;
  const q = encodeURIComponent(simplifyQuery(query));
  const json = await httpsGetJson(
    PEXELS_HOST,
    `/videos/search?query=${q}&per_page=6&orientation=landscape`,
    { Authorization: PEXELS_API_KEY }
  );
  const videos = json.videos || [];
  if (videos.length === 0) return null;
  const pick = videos[Math.floor(Math.random() * Math.min(videos.length, 3))];
  const files = (pick.video_files || []).filter((f) => f.width && f.width <= 1920 && f.file_type === 'video/mp4');
  files.sort((a, b) => b.width - a.width);
  const file = files[0] || pick.video_files?.[0];
  return file ? file.link : null;
}

async function fetchRealMedia(query, outputDir, sceneOrder, preferVideo = false) {
  if (!PEXELS_API_KEY) return null;

  try {
    if (preferVideo) {
      const videoUrl = await searchPexelsVideo(query);
      if (videoUrl) {
        const destPath = path.join(outputDir, `scene-${sceneOrder}.mp4`);
        await downloadToFile(videoUrl, destPath);
        return { filePath: destPath, isVideo: true, source: 'pexels' };
      }
    }
    const photoUrl = await searchPexelsPhoto(query);
    if (photoUrl) {
      const destPath = path.join(outputDir, `scene-${sceneOrder}.jpg`);
      await downloadToFile(photoUrl, destPath);
      return { filePath: destPath, isVideo: false, source: 'pexels' };
    }
  } catch (err) {
    console.warn(`Pexels lookup failed for "${query}": ${err.message}`);
  }
  return null;
}

module.exports = { fetchRealMedia };
