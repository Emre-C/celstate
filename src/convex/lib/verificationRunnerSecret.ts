/**
 * Shared secret for production verification runners (HTTP ingest, internal canary probes).
 * Set on the Convex deployment: `npx convex env set VERIFICATION_RUNNER_SECRET <value>`.
 */

export const UNAUTHORIZED_MESSAGE = "Unauthorized" as const;

/**
 * Typed sentinel for runner-secret rejection. HTTP layer maps this to 401;
 * any other thrown error is a 400. Avoids string-matching the message.
 */
export class VerificationUnauthorizedError extends Error {
  readonly isVerificationUnauthorized = true as const;
  constructor() {
    super(UNAUTHORIZED_MESSAGE);
    this.name = "VerificationUnauthorizedError";
  }
}

export function isVerificationUnauthorizedError(error: unknown): boolean {
  return (
    error instanceof VerificationUnauthorizedError ||
    (error instanceof Error &&
      (error as { isVerificationUnauthorized?: boolean }).isVerificationUnauthorized === true)
  );
}

export function assertVerificationRunnerSecret(provided: string): void {
  const expected = process.env.VERIFICATION_RUNNER_SECRET?.trim();
  if (!expected || provided !== expected) {
    throw new VerificationUnauthorizedError();
  }
}
