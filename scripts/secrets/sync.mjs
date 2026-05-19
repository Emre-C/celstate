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
//   For each secret in the linked Doppler config, runs `convex env set --from-file … [--prod]`.
//   Prune is not supported: listing Convex env prints plaintext values (see AGENTS.md).
//
// Vercel target:
//   Syncs every PUBLIC_* name plus a fixed allowlist of SvelteKit **server** secrets
//   (WorkOS AuthKit + optional SENTRY_DSN). Backend-only secrets stay on Convex.
//   Production / development: `vercel env rm` then `vercel env add --value …`.
//   Preview: REST POST /v10/projects/{id}/env?upsert=true with gitBranch=null (CLI
//   cannot target all Preview branches non-interactively on Windows — see #15763).
//
// GitHub Actions target:
//   For each --secrets-listed name, runs `gh secret set NAME --body=<value>`
//   in the current repository (uses gh CLI auth).
//
// Never prints any secret value.

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, chmodSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { downloadSecrets, findDopplerBinary } from "./lib/doppler.mjs";

/** Non-PUBLIC secrets required on Vercel for `@workos/authkit-sveltekit` + server Sentry. */
const VERCEL_SERVER_SECRET_ALLOWLIST = /** @type {const} */ ([
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_REDIRECT_URI",
  "WORKOS_COOKIE_PASSWORD",
  "SENTRY_DSN",
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
function shouldSyncSecretToVercel(name) {
  if (name.startsWith("DOPPLER_")) return false;
  if (name.startsWith("PUBLIC_")) return true;
  return /** @type {readonly string[]} */ (VERCEL_SERVER_SECRET_ALLOWLIST).includes(name);
}

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

/** @returns {string} */
function readVercelCliToken() {
  const fromEnv = process.env.VERCEL_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const candidates = [
    join(homedir(), ".vercel", "auth.json"),
    process.env.APPDATA ? join(process.env.APPDATA, "com.vercel.cli", "Data", "auth.json") : "",
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (typeof j.token === "string" && j.token.length > 0) return j.token;
    } catch {
      /* missing file or invalid JSON */
    }
  }
  throw new Error(
    "Vercel auth missing: set VERCEL_TOKEN or run `vercel login` (creates ~/.vercel/auth.json).",
  );
}

/** @returns {{ projectId: string; orgId: string }} */
function readLinkedVercelProject() {
  const p = join(process.cwd(), ".vercel", "project.json");
  const j = JSON.parse(readFileSync(p, "utf8"));
  if (typeof j.projectId !== "string") {
    throw new Error(".vercel/project.json: missing projectId — run `vercel link` in the repo.");
  }
  if (typeof j.orgId !== "string") {
    throw new Error(".vercel/project.json: missing orgId (teamId) — run `vercel link`.");
  }
  return { projectId: j.projectId, orgId: j.orgId };
}

/**
 * @param {string} teamId
 * @param {string} projectId
 * @param {string} token
 * @param {string} key
 * @param {string} value
 */
async function upsertVercelPreviewEnv(teamId, projectId, token, key, value) {
  const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env`);
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("upsert", "true");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key,
      value,
      type: "plain",
      target: ["preview"],
      gitBranch: null,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vercel API HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
}

async function main() {
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
  const filtered = Object.fromEntries(
    Object.entries(dopplerSecrets).filter(([k, v]) => shouldSyncSecretToVercel(k) && v != null && v !== ""),
  );
  const names = Object.keys(filtered).sort();
  console.log(
    `Doppler config has ${names.length} secrets to sync to Vercel (${env}) (PUBLIC_* + server kit allowlist).`,
  );
  console.log(`  ${names.join(", ")}`);

  if (env === "preview") {
    if (dryRun) {
      for (const name of names) {
        console.log(`  [dry-run] Vercel API POST preview upsert ${name} (gitBranch=null)`);
      }
    } else {
      const token = readVercelCliToken();
      const { projectId, orgId } = readLinkedVercelProject();
      for (const name of names) {
        const value = filtered[name];
        await upsertVercelPreviewEnv(orgId, projectId, token, name, value);
        console.log(`  ✓ ${name}`);
      }
    }
  } else {
    for (const name of names) {
      const value = filtered[name];
      if (dryRun) {
        console.log(`  [dry-run] vercel env rm ${name} ${env}; vercel env add ${name} ${env}`);
        continue;
      }
      spawnSync("vercel", ["--non-interactive", "env", "rm", name, env, "--yes"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: useShell,
      });
      const addArgs = [
        "--non-interactive",
        "env",
        "add",
        name,
        env,
        "--value",
        value,
        "--yes",
        "--force",
      ];
      const addRes = spawnSync("vercel", addArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: useShell,
      });
      if (addRes.status !== 0) {
        const err = addRes.stderr?.toString().trim();
        const out = addRes.stdout?.toString().trim();
        if (addRes.error) {
          console.error(String(addRes.error));
        }
        if (out) {
          console.error(out);
        }
        if (err) {
          console.error(err);
        }
        console.error(`  ✗ ${name}: vercel env add failed`);
        process.exit(addRes.status ?? 1);
      }
      console.log(`  ✓ ${name}`);
    }
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
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
