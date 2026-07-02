import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval(
  "cleanup stale generations",
  { minutes: 1 },
  internal.generations.cleanupStaleGenerations,
);

crons.interval(
  "cleanup stale lottie generations",
  { minutes: 5 },
  internal.lottieGenerations.cleanupStaleLottieGenerations,
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
  "purge expired generation artifacts",
  "0 6 * * *", // Daily at 06:00 UTC
  internal.generationArtifactRetention.purgeExpiredGenerationArtifacts,
  {},
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
// rotating Clerk credentials, Vertex SA keys, and the manually-rotated
// vendor secrets (Stripe, Google OAuth). Background:
// docs/runbooks/SECRETS-MANAGEMENT.md.
crons.cron(
  "secret rotation reminder",
  "0 14 1 1,4,7,10 *",
  internal.ops.sendSecretRotationReminder,
  {},
);

// Daily behavior-driven welcome email check at 8am ET (12:00 UTC during EDT).
// Finds users who signed up 3-24 hours ago and haven't received a welcome email,
// classifies their behavior, and sends the appropriate scenario email.
crons.cron(
  "process welcome emails",
  "0 12 * * *", // 12:00 UTC = 8:00 EDT / 7:00 EST
  internal.emails.processWelcomeEmails,
  {},
);

export default crons;
