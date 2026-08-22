const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const USED_PATH = path.join(__dirname, '..', 'data', 'used-videos.json');

// Search queries covering curiosity-driven psychology / pop-science
// explainer content - "why does your brain..." style videos that answer a
// personal, relatable question rather than general historical narration.
// Mixed Arabic + English.
const QUERIES = [
  'لماذا يفعل دماغك هذا علم نفس',
  'ظواهر نفسية غريبة تفسير علمي',
  'لماذا نخاف من هذا الشيء علم نفس',
  'أسرار الدماغ البشري غريبة',
  'سلوك بشري غريب تفسير علمي',
  'why does your brain psychology explained',
  'weird psychology phenomenon explained',
  'why do humans fear this evolutionary psychology',
  'uncanny valley psychology explained',
  'strange human behavior science explained',
];

function loadUsed() {
  if (!fs.existsSync(USED_PATH)) return { videoIds: [] };
  try {
    return JSON.parse(fs.readFileSync(USED_PATH, 'utf-8'));
  } catch {
    return { videoIds: [] };
  }
}

function saveUsed(data) {
  fs.mkdirSync(path.dirname(USED_PATH), { recursive: true });
  fs.writeFileSync(USED_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function markUsed(videoId) {
  const data = loadUsed();
  if (!data.videoIds.includes(videoId)) {
    data.videoIds.push(videoId);
    // keep the last 500 to avoid unbounded growth
    if (data.videoIds.length > 500) data.videoIds = data.videoIds.slice(-500);
    saveUsed(data);
  }
}

function getYoutubeClient() {
  // Uses a simple API key (read-only search), separate from the OAuth
  // client used for uploads in youtube.service.js.
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey) {
    throw new Error('YT_API_KEY is not set - needed for youtube.search (read-only Data API key, not the OAuth upload credentials)');
  }
  return google.youtube({ version: 'v3', auth: apiKey });
}

async function searchCandidates(youtube, query, maxResults = 10) {
  const res = await youtube.search.list({
    part: ['snippet'],
    q: query,
    type: ['video'],
    maxResults,
    order: 'relevance',
    videoDuration: 'medium', // 4-20 min, avoids very short/very long
    safeSearch: 'strict',
  });
  return (res.data.items || []).map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
  }));
}

async function getVideoDurationSeconds(youtube, videoId) {
  const res = await youtube.videos.list({ part: ['contentDetails'], id: [videoId] });
  const iso = res.data.items?.[0]?.contentDetails?.duration;
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  return h * 3600 + min * 60 + s;
}

// Picks one not-yet-used candidate video across all queries.
async function findNextSourceVideo() {
  const youtube = getYoutubeClient();
  const used = loadUsed();
  const shuffledQueries = [...QUERIES].sort(() => Math.random() - 0.5);

  for (const query of shuffledQueries) {
    let candidates;
    try {
      candidates = await searchCandidates(youtube, query);
    } catch (err) {
      console.warn(`[discover] search failed for "${query}": ${err.message}`);
      continue;
    }

    const fresh = candidates.filter((c) => !used.videoIds.includes(c.videoId));
    if (fresh.length === 0) continue;

    for (const candidate of fresh) {
      const duration = await getVideoDurationSeconds(youtube, candidate.videoId).catch(() => null);
      // skip anything too short to summarize meaningfully
      if (duration && duration < 120) continue;
      return { ...candidate, duration, query, url: `https://www.youtube.com/watch?v=${candidate.videoId}` };
    }
  }

  throw new Error('No fresh candidate videos found across all queries - try again later or widen QUERIES');
}

module.exports = { findNextSourceVideo, markUsed, loadUsed, QUERIES };
