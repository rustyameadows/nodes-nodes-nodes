import { getDb } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { claimNextJob, heartbeatJob, recoverStaleRunningJobs } from "@/lib/services/jobs";
import { processJobById } from "@/lib/server/job-processor";
import { eq } from "drizzle-orm";

let busy = false;

function emit(event: "assets.changed" | "jobs.changed", projectId?: string) {
  process.send?.({
    type: "event",
    event,
    projectId,
  });
}

async function tick() {
  if (busy) {
    return;
  }

  const claimed = claimNextJob();
  if (!claimed) {
    return;
  }

  busy = true;
  const job = getDb().select().from(jobs).where(eq(jobs.id, claimed.id)).get();
  const heartbeat = setInterval(() => {
    heartbeatJob(claimed.id, claimed.claimToken);
  }, 2000);

  try {
    await processJobById(claimed.id);
    emit("jobs.changed", job?.projectId);
    emit("assets.changed", job?.projectId);
  } catch (error) {
    console.error("Worker failed to process job", error);
  } finally {
    clearInterval(heartbeat);
    busy = false;
  }
}

recoverStaleRunningJobs();
setInterval(() => {
  void tick();
}, 1000);

void tick();
