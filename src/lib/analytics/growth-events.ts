/**
 * PostHog event names for GH-003 (credit depletion → purchase) and GH-004 (landing CRO).
 * Keep in sync with `CORE_GROWTH_EVENTS` in `scripts/lib/growth-runbook.ts`.
 */
export const growthEvents = {
	authSignInStarted: 'auth_sign_in_started',
	creditsPurchaseCtaClicked: 'credits_purchase_cta_clicked',
	imageDownloaded: 'image_downloaded',
	landingCtaClicked: 'landing_cta_clicked',
	landingViewed: 'landing_viewed',
	lottieDownloaded: 'lottie_downloaded',
	zeroCreditsPromptShown: 'zero_credits_prompt_shown'
} as const;

export type CreditsPurchaseCtaSurface =
	| 'credits_page'
	| 'navbar'
	| 'post_generation_banner'
	| 'prompt_input';

export type ImageDownloadVariant = 'standard' | 'hires';
