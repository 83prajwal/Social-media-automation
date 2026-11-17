import fs from "fs";
import path from "path";
import sharp from "sharp";
import { BROWSER_UA, errMsg, fetchWithTimeout, sleep } from "./util";

export const SIZES = {
  src: [1024, 1536],
  feed: [1080, 1350], // Instagram / Facebook 4:5
  pin: [1000, 1500], // Pinterest 2:3
  tall: [1080, 1920], // Reels 9:16
} as const;

export interface GeneratedImage {
  buf: Buffer;
  provider: string;
  usedReference: boolean;
}

const pollenKey = () => process.env.POLLINATIONS_KEY || process.env.POLLINATIONS_TOKEN || "";

/** Which free image providers are usable, best first. */
export function imageProviders() {
  return {
    geminiImage: process.env.GEMINI_IMAGE_ENABLED === "true" && !!process.env.GEMINI_API_KEY,
    pollinationsReference: !!pollenKey(),
    pollinations: true,
    huggingface: !!process.env.HF_TOKEN,
  };
}

// ---------- providers ----------

/** Gemini image model, editing the real product photo into a scene. Off by default (may be billed). */
async function geminiImage(prompt: string, ref: Buffer): Promise<Buffer> {
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const jpeg = await sharp(ref).rotate().resize(1024, 1024, { fit: "inside" }).jpeg().toBuffer();
  const r = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: "image/jpeg", data: jpeg.toString("base64") } },
              { text: `${prompt}\nKeep the product identical to the reference photo. Vertical 2:3 photo, no text.` },
            ],
          },
        ],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "2:3" } },
      }),
    },
    180_000,
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  const part = (j.candidates?.[0]?.content?.parts ?? []).find(
    (p: { inlineData?: { data: string }; inline_data?: { data: string } }) => p.inlineData || p.inline_data,
  );
  const data = part?.inlineData?.data || part?.inline_data?.data;
  if (!data) throw new Error("no image returned");
  return Buffer.from(data, "base64");
}

