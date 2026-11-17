import type { Platform, Post } from "./types";

/** Final caption text sent to each platform (caption + hashtags). Safe to import on the client. */
export function composeCaption(post: Pick<Post, "captions" | "hashtags">, platform: Platform) {
  const tags = post.hashtags.map((h) => "#" + h.replace(/^#+/, "").replace(/\s+/g, "")).filter((t) => t.length > 1);
  if (platform === "instagram") return `${post.captions.instagram}\n\n${tags.slice(0, 20).join(" ")}`.trim().slice(0, 2200);
  if (platform === "facebook") return `${post.captions.facebook}\n\n${tags.slice(0, 3).join(" ")}`.trim();
  return post.captions.pinterestDescription.slice(0, 800);
}
