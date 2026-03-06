import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import { GENERATION_CONFIG } from "./lib/config.js";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId }) {
      if (!existingUserId) {
        // New user — seed initial credits
        const user = await ctx.db.get(userId);
        if (user && user.credits === undefined) {
          await ctx.db.patch(userId, {
            credits: GENERATION_CONFIG.initialCredits,
          });
        }
      }
    },
  },
});
