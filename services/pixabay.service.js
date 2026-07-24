const https = require('https');
const fs = require('fs');
const path = require('path');

const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY;
const PIXABAY_HOST = 'pixabay.com';

function httpsGetJson(hostname, requestPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: requestPath, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Pixabay HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Pixabay request timed out')); });
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
  return prompt.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
}

async function searchPixabayPhoto(query) {
  if (!PIXABAY_API_KEY) return null;
  const q = encodeURIComponent(simplifyQuery(query));
  const json = await httpsGetJson(PIXABAY_HOST, `/api/?key=${PIXABAY_API_KEY}&q=${q}&image_type=photo&orientation=horizontal&safesearch=true&per_page=6`);
  const hits = json.hits || [];
  if (hits.length === 0) return null;
  const pick = hits[Math.floor(Math.random() * Math.min(hits.length, 3))];
  return pick.largeImageURL || pick.webformatURL || null;
}

async function searchPixabayVideo(query) {
  if (!PIXABAY_API_KEY) return null;
  const q = encodeURIComponent(simplifyQuery(query));
  const json = await httpsGetJson(PIXABAY_HOST, `/api/videos/?key=${PIXABAY_API_KEY}&q=${q}&safesearch=true&per_page=6`);
  const hits = json.hits || [];
  if (hits.length === 0) return null;
  const pick = hits[Math.floor(Math.random() * Math.min(hits.length, 3))];
  const videos = pick.videos || {};
  return (videos.large && videos.large.url) || (videos.medium && videos.medium.url) || (videos.small && videos.small.url) || null;
}

async function fetchPixabayMedia(query, outputDir, sceneOrder, preferVideo = false) {
  if (!PIXABAY_API_KEY) return null;
  try {
    if (preferVideo) {
      const videoUrl = await searchPixabayVideo(query);
      if (videoUrl) {
        const destPath = path.join(outputDir, `scene-${sceneOrder}-pixabay.mp4`);
        await downloadToFile(videoUrl, destPath);
        return { filePath: destPath, isVideo: true, source: 'pixabay' };
      }
    }
    const photoUrl = await searchPixabayPhoto(query);
    if (photoUrl) {
      const destPath = path.join(outputDir, `scene-${sceneOrder}-pixabay.jpg`);
      await downloadToFile(photoUrl, destPath);
      return { filePath: destPath, isVideo: false, source: 'pixabay' };
    }
  } catch (err) {
    console.warn(`Pixabay lookup failed for "${query}": ${err.message}`);
  }
  return null;
}

module.exports = { fetchPixabayMedia };