/** Pollinations with a free pollen key: reference-image models (kontext / nanobanana) or flux. */
async function pollinationsKeyed(prompt: string, seed: number, refUrl?: string): Promise<Buffer> {
  // Free-tier models: kontext / klein accept a reference image; zimage is a crisp text-to-image model.
  const models = refUrl
    ? [process.env.POLLINATIONS_REF_MODEL || "kontext", "klein"]
    : [process.env.POLLINATIONS_MODEL || "zimage", "flux"];
  let lastErr: unknown;
  for (const model of [...new Set(models)]) {
    try {
      return await pollinationsKeyedModel(model, prompt, seed, refUrl);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function pollinationsKeyedModel(model: string, prompt: string, seed: number, refUrl?: string): Promise<Buffer> {
  const params = new URLSearchParams({
    model,
    width: String(SIZES.src[0]),
    height: String(SIZES.src[1]),
    seed: String(seed),
    nologo: "true",
    enhance: "false",
  });
  if (refUrl) params.set("image", refUrl);
  const base = process.env.POLLINATIONS_GEN_URL || "https://gen.pollinations.ai/image/";
  return fetchImage(base + encodeURIComponent(prompt.slice(0, 1800)) + "?" + params, {
    Authorization: `Bearer ${pollenKey()}`,
  });
}

let lastAnonCall = 0;
/** Anonymous Pollinations "classic" API: free, text-to-image only, ~1 image / 45 s per IP. */
async function pollinationsAnon(prompt: string, seed: number): Promise<Buffer> {
  const gap = Number(process.env.POLLINATIONS_ANON_GAP_MS || 46_000);
  const wait = lastAnonCall + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastAnonCall = Date.now();
  const params = new URLSearchParams({
    width: String(SIZES.src[0]),
    height: String(SIZES.src[1]),
    seed: String(seed),
    nologo: "true",
    model: process.env.POLLINATIONS_MODEL || "flux",
  });
  const base = process.env.POLLINATIONS_IMAGE_URL || "https://image.pollinations.ai/prompt/";
  const buf = await fetchImage(base + encodeURIComponent(prompt.slice(0, 1500)) + "?" + params, {}, () => {
    lastAnonCall = Date.now();
  });
  // The keyless API stamps a small watermark in the bottom-right corner – crop it off.
  const { width = 0, height = 0 } = await sharp(buf).metadata();
  if (!width || !height) return buf;
  return sharp(buf)
    .extract({ left: 0, top: 0, width, height: Math.round(height * 0.92) })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function fetchImage(url: string, headers: Record<string, string>, onRetry?: () => void): Promise<Buffer> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetchWithTimeout(url, { headers }, 240_000);
    const type = r.headers.get("content-type") || "";
    if (r.ok && type.startsWith("image/")) return Buffer.from(await r.arrayBuffer());
    const body = await r.text().catch(() => "");
    if (r.status === 402 || r.status === 429 || r.status >= 500) {
      const retryAfter = Number(/retry after (\d+)/i.exec(body)?.[1] || 0);
      await sleep(Math.max(retryAfter * 1000 + 2000, 8000 * (attempt + 1)));
      onRetry?.();
      continue;
    }
    let msg = body.slice(0, 300);
    try {
      msg = JSON.parse(body).error?.message || msg;
    } catch {
      /* not JSON */
    }
    throw new Error(`HTTP ${r.status}: ${msg}`);
  }
  throw new Error("rate limited, retries exhausted");
}

async function huggingface(prompt: string): Promise<Buffer> {
  const model = process.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
  const r = await fetchWithTimeout(
    `https://router.huggingface.co/hf-inference/models/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "image/png",
      },
      body: JSON.stringify({ inputs: prompt, parameters: { width: 768, height: 1152 } }),
    },
    240_000,
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

// Remember providers that failed with quota / permission errors so we don't retry them for every slide.
const disabledUntil: Record<string, number> = {};
const usable = (name: string) => (disabledUntil[name] ?? 0) < Date.now();
const cooldown = (name: string, e: unknown) => {
  if (/quota|billing|permission|forbidden|403|401|limit: 0|not supported|isn't part/i.test(errMsg(e))) {
    disabledUntil[name] = Date.now() + 15 * 60_000;
  }
};

/**
 * Generate one lifestyle image, best free provider first:
 *  1. Gemini image (opt-in) and 2. Pollinations kontext (free pollen key) – use the real product photo as reference
 *  3. Pollinations flux (keyed or anonymous) and 4. Hugging Face – text-to-image only
 */
export async function generateImage(prompt: string, seed: number, ref?: { url: string; buf: Buffer }): Promise<GeneratedImage> {
  const p = imageProviders();
  const errors: string[] = [];
  const attempt = async (name: string, usedReference: boolean, fn: () => Promise<Buffer>) => {
    if (!usable(name)) return null;
    try {
      return { buf: await fn(), provider: name, usedReference };
    } catch (e) {
      cooldown(name, e);
      errors.push(`${name}: ${errMsg(e)}`);
      return null;
    }
  };

  const textPrompt = prompt.replace(/^the exact product from the reference image/i, "The product");
  const result =
    (ref && p.geminiImage && (await attempt("gemini-image", true, () => geminiImage(prompt, ref.buf)))) ||
    (ref && p.pollinationsReference && (await attempt("pollinations-reference", true, () => pollinationsKeyed(prompt, seed, ref.url)))) ||
    (p.pollinationsReference && (await attempt("pollinations-text", false, () => pollinationsKeyed(textPrompt, seed)))) ||
    (await attempt("pollinations-free", false, () => pollinationsAnon(textPrompt, seed))) ||
    (p.huggingface && (await attempt("huggingface", false, () => huggingface(textPrompt))));

  if (!result) throw new Error(`All image providers failed – ${errors.join(" | ")}`);
  if (errors.length) console.warn("[images] fell back:", errors.join(" | "));
  return result;
}

export async function downloadImage(url: string): Promise<Buffer> {
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": BROWSER_UA, Accept: "image/*" } }, 60_000);
  if (!r.ok) throw new Error(`Could not download product image (HTTP ${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  await sharp(buf).metadata(); // throws if not an image
  return buf;
}

// ---------- rendering ----------

const cleanText = (s = "") =>
  s
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .trim();

function wrap(text: string, maxChars: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line + " " + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

/** Elegant, minimal text overlay: serif headline on a soft bottom gradient. */
function overlaySvg(w: number, h: number, headline = "", subtext = "", tall = false) {
  const H = cleanText(headline);
  const S = cleanText(subtext);
  const hs = Math.round(w * 0.068);
  const ss = Math.round(w * 0.036);
  const hl = wrap(H, Math.floor((w * 0.84) / (hs * 0.5)));
  const sl = wrap(S, Math.floor((w * 0.84) / (ss * 0.5)));
  const lineH = hs * 1.15;
  const sLineH = ss * 1.45;
  const blockH = hl.length * lineH + (sl.length ? ss * 0.8 + sl.length * sLineH : 0);
  const bottomPad = tall ? h * 0.22 : h * 0.07;
  const top = h - bottomPad - blockH;
  const gradTop = Math.max(0, top - h * 0.2);
  const cx = w / 2;
  let y = top + hs;
  let texts = "";
  for (const l of hl) {
    texts += `<text x="${cx}" y="${y}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${hs}" font-weight="600" fill="#ffffff" letter-spacing="0.5">${l}</text>`;
    y += lineH;
  }
  if (sl.length) {
    y += ss * 0.8 - lineH + hs;
    for (const l of sl) {
      texts += `<text x="${cx}" y="${y}" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="${ss}" fill="#f3ede4" letter-spacing="1.5">${l}</text>`;
      y += sLineH;
    }
  }
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></linearGradient></defs>
<rect x="0" y="${gradTop}" width="${w}" height="${h - gradTop}" fill="url(#g)"/>${texts}</svg>`;
}

/** Crop/resize the source image to a platform size, optionally with a text overlay, and save as JPEG. */
export async function renderVariant(
  src: Buffer,
  kind: keyof typeof SIZES,
  outAbs: string,
  overlay?: { headline?: string; subtext?: string },
) {
  const [w, h] = SIZES[kind];
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const composites =
    overlay && (overlay.headline || overlay.subtext)
      ? [{ input: Buffer.from(overlaySvg(w, h, overlay.headline, overlay.subtext, kind === "tall")), top: 0, left: 0 }]
      : [];
  await sharp(src)
    .rotate()
    .resize(w, h, { fit: "cover", position: sharp.strategy.attention })
    .composite(composites)
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(outAbs);
}
