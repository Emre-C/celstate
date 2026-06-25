import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  isValidLottieAspectRatio,
  isValidLottieDurationSeconds,
  LOTTIE_GENERATION_CONFIG,
} from "./lib/config.js";
import {
  lottieGenerationStatusValidator,
  lottieValidationValidator,
} from "./lib/validation/validators.js";
import { getCurrentAppUser, upsertCurrentUser } from "./users.js";
import {
  ACTIVE_LOTTIE_GENERATION_STATUSES,
  buildLottieGenerationAttemptPatch,
  buildLottieGenerationCompletionPatch,
  buildLottieGenerationFailurePatch,
  createLottieGenerationRun,
  isTerminalLottieGenerationStatus,
  type LottieGenerationStatus,
} from "./lib/lottie/lottieGenerationRun.js";

const lottieGenerationFields = {
  _creationTime: v.number(),
  _id: v.id("lottieGenerations"),
  aspectRatio: v.string(),
  attemptCount: v.number(),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  creditsCost: v.number(),
  creditRefundedAt: v.optional(v.number()),
  durationSeconds: v.number(),
  error: v.optional(v.string()),
  failedAt: v.optional(v.number()),
  fps: v.number(),
  grounding: v.optional(v.string()),
  lastProgressAt: v.optional(v.number()),
  lottieStorageId: v.optional(v.id("_storage")),
  prompt: v.string(),
  status: lottieGenerationStatusValidator,
  statusMessage: v.optional(v.string()),
  userId: v.id("users"),
  validation: v.optional(lottieValidationValidator),
} as const;

const lottieGenerationValidator = v.object(lottieGenerationFields);

const lottieGenerationWithUrlValidator = v.object({
  ...lottieGenerationFields,
  lottieUrl: v.union(v.string(), v.null()),
});

async function countActiveLottieGenerations(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
): Promise<number> {
  let count = 0;
  for (const status of ACTIVE_LOTTIE_GENERATION_STATUSES) {
    const rows = await ctx.db
      .query("lottieGenerations")
      .withIndex("by_user_status_created", (q) =>
        q.eq("userId", userId).eq("status", status)
      )
      .take(LOTTIE_GENERATION_CONFIG.maxActiveGenerations);
    count += rows.length;
    if (count >= LOTTIE_GENERATION_CONFIG.maxActiveGenerations) {
      return count;
    }
  }
  return count;
}

async function countRecentLottieRequests(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  now: number,
): Promise<number> {
  return (
    await ctx.db
      .query("lottieGenerations")
      .withIndex("by_user_created", (q) =>
        q
          .eq("userId", userId)
          .gte("createdAt", now - LOTTIE_GENERATION_CONFIG.requestWindowMs)
      )
      .take(LOTTIE_GENERATION_CONFIG.maxRequestsPerWindow)
  ).length;
}

function validateLottieRequestInput(args: {
  aspectRatio?: string;
  durationSeconds?: number;
  grounding?: string;
  prompt: string;
}): {
  aspectRatio: string;
  durationSeconds: number;
  grounding?: string;
  prompt: string;
} {
  const prompt = args.prompt.trim();
  if (!prompt) {
    throw new ConvexError("Prompt is required");
  }
  if (prompt.length > LOTTIE_GENERATION_CONFIG.maxPromptLength) {
    throw new ConvexError(
      `Prompt too long (max ${LOTTIE_GENERATION_CONFIG.maxPromptLength} characters)`,
    );
  }

  const aspectRatio = args.aspectRatio ?? LOTTIE_GENERATION_CONFIG.defaultAspectRatio;
  if (!isValidLottieAspectRatio(aspectRatio)) {
    throw new ConvexError(`Unsupported Lottie aspect ratio: ${aspectRatio}`);
  }

  const durationSeconds =
    args.durationSeconds ?? LOTTIE_GENERATION_CONFIG.defaultDurationSeconds;
  if (!isValidLottieDurationSeconds(durationSeconds)) {
    throw new ConvexError(`Unsupported Lottie duration: ${durationSeconds}`);
  }

  const grounding = args.grounding?.trim();
  if (grounding && grounding.length > LOTTIE_GENERATION_CONFIG.maxGroundingLength) {
    throw new ConvexError(
      `Grounding reference too long (max ${LOTTIE_GENERATION_CONFIG.maxGroundingLength} characters)`,
    );
  }

  return { aspectRatio, durationSeconds, grounding: grounding || undefined, prompt };
}

