import fs from "fs";
import { composeCaption } from "../captions";
import { mediaAbs } from "../paths";
import { sleep, toBlob } from "../util";
import type { Post } from "../types";

const V = () => process.env.META_GRAPH_VERSION || "v23.0";
const G = (p: string) => `https://graph.facebook.com/${V()}/${p}`;
const token = () => {
  const t = process.env.META_PAGE_ACCESS_TOKEN;
  if (!t) throw new Error("META_PAGE_ACCESS_TOKEN is not set");
  return t;
};
const pageId = () => {
  const p = process.env.META_PAGE_ID;
  if (!p) throw new Error("META_PAGE_ID is not set");
  return p;
};

export const metaConfigured = () => !!(process.env.META_PAGE_ID && process.env.META_PAGE_ACCESS_TOKEN);

type GraphResponse = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function handle(r: Response): Promise<GraphResponse> {
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    throw new Error(`Meta: ${e.error_user_msg || e.message || `HTTP ${r.status}`}${e.code ? ` (code ${e.code})` : ""}`);
  }
  return j;
}

async function gpost(path: string, params: Record<string, string>) {
  return handle(await fetch(G(path), { method: "POST", body: new URLSearchParams({ ...params, access_token: token() }) }));
}

async function gget(path: string, params: Record<string, string> = {}) {
  return handle(await fetch(G(path) + "?" + new URLSearchParams({ ...params, access_token: token() })));
}

export async function getIgUserId(): Promise<string> {
  if (process.env.META_IG_USER_ID) return process.env.META_IG_USER_ID;
  const g = globalThis as { __igUserId?: string };
  if (g.__igUserId) return g.__igUserId;
  const j = await gget(pageId(), { fields: "instagram_business_account" });
  const id = j.instagram_business_account?.id;
  if (!id) throw new Error("No Instagram Business account is linked to this Facebook Page.");
  return (g.__igUserId = id);
}

async function uploadPagePhoto(rel: string, published: boolean, message?: string) {
  const fd = new FormData();
  fd.append("source", toBlob(fs.readFileSync(mediaAbs(rel)), "image/jpeg"), "image.jpg");
  fd.append("published", String(published));
  if (message) fd.append("message", message);
  fd.append("access_token", token());
  return handle(await fetch(G(`${pageId()}/photos`), { method: "POST", body: fd }));
}

/** Instagram needs a public image URL. Use PUBLIC_BASE_URL, or host it as an unpublished Page photo. */
async function publicImageUrl(rel: string): Promise<string> {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (base) return `${base}/api/media/${rel}`;
  const { id } = await uploadPagePhoto(rel, false);
  const j = await gget(id, { fields: "images" });
  const best = (j.images as { source: string; width: number }[] | undefined)?.sort((a, b) => b.width - a.width)[0];
  if (!best) throw new Error("Could not get a public URL for the image");
  return best.source;
}

async function waitForContainer(id: string, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const j = await gget(id, { fields: "status_code,status" });
    if (j.status_code === "FINISHED") return;
    if (j.status_code === "ERROR" || j.status_code === "EXPIRED") throw new Error(`Instagram processing failed: ${j.status || j.status_code}`);
    await sleep(4000);
  }
  throw new Error("Instagram media processing timed out");
}

async function rupload(url: string, file: Buffer) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `OAuth ${token()}`, offset: "0", file_size: String(file.length) },
    body: toBlob(file, "video/mp4"),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false || j.error || j.debug_info) {
    throw new Error(`Video upload failed: ${j.error?.message || j.debug_info?.message || r.status}`);
  }
}

// ---------------- Instagram ----------------

export async function publishInstagram(post: Post) {
  const ig = await getIgUserId();
  const caption = composeCaption(post, "instagram");
  let creationId: string;

  if (post.format === "reel") {
    if (!post.video) throw new Error("Reel video is missing");
    const file = fs.readFileSync(mediaAbs(post.video));
    const c = await gpost(`${ig}/media`, { media_type: "REELS", upload_type: "resumable", caption, share_to_feed: "true" });
    await rupload(c.uri || `https://rupload.facebook.com/ig-api-upload/${V()}/${c.id}`, file);
    await waitForContainer(c.id, 10 * 60_000);
    creationId = c.id;
  } else if (post.format === "carousel" && post.slides.length > 1) {
    const children: string[] = [];
    for (const s of post.slides.slice(0, 10)) {
      const c = await gpost(`${ig}/media`, { image_url: await publicImageUrl(s.feed!), is_carousel_item: "true" });
      await waitForContainer(c.id, 2 * 60_000);
      children.push(c.id);
    }
    const parent = await gpost(`${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption });
    await waitForContainer(parent.id, 2 * 60_000);
    creationId = parent.id;
  } else {
    const c = await gpost(`${ig}/media`, { image_url: await publicImageUrl(post.slides[0].feed!), caption });
    await waitForContainer(c.id, 2 * 60_000);
    creationId = c.id;
  }

  const pub = await gpost(`${ig}/media_publish`, { creation_id: creationId });
  let url: string | undefined;
  try {
    url = (await gget(pub.id, { fields: "permalink" })).permalink;
  } catch {
    /* permalink is optional */
  }
  return { id: pub.id as string, url };
}

// ---------------- Facebook ----------------

export async function publishFacebook(post: Post) {
  const page = pageId();
  const message = composeCaption(post, "facebook");

  if (post.format === "reel") {
    if (!post.video) throw new Error("Reel video is missing");
    const file = fs.readFileSync(mediaAbs(post.video));
    const start = await gpost(`${page}/video_reels`, { upload_phase: "start" });
    await rupload(start.upload_url || `https://rupload.facebook.com/video-upload/${V()}/${start.video_id}`, file);
    await gpost(`${page}/video_reels`, {
      upload_phase: "finish",
      video_id: start.video_id,
      video_state: "PUBLISHED",
      description: message,
    });
    return { id: start.video_id as string, url: `https://www.facebook.com/reel/${start.video_id}` };
  }

  if (post.format === "carousel" && post.slides.length > 1) {
    const params: Record<string, string> = { message };
    let i = 0;
    for (const s of post.slides.slice(0, 10)) {
      const { id } = await uploadPagePhoto(s.feed!, false);
      params[`attached_media[${i++}]`] = JSON.stringify({ media_fbid: id });
    }
    const j = await gpost(`${page}/feed`, params);
    return { id: j.id as string, url: `https://www.facebook.com/${j.id}` };
  }

  const j = await uploadPagePhoto(post.slides[0].feed!, true, message);
  const id = (j.post_id || j.id) as string;
  return { id, url: `https://www.facebook.com/${id}` };
}
