import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval(
  "cleanup stale generations",
  { minutes: 1 },
  internal.generations.cleanupStaleGenerations,
);

export default crons;
