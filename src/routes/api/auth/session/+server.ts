import { json } from "@sveltejs/kit";
import { authKit } from "@workos/authkit-sveltekit";
import type { RequestHandler } from "./$types";

const NO_STORE = { "Cache-Control": "no-store, private" };

export const GET: RequestHandler = async (event) => {
	const user = await authKit.getUser(event);
	return json({ authenticated: user != null }, { headers: NO_STORE });
};
