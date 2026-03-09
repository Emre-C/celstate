# Authentication

## Overview

Celstate uses **Convex Auth** with Google OAuth for user authentication. This provides secure, session-based authentication without third-party auth libraries.

## Architecture

### Backend (`src/convex/auth.ts`)

```typescript
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
```

### Frontend Client (`src/lib/auth/auth.svelte.ts`)

A custom Svelte 5 client that replicates Convex Auth's React client behavior using runes. Handles:
- OAuth initiation and redirect
- Code exchange (token exchange)
- Token refresh
- LocalStorage persistence
- Return path preservation

## OAuth Flow

1. **Initiation**: User clicks "Sign in with Google"
2. **Redirect**: Browser redirects to Google OAuth consent screen
3. **Callback**: Google redirects to `/auth/callback` with authorization code
4. **Exchange**: Backend exchanges code for JWT tokens
5. **Session**: Tokens stored in localStorage, client authenticated

## Schema

User data stored in `users` table:

```typescript
users: defineTable({
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  phone: v.optional(v.string()),
  phoneVerificationTime: v.optional(v.number()),
  isAnonymous: v.optional(v.boolean()),
  credits: v.optional(v.number()), // Custom field for credit balance
}).index("email", ["email"])
```

## New User Onboarding

When a new user authenticates via Google:
1. User record created automatically by Convex Auth
2. `afterUserCreatedOrUpdated` callback triggers
3. Initial credits (`GENERATION_CONFIG.initialCredits = 3`) seeded to user account

## Protected Routes

- `/app/*` routes require authentication
- Server-side auth guards in Convex queries/mutations
- Client-side loading states prevent flash of unauthenticated content

## Sign Out

Clears tokens from localStorage and notifies backend. User redirected to landing page.
