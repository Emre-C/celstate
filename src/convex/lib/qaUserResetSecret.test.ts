import { describe, expect, it } from "vitest";
import { CANARY_PRINCIPAL_CONFIG } from "../../lib/production-confidence.js";
import {
  assertEmailAllowlistedForQaReset,
  assertQaUserResetSecret,
  parseQaUserResetAllowlist,
  QaUserResetUnauthorizedError,
} from "./qaUserResetSecret.js";

describe("parseQaUserResetAllowlist", () => {
  it("returns empty when unset or blank", () => {
    expect(parseQaUserResetAllowlist(undefined)).toEqual([]);
    expect(parseQaUserResetAllowlist("")).toEqual([]);
    expect(parseQaUserResetAllowlist("  ,  ")).toEqual([]);
  });

  it("trims and lowercases", () => {
    expect(parseQaUserResetAllowlist(" A@B.C , X@Y.Z ")).toEqual(["a@b.c", "x@y.z"]);
  });
});

describe("assertQaUserResetSecret", () => {
  it("rejects when env secret is missing", () => {
    const prev = process.env.QA_USER_RESET_SECRET;
    delete process.env.QA_USER_RESET_SECRET;
    expect(() => assertQaUserResetSecret("x")).toThrow(QaUserResetUnauthorizedError);
    process.env.QA_USER_RESET_SECRET = prev;
  });

  it("accepts matching secret", () => {
    const prev = process.env.QA_USER_RESET_SECRET;
    process.env.QA_USER_RESET_SECRET = "test-secret";
    expect(() => assertQaUserResetSecret("test-secret")).not.toThrow();
    process.env.QA_USER_RESET_SECRET = prev;
  });
});

describe("assertEmailAllowlistedForQaReset", () => {
  it("rejects when allowlist env is empty", () => {
    const prev = process.env.QA_USER_RESET_ALLOWED_EMAILS;
    delete process.env.QA_USER_RESET_ALLOWED_EMAILS;
    expect(() => assertEmailAllowlistedForQaReset("a@b.c")).toThrow(QaUserResetUnauthorizedError);
    process.env.QA_USER_RESET_ALLOWED_EMAILS = prev;
  });

  it("rejects email not in list", () => {
    const prev = process.env.QA_USER_RESET_ALLOWED_EMAILS;
    process.env.QA_USER_RESET_ALLOWED_EMAILS = "only@example.com";
    expect(() => assertEmailAllowlistedForQaReset("other@example.com")).toThrow(
      QaUserResetUnauthorizedError,
    );
    process.env.QA_USER_RESET_ALLOWED_EMAILS = prev;
  });

  it("accepts listed email", () => {
    const prev = process.env.QA_USER_RESET_ALLOWED_EMAILS;
    process.env.QA_USER_RESET_ALLOWED_EMAILS = "qa@example.com, other@example.com";
    expect(() => assertEmailAllowlistedForQaReset("qa@example.com")).not.toThrow();
    process.env.QA_USER_RESET_ALLOWED_EMAILS = prev;
  });

  it("refuses canary principal emails", () => {
    // Derive the canary email from the live config so the test stays correct
    // even when CANARY_PRINCIPAL_CONFIG is repointed (e.g. all four principals
    // sharing one Google QA account because production is Google-OAuth only).
    const canaryEmail = CANARY_PRINCIPAL_CONFIG.CANARY_AUTH.email.toLowerCase();
    const prev = process.env.QA_USER_RESET_ALLOWED_EMAILS;
    process.env.QA_USER_RESET_ALLOWED_EMAILS = canaryEmail;
    expect(() => assertEmailAllowlistedForQaReset(canaryEmail)).toThrow(
      "canary principal",
    );
    process.env.QA_USER_RESET_ALLOWED_EMAILS = prev;
  });
});
