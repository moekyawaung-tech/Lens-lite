import { GoogleGenAI } from "@google/genai";

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });
}

export async function analyzeImage(
  base64Image: string,
  mimeType: string,
  language: 'en' | 'my'
): Promise<string> {
  const ai = getAI();
  const languagePrompt = language === 'my' 
    ? "Provide your entire response in Burmese (Myanmar language)." 
    : "Provide your entire response in English.";

  const prompt = `You are an accessibility assistant inspired by Google Lookout. 
Analyze this image for the user and provide a direct, concise description suitable for being spoken aloud.
- If there is text in the image, read it and translate it directly into the requested language.
- If it is a scene or object, describe what is in front of the camera clearly and briefly.
- Do not use markdown formatting like bolding or bullet points, as this will be read by a screen reader. Write in plain, natural sentences.
${languagePrompt}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            data: base64Image,
            mimeType: mimeType,
          },
        },
        prompt,
      ],
    });

    return response.text || "No analysis could be generated.";
  } catch (error) {
    console.error("Error analyzing image:", error);
    throw new Error("Failed to analyze the image. Please try again.");
  }
}

export async function generateImage(prompt: string): Promise<string> {
  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          {
            text: prompt,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "4K"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    throw new Error("No image generated.");
  } catch (error) {
    console.error("Error generating image:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Failed to generate image. Please try again.");
  }
}
