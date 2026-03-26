export function canGrantCreditsForCheckoutSession(session: {
  mode?: string | null;
  payment_status?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (session.mode !== "payment") {
    return {
      ok: false,
      reason: `Unexpected checkout mode: ${session.mode ?? "unknown"}`,
    };
  }

  if (session.payment_status !== "paid") {
    return {
      ok: false,
      reason: `Checkout session is not paid (status=${session.payment_status ?? "unknown"})`,
    };
  }

  return { ok: true };
}

export function isKnownCreditPackPriceId(
  priceId: string,
  knownPriceIds: {
    starter: string;
    pro: string;
  },
): boolean {
  return priceId === knownPriceIds.starter || priceId === knownPriceIds.pro;
}
