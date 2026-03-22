import { PostHog } from "@posthog/convex";
import { components } from "./_generated/api";

const posthogComponent = (components as Record<string, unknown>).posthog as ConstructorParameters<typeof PostHog>[0];

export const posthog = new PostHog(posthogComponent);
