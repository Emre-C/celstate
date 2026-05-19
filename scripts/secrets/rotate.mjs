#!/usr/bin/env node
// Generate fresh values for auto-rotatable secrets and upload them to Doppler.
// Never writes plaintext to disk persistently; the temp upload file is created
// in the OS temp dir with mode 0o600 and deleted immediately after upload.
//
// Usage:
//   node scripts/secrets/rotate.mjs                 # rotate all auto-rotatable
//   node scripts/secrets/rotate.mjs JWT WORKOS_COOKIE # rotate only listed groups
//
// Available rotation groups:
//   - jwt                         : JWT_PRIVATE_KEY + JWKS (RSA-2048, kid=uuid)
//   - workos-cookie-password      : WORKOS_COOKIE_PASSWORD (32 random bytes, base64)
//   - verification-runner-secret  : VERIFICATION_RUNNER_SECRET (32 random bytes)
//   - qa-user-reset-secret        : QA_USER_RESET_SECRET (32 random bytes)
//
// Reads --project / --config from Doppler local config (`doppler setup`).

import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findDopplerBinary, runDoppler } from "./lib/doppler.mjs";

const GROUPS = {
  jwt: () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    /** @type {Record<string, unknown>} */
    const jwk = /** @type {Record<string, unknown>} */ (publicKey.export({ format: "jwk" }));
    jwk.use = "sig";
    jwk.alg = "RS256";
    jwk.kid = randomUUID();
    return {
      JWT_PRIVATE_KEY: pem,
      JWKS: JSON.stringify({ keys: [jwk] }),
    };
  },
  "workos-cookie-password": () => ({
    WORKOS_COOKIE_PASSWORD: randomBytes(32).toString("base64"),
  }),
  "verification-runner-secret": () => ({
    VERIFICATION_RUNNER_SECRET: randomBytes(32).toString("base64"),
  }),
  "qa-user-reset-secret": () => ({
    QA_USER_RESET_SECRET: randomBytes(32).toString("base64"),
  }),
};

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {string[]} */
  const groups = [];
  /** @type {{ project: string | undefined, config: string | undefined }} */
  const flags = { project: undefined, config: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Support both `--name value` and `--name=value` forms.
    const eq = a.indexOf("=");
    const flagName = a.startsWith("--") ? (eq > 2 ? a.slice(2, eq) : a.slice(2)) : null;
    const inlineValue = eq > 2 ? a.slice(eq + 1) : undefined;
    if (flagName === "project") {
      flags.project = inlineValue ?? argv[++i];
    } else if (flagName === "config") {
      flags.config = inlineValue ?? argv[++i];
    } else if (flagName !== null) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else {
      groups.push(a);
    }
  }
  return { groups, flags };
}

const { groups: requested, flags } = parseArgs(process.argv.slice(2));
const groups = requested.length > 0 ? requested : Object.keys(GROUPS);

for (const g of groups) {
  if (!(g in GROUPS)) {
    console.error(`Unknown rotation group: ${g}`);
    console.error(`Available: ${Object.keys(GROUPS).join(", ")}`);
    process.exit(2);
  }
}

const bin = findDopplerBinary();

/** @type {Record<string, string>} */
const secrets = {};
for (const g of groups) {
  const fn = GROUPS[/** @type {keyof typeof GROUPS} */ (g)];
  Object.assign(secrets, fn());
}

const tempPath = join(tmpdir(), `celstate-rotate-${randomUUID()}.json`);
writeFileSync(tempPath, JSON.stringify(secrets), "utf8");
try {
  chmodSync(tempPath, 0o600);
} catch {
  // best-effort on Windows; OS temp dir already has user-only ACLs.
}

try {
  const result = runDoppler(
    bin,
    ["secrets", "upload", tempPath, "--silent"],
    {
      project: flags.project,
      config: flags.config,
    },
  );
  if (result.status !== 0) {
    console.error(result.stderr.trim() || "doppler secrets upload failed");
    process.exit(result.status);
  }
} finally {
  try {
    unlinkSync(tempPath);
  } catch {
    /* ignore */
  }
}

console.log(
  `Rotated and uploaded to Doppler: ${Object.keys(secrets).sort().join(", ")}`,
);
