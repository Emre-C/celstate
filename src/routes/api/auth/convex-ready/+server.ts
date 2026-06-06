import { ConvexHttpClient } from "convex/browser";
import { json } from "@sveltejs/kit";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { api } from "../../../../convex/_generated/api.js";
import type { RequestHandler } from "./$types";

const NO_STORE = { "Cache-Control": "no-store, private" };

export const GET: RequestHandler = async (event) => {
	const token = await event.locals.auth().getToken({ template: "convex" });
	if (!token) {
		return json({ ok: false }, { status: 401, headers: NO_STORE });
	}

	const client = new ConvexHttpClient(PUBLIC_CONVEX_URL, { auth: token });

	try {
		const me = await client.query(api.users.getMe, {});
		return json({ ok: true, userId: me?._id ?? null }, { headers: NO_STORE });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, { status: 502, headers: NO_STORE });
	}
};
