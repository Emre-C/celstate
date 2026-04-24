/**
 * Shared helpers for HTTP route handlers that authenticate via Bearer tokens
 * and serialize responses as JSON. Consolidates the try/catch + status mapping
 * block repeated across every `/verification/*` route in `http.ts`.
 */

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const parseBearer = (request: Request): string => {
  const auth = request.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
};

/**
 * Runs the supplied handler and serializes the result. On error, maps the
 * `Unauthorized` marker thrown by runner-secret helpers to HTTP 401 and all
 * other errors to HTTP 400 with the error message in the body.
 */
export const jsonRouteHandler = async <T>(
  handler: () => Promise<T>,
): Promise<Response> => {
  try {
    const result = await handler();
    return jsonResponse(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 400;
    return jsonResponse({ error: msg }, status);
  }
};
