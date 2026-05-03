#!/usr/bin/env node
// Compare the set of secret NAMES (not values) between Convex prod and the
// linked Doppler config. Useful for safely auditing migrations without ever
// printing any secret value to stdout.
//
// Reads:
//   - Convex prod env via `convex env list --prod`. The output flows through
//     stdin into this process and never touches disk or stdout.
//   - Doppler config via the local Doppler CLI link (`doppler setup`).
//
// Outputs:
//   - Names present in Convex but missing in Doppler (need migration).
//   - Names present in Doppler but missing in Convex (will be added on sync).
//   - Names present in both (will be overwritten on sync).
//
// Never prints any secret value.

import { spawnSync } from "node:child_process";

import { findDopplerBinary, runDoppler } from "./lib/doppler.mjs";

function listConvexProdEnvNames() {
  const useShell = process.platform === "win32";
  // pnpm exec convex env list --prod
  const result = spawnSync(
    useShell ? "pnpm" : "pnpm",
    ["exec", "convex", "env", "list", "--prod"],
    { stdio: ["ignore", "pipe", "pipe"], shell: useShell },
  );
  if (result.status !== 0) {
    throw new Error(
      `convex env list --prod failed: ${result.stderr?.toString().trim() || "unknown error"}`,
    );
  }
  const stdout = result.stdout.toString();
  /** @type {Set<string>} */
  const names = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    // Match: NAME='value' or NAME="value" or NAME=value, where NAME is uppercase identifier.
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m) {
      const name = m[1];
      if (name === "DOPPLER_PROJECT" || name === "DOPPLER_CONFIG" || name === "DOPPLER_ENVIRONMENT") {
        continue;
      }
      names.add(name);
    }
  }
  return names;
}

function listDopplerNames() {
  const bin = findDopplerBinary();
  const res = runDoppler(bin, ["secrets", "--only-names", "--silent"]);
  if (res.status !== 0) {
    throw new Error(`doppler secrets --only-names failed: ${res.stderr.trim()}`);
  }
  /** @type {Set<string>} */
  const names = new Set();
  for (const line of res.stdout.split(/\r?\n/)) {
    // Doppler outputs a table; extract uppercase identifier per line.
    const m = /\b([A-Z][A-Z0-9_]+)\b/.exec(line);
    if (m) {
      const name = m[1];
      if (name === "NAME" || name.startsWith("DOPPLER_")) continue;
      names.add(name);
    }
  }
  return names;
}

const convex = listConvexProdEnvNames();
const doppler = listDopplerNames();

const onlyConvex = [...convex].filter((n) => !doppler.has(n)).sort();
const onlyDoppler = [...doppler].filter((n) => !convex.has(n)).sort();
const both = [...convex].filter((n) => doppler.has(n)).sort();

console.log(`Convex prod: ${convex.size} secrets`);
console.log(`Doppler prd: ${doppler.size} secrets`);
console.log("");
console.log(`In Convex only (NEED TO ADD TO DOPPLER): ${onlyConvex.length}`);
for (const n of onlyConvex) console.log(`  - ${n}`);
console.log("");
console.log(`In Doppler only (will be added to Convex on sync): ${onlyDoppler.length}`);
for (const n of onlyDoppler) console.log(`  + ${n}`);
console.log("");
console.log(`In both (will be overwritten in Convex on sync): ${both.length}`);
for (const n of both) console.log(`  = ${n}`);
