/**
 * Gate for wiping an allowlisted QA email from Convex app tables.
 * Convex env: `QA_USER_RESET_SECRET`, `QA_USER_RESET_ALLOWED_EMAILS` (comma-separated).
 */

import { CANARY_PRINCIPAL_CONFIG } from "../../lib/production-confidence.js";

export const UNAUTHORIZED_MESSAGE = "Unauthorized" as const;

export class QaUserResetUnauthorizedError extends Error {
  readonly isQaUserResetUnauthorized = true as const;
  constructor(message: string = UNAUTHORIZED_MESSAGE) {
    super(message);
    this.name = "QaUserResetUnauthorizedError";
  }
}

export function isQaUserResetUnauthorizedError(error: unknown): boolean {
  return (
    error instanceof QaUserResetUnauthorizedError ||
    (error instanceof Error && (error as { isQaUserResetUnauthorized?: boolean }).isQaUserResetUnauthorized === true)
  );
}

export function parseQaUserResetAllowlist(envValue: string | undefined): string[] {
  if (envValue === undefined || envValue.trim() === "") {
    return [];
  }
  return envValue
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function listCanaryPrincipalEmailsLowercased(): string[] {
  return Object.values(CANARY_PRINCIPAL_CONFIG).map((c) => c.email.toLowerCase());
}

export function assertQaUserResetSecret(provided: string): void {
  const expected = process.env.QA_USER_RESET_SECRET?.trim();
  if (!expected || provided !== expected) {
    throw new QaUserResetUnauthorizedError();
  }
}

export function assertEmailAllowlistedForQaReset(normalizedEmail: string): void {
  const allowed = parseQaUserResetAllowlist(process.env.QA_USER_RESET_ALLOWED_EMAILS);
  if (allowed.length === 0) {
    throw new QaUserResetUnauthorizedError("QA_USER_RESET_ALLOWED_EMAILS is not configured");
  }
  if (!allowed.includes(normalizedEmail)) {
    throw new QaUserResetUnauthorizedError();
  }
  if (listCanaryPrincipalEmailsLowercased().includes(normalizedEmail)) {
    throw new Error("Refusing to reset a canary principal email");
  }
}
