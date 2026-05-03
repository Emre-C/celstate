/**
 * Capture a Playwright storageState by attaching to a real Chrome instance over CDP.
 *
 * Why CDP: Playwright's bundled Chromium is fingerprinted by Google (navigator.webdriver,
 * etc.) and blocked at OAuth. Real Chrome with --remote-debugging-port enabled looks
 * like a normal browser to web pages — the CDP port is server-side and invisible.
 * We attach Playwright after sign-in completes and dump cookies + origins in the exact
 * shape probeProtectedRoute (scripts/production-verification.ts) expects.
 *
 * Usage:
 *   1. Launch Chrome with: --remote-debugging-port=9222 --user-data-dir=<throwaway dir>
 *   2. Sign in to https://www.celstate.com via Google in that Chrome window.
 *   3. Run: node scripts/capture-storage-state.mjs
 *
 * Output: secrets-local/auth-canary-storage.json (gitignored)
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CDP_URL = process.env.CAPTURE_CDP_URL ?? "http://localhost:9222";
const OUT_PATH = process.env.CAPTURE_OUT_PATH ?? "secrets-local/auth-canary-storage.json";
const REQUIRED_HOST_FRAGMENT = "celstate.com";

const absOut = resolve(OUT_PATH);
mkdirSync(dirname(absOut), { recursive: true });

console.log(`[capture] connecting to Chrome over CDP at ${CDP_URL}`);
const browser = await chromium.connectOverCDP(CDP_URL);

const contexts = browser.contexts();
if (contexts.length === 0) {
  console.error("[capture] FATAL: Chrome reported zero browser contexts. Is the window still open?");
  process.exit(1);
}
console.log(`[capture] found ${contexts.length} context(s); using contexts[0]`);
const context = contexts[0];

const state = await context.storageState({ path: absOut });

const celstateCookies = state.cookies.filter((c) => c.domain.includes(REQUIRED_HOST_FRAGMENT));
const celstateOrigins = state.origins.filter((o) => o.origin.includes(REQUIRED_HOST_FRAGMENT));

console.log(`\n[capture] wrote ${absOut}`);
console.log(`[capture] total cookies: ${state.cookies.length}, celstate.com cookies: ${celstateCookies.length}`);
for (const c of celstateCookies) {
  console.log(
    `[capture]   cookie: ${c.name}  domain=${c.domain} path=${c.path} secure=${c.secure} httpOnly=${c.httpOnly} sameSite=${c.sameSite} expires=${c.expires === -1 ? "session" : new Date(c.expires * 1000).toISOString()}`,
  );
}
console.log(`[capture] total origins: ${state.origins.length}, celstate origins: ${celstateOrigins.length}`);
for (const o of celstateOrigins) {
  console.log(`[capture]   origin: ${o.origin} (${o.localStorage.length} localStorage entries)`);
}

await browser.close(); // CDP: disconnects Playwright client, Chrome stays running

const sessionCookieCandidates = celstateCookies.filter(
  (c) => c.name.startsWith("better-auth.session") || c.name.includes("session"),
);
if (celstateCookies.length === 0) {
  console.error("\n[capture] FATAL: no cookies found for celstate.com — sign-in did not happen in this Chrome instance.");
  process.exit(2);
}
if (sessionCookieCandidates.length === 0) {
  console.error("\n[capture] WARNING: no session-shaped cookie found among celstate.com cookies.");
  console.error("[capture] Better Auth typically sets `better-auth.session_token` (and optionally `better-auth.session_data`).");
  console.error("[capture] The file was still written; verify it works before trusting it.");
  process.exit(3);
}
console.log(`\n[capture] OK — session cookie present (${sessionCookieCandidates.map((c) => c.name).join(", ")})`);
