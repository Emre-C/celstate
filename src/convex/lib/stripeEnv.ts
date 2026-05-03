/**
 * Stripe environment variable validation (presence + format).
 *
 * Convex dev and prod deployments set env vars independently; the same
 * SITE_URL may appear on dev (Stripe test) and prod (Stripe live). Cross-checks
 * against SITE_URL caused spurious failures on dev and are intentionally omitted.
 * Ensure your **production** deployment uses live Stripe keys in the dashboard.
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
        `Check Doppler and use pnpm secrets:diff for safe name-only inspection.`,
    );
  }

  return env;
}

export { validateStripeEnv, readStripeEnv };
