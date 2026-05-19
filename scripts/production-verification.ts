/**
 * Production verification runner — exercises AUTH, GENERATION, CHECKOUT_SESSION,
 * and optionally LIVE_SETTLEMENT (scheduled), then ingests results into Convex.
 *
 * Required:
 *   VERIFICATION_RUNNER_SECRET — matches Convex env VERIFICATION_RUNNER_SECRET
 *   CONVEX_URL — deployment URL (https://*.convex.cloud); HTTP host is derived to *.convex.site
 *
 * Optional:
 *   CONVEX_HTTP_VERIFICATION_URL — override HTTP base (default: CONVEX_URL with .convex.site)
 *   VERIFICATION_TRIGGER — POST_DEPLOY | SCHEDULED (default POST_DEPLOY)
 *   AUTH_CANARY_BASE_URL — site URL for auth probes (default PUBLIC_SITE_URL or AUTH_CANARY_BASE_URL)
 *   AUTH_CANARY_REQUIRE_PROTECTED_ROUTE — if "true", require AUTH_CANARY_PROTECTED_STORAGE_STATE
 *   AUTH_CANARY_PROTECTED_STORAGE_STATE — path to Playwright storageState JSON for /app
 *   GITHUB_SHA, VERCEL_GIT_COMMIT_SHA — recorded on the run
 */

