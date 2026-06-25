export type AnalysisPhase =
	| 'P0_funnel_baseline'
	| 'P1_activation_rate'
	| 'P2_revenue_metrics'
	| 'P3_attribution_roi'
	| 'P4_retention';

export type GrowthLever =
	| 'seo_landing_page'
	| 'onboarding_friction_reduction'
	| 'activation_nudge'
	| 'pricing_experiment'
	| 'referral_mechanism'
	| 'content_marketing'
	| 'paid_acquisition'
	| 'conversion_rate_optimization';

export interface AnalysisQuery {
	readonly dependsOn: readonly AnalysisPhase[];
	readonly description: string;
	readonly outputArtifact: string;
	readonly phase: AnalysisPhase;
	readonly queryType: 'hogql' | 'retention' | 'stripe_read';
}

export interface GrowthHypothesis {
	readonly effort: 'high' | 'low' | 'medium';
	readonly hypothesis: string;
	readonly id: string;
	readonly impact: 'high' | 'low' | 'medium';
	readonly lever: GrowthLever;
	readonly metricTarget: string;
	readonly prerequisiteData: readonly AnalysisPhase[];
	readonly status: 'hypothesis' | 'in_progress' | 'rejected' | 'shipped' | 'validated';
}

export const PRODUCT_DEFINITION = {
	appPath: '/app',
	authProviders: ['google'] as const,
	domain: 'celstate.com',
	imagePipeline: 'vertex_ai_difference_matting',
	model: 'credit_pack_one_time_purchase',
	name: 'Celstate',
	valueProposition: 'transparent-background PNGs from text prompt; no post-hoc background removal'
} as const;

export const PRICING_MODEL = {
	costPerGeneration: 1,
	creditsExpire: false,
	subscription: false,
	tiers: [
		{ credits: 3, id: 'free', mechanism: 'signup_bonus', priceUsd: 0 },
		{ credits: 1, id: 'weekly_drip', mechanism: 'cron_weekly', priceUsd: 0 },
		{
			credits: 15,
			id: 'starter',
			priceUsd: 5,
			stripePriceId: 'price_1T9zJgADZK8Hnf4rDqrfK6dF'
		},
		{
			credits: 40,
			id: 'pro',
			priceUsd: 10,
			stripePriceId: 'price_1T9zKyADZK8Hnf4rtXt1wS8R'
		}
	]
} as const;

export const CORE_GROWTH_EVENTS = [
	'landing_viewed',
	'landing_cta_clicked',
	'auth_sign_in_started',
	'signed_up',
	'generation_started',
	'generation_completed',
	'generation_failed',
	'image_downloaded',
	'lottie_downloaded',
	'zero_credits_prompt_shown',
	'credits_purchase_cta_clicked',
	'credits_purchase_initiated',
	'credits_purchase_completed',
	'credits_checkout_returned',
	'session_attribution_registered'
] as const;

