import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const NO_STORE = { "Cache-Control": "no-store, private" };

export const GET: RequestHandler = () => {
	return json({ token: null }, { status: 410, headers: NO_STORE });
};
