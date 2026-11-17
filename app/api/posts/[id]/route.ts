import fs from "fs";
import { db } from "@/lib/db";
import { mediaAbs } from "@/lib/paths";
import { PLATFORMS, type Platform, type Post } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const post = db.getPost(id);
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  if (post.status === "generating" || post.status === "publishing") {
    return Response.json({ error: "Wait until the current job finishes" }, { status: 409 });
  }
  const body = await req.json();
  const patch: Partial<Post> = {};
  if (body.captions) {
    patch.captions = {
      instagram: String(body.captions.instagram ?? post.captions.instagram),
      facebook: String(body.captions.facebook ?? post.captions.facebook),
      pinterestTitle: String(body.captions.pinterestTitle ?? post.captions.pinterestTitle).slice(0, 100),
      pinterestDescription: String(body.captions.pinterestDescription ?? post.captions.pinterestDescription).slice(0, 800),
    };
  }
  if (Array.isArray(body.hashtags)) {
    patch.hashtags = body.hashtags.map((h: unknown) => String(h).replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean);
  }
  if (Array.isArray(body.platforms)) {
    patch.platforms = body.platforms.filter((p: Platform) => PLATFORMS.includes(p));
    if (!patch.platforms!.length) return Response.json({ error: "Choose at least one platform" }, { status: 400 });
  }
  if (body.action === "schedule") {
    if (!body.scheduledAt || isNaN(Date.parse(body.scheduledAt))) {
      return Response.json({ error: "Pick a valid date and time" }, { status: 400 });
    }
    patch.status = "scheduled";
    patch.scheduledAt = new Date(body.scheduledAt).toISOString();
  } else if (body.action === "unschedule") {
    patch.status = "draft";
    patch.scheduledAt = undefined;
  }
  return Response.json(db.updatePost(id, patch));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const post = db.getPost(id);
  if (post?.status === "generating" || post?.status === "publishing") {
    return Response.json({ error: "Wait until the current job finishes" }, { status: 409 });
  }
  db.deletePost(id);
  fs.rmSync(mediaAbs(id), { recursive: true, force: true });
  return Response.json({ ok: true });
}
