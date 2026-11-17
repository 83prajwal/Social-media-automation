import { db } from "@/lib/db";
import { publishPost } from "@/lib/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = db.getPost(id);
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  if (!post.slides.length) return Response.json({ error: "This post has no media yet" }, { status: 400 });
  if (post.status === "publishing" || post.status === "generating") {
    return Response.json({ error: "A job is already running for this post" }, { status: 409 });
  }
  void publishPost(id); // runs in the background; the dashboard polls for progress
  return Response.json({ ok: true });
}
