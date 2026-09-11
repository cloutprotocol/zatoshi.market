import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Advance pending inscriptions to confirmed/failed. Zcash blocks are ~75s apart, so
// 2 minutes keeps status fresh without hammering the RPC fallbacks (Tatum free tier: 3 req/s).
crons.interval(
  "refresh pending inscriptions",
  { minutes: 2 },
  internal.inscriptionStatusActions.refreshPendingInscriptions,
  {}
);

export default crons;
