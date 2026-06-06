import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const NO_STORE = { "Cache-Control": "no-store, private" };

export const GET: RequestHandler = async (event) => {
	const auth = event.locals.auth();
	return json(
		{
			authenticated: auth.userId != null,
			sessionId: auth.sessionId,
			userId: auth.userId,
		},
		{ headers: NO_STORE },
	);
};
