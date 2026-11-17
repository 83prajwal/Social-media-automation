import { db } from "./db";
import { publishPost } from "./publish";

async function tick() {
  const now = Date.now();
  const due = db
    .listPosts()
    .filter((p) => p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt).getTime() <= now);
  for (const p of due) {
    console.log(`[scheduler] publishing ${p.id}`);
    await publishPost(p.id).catch((e) => console.error("[scheduler]", e));
  }
}

export function startScheduler() {
  const g = globalThis as { __scheduler?: NodeJS.Timeout };
  if (g.__scheduler) return;

  // Jobs that were running when the server stopped can't resume – mark them so they can be retried.
  for (const p of db.listPosts()) {
    if (p.status === "generating" || p.status === "publishing") {
      db.updatePost(p.id, {
        status: p.status === "generating" ? "failed" : "partial",
        error: "Interrupted by a server restart – click Retry.",
        progress: undefined,
      });
    }
  }

  g.__scheduler = setInterval(() => void tick(), 60_000);
  void tick();
  console.log("[scheduler] started (checks every 60s)");
}
