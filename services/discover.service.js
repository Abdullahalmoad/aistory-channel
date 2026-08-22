const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const USED_PATH = path.join(__dirname, '..', 'data', 'used-videos.json');

// Fallback search queries used only if the trending chart comes up empty or
// fails (e.g. quota issue). These target commentary/analysis videos ABOUT a
// trend, not the trending content itself (e.g. not a music video, but a
// video explaining/reacting to why a song or topic is blowing up).
const QUERIES = [
  'why is this trending explained',
  'trend explained breakdown',
  'internet trend analysis',
  'what happened viral explained',
  'pop culture moment explained',
  'this week in internet culture',
];

// Western/English-speaking regions only, per request - pulls YouTube's
// official "Trending" chart for each.
const TRENDING_REGIONS = ['US', 'GB', 'CA', 'AU'];

// YouTube category ID for Music - excluded from trending picks since we
// want commentary/analysis content, not music videos themselves.
const EXCLUDED_CATEGORY_IDS = ['10'];

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

function parseIsoDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  return h * 3600 + min * 60 + s;
}

// Pulls YouTube's official "Trending" chart (the same list shown on
// youtube.com/feed/trending) for a given region.
async function getTrendingCandidates(youtube, regionCode, maxResults = 20) {
  const res = await youtube.videos.list({
    part: ['snippet', 'contentDetails'],
    chart: 'mostPopular',
    regionCode,
    maxResults,
  });
  return (res.data.items || []).map((item) => ({
    videoId: item.id,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    categoryId: item.snippet.categoryId,
    duration: parseIsoDuration(item.contentDetails?.duration),
    source: `trending:${regionCode}`,
  }));
}

async function searchCandidates(youtube, query, maxResults = 10) {
  const res = await youtube.search.list({
    part: ['snippet'],
    q: query,
    type: ['video'],
    maxResults,
    order: 'viewCount',
    videoDuration: 'medium', // 4-20 min, avoids very short/very long
    safeSearch: 'strict',
  });
  return (res.data.items || []).map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    source: `search:${query}`,
  }));
}

async function getVideoDurationSeconds(youtube, videoId) {
  const res = await youtube.videos.list({ part: ['contentDetails'], id: [videoId] });
  return parseIsoDuration(res.data.items?.[0]?.contentDetails?.duration);
}

// Picks one not-yet-used, currently-trending candidate video.
async function findNextSourceVideo() {
  const youtube = getYoutubeClient();
  const used = loadUsed();

  // 1) Try the official trending chart first, across a shuffled list of
  // regions, so we're reacting to what's actually viral right now.
  const shuffledRegions = [...TRENDING_REGIONS].sort(() => Math.random() - 0.5);
  for (const region of shuffledRegions) {
    let candidates;
    try {
      candidates = await getTrendingCandidates(youtube, region);
    } catch (err) {
      console.warn(`[discover] trending chart failed for region "${region}": ${err.message}`);
      continue;
    }

    const fresh = candidates.filter(
      (c) => !used.videoIds.includes(c.videoId) && c.duration && c.duration >= 120 && !EXCLUDED_CATEGORY_IDS.includes(c.categoryId)
    );
    for (const candidate of fresh) {
      return { ...candidate, query: candidate.source, url: `https://www.youtube.com/watch?v=${candidate.videoId}` };
    }
  }

  // 2) Fall back to trend-hunting search queries if the chart had nothing
  // fresh (e.g. we've already used everything currently trending).
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
    for (const candidate of fresh) {
      const duration = await getVideoDurationSeconds(youtube, candidate.videoId).catch(() => null);
      if (duration && duration < 120) continue;
      return { ...candidate, duration, query: candidate.source, url: `https://www.youtube.com/watch?v=${candidate.videoId}` };
    }
  }

  throw new Error('No fresh candidate videos found in trending chart or fallback queries - try again later');
}

module.exports = { findNextSourceVideo, markUsed, loadUsed, QUERIES, TRENDING_REGIONS };
