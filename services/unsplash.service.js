const https = require('https');
const fs = require('fs');
const path = require('path');

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const UNSPLASH_HOST = 'api.unsplash.com';

function httpsGetJson(hostname, requestPath, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: requestPath, headers, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Unsplash HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Unsplash request timed out')); });
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

async function searchUnsplashPhoto(query) {
  if (!UNSPLASH_ACCESS_KEY) return null;
  const q = encodeURIComponent(simplifyQuery(query));
  const json = await httpsGetJson(UNSPLASH_HOST, `/search/photos?query=${q}&per_page=6&orientation=landscape`, {
    Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
    'Accept-Version': 'v1',
  });
  const results = json.results || [];
  if (results.length === 0) return null;
  const pick = results[Math.floor(Math.random() * Math.min(results.length, 3))];
  return (pick.urls && (pick.urls.regular || pick.urls.full)) || null;
}

async function fetchUnsplashMedia(query, outputDir, sceneOrder) {
  if (!UNSPLASH_ACCESS_KEY) return null;
  try {
    const photoUrl = await searchUnsplashPhoto(query);
    if (photoUrl) {
      const destPath = path.join(outputDir, `scene-${sceneOrder}-unsplash.jpg`);
      await downloadToFile(photoUrl, destPath);
      return { filePath: destPath, isVideo: false, source: 'unsplash' };
    }
  } catch (err) {
    console.warn(`Unsplash lookup failed for "${query}": ${err.message}`);
  }
  return null;
}

module.exports = { fetchUnsplashMedia };
