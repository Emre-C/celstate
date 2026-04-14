export declare const MCP_SERVER_INFO: {
    readonly name: "celstate";
    readonly version: "0.1.0";
    readonly instructions: "Celstate generates transparent-background PNG images from text prompts. Use it when the user needs logos, icons, mascots, stickers, UI elements, or game assets with no background. Each generation costs 1 credit. Check credits with celstate_check_credits before generating. If the user has 0 credits, direct them to celstate.com to purchase more. After calling celstate_generate, poll celstate_get_image every 5–10 seconds until the status is 'complete' or 'failed'. Typical generation time is 15–45 seconds.";
};
export declare const MCP_ENDPOINT_PATH = "/mcp";
export declare const HEALTH_ENDPOINT_PATH = "/health";
export declare const MCP_CORS_ALLOWED_METHODS: readonly ["DELETE", "GET", "OPTIONS", "POST"];
export declare const MCP_CORS_ALLOWED_HEADERS: readonly ["Accept", "Authorization", "Content-Type", "Last-Event-ID", "Mcp-Session-Id", "MCP-Protocol-Version"];
export declare const MCP_CORS_EXPOSED_HEADERS: readonly ["Mcp-Session-Id", "x-request-id"];
export declare const DEFAULT_HOST = "127.0.0.1";
export declare const DEFAULT_PORT = 3100;
export declare const DEFAULT_LIST_IMAGES_LIMIT = 5;
export declare const MAX_LIST_IMAGES_LIMIT = 10;
export declare const MAX_GENERATION_PROMPT_LENGTH = 20000;
export declare const VALID_ASPECT_RATIOS: readonly ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "5:4", "4:5", "21:9", "4:1", "1:4", "8:1", "1:8"];
export type CelstateAspectRatio = (typeof VALID_ASPECT_RATIOS)[number];
export type GenerationStatusFilter = "all" | "complete" | "generating" | "failed";
