import type { AuthConfig } from "convex/server";

const clientId =
  process.env.WORKOS_CLIENT_ID?.trim() ||
  (process.env.NODE_ENV === "test" ? "client_test_placeholder" : "");

if (!clientId) {
  throw new Error("WORKOS_CLIENT_ID must be set on Convex for WorkOS JWT validation.");
}

export default {
  providers: [
    {
      type: "customJwt",
      issuer: "https://api.workos.com/",
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
  ],
} satisfies AuthConfig;