export const ANALYSIS_QUEUE: readonly AnalysisQuery[] = [
	{
		dependsOn: [],
		description:
			'signed_up → generation_started → generation_completed → credits_purchase_initiated → credits_purchase_completed',
		outputArtifact: 'funnel_conversion_rates',
		phase: 'P0_funnel_baseline',
		queryType: 'hogql'
	},
	{
		dependsOn: [],
		description:
			'GH-004 landing CRO: landing_viewed, landing_cta_clicked, auth_sign_in_started, signed_up — 30d volume',
		outputArtifact: 'landing_to_signup_counts',
		phase: 'P0_funnel_baseline',
		queryType: 'hogql'
	},
	{
		dependsOn: [],
		description:
			'GH-003 free→paid bridge: zero_credits_prompt_shown, credits_purchase_cta_clicked vs credits_purchase_initiated — 30d',
		outputArtifact: 'zero_credits_to_purchase_bridge',
		phase: 'P0_funnel_baseline',
		queryType: 'hogql'
	},
	{
		dependsOn: [],
		description: 'daily_signed_up_count_30d',
		outputArtifact: 'signup_volume_trend',
		phase: 'P0_funnel_baseline',
		queryType: 'hogql'
	},
	{
		dependsOn: [],
		description: 'daily_generation_started_count_30d',
		outputArtifact: 'generation_volume_trend',
		phase: 'P0_funnel_baseline',
		queryType: 'hogql'
	},
	{
		dependsOn: ['P0_funnel_baseline'],
		description: 'pct_users_with_at_least_one_generation_completed_within_24h_of_signup',
		outputArtifact: 'activation_rate_24h',
		phase: 'P1_activation_rate',
		queryType: 'hogql'
	},
	{
		dependsOn: ['P0_funnel_baseline'],
		description: 'signed_up → generation_started: time_to_convert distribution',
		outputArtifact: 'time_to_first_generation',
		phase: 'P1_activation_rate',
		queryType: 'hogql'
	},
	{
		dependsOn: [],
		description: 'total_revenue_all_time, payment_count, unique_paying_customers',
		outputArtifact: 'revenue_summary',
		phase: 'P2_revenue_metrics',
		queryType: 'stripe_read'
	},
	{
		dependsOn: ['P0_funnel_baseline'],
		description: 'credits_purchase_completed aggregated by amount_usd, grouped by user cohort (signup week)',
		outputArtifact: 'revenue_by_cohort',
		phase: 'P2_revenue_metrics',
		queryType: 'hogql'
	},
	{
		dependsOn: [],
		description: 'credits_purchase_completed count + sum(amount_usd) over 90d',
		outputArtifact: 'revenue_trend',
		phase: 'P2_revenue_metrics',
		queryType: 'hogql'
	},
	{
		dependsOn: ['P0_funnel_baseline'],
		description:
			'session_attribution_registered → signed_up → credits_purchase_completed join by distinct_id, grouped by utm_source, utm_medium, referrer',
		outputArtifact: 'attribution_to_revenue_map',
		phase: 'P3_attribution_roi',
		queryType: 'hogql'
	},
	{
		dependsOn: ['P0_funnel_baseline'],
		description: 'weekly retention: signed_up → generation_started, 8 intervals',
		outputArtifact: 'weekly_retention_curve',
		phase: 'P4_retention',
		queryType: 'retention'
	}
] as const;

export const HYPOTHESIS_BACKLOG: readonly GrowthHypothesis[] = [
	{
		effort: 'low',
		hypothesis:
			"celstate.com lacks structured SEO metadata and keyword-targeted content for high-intent queries (e.g., 'AI transparent PNG generator', 'text to transparent image')",
		id: 'GH-001',
		impact: 'high',
		lever: 'seo_landing_page',
		metricTarget: 'organic_signups_per_week',
		prerequisiteData: ['P0_funnel_baseline'],
		status: 'hypothesis'
	},
	{
		effort: 'medium',
		hypothesis:
			'users who sign up do not immediately understand how to generate; reducing steps to first generation increases activation',
		id: 'GH-002',
		impact: 'high',
		lever: 'onboarding_friction_reduction',
		metricTarget: 'activation_rate_24h',
		prerequisiteData: ['P1_activation_rate'],
		status: 'hypothesis'
	},
	{
		effort: 'low',
		hypothesis:
			'users exhaust free credits (3) without purchasing; a well-timed prompt at credit depletion increases purchase conversion',
		id: 'GH-003',
		impact: 'medium',
		lever: 'activation_nudge',
		metricTarget: 'free_to_paid_conversion_rate',
		prerequisiteData: ['P0_funnel_baseline', 'P2_revenue_metrics'],
		status: 'hypothesis'
	},
	{
		effort: 'medium',
		hypothesis:
			'landing page → signup conversion is below industry benchmark for creative tools (5-10%); CRO on hero section increases signups',
		id: 'GH-004',
		impact: 'high',
		lever: 'conversion_rate_optimization',
		metricTarget: 'landing_to_signup_rate',
		prerequisiteData: ['P0_funnel_baseline'],
		status: 'hypothesis'
	},
	{
		effort: 'low',
		hypothesis:
			'starter pack ($5/15cr) underperforms; a lower entry point ($3/10cr) or higher value ($5/25cr) improves purchase rate',
		id: 'GH-005',
		impact: 'medium',
		lever: 'pricing_experiment',
		metricTarget: 'purchase_rate_per_signup',
		prerequisiteData: ['P2_revenue_metrics'],
		status: 'hypothesis'
	},
	{
		effort: 'high',
		hypothesis:
			'no referral system exists; adding share-for-credits increases organic acquisition at near-zero CAC',
		id: 'GH-006',
		impact: 'medium',
		lever: 'referral_mechanism',
		metricTarget: 'referred_signups_per_week',
		prerequisiteData: ['P0_funnel_baseline', 'P4_retention'],
		status: 'hypothesis'
	}
] as const;
