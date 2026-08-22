const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const USED_PATH = path.join(__dirname, '..', 'data', 'used-videos.json');

// Region(s) to pull trending videos from. Iraq isn't always populated with
// enough variety on YouTube's trending chart, so we mix in a couple of
// nearby/major regions as fallbacks.
const REGIONS = ['US', 'GB', 'CA', 'AU'];

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

async function fetchTrendingCandidates(youtube, regionCode, maxResults = 25) {
  const res = await youtube.videos.list({
    part: ['snippet', 'contentDetails'],
    chart: 'mostPopular',
    regionCode,
    maxResults,
    videoCategoryId: undefined, // no category filter - pull whatever's trending
  });
  return (res.data.items || []).map((item) => {
    const iso = item.contentDetails?.duration;
    let duration = null;
    if (iso) {
      const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (m) {
        const h = parseInt(m[1] || '0', 10);
        const min = parseInt(m[2] || '0', 10);
        const s = parseInt(m[3] || '0', 10);
        duration = h * 3600 + min * 60 + s;
      }
    }
    return {
      videoId: item.id,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      categoryId: item.snippet.categoryId,
      duration,
    };
  }).filter((v) => v.categoryId !== '10'); // exclude Music category
}

// Picks one not-yet-used candidate video from YouTube's trending chart,
// trying each configured region in a random order until a fresh candidate
// with a usable duration is found.
async function findNextSourceVideo() {
  const youtube = getYoutubeClient();
  const used = loadUsed();
  const shuffledRegions = [...REGIONS].sort(() => Math.random() - 0.5);

  for (const regionCode of shuffledRegions) {
    let candidates;
    try {
      candidates = await fetchTrendingCandidates(youtube, regionCode);
    } catch (err) {
      console.warn(`[discover] trending fetch failed for region "${regionCode}": ${err.message}`);
      continue;
    }

    const fresh = candidates.filter((c) => !used.videoIds.includes(c.videoId));
    for (const candidate of fresh) {
      // skip anything too short to summarize meaningfully, or extremely
      // long (trending often includes full movies/streams we can't handle)
      if (candidate.duration && (candidate.duration < 120 || candidate.duration > 3600)) continue;
      return { ...candidate, query: `trending:${regionCode}`, url: `https://www.youtube.com/watch?v=${candidate.videoId}` };
    }
  }

  throw new Error('No fresh trending candidate videos found across all regions - try again later or widen REGIONS');
}

module.exports = { findNextSourceVideo, markUsed, loadUsed, REGIONS };
