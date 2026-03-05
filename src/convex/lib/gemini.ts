import { GoogleGenAI } from "@google/genai";
import { GENERATION_CONFIG } from "./config.js";

export interface GeminiImageResult {
  imageBase64: string;
  mimeType: "image/png" | "image/jpeg";
}

export interface GeminiChatSession {
  sendMessage(prompt: string): Promise<GeminiImageResult>;
  sendMessageWithImage(
    prompt: string,
    image: GeminiImageResult,
  ): Promise<GeminiImageResult>;
}

function extractImageFromResponse(response: {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
  }> | null;
}): GeminiImageResult {
  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("Gemini returned no candidates");
  }

  const parts = candidates[0].content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error("Gemini returned no parts in response");
  }

  for (const part of parts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType as
        | "image/png"
        | "image/jpeg"
        | undefined;
      return {
        imageBase64: part.inlineData.data,
        mimeType: mimeType === "image/jpeg" ? "image/jpeg" : "image/png",
      };
    }
  }

  throw new Error(
    "Gemini returned response without image data (text-only response)",
  );
}

export function createChatSession(
  apiKey: string,
  config?: {
    aspectRatio?: string;
    imageSize?: string;
  },
): GeminiChatSession {
  const ai = new GoogleGenAI({ apiKey });

  const aspectRatio = config?.aspectRatio ?? GENERATION_CONFIG.defaultAspectRatio;
  const imageSize = config?.imageSize ?? GENERATION_CONFIG.defaultImageSize;

  const chat = ai.chats.create({
    model: GENERATION_CONFIG.model,
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio,
        imageSize,
      },
    },
  });

  return {
    async sendMessage(prompt: string): Promise<GeminiImageResult> {
      const response = await chat.sendMessage({ message: prompt });
      return extractImageFromResponse(response);
    },

    async sendMessageWithImage(
      prompt: string,
      image: GeminiImageResult,
    ): Promise<GeminiImageResult> {
      const response = await chat.sendMessage({
        message: [
          {
            inlineData: {
              data: image.imageBase64,
              mimeType: image.mimeType,
            },
          },
          { text: prompt },
        ],
      });
      return extractImageFromResponse(response);
    },
  };
}
