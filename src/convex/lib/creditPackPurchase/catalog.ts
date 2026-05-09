import { ConvexError } from "convex/values";
import { assertStripeEnv } from "../stripeEnv.js";

/**
 * The credit-pack catalog is intentionally small and module-private.
 * Two SKUs only — `starter` and `pro`. New SKUs are explicit code changes,
 * not data, because every settled purchase joins a credit count back to one
 * of these keys via Stripe `priceId`.
 */
const CREDIT_PACK_CATALOG = {
  starter: { credits: 15 },
  pro: { credits: 40 },
} as const;

type CreditPackKey = keyof typeof CREDIT_PACK_CATALOG;

export type KnownCreditPackPriceIds = {
  [Key in CreditPackKey]: string;
};

export type CreditPack = {
  key: CreditPackKey;
  priceId: string;
  credits: number;
};

export function getKnownCreditPackPriceIds(): KnownCreditPackPriceIds {
  const stripeEnv = assertStripeEnv();
  return {
    starter: stripeEnv.stripePriceStarter,
    pro: stripeEnv.stripePricePro,
  };
}

export function getCreditPackCatalog(
  knownPriceIds: KnownCreditPackPriceIds = getKnownCreditPackPriceIds(),
): Record<CreditPackKey, CreditPack> {
  return {
    starter: {
      key: "starter",
      priceId: knownPriceIds.starter,
      credits: CREDIT_PACK_CATALOG.starter.credits,
    },
    pro: {
      key: "pro",
      priceId: knownPriceIds.pro,
      credits: CREDIT_PACK_CATALOG.pro.credits,
    },
  };
}

export function getCreditPackByPriceId(
  priceId: string,
  knownPriceIds: KnownCreditPackPriceIds = getKnownCreditPackPriceIds(),
): CreditPack | null {
  const catalog = getCreditPackCatalog(knownPriceIds);
  if (priceId === catalog.starter.priceId) return catalog.starter;
  if (priceId === catalog.pro.priceId) return catalog.pro;
  return null;
}

export function assertKnownCreditPackPriceId(
  priceId: string,
  knownPriceIds: KnownCreditPackPriceIds = getKnownCreditPackPriceIds(),
): CreditPack {
  const creditPack = getCreditPackByPriceId(priceId, knownPriceIds);
  if (!creditPack) {
    throw new ConvexError("Invalid credit pack");
  }
  return creditPack;
}

export function isKnownCreditPackPriceId(
  priceId: string,
  knownPriceIds: KnownCreditPackPriceIds = getKnownCreditPackPriceIds(),
): boolean {
  return getCreditPackByPriceId(priceId, knownPriceIds) !== null;
}
