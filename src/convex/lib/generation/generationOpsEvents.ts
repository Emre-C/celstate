import type { Doc, Id } from "../../_generated/dataModel.js";
import type { MutationCtx } from "../../_generated/server.js";
import type { GenerationStage } from "./generationRun.js";

export type GenerationOpsEventInsert = {
  attemptDurationMs?: number;
  error?: string;
  eventType: Doc<"generationOpsEvents">["eventType"];
  generationDurationMs?: number;
  generationId: Id<"generations">;
  retryCount?: number;
  severity?: "info" | "warning" | "critical";
  stage?: GenerationStage;
  statusMessage?: string;
  totalRetryCount?: number;
  userEmail?: string;
  userId: Id<"users">;
};

/**
 * Single insert path for `generationOpsEvents` (pipeline + ops alerts).
 */
export async function insertGenerationOpsEventRow(
  ctx: Pick<MutationCtx, "db">,
  args: GenerationOpsEventInsert,
): Promise<void> {
  await ctx.db.insert("generationOpsEvents", {
    attemptDurationMs: args.attemptDurationMs,
    createdAt: Date.now(),
    error: args.error,
    eventType: args.eventType,
    generationDurationMs: args.generationDurationMs,
    generationId: args.generationId,
    retryCount: args.retryCount,
    severity: args.severity,
    stage: args.stage,
    statusMessage: args.statusMessage,
    totalRetryCount: args.totalRetryCount,
    userEmail: args.userEmail,
    userId: args.userId,
  });
}
