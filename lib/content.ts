import { generateJSON } from "./llm";
import { clamp } from "./util";
import type { Captions, GenOptions, PostFormat, Product } from "./types";

export interface CopyPlan {
  captions: Captions;
  hashtags: string[];
  slides: { imagePrompt: string; headline: string; subtext: string }[];
}

/** Default art direction – premium, photorealistic lifestyle photography. */
export const DEFAULT_STYLE =
  "Premium editorial lifestyle photography: the product is the hero, placed naturally in a high-end, elegantly styled real-world setting that suits it (e.g. a luxury home interior). Warm ambient lighting with soft glows, natural window light, rich textures (marble, wood, fabric, plants), tasteful props that match the product's use, shallow depth of field, shot on a full-frame camera with an 85mm lens, vertical 2:3 composition with the product filling most of the frame, ultra-detailed, photorealistic, magazine quality.";

const SYSTEM = `You are a senior social media marketer and an art director for premium e-commerce brands.
You write scroll-stopping, on-brand copy for Instagram, Facebook and Pinterest, and you write precise prompts for an AI image model that edits/extends a real product photo into a lifestyle scene.
Always reply with valid JSON only.`;

export function slideCountFor(format: PostFormat, opts: GenOptions) {
  if (format === "single") return 1;
  if (format === "carousel") return clamp(opts.slideCount, 2, 10);
  return clamp(opts.sceneCount, 3, 10);
}

export async function generateCopy(product: Product, format: PostFormat, opts: GenOptions): Promise<CopyPlan> {
  const n = slideCountFor(format, opts);
  const formatGuide = {
    single: "A single-image feed post with one hero lifestyle image.",
    carousel: `A ${n}-slide carousel. Slide 1 is the hero shot that stops the scroll; each middle slide shows a different angle, detail, setting or use case; the last slide is a beautiful wide shot that supports the call to action. Each slide must look clearly different (different room/setting, camera distance or angle).`,
    reel: `A vertical reel of ${n} scenes (~3 s each). Scene 1 is a striking hero shot, then varied angles, close-up details and settings, and the last scene supports the call to action. headline is the on-screen text for that scene.`,
  }[format];

  const prompt = `PRODUCT
Name: ${product.name}
Brand: ${product.brand || "-"}
Price: ${product.price ? `${product.price} ${product.currency || ""}` : "-"}
URL: ${product.url}
Description: ${product.description || "-"}
Page excerpt: ${product.pageText.slice(0, 1800)}

TASK
Create one ${format} post. ${formatGuide}
Tone of voice: ${opts.tone || "warm, elegant, aspirational, benefit-driven"}
Visual style: ${opts.style || DEFAULT_STYLE}
${opts.notes ? `Extra instructions from the brand: ${opts.notes}` : ""}

RULES
- instagram: 80-150 words. Strong first-line hook, short paragraphs, 2-4 tasteful emojis, ends with a call to action (e.g. "Tap the link in bio"). No hashtags.
- facebook: 40-90 words, conversational, ends with the product URL. No hashtags.
- pinterestTitle: max 90 characters, keyword-rich, no emojis.
- pinterestDescription: 200-450 characters, natural SEO keywords, no hashtags.
- hashtags: 15 relevant hashtags WITHOUT the # symbol, mixing broad and niche.
- slides: exactly ${n} items.
  - imagePrompt: 60-110 words for a photorealistic image. It will be given the real product photo as a reference, so start with "The exact product from the reference image" and describe it accurately (shape, material, colour, details from the product info), then describe the setting, styling props, lighting, camera angle/lens and mood following the visual style. Never ask for text, words, letters, logos, price tags or watermarks in the image.
  - headline: max 6 words${format === "single" ? " (use an empty string)" : ""}.
  - subtext: max 12 words (may be empty).
- Never invent facts (dimensions, discounts, awards, materials) that are not in the product info.

Return JSON exactly in this shape:
{"captions":{"instagram":"","facebook":"","pinterestTitle":"","pinterestDescription":""},"hashtags":[""],"slides":[{"imagePrompt":"","headline":"","subtext":""}]}`;

  const plan = await generateJSON<CopyPlan>(SYSTEM, prompt);

  const slides = Array.isArray(plan.slides) ? plan.slides.filter((s) => s && s.imagePrompt) : [];
  if (!slides.length) throw new Error("The AI did not return any image prompts. Please try again.");
  while (slides.length < n) slides.push({ ...slides[slides.length % slides.length] });

  return {
    captions: {
      instagram: String(plan.captions?.instagram ?? "").trim(),
      facebook: String(plan.captions?.facebook ?? "").trim(),
      pinterestTitle: String(plan.captions?.pinterestTitle ?? "").trim().slice(0, 100),
      pinterestDescription: String(plan.captions?.pinterestDescription ?? "").trim().slice(0, 800),
    },
    hashtags: (Array.isArray(plan.hashtags) ? plan.hashtags : [])
      .map((h) => String(h).replace(/^#+/, "").replace(/\s+/g, ""))
      .filter(Boolean)
      .slice(0, 25),
    slides: slides.slice(0, n).map((s) => ({
      imagePrompt: String(s.imagePrompt),
      headline: format === "single" ? "" : String(s.headline ?? ""),
      subtext: String(s.subtext ?? ""),
    })),
  };
}
