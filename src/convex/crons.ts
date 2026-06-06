import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval(
  "cleanup stale generations",
  { minutes: 1 },
  internal.generations.cleanupStaleGenerations,
);

crons.interval(
  "cleanup expired upload url issues",
  { hours: 1 },
  internal.generations.cleanupExpiredUploadUrlIssues,
);

crons.interval(
  "cleanup orphaned reference uploads",
  { hours: 1 },
  internal.generations.cleanupOrphanedReferenceUploads,
);

crons.cron(
  "weekly free credit",
  "0 14 * * 1", // Mondays at 14:00 UTC
  internal.users.grantWeeklyCredit,
  {},
);

// Quarterly secret-rotation reminder posted to the Discord ops webhook
// (OPS_ALERT_WEBHOOK_URL). Runs at 14:00 UTC on the 1st day of January,
// April, July, and October — ~91 days apart, the standard cadence for
// rotating Clerk credentials, JWT (legacy), Vertex SA keys, and the manually-rotated
// vendor secrets (Stripe, Google OAuth). Background:
// docs/runbooks/SECRETS-MANAGEMENT.md.
crons.cron(
  "secret rotation reminder",
  "0 14 1 1,4,7,10 *",
  internal.ops.sendSecretRotationReminder,
  {},
);

export default crons;
