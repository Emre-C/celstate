#!/usr/bin/env node
// Sync secrets from Doppler (source of truth) to a target environment.
//
// Usage:
//   node scripts/secrets/sync.mjs --target=convex --env=prod [--dry-run]
//   node scripts/secrets/sync.mjs --target=convex --env=dev
//   node scripts/secrets/sync.mjs --target=vercel --env=production [--dry-run]
//   node scripts/secrets/sync.mjs --target=github-actions --secrets=VERIFICATION_RUNNER_SECRET[,…]
//
// Convex target:
//   For each secret in the linked Doppler config, runs `convex env set NAME value [--prod]`.
//   By default, optionally PRUNES Convex env vars not present in Doppler with --prune.
//
// Vercel target:
//   For each secret in the linked Doppler config, runs `vercel env rm NAME --yes`
//   then `vercel env add NAME` piping the value via stdin.
//
// GitHub Actions target:
//   For each --secrets-listed name, runs `gh secret set NAME --body=<value>`
//   in the current repository (uses gh CLI auth).
//
// Never prints any secret value.

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { downloadSecrets, findDopplerBinary } from "./lib/doppler.mjs";

/**
 * Encode a Record<string, string> as a dotenv file using single-quoted values.
 * Single quotes are literal in dotenv (no escapes, no $ expansion), and most
 * dotenv parsers support multi-line single-quoted values. Values are scanned
 * for embedded `'` characters; if present, encoding falls back to double-quote
 * escaping.
 *
 * @param {Record<string, string>} entries
 * @returns {string}
 */
