import { v, ConvexError } from "convex/values";
import {
  action,
  query,
  mutation,
  internalMutation,
} from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import { getCurrentAppUser } from "../users.js";
import { MAX_ACTIVE_KEYS_PER_USER } from "./constants.js";

const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62Encode(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    result += BASE62_CHARS[byte % 62];
  }
  return result;
}

function generateRawKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `cel_${base62Encode(bytes)}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const createKey = action({
  args: {
    name: v.string(),
  },
  returns: v.object({
    rawKey: v.string(),
    keyPrefix: v.string(),
    name: v.string(),
    createdAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name || name.length > 64) {
      throw new ConvexError("Key name must be 1-64 characters");
    }

    const rawKey = generateRawKey();
    const keyHash = await sha256Hex(rawKey);
    const keyPrefix = rawKey.slice(0, 12);
    const createdAt = Date.now();

    await ctx.runMutation(internal.mcp.keys.insertKey, {
      keyHash,
      keyPrefix,
      name,
      createdAt,
    });

    return { rawKey, keyPrefix, name, createdAt };
  },
});

export const insertKey = internalMutation({
  args: {
    keyHash: v.string(),
    keyPrefix: v.string(),
    name: v.string(),
    createdAt: v.number(),
  },
  returns: v.id("mcpApiKeys"),
  handler: async (ctx, args) => {
    const user = await getCurrentAppUser(ctx);
    if (!user) {
      throw new ConvexError("Unauthorized");
    }

    const existingKeys = await ctx.db
      .query("mcpApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const activeCount = existingKeys.filter((k) => k.revokedAt === undefined).length;
    if (activeCount >= MAX_ACTIVE_KEYS_PER_USER) {
      throw new ConvexError(
        `Maximum ${MAX_ACTIVE_KEYS_PER_USER} active API keys allowed. Revoke an existing key first.`,
      );
    }

    return ctx.db.insert("mcpApiKeys", {
      userId: user._id,
      keyHash: args.keyHash,
      keyPrefix: args.keyPrefix,
      name: args.name,
      createdAt: args.createdAt,
    });
  },
});

export const listKeys = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("mcpApiKeys"),
    keyPrefix: v.string(),
    name: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })),
  handler: async (ctx) => {
    const user = await getCurrentAppUser(ctx);
    if (!user) {
      return [];
    }

    const keys = await ctx.db
      .query("mcpApiKeys")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    return keys.map((k) => ({
      _id: k._id,
      keyPrefix: k.keyPrefix,
      name: k.name,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
    }));
  },
});

export const revokeKey = mutation({
  args: {
    keyId: v.id("mcpApiKeys"),
  },
  returns: v.object({ revoked: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await getCurrentAppUser(ctx);
    if (!user) {
      throw new ConvexError("Unauthorized");
    }

    const key = await ctx.db.get(args.keyId);
    if (!key || key.userId !== user._id) {
      throw new ConvexError("Key not found");
    }

    if (key.revokedAt !== undefined) {
      return { revoked: false };
    }

    await ctx.db.patch(args.keyId, { revokedAt: Date.now() });
    return { revoked: true };
  },
});

// --- Internal query: validate key by hash (called from MCP HTTP action) ---

const userSubsetValidator = v.object({
  _id: v.id("users"),
  credits: v.optional(v.number()),
  email: v.optional(v.string()),
});

export const authenticateKeyByHash = internalMutation({
  args: {
    keyHash: v.string(),
  },
  returns: v.union(
    v.object({
      user: userSubsetValidator,
      keyId: v.id("mcpApiKeys"),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("mcpApiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.keyHash))
      .unique();

    if (!key || key.revokedAt !== undefined) {
      return null;
    }

    const user = await ctx.db.get(key.userId);
    if (!user) {
      return null;
    }

    await ctx.db.patch(key._id, { lastUsedAt: Date.now() });

    return {
      user: {
        _id: user._id,
        credits: user.credits,
        email: user.email,
      },
      keyId: key._id,
    };
  },
});
