#!/usr/bin/env node
// One-time helper: pull PUBLIC_* env vars from Vercel production and upload
// them to Doppler so Doppler becomes the source of truth.
//
// Usage:
//   node scripts/secrets/import-vercel.mjs [--env=production]
//
// Filters out Vercel's runtime metadata (NX_*, TURBO_*, VERCEL_*) and only
// migrates user-configured PUBLIC_* variables.

import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { findDopplerBinary, runDoppler } from "./lib/doppler.mjs";

const env = process.argv.includes("--env=preview") ? "preview" : "production";
const useShell = process.platform === "win32";

const pullPath = join(tmpdir(), `celstate-vercel-pull-${randomUUID()}.env`);

console.log(`Pulling ${env} env from Vercel...`);
const pull = spawnSync("vercel", ["env", "pull", pullPath, `--environment=${env}`, "--yes"], {
  stdio: ["ignore", "pipe", "inherit"],
  shell: useShell,
});
if (pull.status !== 0) {
  console.error("vercel env pull failed");
  process.exit(pull.status ?? 1);
}

let raw = "";
try {
  raw = readFileSync(pullPath, "utf8");
} catch (e) {
  console.error("Failed to read pulled file:", e);
  process.exit(1);
}

/** @type {Record<string, string>} */
const out = {};
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const m = /^([A-Z_][A-Z0-9_]*)=([\s\S]*)$/.exec(line);
  if (!m) continue;
  const name = m[1];
  if (!name.startsWith("PUBLIC_")) continue;
  let value = m[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  out[name] = value;
}

console.log(`Filtered to ${Object.keys(out).length} PUBLIC_* names: ${Object.keys(out).sort().join(", ")}`);

if (Object.keys(out).length === 0) {
  console.error("No PUBLIC_* vars found; nothing to upload.");
  unlinkSync(pullPath);
  process.exit(0);
}

const uploadPath = join(tmpdir(), `celstate-vercel-upload-${randomUUID()}.json`);
writeFileSync(uploadPath, JSON.stringify(out), "utf8");
try {
  chmodSync(uploadPath, 0o600);
} catch {
  /* best effort */
}

const bin = findDopplerBinary();
try {
  const res = runDoppler(bin, ["secrets", "upload", uploadPath, "--silent"]);
  if (res.status !== 0) {
    console.error(res.stderr.trim() || "doppler upload failed");
    process.exit(res.status);
  }
  console.log(`Uploaded ${Object.keys(out).length} vars to Doppler.`);
} finally {
  try {
    unlinkSync(uploadPath);
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(pullPath);
  } catch {
    /* ignore */
  }
}
