import { db } from "../db";
import { errMsg } from "../util";
import type { Platform, PlatformResult } from "../types";
import { publishFacebook, publishInstagram } from "./meta";
import { publishPinterest } from "./pinterest";

/** Publish a post to all its selected platforms. Already-published platforms are skipped (safe to retry). */
export async function publishPost(id: string) {
  const post = db.getPost(id);
  if (!post || post.status === "publishing" || post.status === "generating") return;
  const product = db.getProduct(post.productId);
  if (!product) {
    db.updatePost(id, { status: "failed", error: "Product not found" });
    return;
  }
  db.updatePost(id, { status: "publishing", error: undefined, progress: "Publishing…" });

  const results = { ...post.results };
  for (const platform of post.platforms) {
    if (results[platform]?.status === "published") continue;
    db.updatePost(id, { progress: `Publishing to ${platform}…` });
    let result: PlatformResult;
    try {
      const r =
        platform === "instagram"
          ? await publishInstagram(post)
          : platform === "facebook"
            ? await publishFacebook(post)
            : await publishPinterest(post, product);
      result = { status: "published", ...r, at: new Date().toISOString() };
    } catch (e) {
      console.error(`[publish:${platform}]`, e);
      result = { status: "failed", error: errMsg(e), at: new Date().toISOString() };
    }
    results[platform as Platform] = result;
    db.updatePost(id, { results: { ...results } });
  }

  const ok = post.platforms.filter((p) => results[p]?.status === "published").length;
  db.updatePost(id, {
    status: ok === post.platforms.length ? "published" : ok > 0 ? "partial" : "failed",
    error: ok === post.platforms.length ? undefined : "Some platforms failed – see details below.",
    progress: undefined,
  });
}
