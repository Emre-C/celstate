const toAbsoluteHttpOrigin = (value?: string) => {
	const trimmed = value?.trim();

	if (!trimmed) {
		return undefined;
	}

	try {
		const url = new URL(trimmed);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
	} catch {
		return undefined;
	}
};

export const getCanonicalRedirectUrl = ({
	requestUrl,
	publicSiteUrl
}: {
	requestUrl: string | URL;
	publicSiteUrl?: string;
}) => {
	const canonicalOrigin = toAbsoluteHttpOrigin(publicSiteUrl);

	if (!canonicalOrigin) {
		return undefined;
	}

	const currentUrl = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl;

	if (currentUrl.origin === canonicalOrigin) {
		return undefined;
	}

	return new URL(`${currentUrl.pathname}${currentUrl.search}`, canonicalOrigin).toString();
};

export const createCanonicalRedirectResponse = (location: string, requestId: string) =>
	new Response(null, {
		status: 308,
		headers: {
			location,
			'x-request-id': requestId
		}
	});
