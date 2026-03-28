import type { AnalysisPhase } from './growth-runbook.js';

export interface GrowthQueryPreset {
	readonly description: string;
	readonly outputArtifact: string;
	readonly phase: AnalysisPhase;
	readonly query: string;
}

export const GROWTH_QUERY_PRESETS: readonly GrowthQueryPreset[] = [
	{
		description:
			'signed_up → generation_started → generation_completed → credits_purchase_initiated → credits_purchase_completed counts over the last 30 days',
		outputArtifact: 'funnel_conversion_rates',
		phase: 'P0_funnel_baseline',
		query: `WITH signed_up AS (
	SELECT person_id, min(timestamp) AS occurred_at
	FROM events
	WHERE event = 'signed_up'
		AND timestamp >= now() - INTERVAL 30 DAY
		AND person_id IS NOT NULL
	GROUP BY person_id
), generation_started AS (
	SELECT person_id, min(timestamp) AS occurred_at
	FROM events
	WHERE event = 'generation_started'
		AND timestamp >= now() - INTERVAL 30 DAY
		AND person_id IS NOT NULL
	GROUP BY person_id
), generation_completed AS (
	SELECT person_id, min(timestamp) AS occurred_at
	FROM events
	WHERE event = 'generation_completed'
		AND timestamp >= now() - INTERVAL 30 DAY
		AND person_id IS NOT NULL
	GROUP BY person_id
), credits_purchase_initiated AS (
	SELECT person_id, min(timestamp) AS occurred_at
	FROM events
	WHERE event = 'credits_purchase_initiated'
		AND timestamp >= now() - INTERVAL 30 DAY
		AND person_id IS NOT NULL
	GROUP BY person_id
), credits_purchase_completed AS (
	SELECT person_id, min(timestamp) AS occurred_at
	FROM events
	WHERE event = 'credits_purchase_completed'
		AND timestamp >= now() - INTERVAL 30 DAY
		AND person_id IS NOT NULL
	GROUP BY person_id
)
SELECT stage, users
FROM (
	SELECT 'signed_up' AS stage, count() AS users FROM signed_up
	UNION ALL
	SELECT 'generation_started' AS stage, count()
	FROM signed_up s
	INNER JOIN generation_started g ON g.person_id = s.person_id
	WHERE g.occurred_at >= s.occurred_at
	UNION ALL
	SELECT 'generation_completed' AS stage, count()
	FROM signed_up s
	INNER JOIN generation_completed g ON g.person_id = s.person_id
	WHERE g.occurred_at >= s.occurred_at
	UNION ALL
	SELECT 'credits_purchase_initiated' AS stage, count()
	FROM signed_up s
	INNER JOIN credits_purchase_initiated c ON c.person_id = s.person_id
	WHERE c.occurred_at >= s.occurred_at
	UNION ALL
	SELECT 'credits_purchase_completed' AS stage, count()
	FROM signed_up s
	INNER JOIN credits_purchase_completed c ON c.person_id = s.person_id
	WHERE c.occurred_at >= s.occurred_at
)
ORDER BY CASE stage
	WHEN 'signed_up' THEN 1
	WHEN 'generation_started' THEN 2
	WHEN 'generation_completed' THEN 3
	WHEN 'credits_purchase_initiated' THEN 4
	ELSE 5
END`
	},
	{
		description:
			'GH-004: landing_viewed, landing_cta_clicked, auth_sign_in_started, signed_up — raw 30d counts (volume for CRO)',
		outputArtifact: 'landing_to_signup_counts',
		phase: 'P0_funnel_baseline',
		query: `SELECT
	event,
	count() AS event_count
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
	AND event IN ('landing_viewed', 'landing_cta_clicked', 'auth_sign_in_started', 'signed_up')
GROUP BY event
ORDER BY event ASC`
	},
	{
		description:
			'GH-003: zero_credits_prompt_shown, credits_purchase_cta_clicked, credits_purchase_initiated, credits_purchase_completed — 30d counts',
		outputArtifact: 'zero_credits_to_purchase_bridge',
		phase: 'P0_funnel_baseline',
		query: `SELECT
	event,
	count() AS event_count
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
	AND event IN (
		'zero_credits_prompt_shown',
		'credits_purchase_cta_clicked',
		'credits_purchase_initiated',
		'credits_purchase_completed'
	)
GROUP BY event
ORDER BY event ASC`
	},
	{
		description: 'daily signed_up volume over the last 30 days',
		outputArtifact: 'signup_volume_trend',
		phase: 'P0_funnel_baseline',
		query: `SELECT toDate(timestamp) AS day, count() AS signed_up_users
FROM events
WHERE event = 'signed_up'
	AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day ASC`
	},
	{
		description: 'daily generation_started volume over the last 30 days',
		outputArtifact: 'generation_volume_trend',
		phase: 'P0_funnel_baseline',
		query: `SELECT toDate(timestamp) AS day, count() AS generation_started_users
FROM events
WHERE event = 'generation_started'
	AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day ASC`
	},
	{
		description: 'share of signups completing at least one generation within 24 hours',
		outputArtifact: 'activation_rate_24h',
		phase: 'P1_activation_rate',
		query: `WITH signups AS (
	SELECT person_id, min(timestamp) AS signed_up_at
	FROM events
	WHERE event = 'signed_up'
		AND timestamp >= now() - INTERVAL 30 DAY
		AND person_id IS NOT NULL
	GROUP BY person_id
), first_generation_completed AS (
	SELECT person_id, min(timestamp) AS generation_completed_at
	FROM events
	WHERE event = 'generation_completed'
		AND person_id IS NOT NULL
	GROUP BY person_id
)
SELECT
	count() AS signed_up_users,
	countIf(
		g.generation_completed_at IS NOT NULL
		AND g.generation_completed_at >= s.signed_up_at
		AND dateDiff('hour', s.signed_up_at, g.generation_completed_at) <= 24
	) AS activated_users_24h,
	round(
		if(
			count() = 0,
			0,
			countIf(
				g.generation_completed_at IS NOT NULL
				AND g.generation_completed_at >= s.signed_up_at
				AND dateDiff('hour', s.signed_up_at, g.generation_completed_at) <= 24
			) * 100.0 / count()
		),
		2
	) AS activation_rate_pct_24h
FROM signups s
LEFT JOIN first_generation_completed g ON g.person_id = s.person_id`
	},
	{
		description: 'time to first generation_started for recent signups',
		outputArtifact: 'time_to_first_generation',
		phase: 'P1_activation_rate',
		query: `WITH signups AS (
	SELECT person_id, min(timestamp) AS signed_up_at
	FROM events
	WHERE event = 'signed_up'
		AND timestamp >= now() - INTERVAL 30 DAY
		AND person_id IS NOT NULL
	GROUP BY person_id
), first_generation_started AS (
	SELECT person_id, min(timestamp) AS generation_started_at
	FROM events
	WHERE event = 'generation_started'
		AND person_id IS NOT NULL
	GROUP BY person_id
)
SELECT
	s.person_id,
	s.signed_up_at,
	g.generation_started_at,
	round(dateDiff('minute', s.signed_up_at, g.generation_started_at) / 60.0, 2) AS hours_to_first_generation
FROM signups s
INNER JOIN first_generation_started g ON g.person_id = s.person_id
WHERE g.generation_started_at >= s.signed_up_at
ORDER BY hours_to_first_generation ASC
LIMIT 5000`
	},
	{
		description: 'authoritative server-side revenue summary from credits_purchase_completed',
		outputArtifact: 'revenue_summary',
		phase: 'P2_revenue_metrics',
		query: `SELECT
	count() AS payment_count,
	uniqExact(person_id) AS unique_paying_customers,
	round(sum(toFloat64(properties.amount_usd)), 2) AS total_revenue_usd,
	round(avg(toFloat64(properties.amount_usd)), 2) AS avg_revenue_per_purchase_usd
FROM events
WHERE event = 'credits_purchase_completed'
	AND person_id IS NOT NULL`
	},
	{
		description: 'server-side revenue grouped by signup cohort week',
		outputArtifact: 'revenue_by_cohort',
		phase: 'P2_revenue_metrics',
		query: `WITH signups AS (
	SELECT person_id, toStartOfWeek(min(timestamp)) AS signup_week
	FROM events
	WHERE event = 'signed_up'
		AND person_id IS NOT NULL
	GROUP BY person_id
), purchases AS (
	SELECT
		person_id,
		count() AS purchase_count,
		round(sum(toFloat64(properties.amount_usd)), 2) AS revenue_usd
	FROM events
	WHERE event = 'credits_purchase_completed'
		AND person_id IS NOT NULL
	GROUP BY person_id
)
SELECT
	s.signup_week,
	count() AS cohort_users,
	countIf(ifNull(p.purchase_count, 0) > 0) AS paying_users,
	round(sum(ifNull(p.revenue_usd, 0)), 2) AS revenue_usd,
	round(if(count() = 0, 0, sum(ifNull(p.revenue_usd, 0)) / count()), 2) AS revenue_per_user_usd
FROM signups s
LEFT JOIN purchases p ON p.person_id = s.person_id
GROUP BY s.signup_week
ORDER BY s.signup_week DESC`
	},
	{
		description: 'daily revenue trend over the last 90 days from server-side purchase events',
		outputArtifact: 'revenue_trend',
		phase: 'P2_revenue_metrics',
		query: `SELECT
	toDate(timestamp) AS day,
	count() AS payment_count,
	round(sum(toFloat64(properties.amount_usd)), 2) AS revenue_usd
FROM events
WHERE event = 'credits_purchase_completed'
	AND timestamp >= now() - INTERVAL 90 DAY
GROUP BY day
ORDER BY day ASC`
	},
	{
		description: 'attribution source to signup and revenue using merged PostHog person_id identity',
		outputArtifact: 'attribution_to_revenue_map',
		phase: 'P3_attribution_roi',
		query: `WITH attribution AS (
	SELECT
		person_id,
		argMin(properties.utm_source, timestamp) AS utm_source,
		argMin(properties.utm_medium, timestamp) AS utm_medium,
		argMin(properties.referrer, timestamp) AS referrer,
		min(timestamp) AS attributed_at
	FROM events
	WHERE event = 'session_attribution_registered'
		AND person_id IS NOT NULL
	GROUP BY person_id
), signups AS (
	SELECT person_id, min(timestamp) AS signed_up_at
	FROM events
	WHERE event = 'signed_up'
		AND person_id IS NOT NULL
	GROUP BY person_id
), purchases AS (
	SELECT
		person_id,
		count() AS purchase_count,
		round(sum(toFloat64(properties.amount_usd)), 2) AS revenue_usd
	FROM events
	WHERE event = 'credits_purchase_completed'
		AND person_id IS NOT NULL
	GROUP BY person_id
)
SELECT
	ifNull(nullIf(a.utm_source, ''), '(direct)') AS utm_source,
	ifNull(nullIf(a.utm_medium, ''), '(none)') AS utm_medium,
	ifNull(nullIf(a.referrer, ''), '(none)') AS referrer,
	count() AS attributed_people,
	countIf(s.signed_up_at IS NOT NULL AND s.signed_up_at >= a.attributed_at) AS signed_up_users,
	countIf(ifNull(p.purchase_count, 0) > 0) AS paying_users,
	round(sum(ifNull(p.revenue_usd, 0)), 2) AS revenue_usd
FROM attribution a
LEFT JOIN signups s ON s.person_id = a.person_id
LEFT JOIN purchases p ON p.person_id = a.person_id
GROUP BY utm_source, utm_medium, referrer
ORDER BY revenue_usd DESC, signed_up_users DESC`
	},
	{
		description: 'weekly generation_started retention for signup cohorts over the first 8 weeks',
		outputArtifact: 'weekly_retention_curve',
		phase: 'P4_retention',
		query: `WITH signups AS (
	SELECT
		person_id,
		min(timestamp) AS signed_up_at,
		toStartOfWeek(min(timestamp)) AS signup_week
	FROM events
	WHERE event = 'signed_up'
		AND person_id IS NOT NULL
	GROUP BY person_id
), retention_activity AS (
	SELECT
		s.signup_week,
		dateDiff('week', toStartOfWeek(s.signed_up_at), toStartOfWeek(e.timestamp)) AS week_number,
		uniqExact(s.person_id) AS retained_users
	FROM signups s
	INNER JOIN events e ON e.person_id = s.person_id
	WHERE e.event = 'generation_started'
		AND e.timestamp >= s.signed_up_at
		AND dateDiff('week', toStartOfWeek(s.signed_up_at), toStartOfWeek(e.timestamp)) BETWEEN 0 AND 7
	GROUP BY s.signup_week, week_number
), cohort_sizes AS (
	SELECT signup_week, count() AS cohort_users
	FROM signups
	GROUP BY signup_week
)
SELECT
	r.signup_week,
	r.week_number,
	c.cohort_users,
	r.retained_users,
	round(if(c.cohort_users = 0, 0, r.retained_users * 100.0 / c.cohort_users), 2) AS retained_pct
FROM retention_activity r
INNER JOIN cohort_sizes c ON c.signup_week = r.signup_week
ORDER BY r.signup_week DESC, r.week_number ASC`
	}
] as const;

export const GROWTH_QUERY_PRESET_BY_ARTIFACT = new Map(
	GROWTH_QUERY_PRESETS.map((preset) => [preset.outputArtifact, preset] as const)
);
