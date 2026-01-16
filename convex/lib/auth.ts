import { auth } from "../auth";
import { MutationCtx, QueryCtx } from "../_generated/server";

declare const process: {
  env: Record<string, string | undefined>;
};

export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const userId = await auth.getUserId(ctx);
  if (!userId) {
    throw new Error("Unauthenticated");
  }
  return userId;
}

export function checkServiceKey(serviceKey?: string | null) {
  if (!serviceKey) {
    return false;
  }
  const expected = process.env.SERVICE_KEY;
  if (!expected) {
    throw new Error("SERVICE_KEY is not configured");
  }
  if (serviceKey !== expected) {
    throw new Error("Invalid service key");
  }
  return true;
}
