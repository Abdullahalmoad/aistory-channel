const { fetchRealMedia: fetchPexelsMedia } = require('./pexels.service');
const { fetchPixabayMedia } = require('./pixabay.service');
const { fetchUnsplashMedia } = require('./unsplash.service');

// Tries multiple free stock sources in order and returns the first real match.
// Order: Pexels -> Pixabay (both support video+photo) -> Unsplash (photo only, last resort before AI fallback).
async function fetchRealMedia(query, outputDir, sceneOrder, preferVideo = false) {
  const pexels = await fetchPexelsMedia(query, outputDir, sceneOrder, preferVideo);
  if (pexels) return pexels;

  const pixabay = await fetchPixabayMedia(query, outputDir, sceneOrder, preferVideo);
  if (pixabay) return pixabay;

  const unsplash = await fetchUnsplashMedia(query, outputDir, sceneOrder);
  if (unsplash) return unsplash;

  return null;
}

module.exports = { fetchRealMedia };
