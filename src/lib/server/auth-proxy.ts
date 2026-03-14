const getForwardedPort = (url: URL) => {
	if (url.port) {
		return url.port;
	}

	return url.protocol === 'https:' ? '443' : '80';
};

export const buildAuthProxyRequest = (
	request: Request,
	convexSiteUrl: string,
	requestId?: string
) => {
	const sourceUrl = new URL(request.url);
	const targetUrl = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, convexSiteUrl);
	const proxiedRequest = new Request(targetUrl, request);

	proxiedRequest.headers.set('host', targetUrl.host);
	proxiedRequest.headers.set('x-forwarded-host', sourceUrl.host);
	proxiedRequest.headers.set('x-forwarded-proto', sourceUrl.protocol.slice(0, -1));
	proxiedRequest.headers.set('x-forwarded-port', getForwardedPort(sourceUrl));
	proxiedRequest.headers.set('accept-encoding', 'application/json');

	if (requestId) {
		proxiedRequest.headers.set('x-request-id', requestId);
	}

	return proxiedRequest;
};

export const proxyAuthRequest = (request: Request, convexSiteUrl: string, requestId?: string) =>
	fetch(buildAuthProxyRequest(request, convexSiteUrl, requestId), {
		method: request.method,
		redirect: 'manual'
	});
