import fs from 'fs';
import path from 'path';

// أسلوب الرسم الموحد والمفروض على كل الصور
const STYLE_PROMPT = "Minimalist 2D hand-drawn line art illustration, simple cartoon aesthetic, parchment paper texture background, clean outline, warm muted beige and earth tone color palette, whimsical storytelling diagram format, vertical 9:16 aspect ratio.";

/**
 * دالة توليد الصور بأسلوب موحد
 * @param {string} sceneDescription وصف المشهد القادم من السكريبت
 * @param {string} outputPath مسار حفظ الصورة الناتج
 */
export async function generateStyledImage(sceneDescription, outputPath) {
    const fullPrompt = `${STYLE_PROMPT} Scene details: ${sceneDescription}`;
    
    console.log(`[Image Service] Generating image with prompt: ${fullPrompt}`);
    
    // يمكنك دمج OpenAI DALL-E 3 أو Pollinations API المجاني هنا
    const encodedPrompt = encodeURIComponent(fullPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1084&height=1920&nologo=true`;

    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to generate image: ${response.statusText}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.log(`[Image Service] Image successfully saved to ${outputPath}`);
    
    return outputPath;
}
