/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";

const modules = import.meta.glob([
  "/src/convex/**/*.ts",
  "!/src/convex/**/*.test.ts",
]);

async function createHarness(tokenIdentifier: string) {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      tokenIdentifier,
      email: "keys-test@celstate.test",
      name: "Keys Test",
      credits: 3,
    });
  });

  return t.withIdentity({
    tokenIdentifier,
    email: "keys-test@celstate.test",
    name: "Keys Test",
  });
}

describe("mcp api keys", () => {
  it("creates, lists, and revokes keys for the authenticated user", async () => {
    const identity = await createHarness("keys-flow-token");

    const created = await identity.action(api.mcp.keys.createKey, {
      name: "Claude Code",
    });

    expect(created.rawKey.startsWith("cel_")).toBe(true);

    const listed = await identity.query(api.mcp.keys.listKeys, {});
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      keyPrefix: created.keyPrefix,
      name: "Claude Code",
    });
    expect(listed[0]?.revokedAt).toBeUndefined();

    const revoked = await identity.mutation(api.mcp.keys.revokeKey, {
      keyId: listed[0]!._id,
    });
    expect(revoked).toEqual({ revoked: true });

    const after = await identity.query(api.mcp.keys.listKeys, {});
    expect(after[0]?.revokedAt).toEqual(expect.any(Number));
  });

  it("enforces the active-key cap until a key is revoked", async () => {
    const identity = await createHarness("keys-cap-token");

    for (let index = 0; index < 5; index += 1) {
      await identity.action(api.mcp.keys.createKey, {
        name: `Harness ${index + 1}`,
      });
    }

    await expect(
      identity.action(api.mcp.keys.createKey, {
        name: "Overflow",
      }),
    ).rejects.toThrowError("Maximum 5 active API keys allowed");

    const keys = await identity.query(api.mcp.keys.listKeys, {});
    await identity.mutation(api.mcp.keys.revokeKey, { keyId: keys[0]!._id });

    await expect(
      identity.action(api.mcp.keys.createKey, {
        name: "Replacement",
      }),
    ).resolves.toMatchObject({
      name: "Replacement",
    });
  });
});