function encodeDotenv(entries) {
  const lines = [];
  for (const [name, value] of Object.entries(entries)) {
    if (!value.includes("'")) {
      lines.push(`${name}='${value}'`);
    } else {
      const escaped = value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\$/g, "\\$");
      lines.push(`${name}="${escaped}"`);
    }
  }
  return lines.join("\n") + "\n";
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (const a of argv) {
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 2) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (a.startsWith("--")) {
      out[a.slice(2)] = true;
    } else {
      console.error(`Unexpected positional arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const target = args.target;
if (target !== "convex" && target !== "vercel" && target !== "github-actions") {
  console.error(`--target=convex|vercel|github-actions required`);
  process.exit(2);
}

const dryRun = Boolean(args["dry-run"]);
const useShell = process.platform === "win32";

const bin = findDopplerBinary();

if (target === "convex") {
  const env = args.env;
  if (env !== "prod" && env !== "dev") {
    console.error(`--env=prod|dev required for convex target`);
    process.exit(2);
  }
  const prune = Boolean(args.prune);

  const dopplerSecrets = downloadSecrets(bin, {
    project: typeof args.project === "string" ? args.project : "",
    config: typeof args.config === "string" ? args.config : "",
  });
  // Convex is the backend runtime; it does NOT need PUBLIC_* vars (those are
  // only consumed by the SvelteKit client/server running on Vercel).
  const filtered = Object.fromEntries(
    Object.entries(dopplerSecrets).filter(
      ([k]) => !k.startsWith("DOPPLER_") && !k.startsWith("PUBLIC_"),
    ),
  );
  const names = Object.keys(filtered).sort();
  console.log(`Doppler config has ${names.length} non-PUBLIC secrets to sync to Convex (${env}).`);
  console.log(`  ${names.join(", ")}`);

  if (!dryRun) {
    // Bulk-write via --from-file to avoid commander treating values like PEM
    // headers as flags, and to make the sync atomic (--force overwrites).
    const tempPath = join(tmpdir(), `celstate-convex-sync-${randomUUID()}.env`);
    writeFileSync(tempPath, encodeDotenv(filtered), "utf8");
    try {
      chmodSync(tempPath, 0o600);
    } catch {
      /* best effort on Windows */
    }
    try {
      const setArgs = ["exec", "convex", "env", "set", "--from-file", tempPath, "--force"];
      if (env === "prod") setArgs.push("--prod");
      const result = spawnSync("pnpm", setArgs, {
        stdio: ["ignore", "inherit", "inherit"],
        shell: useShell,
      });
      if (result.status !== 0) {
        console.error(`convex env set --from-file failed`);
        process.exit(result.status ?? 1);
      }
    } finally {
      try {
        unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
  } else {
    console.log(`  [dry-run] convex env set --from-file <tmp.env> --force ${env === "prod" ? "--prod" : ""}`);
  }

  if (prune) {
    console.log("");
    console.log("Pruning Convex env vars not present in Doppler...");
    const dopplerNames = new Set(names);
    const list = spawnSync("pnpm", ["exec", "convex", "env", "list", env === "prod" ? "--prod" : ""].filter(Boolean), {
      stdio: ["ignore", "pipe", "pipe"],
      shell: useShell,
    });
    if (list.status !== 0) {
      console.error("convex env list failed; skipping prune step.");
    } else {
      /** @type {Set<string>} */
      const convexNames = new Set();
      for (const line of list.stdout.toString().split(/\r?\n/)) {
        const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
        if (m && !m[1].startsWith("DOPPLER_")) {
          convexNames.add(m[1]);
        }
      }
      const toRemove = [...convexNames].filter((n) => !dopplerNames.has(n));
      for (const name of toRemove) {
        if (dryRun) {
          console.log(`  [dry-run] convex env rm ${name} ${env === "prod" ? "--prod" : ""}`);
          continue;
        }
        const rmArgs = ["exec", "convex", "env", "remove", name];
        if (env === "prod") rmArgs.push("--prod");
        const r = spawnSync("pnpm", rmArgs, {
          stdio: ["ignore", "pipe", "inherit"],
          shell: useShell,
        });
        if (r.status !== 0) {
          console.error(`  ✗ ${name}: convex env remove failed`);
          process.exit(r.status ?? 1);
        }
        console.log(`  ✗ ${name} (removed)`);
      }
    }
  }

  console.log("");
  console.log(`Done. Synced ${names.length} secrets to Convex ${env}.`);
} else if (target === "vercel") {
  const env = args.env;
  if (env !== "production" && env !== "preview" && env !== "development") {
    console.error(`--env=production|preview|development required for vercel target`);
    process.exit(2);
  }

  const dopplerSecrets = downloadSecrets(bin, {
    project: typeof args.project === "string" ? args.project : "",
    config: typeof args.config === "string" ? args.config : "",
  });
  // Vercel only needs PUBLIC_* vars (browser-visible config). Backend secrets
  // live in Convex; pushing them to Vercel would expand the leak surface.
  const filtered = Object.fromEntries(
    Object.entries(dopplerSecrets).filter(
      ([k]) => !k.startsWith("DOPPLER_") && k.startsWith("PUBLIC_"),
    ),
  );
  const names = Object.keys(filtered).sort();
  console.log(`Doppler config has ${names.length} PUBLIC_* secrets to sync to Vercel (${env}).`);

  for (const name of names) {
    const value = filtered[name];
    if (dryRun) {
      console.log(`  [dry-run] vercel env rm ${name} ${env}; vercel env add ${name} ${env}`);
      continue;
    }
    // Best-effort remove (ignore failure if it doesn't exist)
    spawnSync("vercel", ["env", "rm", name, env, "--yes"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: useShell,
    });
    /** @type {import("node:child_process").SpawnSyncReturns<Buffer>} */
    const addRes = spawnSync("vercel", ["env", "add", name, env], {
      stdio: ["pipe", "pipe", "inherit"],
      shell: useShell,
      input: value + "\n",
    });
    if (addRes.status !== 0) {
      console.error(`  ✗ ${name}: vercel env add failed`);
      if (env === "preview") {
        console.error(`     Tip: \`vercel env add\` may interactively prompt for a Git branch on Preview`);
        console.error(`     and refuse the production branch (e.g. \`main\`). If that's the cause, set this`);
        console.error(`     variable via the Vercel dashboard (Settings → Environment Variables → enable`);
        console.error(`     Preview, save) or use the REST API with target: ["preview"] and a VERCEL_TOKEN.`);
        console.error(`     See docs/runbooks/PUBLIC-ENV-CHECKLIST.md (CLI note).`);
      }
      process.exit(addRes.status ?? 1);
    }
    console.log(`  ✓ ${name}`);
  }

  console.log("");
  console.log(`Done. Synced ${names.length} secrets to Vercel ${env}.`);
} else if (target === "github-actions") {
  const list = typeof args.secrets === "string" ? args.secrets.split(",").map((s) => s.trim()) : [];
  if (list.length === 0) {
    console.error("--secrets=NAME1,NAME2,... required for github-actions target");
    process.exit(2);
  }

  const dopplerSecrets = downloadSecrets(bin, {
    project: typeof args.project === "string" ? args.project : "",
    config: typeof args.config === "string" ? args.config : "",
  });

  for (const name of list) {
    if (!(name in dopplerSecrets)) {
      console.error(`  ✗ ${name}: not present in Doppler config`);
      process.exit(1);
    }
    const value = dopplerSecrets[name];
    if (dryRun) {
      console.log(`  [dry-run] gh secret set ${name}`);
      continue;
    }
    const set = spawnSync("gh", ["secret", "set", name, "--body", value], {
      stdio: ["ignore", "pipe", "inherit"],
      shell: useShell,
    });
    if (set.status !== 0) {
      console.error(`  ✗ ${name}: gh secret set failed`);
      process.exit(set.status ?? 1);
    }
    console.log(`  ✓ ${name}`);
  }

  console.log("");
  console.log(`Done. Synced ${list.length} secrets to GitHub Actions.`);
}
