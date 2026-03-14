import { browser } from "$app/environment";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/svelte";

const DEFAULT_LOCAL_SITE_URL = "http://localhost:5173";

const toAbsoluteHttpUrl = (value?: string) => {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    return url.origin;
  } catch {
    return undefined;
  }
};

export const resolveAuthClientBaseUrl = ({
  publicSiteUrl = PUBLIC_SITE_URL,
  browserOrigin = browser ? window.location.origin : undefined,
}: {
  publicSiteUrl?: string;
  browserOrigin?: string;
} = {}) =>
  toAbsoluteHttpUrl(browserOrigin) ??
  toAbsoluteHttpUrl(publicSiteUrl) ??
  DEFAULT_LOCAL_SITE_URL;

export const authClient = createAuthClient({
  baseURL: resolveAuthClientBaseUrl(),
  plugins: [convexClient()],
});
