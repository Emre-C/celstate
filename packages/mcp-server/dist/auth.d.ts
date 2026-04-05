import type { ConvexHttpClient } from "convex/browser";
import type { CelstateCurrentUser } from "./convex-api.js";
export declare class AuthenticationError extends Error {
    readonly statusCode = 401;
    constructor(message: string);
}
export interface CelstateRequestContext {
    convex: ConvexHttpClient;
    token: string;
    user: CelstateCurrentUser;
}
export declare function parseBearerToken(authHeader: string | undefined): string;
export declare function authenticateRequest(authHeader: string | undefined): Promise<CelstateRequestContext>;
