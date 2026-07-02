import { defineApp } from "convex/server";
import stripe from "@convex-dev/stripe/convex.config.js";
import posthog from "@posthog/convex/convex.config.js";
import resend from "@convex-dev/resend/convex.config.js";

const app = defineApp();
app.use(stripe);
app.use(posthog);
app.use(resend);

export default app;
