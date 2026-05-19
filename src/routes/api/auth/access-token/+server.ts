import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
	accessTokenJsonForConvex,
	AUTH_ACCESS_TOKEN_NO_STORE,
} from "$lib/server/access-token-response.js";

export const GET: RequestHandler = async (event) => {
	const token = event.locals.auth?.accessToken;
	const { body, status } = accessTokenJsonForConvex(token);
	return json(body, { status, headers: AUTH_ACCESS_TOKEN_NO_STORE });
};
