/**
 * Stripe environment variable validation.
 *
 * Guards against misconfigured Convex env vars (wrong keys, test-vs-live
 * mismatch, localhost in production) that silently break the payment flow.
 */

export interface StripeEnv {
  stripeSecretKey: string;
  stripePriceStarter: string;
  stripePricePro: string;
  stripeWebhookSecret: string;
  siteUrl: string;
}

interface EnvError {
  variable: string;
  message: string;
}

const LIVE_KEY_PREFIX = "sk_live_";
const TEST_KEY_PREFIX = "sk_test_";
const LIVE_PRICE_PREFIX = "price_";
const LIVE_WEBHOOK_PREFIX = "whsec_";

const isLiveStripeKey = (key: string) => key.startsWith(LIVE_KEY_PREFIX);
const isTestStripeKey = (key: string) => key.startsWith(TEST_KEY_PREFIX);
const isProductionSiteUrl = (url: string) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

const isLocalhostUrl = (url: string) => {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
};

function readStripeEnv(): StripeEnv {
  return {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
    stripePriceStarter: process.env.STRIPE_PRICE_STARTER ?? "",
    stripePricePro: process.env.STRIPE_PRICE_PRO ?? "",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    siteUrl: process.env.SITE_URL ?? "",
  };
}

function validateStripeEnv(env: StripeEnv): EnvError[] {
  const errors: EnvError[] = [];

  // --- presence checks ---
  if (!env.stripeSecretKey) {
    errors.push({ variable: "STRIPE_SECRET_KEY", message: "Missing" });
  }
  if (!env.stripePriceStarter) {
    errors.push({ variable: "STRIPE_PRICE_STARTER", message: "Missing" });
  }
  if (!env.stripePricePro) {
    errors.push({ variable: "STRIPE_PRICE_PRO", message: "Missing" });
  }
  if (!env.stripeWebhookSecret) {
    errors.push({ variable: "STRIPE_WEBHOOK_SECRET", message: "Missing" });
  }
  if (!env.siteUrl) {
    errors.push({ variable: "SITE_URL", message: "Missing" });
  }

  // --- format checks ---
  if (env.stripeSecretKey && !isLiveStripeKey(env.stripeSecretKey) && !isTestStripeKey(env.stripeSecretKey)) {
    errors.push({
      variable: "STRIPE_SECRET_KEY",
      message: `Must start with "${LIVE_KEY_PREFIX}" or "${TEST_KEY_PREFIX}"`,
    });
  }

  if (env.stripePriceStarter && !env.stripePriceStarter.startsWith(LIVE_PRICE_PREFIX)) {
    errors.push({
      variable: "STRIPE_PRICE_STARTER",
      message: `Must start with "${LIVE_PRICE_PREFIX}"`,
    });
  }

  if (env.stripePricePro && !env.stripePricePro.startsWith(LIVE_PRICE_PREFIX)) {
    errors.push({
      variable: "STRIPE_PRICE_PRO",
      message: `Must start with "${LIVE_PRICE_PREFIX}"`,
    });
  }

  if (env.stripeWebhookSecret && !env.stripeWebhookSecret.startsWith(LIVE_WEBHOOK_PREFIX)) {
    errors.push({
      variable: "STRIPE_WEBHOOK_SECRET",
      message: `Must start with "${LIVE_WEBHOOK_PREFIX}"`,
    });
  }

  // --- cross-variable consistency ---
  const siteIsProduction = isProductionSiteUrl(env.siteUrl);
  const keyIsTest = isTestStripeKey(env.stripeSecretKey);

  if (siteIsProduction && keyIsTest) {
    errors.push({
      variable: "STRIPE_SECRET_KEY",
      message: "Production SITE_URL (https) but STRIPE_SECRET_KEY is a test key (sk_test_). Use a live key.",
    });
  }

  if (siteIsProduction && isLocalhostUrl(env.siteUrl)) {
    errors.push({
      variable: "SITE_URL",
      message: "SITE_URL points to localhost, which is invalid for production",
    });
  }

  if (!siteIsProduction && isLiveStripeKey(env.stripeSecretKey)) {
    errors.push({
      variable: "STRIPE_SECRET_KEY",
      message: "Non-production SITE_URL (http) but STRIPE_SECRET_KEY is a live key (sk_live_). Possible mismatch.",
    });
  }

  return errors;
}

/**
 * Validates all Stripe-related env vars and throws if any are invalid.
 * Call this at the entry point of any Stripe-dependent code path.
 */
export function assertStripeEnv(): StripeEnv {
  const env = readStripeEnv();
  const errors = validateStripeEnv(env);

  if (errors.length > 0) {
    const summary = errors
      .map((e) => `  ${e.variable}: ${e.message}`)
      .join("\n");
    throw new Error(
      `Stripe environment validation failed:\n${summary}\n\n` +
        `Check your Convex environment variables (npx convex env list).`,
    );
  }

  return env;
}

export { validateStripeEnv, readStripeEnv };
