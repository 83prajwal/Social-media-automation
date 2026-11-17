import { db } from "@/lib/db";
import { enqueue, runGeneration } from "@/lib/generate";
import { FORMATS, PLATFORMS, type GenOptions, type Platform, type Post, type PostFormat } from "@/lib/types";
import { clamp, newId } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const product = db.getProduct(body.productId);
  if (!product) return Response.json({ error: "Pick a product first" }, { status: 400 });

  const formats = (body.formats as PostFormat[] | undefined)?.filter((f) => FORMATS.includes(f)) ?? [];
  const platforms = (body.platforms as Platform[] | undefined)?.filter((p) => PLATFORMS.includes(p)) ?? [];
  if (!formats.length) return Response.json({ error: "Choose at least one post type" }, { status: 400 });
  if (!platforms.length) return Response.json({ error: "Choose at least one platform" }, { status: 400 });

  const after = ["draft", "publish", "schedule"].includes(body.after) ? body.after : "draft";
  if (after === "schedule" && !(body.scheduledAt && !isNaN(Date.parse(body.scheduledAt)))) {
    return Response.json({ error: "Pick a date and time to schedule" }, { status: 400 });
  }
  const variations = clamp(Number(body.variations ?? 1), 1, 5);

  const genOptions: GenOptions = {
    slideCount: clamp(Number(body.slideCount ?? 5), 2, 10),
    sceneCount: clamp(Number(body.sceneCount ?? 5), 3, 10),
    useProductPhotos: !!body.useProductPhotos,
    textOverlay: !!body.textOverlay,
    style: String(body.style ?? "").slice(0, 1500),
    tone: String(body.tone ?? "").slice(0, 300),
    notes: String(body.notes ?? "").slice(0, 1500),
    after,
    scheduledAt: after === "schedule" ? new Date(body.scheduledAt).toISOString() : undefined,
  };

  const created: Post[] = [];
  const now = new Date().toISOString();
  for (let v = 0; v < variations; v++) {
    for (const format of formats) {
      const post = db.addPost({
        id: newId("post"),
        productId: product.id,
        format,
        // Pinterest has no carousel *video*; all formats are supported on all three platforms.
        platforms,
        status: "generating",
        progress: "Queued…",
        captions: { instagram: "", facebook: "", pinterestTitle: "", pinterestDescription: "" },
        hashtags: [],
        slides: [],
        results: {},
        genOptions,
        createdAt: now,
        updatedAt: now,
      });
      created.push(post);
      enqueue(() => runGeneration(post.id));
    }
  }
  return Response.json(created);
}
