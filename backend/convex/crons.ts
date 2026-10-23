import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Empties the trash of tasks deleted more than 30 days ago.
crons.daily("purge expired trash", { hourUTC: 3, minuteUTC: 30 }, internal.ops.purgeTrash, {});

// Removes pairing codes that expired more than a day ago.
crons.daily("purge expired pairing codes", { hourUTC: 3, minuteUTC: 45 }, internal.devices.purgeExpiredCodes, {});

// Removes OAuth requests and tokens that ended more than a day ago, and unused client registrations.
crons.daily("purge expired oauth records", { hourUTC: 4, minuteUTC: 0 }, internal.oauth.purgeExpired, {});

export default crons;
