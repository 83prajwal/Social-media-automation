import fs from "fs";
import sharp from "sharp";
import { db } from "./db";
import { generateCopy } from "./content";
import { downloadImage, generateImage, renderVariant } from "./images";
import { mediaAbs } from "./paths";
import { buildReel } from "./reel";
import { errMsg } from "./util";
import type { Slide } from "./types";

/** Serialise all generations (free image APIs allow ~1 request at a time). */
export function enqueue(task: () => Promise<void>) {
  const g = globalThis as { __genQueue?: Promise<void> };
  g.__genQueue = (g.__genQueue ?? Promise.resolve()).then(task).catch((e) => console.error("[queue]", e));
}

export async function runGeneration(postId: string) {
  const progress = (msg: string) => db.updatePost(postId, { progress: msg });
  try {
    const post = db.getPost(postId);
    if (!post) return;
    const product = db.getProduct(post.productId);
    if (!product) throw new Error("Product not found");
    const opts = post.genOptions;

    progress("Writing captions and art direction…");
    const plan = await generateCopy(product, post.format, opts);
    db.updatePost(postId, { captions: plan.captions, hashtags: plan.hashtags });

    // Download real product photos once – they are used as references for the AI scenes.
    const refs: { url: string; buf: Buffer }[] = [];
    for (const url of product.images.slice(0, 4)) {
      try {
        refs.push({ url, buf: await downloadImage(url) });
      } catch {
        /* skip broken image */
      }
    }

    const dir = postId;
    fs.mkdirSync(mediaAbs(dir), { recursive: true });
    const slides: Slide[] = [];
    const n = plan.slides.length;
    const seedBase = Math.floor(Math.random() * 1_000_000);

    for (let i = 0; i < n; i++) {
      const s = plan.slides[i];
      progress(`Creating image ${i + 1} of ${n}… (free image APIs can take ~1 min per image)`);
      const ref = refs.length ? refs[i % refs.length] : undefined;

      // Optionally show the untouched product photo as the final carousel slide.
      const useOriginal = opts.useProductPhotos && post.format === "carousel" && i === n - 1 && n > 1 && ref;

      let buf: Buffer;
      let slide: Slide;
      if (useOriginal) {
        buf = ref.buf;
        slide = { source: "product", provider: "original photo", headline: s.headline, subtext: s.subtext };
      } else {
        try {
          const img = await generateImage(s.imagePrompt, seedBase + i * 17, ref);
          buf = img.buf;
          slide = {
            source: img.usedReference ? "ai-ref" : "ai",
            provider: img.provider,
            prompt: s.imagePrompt,
            headline: s.headline,
            subtext: s.subtext,
          };
        } catch (e) {
          if (!ref) throw e;
          console.warn("[generate] AI image failed, using product photo:", errMsg(e));
          buf = ref.buf;
          slide = { source: "product", provider: "original photo (AI failed)", headline: s.headline, subtext: s.subtext };
        }
      }

      const overlay = opts.textOverlay && post.format !== "single" ? { headline: s.headline, subtext: s.subtext } : undefined;
      slide.src = `${dir}/s${i}_src.jpg`;
      await sharp(buf).rotate().jpeg({ quality: 95 }).toFile(mediaAbs(slide.src));
      if (post.format === "reel") {
        slide.tall = `${dir}/s${i}_tall.jpg`;
        // Reels always get on-screen text if the scene has a headline (it carries the story).
        await renderVariant(buf, "tall", mediaAbs(slide.tall), { headline: s.headline, subtext: opts.textOverlay ? s.subtext : "" });
      } else {
        slide.feed = `${dir}/s${i}_feed.jpg`;
        slide.pin = `${dir}/s${i}_pin.jpg`;
        await renderVariant(buf, "feed", mediaAbs(slide.feed), overlay);
        await renderVariant(buf, "pin", mediaAbs(slide.pin), overlay);
      }
      slides.push(slide);
      db.updatePost(postId, { slides: [...slides] });
    }

    let video: string | undefined;
    if (post.format === "reel") {
      progress("Rendering reel video…");
      video = `${dir}/reel.mp4`;
      await buildReel(slides.map((s) => mediaAbs(s.tall!)), mediaAbs(video));
    }

    const after = opts.after;
    const scheduled = after === "schedule" && opts.scheduledAt;
    db.updatePost(postId, {
      video,
      progress: undefined,
      error: undefined,
      status: scheduled ? "scheduled" : "draft",
      scheduledAt: scheduled ? opts.scheduledAt : undefined,
    });
    if (after === "publish") {
      const { publishPost } = await import("./publish");
      await publishPost(postId);
    }
  } catch (e) {
    console.error("[generate]", e);
    db.updatePost(postId, { status: "failed", error: errMsg(e), progress: undefined });
  }
}
