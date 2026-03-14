export const withResponseHeader = (response: Response, name: string, value: string) => {
	const headers = new Headers(response.headers);
	headers.set(name, value);

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};
