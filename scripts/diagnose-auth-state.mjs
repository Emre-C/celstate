/**
 * Diagnostic: connect to the running Chrome over CDP and dump everything we
 * need to figure out why the /auth ↔ /app redirect loop is happening.
 *
 * Reports:
 *  - All pages currently open and their URLs
 *  - All cookies for any *.celstate.com / celstate.com domain
 *  - The result of GET /api/auth/get-session executed inside the browser
 *  - The result of GET /api/auth/convex/token (mints the convex_jwt cookie)
 *  - Cookies again, after the /convex/token call
 *  - The result of GET /app executed inside the browser (final URL after redirects)
 */
import { chromium } from "@playwright/test";

const CDP_URL = process.env.CAPTURE_CDP_URL ?? "http://localhost:9222";
const SITE = "https://www.celstate.com";

const browser = await chromium.connectOverCDP(CDP_URL);
const contexts = browser.contexts();
console.log(`[diag] contexts: ${contexts.length}`);

for (const [i, ctx] of contexts.entries()) {
  const pages = ctx.pages();
  console.log(`\n[diag] context[${i}] pages: ${pages.length}`);
  for (const p of pages) {
    console.log(`[diag]   page url: ${p.url()}`);
  }

  const dumpCookies = async (label) => {
    const cookies = await ctx.cookies();
    const cel = cookies.filter((c) => c.domain.includes("celstate"));
    console.log(`\n[diag] ${label}: celstate cookies = ${cel.length}`);
    for (const c of cel) {
      console.log(
        `[diag]   ${c.name}  domain=${c.domain} path=${c.path} secure=${c.secure} httpOnly=${c.httpOnly} sameSite=${c.sameSite}`,
      );
    }
  };

  await dumpCookies("BEFORE /convex/token");

  const runner = pages[0] ?? (await ctx.newPage());

  console.log(`\n[diag] context[${i}] fetching ${SITE}/api/auth/get-session`);
  const sessionResult = await runner.evaluate(async (site) => {
    try {
      const r = await fetch(`${site}/api/auth/get-session`, {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      const text = await r.text();
      return { status: r.status, body: text.slice(0, 300) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, SITE);
  console.log(`[diag]   get-session: ${JSON.stringify(sessionResult)}`);

  console.log(`\n[diag] context[${i}] fetching ${SITE}/api/auth/convex/token to mint JWT cookie`);
  const tokenResult = await runner.evaluate(async (site) => {
    try {
      const r = await fetch(`${site}/api/auth/convex/token`, {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      const text = await r.text();
      const setCookieHeaders = [];
      // We can't see Set-Cookie from JS, but list response headers we can.
      r.headers.forEach((v, k) => setCookieHeaders.push(`${k}: ${v.slice(0, 80)}`));
      return { status: r.status, body: text.slice(0, 300), responseHeaders: setCookieHeaders };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, SITE);
  console.log(`[diag]   convex/token: ${JSON.stringify(tokenResult, null, 2)}`);

  await dumpCookies("AFTER /convex/token");

  console.log(`\n[diag] context[${i}] navigating to ${SITE}/app and reporting final URL`);
  try {
    const probe = await ctx.newPage();
    const resp = await probe.goto(`${SITE}/app`, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(`[diag]   /app status: ${resp?.status()} final url: ${probe.url()}`);
    await probe.close();
  } catch (e) {
    console.log(`[diag]   /app probe error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

await browser.close();
