export interface SessionAttributionProps {
	landing_path: string;
	referrer?: string;
	utm_campaign?: string;
	utm_medium?: string;
	utm_source?: string;
}

export interface SessionAttributionStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const SESSION_ATTRIBUTION_STORAGE_KEY = 'celstate:session_attribution_registered';

function readSearchParam(url: URL, key: string): string | undefined {
	const value = url.searchParams.get(key)?.trim();
	return value ? value : undefined;
}

export function buildSessionAttributionProps(
	url: URL,
	referrer?: string
): SessionAttributionProps {
	const utmSource = readSearchParam(url, 'utm_source');
	const utmMedium = readSearchParam(url, 'utm_medium');
	const utmCampaign = readSearchParam(url, 'utm_campaign');
	const normalizedReferrer = referrer?.trim() || undefined;

	return {
		landing_path: url.pathname,
		...(normalizedReferrer ? { referrer: normalizedReferrer } : {}),
		...(utmSource ? { utm_source: utmSource } : {}),
		...(utmMedium ? { utm_medium: utmMedium } : {}),
		...(utmCampaign ? { utm_campaign: utmCampaign } : {})
	};
}

export function hasCapturedSessionAttribution(storage: SessionAttributionStorage): boolean {
	return storage.getItem(SESSION_ATTRIBUTION_STORAGE_KEY) === '1';
}

export function markSessionAttributionCaptured(storage: SessionAttributionStorage): void {
	storage.setItem(SESSION_ATTRIBUTION_STORAGE_KEY, '1');
}

export function captureSessionAttributionOnce(args: {
	capture: (event: 'session_attribution_registered', properties: SessionAttributionProps) => void;
	referrer?: string;
	storage: SessionAttributionStorage;
	url: URL;
}): boolean {
	if (hasCapturedSessionAttribution(args.storage)) {
		return false;
	}

	args.capture('session_attribution_registered', buildSessionAttributionProps(args.url, args.referrer));
	markSessionAttributionCaptured(args.storage);
	return true;
}
