import { defineApp } from "convex/server";
import stripe from "@convex-dev/stripe/convex.config.js";
import posthog from "@posthog/convex/convex.config.js";

const app = defineApp();
app.use(stripe);
app.use(posthog);

export default app;