async function requestLottieGenerationCore(
  ctx: MutationCtx,
  args: {
    aspectRatio: string;
    durationSeconds: number;
    grounding?: string;
    prompt: string;
    userId: Id<"users">;
  },
): Promise<Id<"lottieGenerations">> {
  const user = await ctx.db.get(args.userId);
  if (!user) {
    throw new ConvexError("User not found");
  }

  const activeCount = await countActiveLottieGenerations(ctx, args.userId);
  if (activeCount >= LOTTIE_GENERATION_CONFIG.maxActiveGenerations) {
    throw new ConvexError("Too many Lottie generations in progress. Please wait for one to finish.");
  }

  const now = Date.now();
  const recentCount = await countRecentLottieRequests(ctx, args.userId, now);
  if (recentCount >= LOTTIE_GENERATION_CONFIG.maxRequestsPerWindow) {
    throw new ConvexError("Too many Lottie requests submitted recently. Please wait and try again.");
  }

  const creditsCost = LOTTIE_GENERATION_CONFIG.creditsPerLottieGeneration;
  if (creditsCost > 0 && (user.credits ?? 0) < creditsCost) {
    throw new ConvexError("Insufficient credits");
  }
  if (creditsCost > 0) {
    await ctx.db.patch(args.userId, {
      credits: (user.credits ?? 0) - creditsCost,
    });
  }

  const lottieGenerationId = await ctx.db.insert(
    "lottieGenerations",
    createLottieGenerationRun({
      aspectRatio: args.aspectRatio,
      createdAt: now,
      creditsCost,
      durationSeconds: args.durationSeconds,
      fps: LOTTIE_GENERATION_CONFIG.defaultFps,
      grounding: args.grounding,
      prompt: args.prompt,
      userId: args.userId,
    }),
  );

  await ctx.scheduler.runAfter(0, internal.lottieGeneration.generateLottie, {
    lottieGenerationId,
  });

  return lottieGenerationId;
}

async function resolveLottieGenerationWithUrl(
  ctx: Pick<QueryCtx, "storage">,
  generation: Doc<"lottieGenerations">,
): Promise<Doc<"lottieGenerations"> & { lottieUrl: string | null }> {
  return {
    ...generation,
    lottieUrl: generation.lottieStorageId
      ? await ctx.storage.getUrl(generation.lottieStorageId)
      : null,
  };
}

export const requestLottieGeneration = mutation({
  args: {
    aspectRatio: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    grounding: v.optional(v.string()),
    prompt: v.string(),
  },
  returns: v.id("lottieGenerations"),
  handler: async (ctx, args) => {
    const appUser = await upsertCurrentUser(ctx);
    const input = validateLottieRequestInput(args);

    return await requestLottieGenerationCore(ctx, {
      ...input,
      userId: appUser._id,
    });
  },
});

export const getByUserWithUrls = query({
  args: {},
  returns: v.array(lottieGenerationWithUrlValidator),
  handler: async (ctx) => {
    const appUser = await getCurrentAppUser(ctx);
    if (!appUser) {
      return [];
    }

    const generations = await ctx.db
      .query("lottieGenerations")
      .withIndex("by_user_created", (q) => q.eq("userId", appUser._id))
      .order("desc")
      .take(50);

    return Promise.all(generations.map((generation) => resolveLottieGenerationWithUrl(ctx, generation)));
  },
});

export const getByUserAndIdWithUrl = query({
  args: {
    lottieGenerationId: v.string(),
  },
  returns: v.union(lottieGenerationWithUrlValidator, v.null()),
  handler: async (ctx, args) => {
    const appUser = await getCurrentAppUser(ctx);
    if (!appUser) {
      return null;
    }

    const lottieGenerationId = ctx.db.normalizeId(
      "lottieGenerations",
      args.lottieGenerationId,
    );
    if (!lottieGenerationId) {
      return null;
    }

    const generation = await ctx.db.get(lottieGenerationId);
    if (!generation || generation.userId !== appUser._id) {
      return null;
    }

    return resolveLottieGenerationWithUrl(ctx, generation);
  },
});

export const getById = internalQuery({
  args: {
    lottieGenerationId: v.id("lottieGenerations"),
  },
  returns: v.union(lottieGenerationValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.lottieGenerationId);
  },
});

