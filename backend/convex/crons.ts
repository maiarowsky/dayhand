import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Empties the trash of tasks deleted more than 30 days ago.
crons.daily("purge expired trash", { hourUTC: 3, minuteUTC: 30 }, internal.ops.purgeTrash, {});

export default crons;
