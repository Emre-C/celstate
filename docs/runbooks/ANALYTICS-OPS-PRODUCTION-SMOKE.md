# Production Smoke Test: Analytics & Ops

Deploy the updated Convex backend and run these checks **after** setting the Convex env vars.

## Prerequisites

### 1. Convex environment variables
```bash
# In your Convex production environment
POSTHOG_API_KEY=phc_...
POSTHOG_HOST=https://us.i.posthog.com
```

### 2. Ops webhook (optional but recommended)
```bash
OPS_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
# or Discord/generic endpoint
OPS_ALERT_WEBHOOK_KIND=slack  # optional; auto-detected from hostname if omitted
```

### 3. Stripe test credit pack
- Ensure you have a test credit pack price ID ready.
- Confirm `CREDIT_PACKS` mapping in `src/convex/lib/stripeEnv.ts` includes it.

---

## Smoke Tests

### Test 1: Sign-up analytics

**Steps**
1. Incognito window.
2. Sign up with Google or Apple.
3. Complete onboarding.

**Expected in PostHog**
- Exactly one `signed_up` event.
- Properties:
  - `user_id`: Convex user ID string
  - `auth_provider`: `"google"` | `"apple"` | `"unknown"`
  - `initial_credits`: number (from `GENERATION_CONFIG.initialCredits`)

**Expected in Convex**
- New user record created with `credits` set to `initialCredits`.

---

### Test 2: Stripe purchase flow

**Steps**
1. From the app, initiate a credit pack purchase.
2. Complete the Stripe checkout.
3. Wait for the redirect back to `/app?success=true`.

**Expected in PostHog**
- One `credits_purchase_completed` event (server-side).
- One `credits_checkout_returned` event (client-side redirect).

**Expected properties on `credits_purchase_completed`**
- `credits_added`: number (from `CREDIT_PACKS` mapping)
- `amount_usd`: number (e.g., `10.00` for $10)
- `currency`: `"usd"` (lowercase)
- `stripe_payment_intent_id`: `"pi_..."`
- `user_id`: Convex user ID string

**Expected in Convex**
- `creditGrants` record with `stripePaymentIntentId`.
- User `credits` increased by the pack amount.

**Expected webhook/Discord**
- One formatted purchase alert if `OPS_ALERT_WEBHOOK_URL` is set.

---

### Test 3: Generation failure normalization

**Steps**
1. Start a generation.
2. Force a failure (e.g., via a known invalid prompt or by temporarily disabling the model).
3. Wait for the generation to fail.

**Expected in PostHog**
- One `generation_failed` event.
- Properties:
  - `generation_id`: Convex generation ID string
  - `failure_kind`: `"timeout"` | `"provider_error"` | `"processing_error"` | `"unknown"`
  - `failure_stage` (optional): `"white_background"` | `"black_background"` | `"finalizing"`
  - `retry_count`: number (may be `0`)

**Expected NOT in PostHog**
- Raw error strings.
- Stack traces.
- Internal status messages.

**Expected in Convex**
- Generation record with `failureKind` and `failureStage` persisted.
- Ops alert event recorded for the failure.

---

### Test 4: Session attribution

**Steps**
1. Open a fresh browser session (clear cookies/localStorage).
2. Land on a URL with UTM params, e.g.:
   ```
   https://celstate.com/?utm_source=twitter&utm_medium=social&utm_campaign=launch
   ```
3. Navigate through the app.

**Expected in PostHog**
- One `session_attribution_registered` event.
- Properties:
  - `landing_path`: `"/"`
  - `utm_source`: `"twitter"`
  - `utm_medium`: `"social"`
  - `utm_campaign`: `"launch"`
  - `referrer` (if present): referrer URL

**Expected behavior**
- No second `session_attribution_registered` event in the same browser session.
- Event only fires once per session, not on every page load.

---

## Idempotency & Duplicate Checks

### Replay Stripe webhook
1. In Stripe Dashboard, find the `checkout.session.completed` event from Test 2.
2. Use Stripe CLI to replay it:
   ```bash
   stripe events trigger --forward-to https://your-app.vercel.app/api/stripe <event-id>
   ```
3. Verify:
   - No duplicate credit grant.
   - No duplicate `credits_purchase_completed` event.
   - No duplicate purchase webhook.

### Verify credit grant atomicity
1. Check the `creditGrants` table in Convex.
2. Confirm exactly one record per `stripePaymentIntentId`.
3. Confirm `user.credits` increased by the correct amount exactly once.

---

## PostHog Event Shape Validation

After the smoke tests, export the events and confirm the schema:

```sql
-- signed_up
select distinct user_id, auth_provider, initial_credits from events where event = 'signed_up';

-- credits_purchase_completed
select distinct credits_added, amount_usd, currency, stripe_payment_intent_id, user_id 
from events where event = 'credits_purchase_completed';

-- generation_failed
select distinct generation_id, failure_kind, failure_stage, retry_count 
from events where event = 'generation_failed';

-- session_attribution_registered
select distinct landing_path, utm_source, utm_medium, utm_campaign, referrer 
from events where event = 'session_attribution_registered';
```

All properties should be present, correctly typed, and free of raw error content.

---

## Failure Isolation Checks

### PostHog outage simulation
1. Temporarily unset `POSTHOG_API_KEY` in Convex dev.
2. Run a purchase flow.
3. Verify:
   - Credits are still granted.
   - User experience is unaffected.
   - Webhook still fires (if configured).
4. Restore the env var and re-run to confirm events resume.

### Ops webhook failure simulation
1. Set `OPS_ALERT_WEBHOOK_URL` to a non-existent endpoint.
2. Run a purchase flow.
3. Verify:
   - Purchase still completes.
   - Credits are granted.
   - No error shown to the user.
   - Ops alert failure is recorded in Convex.

---

## Rollback Criteria

If any of these occur, rollback the Convex deployment:

- Duplicate credit grants for a single `stripePaymentIntentId`.
- Missing `credits_purchase_completed` events for successful purchases.
- Raw error strings appearing in `generation_failed` events.
- Sign-up events firing on repeat logins (should only fire on first user insert).

---

## Success Indicators

- All 4 smoke tests pass.
- No duplicate events in PostHog.
- No duplicate credit grants in Convex.
- Event properties match the documented schema.
- Idempotency replay produces no side effects.

---

## Next Steps After Success

- Keep this checklist in `docs/runbooks/`.
- Consider adding an automated integration test for the Stripe->PostHog path.
- Monitor `alert_failed` ops events to catch webhook delivery issues.
- Review `generation_failed` patterns weekly to adjust classification rules if needed.
