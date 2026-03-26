import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { GENERATION_CONFIG } from "./config.js";

type GeminiImageMimeType =
  | "image/heic"
  | "image/heif"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

interface VertexServiceAccountCredentials {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
  type?: string;
}

export interface GeminiImageResult {
  imageBase64: string;
  mimeType: GeminiImageMimeType;
}

export interface GeminiChatSession {
  sendMessage(prompt: string): Promise<GeminiImageResult>;
  sendMessageWithImages(
    prompt: string,
    images: GeminiImageResult[],
  ): Promise<GeminiImageResult>;
}

export interface GeminiRuntimeConfig {
  googleAuthOptions?: {
    credentials?: VertexServiceAccountCredentials;
    keyFilename?: string;
    projectId?: string;
  };
  location: string;
  project: string;
}

const GEMINI_IMAGE_MIME_TYPES = new Set<GeminiImageMimeType>([
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isGeminiImageMimeType(value: string | undefined): value is GeminiImageMimeType {
  return value !== undefined && GEMINI_IMAGE_MIME_TYPES.has(value as GeminiImageMimeType);
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}

export function normalizeGeminiImageMimeType(value: string | undefined): GeminiImageMimeType {
  if (isGeminiImageMimeType(value)) {
    return value;
  }

  return "image/png";
}

function parseServiceAccountJson(raw: string): VertexServiceAccountCredentials {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("VERTEX_AI_SERVICE_ACCOUNT_JSON environment variable must contain valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("VERTEX_AI_SERVICE_ACCOUNT_JSON environment variable must contain a JSON object");
  }

  const credentials = parsed as Partial<VertexServiceAccountCredentials>;
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      "VERTEX_AI_SERVICE_ACCOUNT_JSON environment variable must contain client_email and private_key",
    );
  }

  return {
    client_email: credentials.client_email,
    private_key: normalizePrivateKey(credentials.private_key),
    private_key_id: credentials.private_key_id,
    project_id: credentials.project_id,
    type: credentials.type,
  };
}

function readServiceAccountCredentialsFromEnv(
  env: Record<string, string | undefined>,
): VertexServiceAccountCredentials | undefined {
  const serviceAccountJson = env.VERTEX_AI_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson) {
    return parseServiceAccountJson(serviceAccountJson);
  }

  const clientEmail = env.VERTEX_AI_CLIENT_EMAIL?.trim();
  const privateKey = env.VERTEX_AI_PRIVATE_KEY;
  if (!clientEmail || !privateKey) {
    return undefined;
  }

  return {
    client_email: clientEmail,
    private_key: normalizePrivateKey(privateKey),
    private_key_id: env.VERTEX_AI_PRIVATE_KEY_ID?.trim(),
    project_id:
      env.VERTEX_AI_PROJECT_ID?.trim()
      || env.GOOGLE_CLOUD_PROJECT?.trim()
      || env.GCLOUD_PROJECT?.trim(),
    type: "service_account",
  };
}

export function readGeminiRuntimeConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GeminiRuntimeConfig {
  const serviceAccountCredentials = readServiceAccountCredentialsFromEnv(env);
  const keyFilename = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const project =
    env.VERTEX_AI_PROJECT_ID?.trim()
    || env.GOOGLE_CLOUD_PROJECT?.trim()
    || env.GCLOUD_PROJECT?.trim()
    || serviceAccountCredentials?.project_id?.trim()
    || "";

  if (!project) {
    throw new Error(
      "VERTEX_AI_PROJECT_ID or GOOGLE_CLOUD_PROJECT environment variable not set",
    );
  }

  const location = env.VERTEX_AI_LOCATION?.trim() || env.GOOGLE_CLOUD_LOCATION?.trim() || "global";

  return {
    googleAuthOptions: serviceAccountCredentials
      ? {
          credentials: serviceAccountCredentials,
          projectId: project,
        }
      : keyFilename
        ? {
            keyFilename,
            projectId: project,
          }
        : undefined,
    location,
    project,
  };
}

function createClient(runtimeConfig: GeminiRuntimeConfig): GoogleGenAI {
  return new GoogleGenAI({
    ...(runtimeConfig.googleAuthOptions
      ? { googleAuthOptions: runtimeConfig.googleAuthOptions }
      : {}),
    location: runtimeConfig.location,
    project: runtimeConfig.project,
    vertexai: true,
  });
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
      const mimeType = normalizeGeminiImageMimeType(part.inlineData.mimeType);
      return {
        imageBase64: part.inlineData.data,
        mimeType,
      };
    }
  }

  throw new Error(
    "Gemini returned response without image data (text-only response)",
  );
}

export function createChatSession(
  runtimeConfig: GeminiRuntimeConfig,
  config?: {
    aspectRatio?: string;
    imageSize?: string;
  },
): GeminiChatSession {
  const ai = createClient(runtimeConfig);

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
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.LOW,
        includeThoughts: false,
      },
    },
  });

  return {
    async sendMessage(prompt: string): Promise<GeminiImageResult> {
      const response = await chat.sendMessage({ message: prompt });
      return extractImageFromResponse(response);
    },

    async sendMessageWithImages(
      prompt: string,
      images: GeminiImageResult[],
    ): Promise<GeminiImageResult> {
      const messageParts: Array<
        | { inlineData: { data: string; mimeType: GeminiImageMimeType } }
        | { text: string }
      > = images.map((img) => ({
        inlineData: {
          data: img.imageBase64,
          mimeType: img.mimeType,
        },
      }));
      messageParts.push({ text: prompt });

      const response = await chat.sendMessage({
        message: messageParts,
      });
      return extractImageFromResponse(response);
    },
  };
}
