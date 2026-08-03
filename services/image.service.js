const fs = require('fs');
const path = require('path');

async function generateStyledImage(sceneDescription, outputPath) {
    // استخدام وسم vector art و line art مباشر وصارم
    const stylePrefix = "flat 2d vector art, simple hand drawn line art, doodle caveman, clean ink lines, beige paper background, solid colors, no gradients, no 3d, no shadows";
    const fullPrompt = `${stylePrefix}, ${sceneDescription}`;

    console.log(`[Image Service] Generating 2D Vector image for: ${sceneDescription}`);
    
    const seed = Math.floor(Math.random() * 1000000);
    const encodedPrompt = encodeURIComponent(fullPrompt);
    
    // استخدام sdxl أو turbo بدل flux لأنه يلتزم بالـ Vector بشكل أفضل في الحسابات المجانية
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1084&height=1920&nologo=true&seed=${seed}&model=turbo`;

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

    const imagePaths = [];
    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const description = scene.visualPrompt || scene.text || `Scene ${i + 1}`;
        const outputPath = path.join(outputDir, `scene_${i + 1}.png`);
        
        await generateStyledImage(description, outputPath);
        imagePaths.push(outputPath);
    }

    return imagePaths;
}

module.exports = { generateStyledImage, getAllSceneImages };
