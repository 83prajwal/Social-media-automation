import fs from "fs";
import { db } from "@/lib/db";
import { enqueue, runGeneration } from "@/lib/generate";
import { mediaAbs } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Regenerate a post's copy and media from scratch (keeps its settings). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = db.getPost(id);
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  if (post.status === "generating" || post.status === "publishing") {
    return Response.json({ error: "A job is already running for this post" }, { status: 409 });
  }
  if (Object.values(post.results).some((r) => r?.status === "published")) {
    return Response.json({ error: "Already published somewhere – generate a new post instead" }, { status: 409 });
  }
  fs.rmSync(mediaAbs(id), { recursive: true, force: true });
  db.updatePost(id, { status: "generating", progress: "Queued…", error: undefined, slides: [], video: undefined, results: {} });
  enqueue(() => runGeneration(id));
  return Response.json({ ok: true });
}
