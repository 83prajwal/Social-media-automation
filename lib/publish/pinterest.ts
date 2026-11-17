import fs from "fs";
import { mediaAbs } from "../paths";
import { sleep, toBlob } from "../util";
import type { Post, Product } from "../types";

const base = () => (process.env.PINTEREST_API_BASE || "https://api.pinterest.com/v5").replace(/\/$/, "");
export const pinterestConfigured = () => !!(process.env.PINTEREST_ACCESS_TOKEN && process.env.PINTEREST_BOARD_ID);

async function papi(method: string, path: string, body?: unknown) {
  const r = await fetch(base() + path, {
    method,
    headers: { Authorization: `Bearer ${process.env.PINTEREST_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Pinterest: ${j.message || `HTTP ${r.status}`}`);
  return j;
}

const b64 = (rel: string) => fs.readFileSync(mediaAbs(rel)).toString("base64");

async function uploadVideo(rel: string): Promise<string> {
  const reg = await papi("POST", "/media", { media_type: "video" });
  const fd = new FormData();
  for (const [k, v] of Object.entries(reg.upload_parameters || {})) fd.append(k, String(v));
  fd.append("file", toBlob(fs.readFileSync(mediaAbs(rel)), "video/mp4"), "reel.mp4");
  const up = await fetch(reg.upload_url, { method: "POST", body: fd });
  if (!up.ok) throw new Error(`Pinterest video upload failed (HTTP ${up.status})`);
  const end = Date.now() + 10 * 60_000;
  while (Date.now() < end) {
    const m = await papi("GET", `/media/${reg.media_id}`);
    if (m.status === "succeeded") return reg.media_id;
    if (m.status === "failed") throw new Error("Pinterest video processing failed");
    await sleep(5000);
  }
  throw new Error("Pinterest video processing timed out");
}

export async function publishPinterest(post: Post, product: Product) {
  if (!pinterestConfigured()) throw new Error("Pinterest is not configured (PINTEREST_ACCESS_TOKEN / PINTEREST_BOARD_ID)");
  const title = (post.captions.pinterestTitle || product.name).slice(0, 100);
  let media_source: Record<string, unknown>;

  if (post.format === "reel") {
    media_source = { source_type: "video_id", media_id: await uploadVideo(post.video!), cover_image_key_frame_time: 1 };
  } else if (post.format === "carousel" && post.slides.length > 1) {
    media_source = {
      source_type: "multiple_image_base64",
      items: post.slides.slice(0, 5).map((s) => ({
        content_type: "image/jpeg",
        data: b64(s.pin!),
        title,
        description: post.captions.pinterestDescription.slice(0, 500),
        link: product.url,
      })),
    };
  } else {
    media_source = { source_type: "image_base64", content_type: "image/jpeg", data: b64(post.slides[0].pin!) };
  }

  const pin = await papi("POST", "/pins", {
    board_id: process.env.PINTEREST_BOARD_ID,
    title,
    description: post.captions.pinterestDescription.slice(0, 800),
    link: product.url,
    alt_text: title,
    media_source,
  });
  return { id: pin.id as string, url: `https://www.pinterest.com/pin/${pin.id}/` };
}
