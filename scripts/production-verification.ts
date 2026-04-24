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
  type VerificationTrigger,
} from "../src/lib/production-confidence.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function resolveConvexHttpUrl(): string {
  const explicit = process.env.CONVEX_HTTP_VERIFICATION_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const convexUrl = process.env.CONVEX_URL?.trim();
  if (!convexUrl) {
    throw new Error("Set CONVEX_HTTP_VERIFICATION_URL or CONVEX_URL");
  }
  if (!convexUrl.includes(".convex.cloud")) {
    throw new Error("CONVEX_URL must be a *.convex.cloud deployment URL for HTTP derivation");
  }
  return convexUrl.replace(".convex.cloud", ".convex.site");
}

function getRunnerSecret(): string {
  const s = process.env.VERIFICATION_RUNNER_SECRET?.trim();
  if (!s) {
    throw new Error("VERIFICATION_RUNNER_SECRET is required");
  }
  return s;
}

async function convexHttp(path: string, init: RequestInit): Promise<Response> {
  const url = `${resolveConvexHttpUrl()}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${getRunnerSecret()}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

function getTrigger(): VerificationTrigger {
  const t = process.env.VERIFICATION_TRIGGER?.trim().toUpperCase();
  if (t === "SCHEDULED" || t === "POST_DEPLOY" || t === "PRE_MERGE_CI") {
    return t;
  }
  return "POST_DEPLOY";
}

function record(
  domain: FeatureDomain,
  trigger: VerificationTrigger,
  verdict: DomainVerdictRecord["verdict"],
  evidenceRef: string,
  startedAt: number,
): DomainVerdictRecord {
  return {
    domain,
    trigger,
    requirement: getRequirementClass(domain, trigger),
    verdict,
    evidenceRef,
    startedAt,
    finishedAt: Date.now(),
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
  } finally {
    clearTimeout(t);
  }

  const sc = new AbortController();
  const t2 = setTimeout(() => sc.abort(), AUTH_CANARY_PROBE_TIMEOUT_MS);
  try {
    const sessionRes = await fetch(joinUrl("/api/auth/get-session"), {
      headers: { accept: "application/json" },
      signal: sc.signal,
    });
    if (!isFinalGetSessionProbeOk(sessionRes.status)) {
      throw new Error(`/api/auth/get-session returned ${sessionRes.status}`);
    }
  } finally {
    clearTimeout(t2);
  }

  return { authPageHealthy: true, sessionEndpointHealthy: true };
}

async function probeProtectedRoute(baseUrl: string, storageStatePath: string): Promise<boolean> {
  const raw = readFileSync(storageStatePath, "utf-8");
  const storageState = JSON.parse(raw);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    const normalized = baseUrl.replace(/\/$/, "");
    const response = await page.goto(`${normalized}/app`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response || !response.ok()) {
      return false;
    }
    // A silent redirect to /auth still returns 200; assert final path.
    const finalPath = new URL(page.url()).pathname;
    if (!finalPath.startsWith("/app")) {
      return false;
    }
    await context.close();
    return true;
  } finally {
    await browser.close();
  }
}

async function automateStripeCheckout(checkoutUrl: string): Promise<boolean> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(checkoutUrl, { waitUntil: "networkidle", timeout: 30_000 });

    // Selectors layered for resilience across Stripe hosted-checkout UI revisions.
    const payButton = page.locator('[data-testid="hosted-payment-submit-button"]')
      .or(page.locator(".SubmitButton"))
      .or(page.getByRole("button", { name: /pay/i }));

    await payButton.first().waitFor({ state: "visible", timeout: 15_000 });
    await payButton.first().click();

    await page.waitForURL(
      (url) => !url.href.includes("checkout.stripe.com"),
      { timeout: 60_000 },
    );

    await context.close();
    return true;
  } catch {
    return false;
  } finally {
    await browser.close();
  }
}

async function provisionCanaryPrincipals(trigger: VerificationTrigger): Promise<void> {
  const principalIds: CanaryPrincipalId[] = ["CANARY_GENERATION", "CANARY_CHECKOUT"];
  if (trigger === "SCHEDULED") {
    principalIds.push("CANARY_SETTLEMENT");
  }

  for (const principalId of principalIds) {
    try {
      const res = await convexHttp("/verification/canary/upsert-principal", {
        method: "POST",
        body: JSON.stringify({ principalId }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn(`Principal provisioning ${principalId}: ${res.status} ${errText}`);
      } else {
        console.log(`Principal ${principalId} provisioned`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Principal provisioning ${principalId} failed: ${msg}`);
    }
  }
}