import { readFileSync, existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import {
  AUTH_CANARY_PROBE,
  AUTH_CANARY_PROBE_TIMEOUT_MS,
  formatAuthCanaryProbeFailure,
  isFinalGetSessionProbeOk,
} from "./auth-canary-probe.mjs";
import {
  classifyAuthProbeVerdict,
  classifyCheckoutProbeVerdict,
  classifyGenerationOutcome,
  classifyLiveSettlementVerdict,
  classifySettlementOutcome,
  createEvidenceRef,
  createRunKey,
  evaluateReleaseDecision,
  getRequirementClass,
  type AuthCanaryEvidence,
  type CheckoutSessionCanaryEvidence,
  type DomainVerdictRecord,
  type FeatureDomain,
  type GenerationCanaryEvidence,
  type LiveSettlementCanaryEvidence,
  type CanaryPrincipalId,
  type SettlementOutcome,
  type VerificationTrigger,
} from "../src/lib/production-confidence.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- Polling deadlines and intervals (tunable runner constants) ---
//
// These are upper bounds on how long the runner will wait for an asynchronous
// observation before declaring TIMEOUT. They are NOT contract values — increasing
// them never makes a healthy run fail; decreasing them risks false TIMEOUTs.

const PLAYWRIGHT_NAVIGATION_TIMEOUT_MS = 30_000;
const PLAYWRIGHT_PAY_BUTTON_TIMEOUT_MS = 15_000;
const PLAYWRIGHT_REDIRECT_AWAY_TIMEOUT_MS = 60_000;

const GENERATION_POLL_DEADLINE_MS = 5 * 60_000;
const GENERATION_POLL_INTERVAL_MS = 5_000;

const CHECKOUT_POLL_DEADLINE_MS = 90_000;
const CHECKOUT_POLL_INTERVAL_MS = 2_000;

const SETTLEMENT_POLL_DEADLINE_MS = 3 * 60_000;
const SETTLEMENT_POLL_INTERVAL_MS = 5_000;

const REFUND_POLL_DEADLINE_MS = 30_000;
const REFUND_POLL_INTERVAL_MS = 2_000;

interface RunnerEnv {
  readonly runnerSecret: string;
  readonly convexHttpBase: string;
  readonly siteUrl: string;
  readonly trigger: VerificationTrigger;
  readonly deploymentId?: string;
  readonly gitSha?: string;
  readonly workflowRunId?: string;
  readonly storagePath?: string;
  readonly requireProtectedRoute: boolean;
}

function readTrigger(): VerificationTrigger {
  const t = process.env.VERIFICATION_TRIGGER?.trim().toUpperCase();
  if (t === "SCHEDULED" || t === "POST_DEPLOY" || t === "PRE_MERGE_CI") {
    return t;
  }
  return "POST_DEPLOY";
}

function deriveConvexHttpBase(missing: string[]): string {
  const explicit = process.env.CONVEX_HTTP_VERIFICATION_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const convexUrl = process.env.CONVEX_URL?.trim();
  if (!convexUrl) {
    missing.push("CONVEX_URL or CONVEX_HTTP_VERIFICATION_URL");
    return "";
  }
  if (!convexUrl.includes(".convex.cloud")) {
    throw new Error(
      "CONVEX_URL must be a *.convex.cloud deployment URL for HTTP derivation, " +
        "or set CONVEX_HTTP_VERIFICATION_URL explicitly",
    );
  }
  return convexUrl.replace(".convex.cloud", ".convex.site");
}

/**
 * Validate every input the runner depends on up front. Fail fast with a single
 * error listing every missing variable, instead of failing deep inside a probe.
 */
function readRunnerEnv(): RunnerEnv {
  const missing: string[] = [];

  const runnerSecret = process.env.VERIFICATION_RUNNER_SECRET?.trim();
  if (!runnerSecret) missing.push("VERIFICATION_RUNNER_SECRET");

  const convexHttpBase = deriveConvexHttpBase(missing);

  const siteUrl =
    process.env.AUTH_CANARY_BASE_URL?.trim() ||
    process.env.PUBLIC_SITE_URL?.trim() ||
    "";
  if (!siteUrl) missing.push("AUTH_CANARY_BASE_URL or PUBLIC_SITE_URL");

  if (missing.length > 0) {
    throw new Error(
      `Production verification runner is missing required environment variables: ${missing.join(", ")}`,
    );
  }

  const trigger = readTrigger();
  const requireProtectedRoute =
    trigger !== "PRE_MERGE_CI" &&
    process.env.AUTH_CANARY_REQUIRE_PROTECTED_ROUTE !== "false";

  return {
    runnerSecret: runnerSecret!,
    convexHttpBase,
    siteUrl,
    trigger,
    deploymentId:
      process.env.VERCEL_DEPLOYMENT_ID?.trim() ||
      process.env.GITHUB_RUN_ID?.trim() ||
      undefined,
    gitSha:
      process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
      process.env.GITHUB_SHA?.trim() ||
      undefined,
    workflowRunId: process.env.GITHUB_RUN_ID?.trim() || undefined,
    storagePath: process.env.AUTH_CANARY_PROTECTED_STORAGE_STATE?.trim() || undefined,
    requireProtectedRoute,
  };
}

async function convexHttp(env: RunnerEnv, path: string, init: RequestInit): Promise<Response> {
  const url = `${env.convexHttpBase}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.runnerSecret}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

function record(
  domain: FeatureDomain,
  trigger: VerificationTrigger,
  verdict: DomainVerdictRecord["verdict"],
  evidenceRef: string,
  startedAt: number,
  extras: { note?: string; settlementOutcome?: SettlementOutcome } = {},
): DomainVerdictRecord {
  return {
    domain,
    trigger,
    requirement: getRequirementClass(domain, trigger),
    verdict,
    evidenceRef,
    startedAt,
    finishedAt: Date.now(),
    ...(extras.note !== undefined && { note: extras.note }),
    ...(extras.settlementOutcome !== undefined && { settlementOutcome: extras.settlementOutcome }),
  };
}

async function probeAuthSmoke(baseUrl: string): Promise<{
  authPageHealthy: boolean;
  sessionEndpointHealthy: boolean;
}> {
  const normalized = baseUrl.replace(/\/$/, "");
  const joinUrl = (p: string) => `${normalized}${p}`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), AUTH_CANARY_PROBE_TIMEOUT_MS);
  try {
    const authRes = await fetch(joinUrl("/auth"), {
      headers: { accept: "text/html" },
      signal: ac.signal,
    });
    if (!authRes.ok) {
      throw new Error(`/auth returned ${authRes.status}`);
    }
    const html = await authRes.text();
    if (!html.includes('data-testid="auth-page"')) {
      throw new Error("auth page marker missing");
    }
    if (!html.includes('data-testid="auth-workos-sign-in"')) {
      throw new Error("auth page WorkOS sign-in marker missing");
    }
  } finally {
    clearTimeout(t);
  }

  const sc = new AbortController();
  const t2 = setTimeout(() => sc.abort(), AUTH_CANARY_PROBE_TIMEOUT_MS);
  try {
    const sessionRes = await fetch(joinUrl("/api/auth/session"), {
      headers: { accept: "application/json" },
      signal: sc.signal,
    });
    if (!isFinalGetSessionProbeOk(sessionRes.status)) {
      throw new Error(`/api/auth/session returned ${sessionRes.status}`);
    }
    const ct = sessionRes.headers.get("content-type")?.toLowerCase() ?? "";
    if (!ct.includes("application/json")) {
      throw new Error(`/api/auth/session returned unexpected content-type: ${ct || "missing"}`);
    }
    const sessionBody = (await sessionRes.json()) as { authenticated?: unknown };
    if (typeof sessionBody.authenticated !== "boolean") {
      throw new Error("/api/auth/session JSON missing boolean authenticated");
    }
  } finally {
    clearTimeout(t2);
  }

  return { authPageHealthy: true, sessionEndpointHealthy: true };
}

async function probeWorkOsProtectedRoute(
  baseUrl: string,
  storageStatePath: string,
): Promise<{
  protectedRouteReachable: boolean;
  convexAuthenticatedQueryHealthy: boolean;
}> {
  const raw = readFileSync(storageStatePath, "utf-8");
  const storageState = JSON.parse(raw);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState });
  try {
    const page = await context.newPage();
    const normalized = baseUrl.replace(/\/$/, "");
    const response = await page.goto(`${normalized}/app`, {
      waitUntil: "domcontentloaded",
      timeout: PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
    });
    if (!response?.ok()) {
      throw new Error(`[protected_route] /app returned ${response?.status() ?? "no response"}`);
    }
    const finalPath = new URL(page.url()).pathname;
    if (!finalPath.startsWith("/app")) {
      throw new Error(`[protected_route] expected /app, got ${finalPath}`);
    }

    const convexReady = await page.evaluate(async () => {
      const r = await fetch(`${window.location.origin}/api/auth/convex-ready`, {
        credentials: "include",
      });
      let body: unknown = {};
      try {
        body = await r.json();
      } catch {
        /* ignore */
      }
      return { status: r.status, body };
    });
    const convexOk =
      convexReady.status === 200 &&
      typeof convexReady.body === "object" &&
      convexReady.body !== null &&
      (convexReady.body as { ok?: boolean }).ok === true;
    if (!convexOk) {
      throw new Error(`[convex_ready] status=${convexReady.status} body=${JSON.stringify(convexReady.body)}`);
    }

    return {
      protectedRouteReachable: true,
      convexAuthenticatedQueryHealthy: true,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close();
  }
}

/**
 * Lightweight sign-out smoke test that does NOT burn a persistent WorkOS session.
 * It verifies the /sign-out endpoint returns a redirect (302) and the logout URL
 * is well-formed, without invalidating any server-side session state.
 */
async function probeAuthSignOutSmoke(baseUrl: string): Promise<boolean> {
  const normalized = baseUrl.replace(/\/$/, "");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetch(`${normalized}/sign-out`, {
      method: "GET",
      redirect: "manual",
      signal: ac.signal,
    });
    // /sign-out should always redirect (302 to WorkOS logout, or via SDK)
    if (res.status !== 302) {
      throw new Error(`[sign_out_smoke] expected 302, got ${res.status}`);
    }
    const location = res.headers.get("location") ?? "";
    if (!location) {
      throw new Error("[sign_out_smoke] missing Location header on 302");
    }
    return true;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Drive the Stripe hosted checkout flow to completion. Throws (rather than
 * returning false) so callers see the underlying selector / navigation /
 * timeout error in the verdict's note instead of an opaque "payment failed".
 */
async function automateStripeCheckout(checkoutUrl: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(checkoutUrl, {
      waitUntil: "networkidle",
      timeout: PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
    });

    // Stripe hosted checkout: find the submit/pay button.
    // Multiple selectors for resilience across Stripe UI revisions.
    const payButton = page.locator('[data-testid="hosted-payment-submit-button"]')
      .or(page.locator(".SubmitButton"))
      .or(page.getByRole("button", { name: /pay/i }));

    await payButton.first().waitFor({ state: "visible", timeout: PLAYWRIGHT_PAY_BUTTON_TIMEOUT_MS });
    await payButton.first().click();

    // Wait for redirect away from checkout.stripe.com (payment committed).
    await page.waitForURL(
      (url) => !url.href.includes("checkout.stripe.com"),
      { timeout: PLAYWRIGHT_REDIRECT_AWAY_TIMEOUT_MS },
    );
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close();
  }
}

/**
 * Provision required canary principals before probes run. Never throws — failures are
 * recorded on AUTH evidence (`preflightProvisioningHealthy`) so ingest still captures a full run.
 */
async function provisionCanaryPrincipals(env: RunnerEnv): Promise<{ ok: boolean; errors: string[] }> {
  const principalIds: CanaryPrincipalId[] = ["CANARY_GENERATION", "CANARY_CHECKOUT"];
  if (env.trigger === "SCHEDULED") {
    principalIds.push("CANARY_SETTLEMENT");
  }

  const failures: string[] = [];
  for (const principalId of principalIds) {
    try {
      const res = await convexHttp(env, "/verification/canary/upsert-principal", {
        method: "POST",
        body: JSON.stringify({ principalId }),
      });
      if (!res.ok) {
        const errText = await res.text();
        failures.push(`${principalId}: ${res.status} ${errText}`);
      } else {
        console.log(`Principal ${principalId} provisioned`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${principalId}: ${msg}`);
    }
  }

  if (failures.length > 0) {
    console.error(`Canary principal provisioning failed: ${failures.join("; ")}`);
    return { ok: false, errors: failures };
  }
  return { ok: true, errors: [] };
}

