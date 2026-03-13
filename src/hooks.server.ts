import type { Handle } from "@sveltejs/kit";
import { getConvexJwtToken } from "$lib/server/auth.js";

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.token = getConvexJwtToken(event.cookies);
  return resolve(event);
};
