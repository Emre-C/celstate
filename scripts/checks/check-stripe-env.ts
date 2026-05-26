/**
 * Validates Stripe + WorkOS-related environment variables in the **current**
 * process environment (names and formats only — values are never printed).
 *
 * Intended usage with Doppler (recommended):
 *   doppler run --project celstate --config prd -- pnpm check:stripe-env
 *
 * This deliberately does **not** call `convex env list`, which prints plaintext values.
 */

interface EnvCheck {
	readonly name: string;
	readonly required: boolean;
	readonly validate: (value: string) => string | null;
}

const checks: EnvCheck[] = [
	{
		name: "SITE_URL",
		required: true,
		validate: (v) => {
			try {
				const url = new URL(v);
				if (url.protocol !== "https:") return "Must use https:// in production";
				if (url.hostname === "localhost" || url.hostname === "127.0.0.1")
					return "Must not be localhost in production";
				return null;
			} catch {
				return "Not a valid URL";
			}
		},
	},
	{
		name: "STRIPE_SECRET_KEY",
		required: true,
		validate: (v) =>
			v.startsWith("sk_live_") ? null : `Expected sk_live_ prefix, got "${v.slice(0, 12)}..."`,
	},
	{
		name: "STRIPE_PRICE_STARTER",
		required: true,
		validate: (v) =>
			v.startsWith("price_") ? null : `Expected price_ prefix, got "${v.slice(0, 12)}..."`,
	},
	{
		name: "STRIPE_PRICE_PRO",
		required: true,
		validate: (v) =>
			v.startsWith("price_") ? null : `Expected price_ prefix, got "${v.slice(0, 12)}..."`,
	},
	{
		name: "STRIPE_WEBHOOK_SECRET",
		required: true,
		validate: (v) =>
			v.startsWith("whsec_") ? null : `Expected whsec_ prefix, got "${v.slice(0, 12)}..."`,
	},
	{
		name: "WORKOS_CLIENT_ID",
		required: true,
		validate: (v) =>
			v.startsWith("client_") ? null : `Expected client_ prefix, got "${v.slice(0, 12)}..."`,
	},
];

function main() {
	console.log("🔍 Checking Stripe + WorkOS env vars in the current environment…\n");

	let failures = 0;

	for (const check of checks) {
		const value = process.env[check.name];

		if (!value) {
			if (check.required) {
				console.error(`  ❌ ${check.name}: MISSING`);
				failures++;
			} else {
				console.log(`  ⏭️  ${check.name}: not set (optional)`);
			}
			continue;
		}

		const error = check.validate(value);
		if (error) {
			console.error(`  ❌ ${check.name}: ${error}`);
			failures++;
		} else {
			console.log(`  ✅ ${check.name}`);
		}
	}

	console.log();

	if (failures > 0) {
		console.error(`❌ ${failures} check(s) failed. Fix Doppler prd (then sync) before deploying.`);
		process.exit(1);
	}

	console.log("✅ All Stripe + WorkOS production environment checks passed.");
}

main();
