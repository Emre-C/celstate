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

crons.weekly(
  "weekly free credit",
  { dayOfWeek: "monday", hourUTC: 14, minuteUTC: 0 },
  internal.users.grantWeeklyCredit,
);

export default crons;