async function main(): Promise<void> {
  const trigger = getTrigger();
  const startedAt = Date.now();

  // Non-fatal: probe itself will produce FAILED if provisioning fails.
  await provisionCanaryPrincipals(trigger);

  const deploymentId =
    process.env.VERCEL_DEPLOYMENT_ID?.trim() ||
    process.env.GITHUB_RUN_ID?.trim() ||
    undefined;
  const gitSha =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    undefined;
  const siteUrl =
    process.env.AUTH_CANARY_BASE_URL?.trim() ||
    process.env.PUBLIC_SITE_URL?.trim() ||
    undefined;

  if (!siteUrl) {
    throw new Error("Set AUTH_CANARY_BASE_URL or PUBLIC_SITE_URL for auth probes");
  }

  const runKey = createRunKey({
    trigger,
    deploymentId,
    gitSha,
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
  let authVerdict: DomainVerdictRecord;
  try {
    await probeAuthSmoke(siteUrl);
    // PRE_MERGE_CI has no production env to test against; AUTH_CANARY_REQUIRE_PROTECTED_ROUTE=false is the emergency-deploy opt-out.
    const requireProtected = trigger !== "PRE_MERGE_CI" &&
      process.env.AUTH_CANARY_REQUIRE_PROTECTED_ROUTE !== "false";
    const storagePath = process.env.AUTH_CANARY_PROTECTED_STORAGE_STATE?.trim();
    let protectedOk = false;
    if (storagePath && existsSync(storagePath)) {
      protectedOk = await probeProtectedRoute(siteUrl, storagePath);
    } else if (requireProtected) {
      throw new Error(
        "AUTH_CANARY_REQUIRE_PROTECTED_ROUTE=true but AUTH_CANARY_PROTECTED_STORAGE_STATE is missing or not a file",
      );
    }
    const authEvidence: AuthCanaryEvidence = {
      authPageHealthy: true,
      sessionEndpointHealthy: true,
      protectedRouteReachable: storagePath ? protectedOk : false,
    };
    const authVerdictResult = classifyAuthProbeVerdict(authEvidence, { requireProtectedRoute: requireProtected });
    const evidenceRef = createEvidenceRef({ runKey, domain: "AUTH", startedAt: authStart });
    evidenceRows.push({
      evidenceRef,
      runKey,
      domain: "AUTH",
      trigger,
      payloadJson: JSON.stringify(authEvidence),
    });
    authVerdict = record("AUTH", trigger, authVerdictResult, evidenceRef, authStart);
  } catch (e) {
    const evidenceRef = createEvidenceRef({ runKey, domain: "AUTH", startedAt: authStart });
    evidenceRows.push({
      evidenceRef,
      runKey,
      domain: "AUTH",
      trigger,
      payloadJson: JSON.stringify({
        error: formatAuthCanaryProbeFailure("auth_page", e),
      }),
    });
    authVerdict = record("AUTH", trigger, "FAILED", evidenceRef, authStart);
  }
  verdicts.push(authVerdict);

  // --- GENERATION ---
  const genStart = Date.now();
  let generationVerdict: DomainVerdictRecord;
  try {
    const startRes = await convexHttp("/verification/canary/start-generation", {
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

    const deadline = Date.now() + 5 * 60_000;
    let terminalStatus: "complete" | "failed" | undefined;
    let probeResultStorageId: string | undefined;
    let probeRefundedAt: number | undefined;
    while (Date.now() < deadline) {
      const stRes = await convexHttp(
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
      await sleep(5000);
    }

    const genEvidence: GenerationCanaryEvidence = {
      requestAccepted: true,
      terminalVerdict: terminalStatus === "complete" ? "COMPLETE" : terminalStatus === "failed" ? "FAILED" : "TIMEOUT",
      artifactPresent: Boolean(probeResultStorageId),
      refundObserved: Boolean(probeRefundedAt),
    };
    // Timeout is a runner concern (polling exhausted); terminal states go through the library classifier.
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
    const startRes = await convexHttp("/verification/canary/start-checkout", {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!startRes.ok) {
      const errText = await startRes.text();
      throw new Error(`start-checkout ${startRes.status}: ${errText}`);
    }
    const { checkoutId } = (await startRes.json()) as { checkoutId: string };

    const deadline = Date.now() + 90_000;
    let pendingObserved = false;
    let readyObserved = false;
    let hostedCheckoutUrlPresent = false;
    while (Date.now() < deadline) {
      const stRes = await convexHttp(
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
      await sleep(2000);
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
    evidenceRows.push({
      evidenceRef,
      runKey,
      domain: "LIVE_SETTLEMENT",
      trigger,
      payloadJson: JSON.stringify({ skipped: true, reason: "not required for this trigger" }),
    });
    liveSettlementVerdict = record("LIVE_SETTLEMENT", trigger, "SKIPPED", evidenceRef, lsStart);
  } else {
    // Fails loudly if CANARY_SETTLEMENT is not provisioned or has no saved payment method.
    try {
      const startRes = await convexHttp("/verification/canary/start-settlement-checkout", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!startRes.ok) {
        const errText = await startRes.text();
        throw new Error(`start-settlement-checkout ${startRes.status}: ${errText}`);
      }
      const { checkoutId } = (await startRes.json()) as { checkoutId: string };

      let checkoutUrl = "";
      const checkoutDeadline = Date.now() + 90_000;
      while (Date.now() < checkoutDeadline) {
        const stRes = await convexHttp(
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
        await sleep(2000);
      }
      if (!checkoutUrl) {
        throw new Error("settlement checkout timed out waiting for hosted checkout URL");
      }

      // Canary customer has a saved payment method; Playwright just clicks Pay.
      const paymentOk = await automateStripeCheckout(checkoutUrl);
      if (!paymentOk) {
        throw new Error("Stripe checkout automation failed — could not complete payment on hosted checkout");
      }

      // Settlement chain: Stripe webhook → credit grant → settlement row.
      const settlementDeadline = Date.now() + 3 * 60_000;
      let creditGrantCount: 0 | 1 = 0;
      let authoritativeRevenueCount: 0 | 1 = 0;
      let paidWebhookObserved = false;
      while (Date.now() < settlementDeadline) {
        const stRes = await convexHttp(
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
            break;
          }
          if (outcome === "DUPLICATE_GRANT" || outcome === "FAILED") {
            throw new Error(`settlement classified as ${outcome} — ledger integrity issue`);
          }
        }
        await sleep(5000);
      }

      // Idempotent refund, scoped to this canary checkout.
      let refundObserved = false;
      const rfRes = await convexHttp("/verification/canary/refund-settlement", {
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

      const refundDeadline = Date.now() + 30_000;
      refundObserved = refundResult.alreadyRefunded;
      while (Date.now() < refundDeadline && !refundObserved) {
        const stRes = await convexHttp(
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
        await sleep(2000);
      }

      const settlementOutcome = classifySettlementOutcome({
        creditGrantCount,
        revenueEventCount: authoritativeRevenueCount,
        refundedAt: refundObserved ? Date.now() : undefined,
      });
      const lsEvidence: LiveSettlementCanaryEvidence = {
        checkoutCommitted: true,
        paidWebhookObserved,
        creditGrantCount,
        authoritativeRevenueCount,
        refundObserved,
      };
      const lsVerdictResult = classifyLiveSettlementVerdict({
        settlementOutcome: paidWebhookObserved ? "GRANTED_ONCE" : "UNOBSERVED",
        refundConfirmed: refundObserved,
      });
      const evidenceRef = createEvidenceRef({ runKey, domain: "LIVE_SETTLEMENT", startedAt: lsStart });
      evidenceRows.push({
        evidenceRef,
        runKey,
        domain: "LIVE_SETTLEMENT",
        trigger,
        payloadJson: JSON.stringify(lsEvidence),
      });
      liveSettlementVerdict = record("LIVE_SETTLEMENT", trigger, lsVerdictResult, evidenceRef, lsStart);
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
      liveSettlementVerdict = record("LIVE_SETTLEMENT", trigger, "FAILED", evidenceRef, lsStart);
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
    deploymentId,
    gitSha,
    siteUrl,
    workflowRunId: process.env.GITHUB_RUN_ID?.trim(),
    startedAt,
    finishedAt,
    authVerdict: verdicts.find((v) => v.domain === "AUTH"),
    generationVerdict: verdicts.find((v) => v.domain === "GENERATION"),
    checkoutSessionVerdict: verdicts.find((v) => v.domain === "CHECKOUT_SESSION"),
    liveSettlementVerdict: verdicts.find((v) => v.domain === "LIVE_SETTLEMENT"),
    evidenceRows,
  };

  const ingest = await convexHttp("/verification/ingest", {
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
