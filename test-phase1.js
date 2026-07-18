require('dotenv').config();
const { generateScript } = require('./services/script.service');
const { generateNarrationAudio } = require('./services/tts.service');

async function main() {
  const topic = process.argv[2] || 'The Dyatlov Pass Incident: a real unsolved mystery';

  console.log(`\n--- Generating script for: "${topic}" ---`);
  const script = await generateScript(topic, { targetWords: 1800 });

  console.log(`\nTitle: ${script.title}`);
  console.log(`Description: ${script.description}`);
  console.log(`Tags: ${script.tags.join(', ')}`);
  console.log(`Scenes: ${script.scenes.length}`);
  console.log(`Estimated word count: ${script.estimated_word_count}`);
  console.log(`Hook scenes: ${script.scenes.filter((s) => s.is_hook).length}`);

  console.log('\n--- Scene preview (first 3) ---');
  script.scenes.slice(0, 3).forEach((s) => {
    console.log(`[${s.scene_order}]${s.is_hook ? ' (HOOK)' : ''} ${s.text}`);
  });

  console.log('\n--- Generating narration audio (this can take a bit for 1800+ words) ---');
  const audio = await generateNarrationAudio(script.scenes, {
    outputPath: './test-output.mp3',
  });

  console.log(`\nDone. Audio saved to: ${audio.filePath} (voice: ${audio.voice})`);
  console.log('Listen to it and check pacing/tone before moving to Phase 2 (images).');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