export const markAttemptStarted = internalMutation({
  args: {
    attemptCount: v.number(),
    expectedStatus: lottieGenerationStatusValidator,
    lottieGenerationId: v.id("lottieGenerations"),
    status: v.union(v.literal("generating"), v.literal("repairing")),
    statusMessage: v.optional(v.string()),
    validation: v.optional(lottieValidationValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.lottieGenerationId);
    const patch = buildLottieGenerationAttemptPatch(generation, {
      attemptCount: args.attemptCount,
      expectedStatus: args.expectedStatus,
      now: Date.now(),
      status: args.status,
      statusMessage: args.statusMessage,
      validation: args.validation,
    });
    if (!patch) {
      return null;
    }

    await ctx.db.patch(args.lottieGenerationId, patch);
    return null;
  },
});

export const completeLottieGeneration = internalMutation({
  args: {
    expectedStatus: lottieGenerationStatusValidator,
    lottieGenerationId: v.id("lottieGenerations"),
    lottieStorageId: v.id("_storage"),
    validation: lottieValidationValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.validation.decision !== "pass") {
      throw new ConvexError("Lottie completion requires passing validation");
    }

    const generation = await ctx.db.get(args.lottieGenerationId);
    if (
      !generation
      || generation.status !== args.expectedStatus
      || isTerminalLottieGenerationStatus(generation.status)
    ) {
      return null;
    }

    await ctx.db.patch(args.lottieGenerationId, buildLottieGenerationCompletionPatch({
      completedAt: Date.now(),
      lottieStorageId: args.lottieStorageId,
      validation: args.validation,
    }));
    return null;
  },
});

async function refundLottieCreditsIfNeeded(
  ctx: Pick<MutationCtx, "db">,
  generation: Doc<"lottieGenerations">,
  now: number,
): Promise<number | undefined> {
  if (generation.creditsCost <= 0 || generation.creditRefundedAt) {
    return generation.creditRefundedAt;
  }
  const user = await ctx.db.get(generation.userId);
  if (user) {
    await ctx.db.patch(generation.userId, {
      credits: (user.credits ?? 0) + generation.creditsCost,
    });
  }
  return now;
}

async function failLottieGenerationDoc(
  ctx: MutationCtx,
  generation: Doc<"lottieGenerations">,
  args: {
    error: string;
    expectedStatus?: LottieGenerationStatus;
    validation?: Doc<"lottieGenerations">["validation"];
  },
): Promise<boolean> {
  if (
    isTerminalLottieGenerationStatus(generation.status)
    || (args.expectedStatus && generation.status !== args.expectedStatus)
  ) {
    return false;
  }

  const now = Date.now();
  const creditRefundedAt = await refundLottieCreditsIfNeeded(ctx, generation, now);
  await ctx.db.patch(generation._id, {
    ...buildLottieGenerationFailurePatch({
      error: args.error,
      failedAt: now,
      validation: args.validation,
    }),
    creditRefundedAt,
  });
  return true;
}

export const failLottieGeneration = internalMutation({
  args: {
    error: v.string(),
    expectedStatus: v.optional(lottieGenerationStatusValidator),
    lottieGenerationId: v.id("lottieGenerations"),
    validation: v.optional(lottieValidationValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.lottieGenerationId);
    if (!generation) {
      return null;
    }

    await failLottieGenerationDoc(ctx, generation, {
      error: args.error,
      expectedStatus: args.expectedStatus,
      validation: args.validation,
    });
    return null;
  },
});

export const cleanupStaleLottieGenerations = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const staleThreshold = now - LOTTIE_GENERATION_CONFIG.staleGenerationTimeoutMs;

    for (const status of ACTIVE_LOTTIE_GENERATION_STATUSES) {
      const stale = await ctx.db
        .query("lottieGenerations")
        .withIndex("by_status_last_progress", (q) =>
          q.eq("status", status).lt("lastProgressAt", staleThreshold),
        )
        .take(LOTTIE_GENERATION_CONFIG.staleCleanupBatchSize);

      for (const generation of stale) {
        await failLottieGenerationDoc(ctx, generation, {
          error:
            "Lottie generation timed out before completion. Any credits have been refunded — please try again.",
        });
      }
    }

    return null;
  },
});
