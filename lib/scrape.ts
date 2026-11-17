import * as cheerio from "cheerio";
import { BROWSER_UA, fetchWithTimeout, newId } from "./util";
import type { Product } from "./types";

type Json = Record<string, unknown> | unknown[] | null;

function findProduct(node: Json): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findProduct(n as Json);
      if (f) return f;
    }
    return null;
  }
  const t = node["@type"];
  if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return node;
  if (node["@graph"]) return findProduct(node["@graph"] as Json);
  return null;
}

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function imageUrls(v: unknown): string[] {
  return asArray(v as unknown[])
    .map((x) => (typeof x === "string" ? x : (x as { url?: string; contentUrl?: string })?.url || (x as { contentUrl?: string })?.contentUrl))
    .filter((x): x is string => typeof x === "string");
}

/** Shopify stores expose clean product JSON at /products/<handle>.js – use it when available. */
async function tryShopify(url: string): Promise<Product | null> {
  const u = new URL(url);
  if (!/\/products\/[^/]+/.test(u.pathname)) return null;
  const jsUrl = `${u.origin}${u.pathname.replace(/\/$/, "")}.js`;
  try {
    const r = await fetchWithTimeout(jsUrl, { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } }, 20_000);
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return null;
    const p = await r.json();
    if (!p?.title) return null;
    const strip = (h: string) => cheerio.load(h || "").text().replace(/\s+/g, " ").trim();
    const images = ((p.images as string[]) || []).map((s) => (s.startsWith("//") ? "https:" + s : s)).slice(0, 8);
    return {
      id: newId("prod"),
      url: `${u.origin}${u.pathname}`,
      name: p.title,
      description: strip(p.description).slice(0, 1500),
      price: p.price != null ? (p.price / 100).toFixed(2) : undefined,
      brand: p.vendor || undefined,
      images,
      pageText: [strip(p.description), (p.tags || []).join(", "), p.type].filter(Boolean).join(" | ").slice(0, 4000),
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function scrapeProduct(url: string): Promise<Product> {
  const shopify = await tryShopify(url);
  if (shopify) return shopify;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    },
    30_000,
  );
  if (!res.ok) throw new Error(`Could not fetch the page (HTTP ${res.status}).`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const meta = (key: string) =>
    $(`meta[property="${key}"]`).attr("content") || $(`meta[name="${key}"]`).attr("content") || "";

  let ld: Record<string, unknown> | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (ld) return;
    try {
      ld = findProduct(JSON.parse($(el).text()));
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  const product = ld as Record<string, unknown> | null;

  const offers = asArray(product?.offers as Record<string, unknown>)[0] as Record<string, unknown> | undefined;
  const brand = product?.brand as { name?: string } | string | undefined;

  const resolve = (src: string) => {
    try {
      return new URL(src, res.url || url).href;
    } catch {
      return "";
    }
  };

  const imgs = [
    ...imageUrls(product?.image),
    meta("og:image"),
    meta("og:image:secure_url"),
    meta("twitter:image"),
  ];
  $("img").each((_, el) => {
    const src = $(el).attr("data-zoom-image") || $(el).attr("data-src") || $(el).attr("src") || "";
    const w = Number($(el).attr("width") || 0);
    const alt = ($(el).attr("alt") || "").toLowerCase();
    if (src && (w >= 400 || /product|main|gallery|zoom/i.test(src + " " + alt))) imgs.push(src);
  });
  const images = [...new Set(imgs.filter(Boolean).map(resolve))]
    .filter((u) => u.startsWith("http") && !/\.svg(\?|$)|logo|icon|sprite|placeholder/i.test(u))
    .slice(0, 8);

  $("script,style,noscript,nav,footer,header,svg,iframe").remove();
  const pageText = $("main").text() || $("body").text();

  const name = String(product?.name || meta("og:title") || $("h1").first().text() || $("title").text() || "").trim();
  if (!name) throw new Error("Could not find a product on that page.");

  return {
    id: newId("prod"),
    url: res.url || url,
    name,
    description: String(product?.description || meta("og:description") || meta("description") || "")
      .replace(/\s+/g, " ")
      .trim(),
    price: String(offers?.price ?? offers?.lowPrice ?? meta("product:price:amount") ?? "") || undefined,
    currency: String(offers?.priceCurrency ?? meta("product:price:currency") ?? "") || undefined,
    brand: (typeof brand === "string" ? brand : brand?.name) || meta("og:site_name") || undefined,
    images,
    pageText: pageText.replace(/\s+/g, " ").trim().slice(0, 4000),
    createdAt: new Date().toISOString(),
  };
}
