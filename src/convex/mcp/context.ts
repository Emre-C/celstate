import type { ActionCtx } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.js";

export interface McpToolContext {
  runQuery: ActionCtx["runQuery"];
  runMutation: ActionCtx["runMutation"];
  user: {
    _id: Id<"users">;
    credits?: number;
    email?: string;
  };
  requestId: string;
}
