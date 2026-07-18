// test-phase2.js
const { getAllSceneImages } = require('./services/image.service');

async function main() {
  const sampleScenes = [
    {
      scene_order: 1,
      image_prompt: 'a volcanic island rising out of the ocean with steam rising',
    },
    {
      scene_order: 2,
      image_prompt: 'a group of hikers walking through a snowy mountain forest at night',
    },
    {
      scene_order: 3,
      image_prompt: 'an abandoned tent torn open in the snow, moonlight overhead',
    },
  ];

  console.log('--- Generating 3 sample images (this can take ~30-60s) ---');
  const results = await getAllSceneImages(sampleScenes, './test-images');

  results.forEach((r) => {
    if (r.image_error) {
      console.log(`[${r.scene_order}] FAILED: ${r.image_error}`);
    } else {
      console.log(`[${r.scene_order}] OK -> ${r.image_file}`);
    }
  });

  console.log('\nDone. Open the test-images/ folder and check the images look right.');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
