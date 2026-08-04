const fs = require('fs');
const path = require('path');

async function generateStyledImage(sceneDescription, outputPath) {
    // استخدام وسم vector art و line art مباشر وصارم
    const stylePrefix = "flat design vector illustration, clean bold black outlines, solid flat colors, no gradients, no shading, minimalist cartoon character, muted earthy color palette beige brown terracotta, plain cream background";
    const fullPrompt = `${stylePrefix}, ${sceneDescription}`;

    console.log(`[Image Service] Generating 2D Vector image for: ${sceneDescription}`);
    
    const seed = Math.floor(Math.random() * 1000000);
    const encodedPrompt = encodeURIComponent(fullPrompt);
    
    // استخدام sdxl أو turbo بدل flux لأنه يلتزم بالـ Vector بشكل أفضل في الحسابات المجانية
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1084&height=1920&nologo=true&seed=${seed}&model=flux`;

    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to generate image: ${response.statusText}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.log(`[Image Service] Saved: ${outputPath}`);
    return outputPath;
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
        
        await generateStyledImage(description, outputPath);
        scenesWithImages.push({ ...scene, image_file: outputPath });
    }

    return scenesWithImages;
}

module.exports = { generateStyledImage, getAllSceneImages };
