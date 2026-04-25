import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  UNAUTHORIZED_MESSAGE,
  VerificationUnauthorizedError,
  assertVerificationRunnerSecret,
  isVerificationUnauthorizedError,
} from "./verificationRunnerSecret.js";

const ORIGINAL = process.env.VERIFICATION_RUNNER_SECRET;

describe("VerificationUnauthorizedError", () => {
  it("carries the shared UNAUTHORIZED_MESSAGE constant", () => {
    const err = new VerificationUnauthorizedError();
    expect(err.message).toBe(UNAUTHORIZED_MESSAGE);
    expect(err.name).toBe("VerificationUnauthorizedError");
  });

  it("isVerificationUnauthorizedError detects the typed instance", () => {
    expect(isVerificationUnauthorizedError(new VerificationUnauthorizedError())).toBe(true);
  });

  it("isVerificationUnauthorizedError detects a plain Error duck-typed across boundaries", () => {
    // Convex serializes errors across runMutation boundaries — the prototype chain is
    // lost but the brand property survives if it was added directly. We accept either.
    const branded = new Error(UNAUTHORIZED_MESSAGE) as Error & { isVerificationUnauthorized?: boolean };
    branded.isVerificationUnauthorized = true;
    expect(isVerificationUnauthorizedError(branded)).toBe(true);
  });

  it("isVerificationUnauthorizedError rejects unrelated errors", () => {
    expect(isVerificationUnauthorizedError(new Error("something else"))).toBe(false);
    expect(isVerificationUnauthorizedError("string-error")).toBe(false);
    expect(isVerificationUnauthorizedError(undefined)).toBe(false);
    expect(isVerificationUnauthorizedError(null)).toBe(false);
  });
});

describe("assertVerificationRunnerSecret", () => {
  beforeEach(() => {
    process.env.VERIFICATION_RUNNER_SECRET = "expected-secret";
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.VERIFICATION_RUNNER_SECRET;
    else process.env.VERIFICATION_RUNNER_SECRET = ORIGINAL;
  });

  it("returns silently when the provided value matches the env secret", () => {
    expect(() => assertVerificationRunnerSecret("expected-secret")).not.toThrow();
  });

  it("throws VerificationUnauthorizedError when the value does not match", () => {
    expect(() => assertVerificationRunnerSecret("wrong-secret")).toThrow(VerificationUnauthorizedError);
  });

  it("throws when the env secret is unset, even if provided is non-empty", () => {
    delete process.env.VERIFICATION_RUNNER_SECRET;
    expect(() => assertVerificationRunnerSecret("anything")).toThrow(VerificationUnauthorizedError);
  });

  it("throws on empty provided value", () => {
    expect(() => assertVerificationRunnerSecret("")).toThrow(VerificationUnauthorizedError);
  });

  it("throws Error subclass that carries UNAUTHORIZED_MESSAGE", () => {
    try {
      assertVerificationRunnerSecret("nope");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(VerificationUnauthorizedError);
      expect((e as Error).message).toBe(UNAUTHORIZED_MESSAGE);
    }
  });
});
