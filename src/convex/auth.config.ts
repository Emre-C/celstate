import type { AuthConfig } from "convex/server";

const clerkJwtIssuerDomain =
  process.env.CLERK_JWT_ISSUER_DOMAIN?.trim() ||
  (process.env.NODE_ENV === "test" ? "https://clerk.test" : "");

if (!clerkJwtIssuerDomain) {
  throw new Error("CLERK_JWT_ISSUER_DOMAIN must be set on Convex for Clerk JWT validation.");
}

export default {
  providers: [
    {
      domain: clerkJwtIssuerDomain,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
