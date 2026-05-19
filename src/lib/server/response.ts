export const withResponseHeader = (response: Response, name: string, value: string) => {
	const headers = new Headers(response.headers);

	// Preserve Set-Cookie headers explicitly because new Headers()
	// from another Headers object can comma-join them, which breaks
	// cookie clearing on sign-out and other auth boundaries.
	const setCookies = response.headers.getSetCookie?.() ?? [];
	if (setCookies.length > 0) {
		headers.delete("Set-Cookie");
		for (const cookie of setCookies) {
			headers.append("Set-Cookie", cookie);
		}
	}

	headers.set(name, value);

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};
