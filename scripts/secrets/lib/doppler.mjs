// Shared helpers for Doppler CLI invocation.
// Detects the doppler binary across Windows winget / *nix PATH, and exposes
// safe wrappers that never echo secret values to stdout.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * @returns {string} Absolute path or bare name of the doppler executable.
 * @throws if the CLI cannot be located.
 */
export function findDopplerBinary() {
  if (process.env.DOPPLER_BIN && existsSync(process.env.DOPPLER_BIN)) {
    return process.env.DOPPLER_BIN;
  }

  const candidates = ["doppler"];

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      candidates.push(join(localAppData, "Microsoft", "WinGet", "Links", "doppler.exe"));
    }
    const programFiles = process.env["ProgramFiles"];
    if (programFiles) {
      candidates.push(join(programFiles, "Doppler", "doppler.exe"));
    }
  } else {
    candidates.push("/usr/local/bin/doppler", "/opt/homebrew/bin/doppler");
  }

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore", shell: false });
    if (probe.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    "doppler CLI not found. Install from https://docs.doppler.com/docs/cli, then retry. " +
      "If installed in a non-standard location, set DOPPLER_BIN=<path> and retry.",
  );
}

/**
 * Run doppler with the given args. Stdout is captured (never inherited) to
 * prevent secret values from leaking to the terminal. Stderr is forwarded.
 *
 * @param {string} bin Absolute path to doppler binary.
 * @param {string[]} args Argument vector.
 * @param {{ project?: string, config?: string, input?: string }} [options]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function runDoppler(bin, args, options = {}) {
  const finalArgs = [...args];
  if (options.project) {
    finalArgs.push("--project", options.project);
  }
  if (options.config) {
    finalArgs.push("--config", options.config);
  }

  const result = spawnSync(bin, finalArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    input: options.input,
  });

  return {
    status: result.status ?? -1,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

/**
 * Read all secrets from a Doppler config as a plain object. Values stay in
 * memory; the caller is responsible for handling them safely.
 *
 * @param {string} bin
 * @param {{ project: string, config: string }} target
 * @returns {Record<string, string>}
 */
export function downloadSecrets(bin, target) {
  const result = runDoppler(bin, ["secrets", "download", "--no-file", "--format", "json", "--silent"], target);
  if (result.status !== 0) {
    throw new Error(`doppler secrets download failed: ${result.stderr.trim() || "unknown error"}`);
  }
  /** @type {Record<string, string | { computed?: string }>} */
  const parsed = JSON.parse(result.stdout);
  /** @type {Record<string, string>} */
  const flat = {};
  for (const [name, raw] of Object.entries(parsed)) {
    if (typeof raw === "string") {
      flat[name] = raw;
    } else if (raw && typeof raw === "object" && typeof raw.computed === "string") {
      flat[name] = raw.computed;
    }
  }
  return flat;
}