async function main(): Promise<void> {
  const env = readRunnerEnv();
  const trigger = env.trigger;
  const startedAt = Date.now();

  const provisionOutcome = await provisionCanaryPrincipals(env);
  if (!provisionOutcome.ok) {
    console.error(JSON.stringify({ provisionFailures: provisionOutcome.errors }, null, 2));
  }

  const siteUrl = env.siteUrl;
  const runKey = createRunKey({
    trigger,
    deploymentId: env.deploymentId,
    gitSha: env.gitSha,
    startedAt,
  });

  const evidenceRows: {
    evidenceRef: string;
    runKey: string;
    domain: FeatureDomain;
    trigger: VerificationTrigger;
    payloadJson: string;
  }[] = [];

  const verdicts: DomainVerdictRecord[] = [];

  // --- AUTH ---
  const authStart = Date.now();
  // Protected-route proof is required by default for POST_DEPLOY and SCHEDULED triggers.
  // PRE_MERGE_CI never requires it (no production environment to test against).
  // Set AUTH_CANARY_REQUIRE_PROTECTED_ROUTE=false to explicitly opt out (e.g., emergency deploys).
  const requireProtected = env.requireProtectedRoute;
  const storagePath = env.storagePath;
  type AuthFailureStage =
    | "auth_page"
    | "get_session"
    | "protected_route"
    | "convex_ready"
    | "sign_out";
  let authFailureStage: AuthFailureStage | null = null;
  let authFailureMessage: string | null = null;
  let authPageHealthy = false;
  let sessionEndpointHealthy = false;
  let protectedRouteReachable = false;
  let convexAuthenticatedQueryHealthy = !requireProtected;
  let signOutHealthy = !requireProtected;
  try {
    await probeAuthSmoke(siteUrl);
    authPageHealthy = true;
    sessionEndpointHealthy = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    authFailureStage =
      msg.includes("/api/auth/session") || msg.includes("session JSON")
        ? AUTH_CANARY_PROBE.GET_SESSION
        : AUTH_CANARY_PROBE.AUTH_PAGE;
    authFailureMessage = formatAuthCanaryProbeFailure(authFailureStage, e);
  }
  if (!authFailureStage) {
    try {
      if (storagePath && existsSync(storagePath)) {
        const routeBundle = await probeWorkOsProtectedRoute(siteUrl, storagePath);
        protectedRouteReachable = routeBundle.protectedRouteReachable;
        convexAuthenticatedQueryHealthy = routeBundle.convexAuthenticatedQueryHealthy;
      } else if (requireProtected) {
        throw new Error(
          "AUTH_CANARY_REQUIRE_PROTECTED_ROUTE=true but AUTH_CANARY_PROTECTED_STORAGE_STATE is missing or not a file",
        );
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const bracket = /^\[([a-z_]+)\]/u.exec(raw);
      authFailureStage = (bracket?.[1] as AuthFailureStage | undefined) ?? "protected_route";
      authFailureMessage = raw;
    }
  }

  // Sign-out smoke test runs independently so it never burns the persistent
  // WorkOS session used for protected-route proof.
  if (!authFailureStage) {
    try {
      signOutHealthy = await probeAuthSignOutSmoke(siteUrl);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      authFailureStage = "sign_out";
      authFailureMessage = raw;
    }
  }
  const authEvidence: AuthCanaryEvidence = {
    authPageHealthy,
    sessionEndpointHealthy,
    protectedRouteReachable,
    convexAuthenticatedQueryHealthy,
    signOutHealthy,
    preflightProvisioningHealthy: provisionOutcome.ok,
  };
  const authVerdictResult = authFailureStage
    ? "FAILED"
    : classifyAuthProbeVerdict(authEvidence, { requireProtectedRoute: requireProtected });
  const authEvidenceRef = createEvidenceRef({ runKey, domain: "AUTH", startedAt: authStart });
  evidenceRows.push({
    evidenceRef: authEvidenceRef,
    runKey,
    domain: "AUTH",
    trigger,
    payloadJson: JSON.stringify(
      authFailureStage
        ? { ...authEvidence, failureStage: authFailureStage, error: authFailureMessage }
        : authEvidence,
    ),
  });
  const authVerdict: DomainVerdictRecord = record(
    "AUTH",
    trigger,
    authVerdictResult,
    authEvidenceRef,
    authStart,
    authFailureMessage ? { note: authFailureMessage } : {},
  );
  verdicts.push(authVerdict);

  // --- GENERATION ---
  const genStart = Date.now();
  let generationVerdict: DomainVerdictRecord;
  try {
    const startRes = await convexHttp(env, "/verification/canary/start-generation", {
      method: "POST",
      body: JSON.stringify({
        prompt: "Production canary — minimal smoke generation",
      }),
    });
    if (!startRes.ok) {
      const errText = await startRes.text();
      throw new Error(`start-generation ${startRes.status}: ${errText}`);
    }
    const { generationId } = (await startRes.json()) as { generationId: string };

    const deadline = Date.now() + GENERATION_POLL_DEADLINE_MS;
    let terminalStatus: "complete" | "failed" | undefined;
    let probeResultStorageId: string | undefined;
    let probeRefundedAt: number | undefined;
    while (Date.now() < deadline) {
      const stRes = await convexHttp(
        env,
        `/verification/canary/generation-status?generationId=${encodeURIComponent(generationId)}`,
        { method: "GET" },
      );
      if (!stRes.ok) {
        throw new Error(`generation-status ${stRes.status}`);
      }
      const body = (await stRes.json()) as {
        status:
          | { status: "generating" }
          | { status: "complete"; creditRefundedAt?: number; resultStorageId?: string }
          | { status: "failed"; creditRefundedAt?: number }
          | null;
      };
      const st = body.status;
      if (!st) {
        throw new Error("generation status null");
      }
      if (st.status === "complete") {
        terminalStatus = "complete";
        probeResultStorageId = st.resultStorageId;
        probeRefundedAt = st.creditRefundedAt;
        break;
      }
      if (st.status === "failed") {
        terminalStatus = "failed";
        probeRefundedAt = st.creditRefundedAt;
        break;
      }
      await sleep(GENERATION_POLL_INTERVAL_MS);
    }

    const genEvidence: GenerationCanaryEvidence = {
      requestAccepted: true,
      terminalVerdict: terminalStatus === "complete" ? "COMPLETE" : terminalStatus === "failed" ? "FAILED" : "TIMEOUT",
      artifactPresent: Boolean(probeResultStorageId),
      refundObserved: Boolean(probeRefundedAt),
    };
    // Delegate to library classifier — timeout is a runner concern (polling exhausted),
    // terminal states are classified by the library function.
    const terminal: DomainVerdictRecord["verdict"] = terminalStatus
      ? classifyGenerationOutcome({ status: terminalStatus, resultStorageId: probeResultStorageId })
      : "TIMEOUT";

    const evidenceRef = createEvidenceRef({ runKey, domain: "GENERATION", startedAt: genStart });
    evidenceRows.push({
      evidenceRef,
      runKey,
      domain: "GENERATION",
      trigger,
      payloadJson: JSON.stringify(genEvidence),
    });
    generationVerdict = record("GENERATION", trigger, terminal, evidenceRef, genStart);
  } catch (e) {
    const evidenceRef = createEvidenceRef({ runKey, domain: "GENERATION", startedAt: genStart });
    const msg = e instanceof Error ? e.message : String(e);
    evidenceRows.push({
      evidenceRef,
      runKey,
      domain: "GENERATION",
      trigger,
      payloadJson: JSON.stringify({ error: msg }),
    });
    generationVerdict = record("GENERATION", trigger, "FAILED", evidenceRef, genStart);
  }
  verdicts.push(generationVerdict);

  // --- CHECKOUT ---
  const coStart = Date.now();
  let checkoutVerdict: DomainVerdictRecord;
  try {
    const startRes = await convexHttp(env, "/verification/canary/start-checkout", {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!startRes.ok) {
      const errText = await startRes.text();
      throw new Error(`start-checkout ${startRes.status}: ${errText}`);
    }
    const { checkoutId } = (await startRes.json()) as { checkoutId: string };

    const deadline = Date.now() + CHECKOUT_POLL_DEADLINE_MS;
    let pendingObserved = false;
    let readyObserved = false;
    let hostedCheckoutUrlPresent = false;
    while (Date.now() < deadline) {
      const stRes = await convexHttp(
        env,
        `/verification/canary/checkout-status?checkoutId=${encodeURIComponent(checkoutId)}`,
        { method: "GET" },
      );
      if (!stRes.ok) {
        throw new Error(`checkout-status ${stRes.status}`);
      }
      const body = (await stRes.json()) as {
        status:
          | { status: "pending" }
          | { status: "ready"; checkoutUrl: string }
          | { status: "failed"; error: string }
          | null;
      };
      const st = body.status;
      if (!st) {
        throw new Error("checkout status null");
      }
      if (st.status === "ready") {
        readyObserved = true;
        hostedCheckoutUrlPresent = Boolean(st.checkoutUrl?.startsWith("http"));
        break;
      }
      if (st.status === "pending") {
        pendingObserved = true;
      }
      if (st.status === "failed") {
        throw new Error(st.error);
      }
      await sleep(CHECKOUT_POLL_INTERVAL_MS);
    }

    const coEvidence: CheckoutSessionCanaryEvidence = {
      requestAccepted: true,
      pendingObserved,
      readyObserved,
      hostedCheckoutUrlPresent,
    };
    const coVerdictResult = classifyCheckoutProbeVerdict(coEvidence);
    const evidenceRef = createEvidenceRef({ runKey, domain: "CHECKOUT_SESSION", startedAt: coStart });
    evidenceRows.push({
      evidenceRef,
      runKey,
      domain: "CHECKOUT_SESSION",
      trigger,
      payloadJson: JSON.stringify(coEvidence),
    });
    checkoutVerdict = record("CHECKOUT_SESSION", trigger, coVerdictResult, evidenceRef, coStart);
  } catch (e) {
    const evidenceRef = createEvidenceRef({ runKey, domain: "CHECKOUT_SESSION", startedAt: coStart });
    const msg = e instanceof Error ? e.message : String(e);
    evidenceRows.push({
      evidenceRef,
      runKey,
      domain: "CHECKOUT_SESSION",
      trigger,
      payloadJson: JSON.stringify({ error: msg }),
    });
    checkoutVerdict = record("CHECKOUT_SESSION", trigger, "FAILED", evidenceRef, coStart);
  }
  verdicts.push(checkoutVerdict);

  // --- LIVE_SETTLEMENT (scheduled only — fresh end-to-end flow) ---
  const lsStart = Date.now();
  let liveSettlementVerdict: DomainVerdictRecord;
  if (trigger !== "SCHEDULED") {
    const evidenceRef = createEvidenceRef({ runKey, domain: "LIVE_SETTLEMENT", startedAt: lsStart });
    const skipNote = "LIVE_SETTLEMENT is destructive; only the SCHEDULED trigger exercises it";
    evidenceRows.push({
      evidenceRef,
      runKey,
      domain: "LIVE_SETTLEMENT",
      trigger,
      payloadJson: JSON.stringify({ skipped: true, reason: skipNote }),
    });
    liveSettlementVerdict = record(
      "LIVE_SETTLEMENT",
      trigger,
      "SKIPPED",
      evidenceRef,
      lsStart,
      { note: skipNote },
    );
  } else {
    // Fresh settlement: create checkout → pay via Playwright → observe settlement → refund.
    // Fails loudly if CANARY_SETTLEMENT is not provisioned or has no saved payment method.
    try {
      const startRes = await convexHttp(env, "/verification/canary/start-settlement-checkout", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!startRes.ok) {
        const errText = await startRes.text();
        throw new Error(`start-settlement-checkout ${startRes.status}: ${errText}`);
      }
      const { checkoutId } = (await startRes.json()) as { checkoutId: string };

      let checkoutUrl = "";
      const checkoutDeadline = Date.now() + CHECKOUT_POLL_DEADLINE_MS;
      while (Date.now() < checkoutDeadline) {
        const stRes = await convexHttp(
          env,
          `/verification/canary/settlement-checkout-status?checkoutId=${encodeURIComponent(checkoutId)}`,
          { method: "GET" },
        );
        if (!stRes.ok) {
          throw new Error(`settlement-checkout-status ${stRes.status}`);
        }
        const body = (await stRes.json()) as {
          status:
            | { status: "pending" }
            | { status: "ready"; checkoutUrl: string }
            | { status: "failed"; error: string }
            | null;
        };
        const st = body.status;
        if (!st) {
          throw new Error("settlement checkout status null — checkout may not belong to CANARY_SETTLEMENT");
        }
        if (st.status === "ready") {
          checkoutUrl = st.checkoutUrl;
          break;
        }
        if (st.status === "failed") {
          throw new Error(`settlement checkout failed: ${st.error}`);
        }
        await sleep(CHECKOUT_POLL_INTERVAL_MS);
      }
      if (!checkoutUrl) {
        throw new Error("settlement checkout timed out waiting for hosted checkout URL");
      }

      // Canary customer has a saved payment method; selector/timeout/navigation failures
      // bubble up into the outer catch so the verdict's note carries the real root cause.
      await automateStripeCheckout(checkoutUrl);

      // Settlement chain: webhook → credit grant → settlement row. observedSettlementOutcome
      // captures the canonical pre-refund classification — ledger integrity faults
      // (DUPLICATE_GRANT, FAILED) throw and short-circuit the run.
      const settlementDeadline = Date.now() + SETTLEMENT_POLL_DEADLINE_MS;
      let creditGrantCount: 0 | 1 = 0;
      let authoritativeRevenueCount: 0 | 1 = 0;
      let paidWebhookObserved = false;
      let observedSettlementOutcome: SettlementOutcome = "UNOBSERVED";
      while (Date.now() < settlementDeadline) {
        const stRes = await convexHttp(
          env,
          `/verification/canary/settlement-by-checkout?checkoutId=${encodeURIComponent(checkoutId)}`,
          { method: "GET" },
        );
        if (!stRes.ok) {
          throw new Error(`settlement-by-checkout ${stRes.status}`);
        }
        const { settlement } = (await stRes.json()) as {
          settlement: {
            creditGrantCount: number;
            revenueEventCount: number;
            refundedAt?: number;
          } | null;
        };
        if (settlement) {
          paidWebhookObserved = true;
          creditGrantCount = settlement.creditGrantCount >= 1 ? 1 : 0;
          authoritativeRevenueCount = settlement.revenueEventCount >= 1 ? 1 : 0;
          const outcome = classifySettlementOutcome({
            creditGrantCount: settlement.creditGrantCount,
            revenueEventCount: settlement.revenueEventCount,
            refundedAt: settlement.refundedAt,
          });
          if (outcome === "GRANTED_ONCE") {
            observedSettlementOutcome = outcome;
            break;
          }
          if (outcome === "DUPLICATE_GRANT" || outcome === "FAILED") {
            throw new Error(`settlement classified as ${outcome} — ledger integrity issue`);
          }
          // outcome === "REFUNDED" or "UNOBSERVED" — keep polling until we observe
          // GRANTED_ONCE (or a fault) or hit the deadline. A pre-existing REFUNDED
          // state would mean a stale ledger row leaked through — assertNoActiveSettlementCanary
          // should have prevented that, so timing out here is the safe terminal.
        }
        await sleep(SETTLEMENT_POLL_INTERVAL_MS);
      }

      // Idempotent refund scoped to this canary checkout.
      let refundObserved = false;
      const rfRes = await convexHttp(env, "/verification/canary/refund-settlement", {
        method: "POST",
        body: JSON.stringify({ pendingCheckoutId: checkoutId }),
      });
      if (!rfRes.ok) {
        throw new Error(`refund-settlement ${rfRes.status}: ${await rfRes.text()}`);
      }
      const refundResult = (await rfRes.json()) as {
        stripeRefundId: string;
        refundAmountUsd: number;
        alreadyRefunded: boolean;
      };

      const refundDeadline = Date.now() + REFUND_POLL_DEADLINE_MS;
      refundObserved = refundResult.alreadyRefunded;
      while (Date.now() < refundDeadline && !refundObserved) {
        const stRes = await convexHttp(
          env,
          `/verification/canary/settlement-by-checkout?checkoutId=${encodeURIComponent(checkoutId)}`,
          { method: "GET" },
        );
        if (stRes.ok) {
          const { settlement } = (await stRes.json()) as {
            settlement: { refundedAt?: number } | null;
          };
          if (settlement?.refundedAt) {
            refundObserved = true;
            break;
          }
        }
        await sleep(REFUND_POLL_INTERVAL_MS);
      }

      const lsEvidence: LiveSettlementCanaryEvidence = {
        checkoutCommitted: true,
        paidWebhookObserved,
        creditGrantCount,
        authoritativeRevenueCount,
        refundObserved,
      };
      // Pass the pre-refund outcome captured during polling — classifyLiveSettlementVerdict
      // expects refundConfirmed as a separate signal (see SI7 in the spec).
      const lsVerdictResult = classifyLiveSettlementVerdict({
        settlementOutcome: observedSettlementOutcome,
        refundConfirmed: refundObserved,
      });
      const evidenceRef = createEvidenceRef({ runKey, domain: "LIVE_SETTLEMENT", startedAt: lsStart });
      evidenceRows.push({
        evidenceRef,
        runKey,
        domain: "LIVE_SETTLEMENT",
        trigger,
        payloadJson: JSON.stringify({
          ...lsEvidence,
          settlementOutcome: observedSettlementOutcome,
        }),
      });
      liveSettlementVerdict = record(
        "LIVE_SETTLEMENT",
        trigger,
        lsVerdictResult,
        evidenceRef,
        lsStart,
        { settlementOutcome: observedSettlementOutcome },
      );
    } catch (e) {
      const evidenceRef = createEvidenceRef({ runKey, domain: "LIVE_SETTLEMENT", startedAt: lsStart });
      const msg = e instanceof Error ? e.message : String(e);
      evidenceRows.push({
        evidenceRef,
        runKey,
        domain: "LIVE_SETTLEMENT",
        trigger,
        payloadJson: JSON.stringify({ error: msg }),
      });
      liveSettlementVerdict = record(
        "LIVE_SETTLEMENT",
        trigger,
        "FAILED",
        evidenceRef,
        lsStart,
        { note: msg },
      );
    }
  }
  verdicts.push(liveSettlementVerdict);

  const finishedAt = Date.now();

  const evaluation = evaluateReleaseDecision({
    trigger,
    verdicts,
  });

  const payload = {
    runKey,
    trigger,
    deploymentId: env.deploymentId,
    gitSha: env.gitSha,
    siteUrl,
    workflowRunId: env.workflowRunId,
    startedAt,
    finishedAt,
    authVerdict: verdicts.find((v) => v.domain === "AUTH"),
    generationVerdict: verdicts.find((v) => v.domain === "GENERATION"),
    checkoutSessionVerdict: verdicts.find((v) => v.domain === "CHECKOUT_SESSION"),
    liveSettlementVerdict: verdicts.find((v) => v.domain === "LIVE_SETTLEMENT"),
    evidenceRows,
  };

  const ingest = await convexHttp(env, "/verification/ingest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!ingest.ok) {
    throw new Error(`ingest ${ingest.status}: ${await ingest.text()}`);
  }

  const summary = {
    runKey,
    trigger,
    releaseDecision: evaluation.releaseDecision,
    requiredDomains: evaluation.requiredDomains,
    missingRequiredDomains: evaluation.missingRequiredDomains,
    nonPassingRequiredDomains: evaluation.nonPassingRequiredDomains,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (evaluation.releaseDecision === "DENY") {
    process.exitCode = 1;
  }
}

await main();
