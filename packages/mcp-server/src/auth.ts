import type { ConvexHttpClient } from "convex/browser";
import {
  createConvexClient,
  getCurrentUser,
} from "./convex-client.js";
import type { CelstateCurrentUser } from "./convex-api.js";

export class AuthenticationError extends Error {
  readonly statusCode = 401;

  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export interface CelstateRequestContext {
  convex: ConvexHttpClient;
  requestId: string;
  token: string;
  user: CelstateCurrentUser;
}

export function parseBearerToken(authHeader: string | undefined): string {
  if (!authHeader) {
    throw new AuthenticationError(
      "Missing bearer token. Add the user's Celstate MCP API key in the Authorization header.",
    );
  }

  if (!authHeader.startsWith("Bearer ")) {
    throw new AuthenticationError(
      "Invalid Authorization header. Use the format: Bearer <celstate_api_key>.",
    );
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new AuthenticationError(
      "Bearer token is empty. Provide a valid Celstate MCP API key.",
    );
  }

  return token;
}

export async function authenticateRequest(
  authHeader: string | undefined,
  requestId: string,
): Promise<CelstateRequestContext> {
  try {
    const token = parseBearerToken(authHeader);
    const convex = createConvexClient(token);
    const user = await getCurrentUser(convex);

    if (!user) {
      throw new AuthenticationError(
        "Authentication failed. Generate a new Celstate MCP API key in settings and reconnect the MCP client.",
      );
    }

    return {
      convex,
      requestId,
      token,
      user,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }

    throw new AuthenticationError(
      "Authentication failed. Generate a new Celstate MCP API key in settings and reconnect the MCP client.",
    );
  }
}
