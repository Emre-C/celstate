#!/usr/bin/env node
// Rotate a GCP service account key:
//   1. Create a new JSON key via `gcloud iam service-accounts keys create`.
//   2. Validate the new JSON parses and contains the expected fields.
//   3. Upload the JSON to Doppler under VERTEX_AI_SERVICE_ACCOUNT_JSON.
//   4. Delete the old key from GCP by ID.
//   5. Securely remove the temp file from disk.
//
// Usage:
//   node scripts/secrets/gcp-rotate-sa-key.mjs \
//     --service-account=vertex-express@celstate-489304.iam.gserviceaccount.com \
//     --project=celstate-489304 \
//     --old-key-id=f849284b2044d1e688e95ee26a41b4df943d34c6 \
//     --doppler-secret=VERTEX_AI_SERVICE_ACCOUNT_JSON
//
// Requires gcloud CLI authed with iam.serviceAccountKeyAdmin on the target SA.

import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { findDopplerBinary, runDoppler } from "./lib/doppler.mjs";

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (!m) {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
    out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const required = ["service-account", "project", "old-key-id"];
for (const k of required) {
  if (!args[k]) {
    console.error(`Missing --${k}`);
    process.exit(2);
  }
}
const dopplerSecret = args["doppler-secret"] ?? "VERTEX_AI_SERVICE_ACCOUNT_JSON";

const serviceAccount = args["service-account"];
const project = args.project;
const oldKeyId = args["old-key-id"];

const tempPath = join(tmpdir(), `celstate-sa-${randomUUID()}.json`);

function gcloud(/** @type {string[]} */ cmd) {
  // On Windows, gcloud is a .cmd batch file; spawn requires shell: true to resolve it.
  // Args used by this script are static (no untrusted user input) so shell quoting is safe.
  const result = spawnSync("gcloud", cmd, {
    stdio: ["ignore", "pipe", "inherit"],
    shell: process.platform === "win32",
  });
  return { status: result.status ?? -1, stdout: result.stdout?.toString() ?? "" };
}

console.log(`Creating new key for ${serviceAccount}...`);
const create = gcloud([
  "iam",
  "service-accounts",
  "keys",
  "create",
  tempPath,
  `--iam-account=${serviceAccount}`,
  `--project=${project}`,
]);
if (create.status !== 0) {
  console.error("gcloud key create failed");
  process.exit(create.status);
}

let newKeyJson;
try {
  newKeyJson = JSON.parse(readFileSync(tempPath, "utf8"));
} catch (e) {
  console.error("Failed to parse new key JSON:", e);
  try {
    unlinkSync(tempPath);
  } catch {
    /* ignore */
  }
  process.exit(1);
}

if (
  newKeyJson.type !== "service_account" ||
  !newKeyJson.private_key ||
  !newKeyJson.private_key_id ||
  !newKeyJson.client_email
) {
  console.error("New SA key JSON is missing required fields; aborting before rotation.");
  try {
    unlinkSync(tempPath);
  } catch {
    /* ignore */
  }
  process.exit(1);
}

const newKeyId = newKeyJson.private_key_id;
console.log(`✓ New key created: ${newKeyId}`);

const bin = findDopplerBinary();

const uploadPayload = { [dopplerSecret]: JSON.stringify(newKeyJson) };
const uploadPath = join(tmpdir(), `celstate-sa-upload-${randomUUID()}.json`);
writeFileSync(uploadPath, JSON.stringify(uploadPayload), "utf8");
try {
  chmodSync(uploadPath, 0o600);
} catch {
  /* best effort on Windows */
}

let dopplerStatus = -1;
try {
  const res = runDoppler(bin, ["secrets", "upload", uploadPath, "--silent"]);
  dopplerStatus = res.status;
  if (res.status !== 0) {
    console.error(res.stderr.trim() || "doppler upload failed");
  }
} finally {
  try {
    unlinkSync(uploadPath);
  } catch {
    /* ignore */
  }
}

if (dopplerStatus !== 0) {
  console.error("Aborting before deleting old key — Doppler upload failed.");
  try {
    unlinkSync(tempPath);
  } catch {
    /* ignore */
  }
  process.exit(dopplerStatus);
}
console.log(`✓ Uploaded ${dopplerSecret} to Doppler`);

console.log(`Deleting old key ${oldKeyId}...`);
const del = gcloud([
  "iam",
  "service-accounts",
  "keys",
  "delete",
  oldKeyId,
  `--iam-account=${serviceAccount}`,
  `--project=${project}`,
  "--quiet",
]);
if (del.status !== 0) {
  console.error("gcloud key delete failed; new key already pushed to Doppler — review manually.");
  try {
    unlinkSync(tempPath);
  } catch {
    /* ignore */
  }
  process.exit(del.status);
}
console.log(`✓ Old key ${oldKeyId} deleted`);

try {
  unlinkSync(tempPath);
} catch {
  /* ignore */
}

console.log(`Rotation complete. New key id: ${newKeyId}`);
