/** Fetch a URL and trigger a browser download under the given filename. */
export async function downloadUrlAsFile(url: string, filename: string): Promise<void> {
	const response = await fetch(url);
	const blob = await response.blob();
	const objectUrl = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = objectUrl;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	URL.revokeObjectURL(objectUrl);
}
