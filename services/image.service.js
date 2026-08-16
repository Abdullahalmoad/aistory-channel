const fs = require('fs');
const path = require('path');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function generateStyledImage(sceneDescription, outputPath, retries = 3) {
  // اسلوب vector art و line art محترف
  const stylePrefix = "flat design vector illustration, clean bold black outlines, solid flat colors, no gradients, no shading, minimalist cartoon character, muted earthy color palette beige brown terracotta, plain cream background";
  const fullPrompt = `${stylePrefix}, ${sceneDescription}`;

  console.log(`[Image Service] Generating 2D Vector image for: ${sceneDescription}`);

  const seed = Math.floor(Math.random() * 1000000);
  const encodedPrompt = encodeURIComponent(fullPrompt);
  // تركيبة turbo و sdxl مختصره ا// Vector لا يتطلب من ال flux ب توربين تفاصيل ايف لشيف اقل ادوات ابت اجمل
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1084&height=1920&nologo=true&seed=${seed}&model=flux`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(imageUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`Failed to generate image: ${response.statusText}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(outputPath, buffer);
      console.log(`[Image Service] Saved: ${outputPath}`);
      return outputPath;
    } catch (err) {
      clearTimeout(timeoutId);
      const isLast = attempt === retries;
      console.warn(`[Image Service] Attempt ${attempt}/${retries} failed: ${err.message}`);
      if (isLast) throw err;
      await sleep(attempt * 3000);
    }
  }
}

async function getAllSceneImages(scenes, outputDir = './assets/images') {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const scenesWithImages = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const description = scene.visualPrompt || scene.text || `Scene ${i + 1}`;
    const outputPath = path.join(outputDir, `scene_${i + 1}.png`);
    try {
      await generateStyledImage(description, outputPath);
      scenesWithImages.push({ ...scene, image_file: outputPath });
    } catch (err) {
      console.warn(`[Image Service] Scene ${i + 1} failed after retries: ${err.message}`);
      scenesWithImages.push({ ...scene, image_file: null });
    }
    if (i < scenes.length - 1) await sleep(2000);
  }
  return scenesWithImages;
}

module.exports = { generateStyledImage, getAllSceneImages };
