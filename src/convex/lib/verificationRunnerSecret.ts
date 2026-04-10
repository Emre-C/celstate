/**
 * Shared secret for production verification runners (HTTP ingest, internal canary probes).
 * Set on the Convex deployment: `npx convex env set VERIFICATION_RUNNER_SECRET <value>`.
 */
export function assertVerificationRunnerSecret(provided: string): void {
  const expected = process.env.VERIFICATION_RUNNER_SECRET?.trim();
  if (!expected || provided !== expected) {
    throw new Error("Unauthorized");
  }
}
