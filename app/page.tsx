"use client";

import { useCallback, useEffect, useState } from "react";
import { composeCaption } from "@/lib/captions";
import type { Platform, Post, PostFormat, Product } from "@/lib/types";

type Status = {
  llm: "gemini" | "groq" | null;
  images: { geminiImage: boolean; pollinationsReference: boolean; pollinations: boolean; huggingface: boolean };
  ffmpeg: boolean;
  meta: { configured: boolean; instagram: boolean; error?: string };
  pinterest: { configured: boolean };
};

const PLATFORM_LABEL: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", pinterest: "Pinterest" };
const FORMAT_LABEL: Record<PostFormat, string> = { single: "Single image", carousel: "Carousel", reel: "Reel" };
const media = (rel?: string) => (rel ? `/api/media/${rel}` : "");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

const toLocalInput = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60_000);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
};

function toggle<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

// ---------------------------------------------------------------------------

export default function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState<"all" | "drafts" | "scheduled" | "published">("all");

  const refresh = useCallback(async () => {
    const [p, q] = await Promise.all([api<Product[]>("/api/products"), api<Post[]>("/api/posts")]);
    setProducts(p);
    setPosts(q);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    api<Status>("/api/status").then(setStatus).catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (!selected && products[0]) setSelected(products[0].id);
  }, [products, selected]);

  const busy = posts.some((p) => p.status === "generating" || p.status === "publishing");
  const hasScheduled = posts.some((p) => p.status === "scheduled");
  useEffect(() => {
    if (!busy && !hasScheduled) return;
    const t = setInterval(() => refresh().catch(() => {}), busy ? 3000 : 30_000);
    return () => clearInterval(t);
  }, [busy, hasScheduled, refresh]);

  const productById = Object.fromEntries(products.map((p) => [p.id, p]));
  const shown = posts.filter((p) =>
    filter === "all"
      ? true
      : filter === "drafts"
        ? ["draft", "generating", "failed"].includes(p.status)
        : filter === "scheduled"
          ? p.status === "scheduled"
          : ["published", "partial", "publishing"].includes(p.status),
  );

  return (
    <div className="wrap">
      <div className="top">
        <div>
          <h1>Post Studio</h1>
          <div className="sub">Product URL → AI lifestyle posts, carousels and reels → Instagram, Facebook and Pinterest</div>
        </div>
        <StatusPills status={status} />
      </div>

      <div className="grid">
        <div className="side stack">
          <ProductPanel products={products} selected={selected} onSelect={setSelected} onChange={refresh} />
          <GeneratePanel product={productById[selected]} status={status} onCreated={refresh} />
        </div>

        <div>
          <div className="toolbar">
            <h2 style={{ margin: 0 }}>Posts</h2>
            <div className="tabs">
              {(["all", "drafts", "scheduled", "published"] as const).map((f) => (
                <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
              <button onClick={() => refresh()}>↻</button>
            </div>
          </div>
          {shown.length === 0 ? (
            <div className="empty">No posts here yet. Add a product URL and click Generate.</div>
          ) : (
            <div className="posts">
              {shown.map((p) => (
                <PostCard key={p.id} post={p} product={productById[p.productId]} onChange={refresh} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatusPills({ status }: { status: Status | null }) {
  if (!status) return null;
  const img = status.images.geminiImage || status.images.pollinationsReference;
  return (
    <div className="pills">
      <span className={`pill ${status.llm ? "ok" : "bad"}`}>Copy AI: {status.llm ?? "add GEMINI_API_KEY"}</span>
      <span className={`pill ${img ? "ok" : "warn"}`} title={img ? "" : "Add a free POLLINATIONS_KEY to put your real product into AI scenes"}>
        Images: {img ? "product-accurate" : "basic (free, no key)"}
      </span>
      <span className={`pill ${status.ffmpeg ? "ok" : "bad"}`}>Reels: {status.ffmpeg ? "ffmpeg ✓" : "ffmpeg missing"}</span>
      <span className={`pill ${status.meta.configured && status.meta.instagram ? "ok" : status.meta.configured ? "warn" : "bad"}`} title={status.meta.error}>
        FB/IG: {!status.meta.configured ? "not connected" : status.meta.instagram ? "connected" : "IG not linked"}
      </span>
      <span className={`pill ${status.pinterest.configured ? "ok" : "bad"}`}>Pinterest: {status.pinterest.configured ? "connected" : "not connected"}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProductPanel(props: { products: Product[]; selected: string; onSelect: (id: string) => void; onChange: () => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const add = async () => {
    setLoading(true);
    setError("");
    try {
      const p = await api<Product>("/api/products", { method: "POST", body: JSON.stringify({ url: url.trim() }) });
      setUrl("");
      await props.onChange();
      props.onSelect(p.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this product? Its posts are kept.")) return;
    await api(`/api/products/${id}`, { method: "DELETE" });
    if (props.selected === id) props.onSelect("");
    await props.onChange();
  };

  return (
    <div className="panel stack">
      <h2>1. Product</h2>
      <div className="row">
        <input
          className="grow"
          type="url"
          placeholder="https://yourstore.com/products/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && url && !loading && add()}
        />
        <button className="primary" onClick={add} disabled={!url || loading}>
          {loading ? "Reading…" : "Add"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {props.products.length > 0 && (
        <div className="products">
          {props.products.map((p) => (
            <div key={p.id} className={`product ${props.selected === p.id ? "on" : ""}`} onClick={() => props.onSelect(p.id)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.images[0] || ""} alt="" referrerPolicy="no-referrer" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="name">{p.name}</div>
                <div className="meta">
                  {p.price ? `${p.price} ${p.currency || ""} · ` : ""}
                  {p.images.length} photo{p.images.length === 1 ? "" : "s"} · {new URL(p.url).hostname}
                </div>
              </div>
              <button
                className="link danger"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(p.id);
                }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function GeneratePanel({ product, status, onCreated }: { product?: Product; status: Status | null; onCreated: () => Promise<void> }) {
  const [formats, setFormats] = useState<PostFormat[]>(["single", "carousel", "reel"]);
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram", "facebook", "pinterest"]);
  const [slideCount, setSlideCount] = useState(5);
  const [sceneCount, setSceneCount] = useState(5);
  const [variations, setVariations] = useState(1);
  const [textOverlay, setTextOverlay] = useState(false);
  const [useProductPhotos, setUseProductPhotos] = useState(false);
  const [tone, setTone] = useState("");
  const [style, setStyle] = useState("");
  const [notes, setNotes] = useState("");
  const [after, setAfter] = useState<"draft" | "publish" | "schedule">("draft");
  const [when, setWhen] = useState(toLocalInput());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status && !status.pinterest.configured) setPlatforms((p) => p.filter((x) => x !== "pinterest"));
  }, [status]);

  const generate = async () => {
    if (!product) return;
    setLoading(true);
    setError("");
    try {
      await api("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          productId: product.id,
          formats,
          platforms,
          slideCount,
          sceneCount,
          variations,
          textOverlay,
          useProductPhotos,
          tone,
          style,
          notes,
          after,
          scheduledAt: after === "schedule" ? new Date(when).toISOString() : undefined,
        }),
      });
      await onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel stack">
      <h2>2. Generate</h2>
      {!product ? (
        <div className="hint">Add or select a product first.</div>
      ) : (
        <div className="hint">
          For: <b>{product.name}</b>
        </div>
      )}

      <div>
        <label>Post types</label>
        <div className="checks">
          {(["single", "carousel", "reel"] as PostFormat[]).map((f) => (
            <span key={f} className={`check ${formats.includes(f) ? "on" : ""}`} onClick={() => setFormats(toggle(formats, f))}>
              <input type="checkbox" readOnly checked={formats.includes(f)} /> {FORMAT_LABEL[f]}
            </span>
          ))}
        </div>
      </div>

      <div>
        <label>Platforms</label>
        <div className="checks">
          {(["instagram", "facebook", "pinterest"] as Platform[]).map((p) => (
            <span key={p} className={`check ${platforms.includes(p) ? "on" : ""}`} onClick={() => setPlatforms(toggle(platforms, p))}>
              <input type="checkbox" readOnly checked={platforms.includes(p)} /> {PLATFORM_LABEL[p]}
            </span>
          ))}
        </div>
      </div>

      <div className="row">
        {formats.includes("carousel") && (
          <div className="grow">
            <label>Carousel slides</label>
            <input type="number" min={2} max={10} value={slideCount} onChange={(e) => setSlideCount(+e.target.value)} />
          </div>
        )}
        {formats.includes("reel") && (
          <div className="grow">
            <label>Reel scenes</label>
            <input type="number" min={3} max={10} value={sceneCount} onChange={(e) => setSceneCount(+e.target.value)} />
          </div>
        )}
        <div className="grow">
          <label>Variations</label>
          <input type="number" min={1} max={5} value={variations} onChange={(e) => setVariations(+e.target.value)} />
        </div>
      </div>

      <div className="checks">
        <span className={`check ${textOverlay ? "on" : ""}`} onClick={() => setTextOverlay(!textOverlay)}>
          <input type="checkbox" readOnly checked={textOverlay} /> Text on carousel images
        </span>
        <span className={`check ${useProductPhotos ? "on" : ""}`} onClick={() => setUseProductPhotos(!useProductPhotos)}>
          <input type="checkbox" readOnly checked={useProductPhotos} /> Original photo as last slide
        </span>
      </div>

      <details>
        <summary>Brand voice & art direction (optional)</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <div>
            <label>Tone of voice</label>
            <input type="text" placeholder="warm, elegant, aspirational" value={tone} onChange={(e) => setTone(e.target.value)} />
          </div>
          <div>
            <label>Visual style</label>
            <textarea
              placeholder="Default: premium editorial lifestyle photo, luxury interior, warm ambient light, 85mm, photorealistic"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
            />
          </div>
          <div>
            <label>Extra instructions</label>
            <textarea placeholder="e.g. Mention free shipping across India. Diwali theme." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </details>

      <div>
        <label>When it&apos;s ready</label>
        <select value={after} onChange={(e) => setAfter(e.target.value as typeof after)}>
          <option value="draft">Save as draft for review</option>
          <option value="publish">Publish automatically</option>
          <option value="schedule">Schedule</option>
        </select>
        {after === "schedule" && (
          <input type="datetime-local" style={{ marginTop: 8 }} value={when} onChange={(e) => setWhen(e.target.value)} />
        )}
      </div>

      {error && <div className="error">{error}</div>}
      <button className="primary big" onClick={generate} disabled={!product || loading || !formats.length || !platforms.length}>
        {loading ? "Starting…" : `Generate ${formats.length * variations} post${formats.length * variations === 1 ? "" : "s"}`}
      </button>
      {status && !status.images.pollinationsReference && !status.images.geminiImage && (
        <div className="hint">
          Tip: add a free <code>POLLINATIONS_KEY</code> so the AI places <i>your actual product</i> into each scene. Without it, images are
          generated from text only (about 1 image every 45 s).
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PostCard({ post, product, onChange }: { post: Post; product?: Product; onChange: () => Promise<void> }) {
  const [idx, setIdx] = useState(0);
  const [tab, setTab] = useState<Platform>(post.platforms[0] || "instagram");
  const [captions, setCaptions] = useState(post.captions);
  const [hashtags, setHashtags] = useState(post.hashtags.join(" "));
  const [platforms, setPlatforms] = useState(post.platforms);
  const [when, setWhen] = useState(toLocalInput(post.scheduledAt));
  const [dirty, setDirty] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (dirty) return;
    setCaptions(post.captions);
    setHashtags(post.hashtags.join(" "));
    setPlatforms(post.platforms);
  }, [post.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = post.status === "generating" || post.status === "publishing";
  const slides = post.slides;
  const cur = slides[Math.min(idx, slides.length - 1)];
  const imgFor = (s: (typeof slides)[number]) => media(tab === "pinterest" ? s.pin || s.feed || s.tall : s.feed || s.tall);

  const call = async (fn: () => Promise<unknown>) => {
    setWorking(true);
    setError("");
    try {
      await fn();
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const save = () =>
    call(async () => {
      await api(`/api/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ captions, hashtags: hashtags.split(/[\s,]+/).filter(Boolean), platforms }),
      });
      setDirty(false);
    });

  const saveIfDirty = async () => {
    if (dirty) {
      await api(`/api/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ captions, hashtags: hashtags.split(/[\s,]+/).filter(Boolean), platforms }),
      });
      setDirty(false);
    }
  };

  const publish = () =>
    call(async () => {
      if (!confirm(`Publish this ${FORMAT_LABEL[post.format].toLowerCase()} to ${platforms.map((p) => PLATFORM_LABEL[p]).join(", ")} now?`)) return;
      await saveIfDirty();
      await api(`/api/posts/${post.id}/publish`, { method: "POST" });
    });

  const schedule = () =>
    call(async () => {
      await saveIfDirty();
      await api(`/api/posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ action: "schedule", scheduledAt: new Date(when).toISOString() }) });
    });

  const unschedule = () => call(() => api(`/api/posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ action: "unschedule" }) }));
  const retry = () => call(() => api(`/api/posts/${post.id}/retry`, { method: "POST" }));
  const remove = () =>
    call(async () => {
      if (!confirm("Delete this post and its media?")) return;
      await api(`/api/posts/${post.id}`, { method: "DELETE" });
    });

  const edit = (k: keyof Post["captions"], v: string) => {
    setCaptions({ ...captions, [k]: v });
    setDirty(true);
  };

  const anyPublished = Object.values(post.results).some((r) => r?.status === "published");

  return (
    <div className="post">
      <div className="post-head">
        <div style={{ minWidth: 0 }}>
          <div className="title">
            {FORMAT_LABEL[post.format]} · {product?.name ?? "Deleted product"}
          </div>
          <div className="hint">
            {post.status === "scheduled" && post.scheduledAt ? `Scheduled for ${new Date(post.scheduledAt).toLocaleString()}` : new Date(post.createdAt).toLocaleString()}
          </div>
        </div>
        <span className={`badge ${post.status}`}>{post.status}</span>
      </div>

      <div className="media">
        {post.format === "reel" && post.video ? (
          <video src={media(post.video)} controls playsInline preload="metadata" poster={media(slides[0]?.tall)} />
        ) : cur ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="main" src={imgFor(cur)} alt="" style={tab === "pinterest" ? { aspectRatio: "2 / 3" } : undefined} />
            {cur.provider && <span className="src-tag">{cur.source === "ai-ref" ? "AI · real product" : cur.source === "ai" ? "AI" : "Original photo"}</span>}
            {slides.length > 1 && (
              <>
                <span className="counter">
                  {idx + 1}/{slides.length}
                </span>
                <button className="nav l" onClick={() => setIdx((idx - 1 + slides.length) % slides.length)}>
                  ‹
                </button>
                <button className="nav r" onClick={() => setIdx((idx + 1) % slides.length)}>
                  ›
                </button>
              </>
            )}
          </>
        ) : (
          <div className="placeholder">
            {running ? <div className="spinner" /> : null}
            <div>{post.progress || (post.status === "failed" ? "Generation failed" : "No media")}</div>
          </div>
        )}
        {running && slides.length > 0 && (
          <div className="placeholder" style={{ aspectRatio: "auto", padding: 10, flexDirection: "row" }}>
            <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> {post.progress}
          </div>
        )}
        {slides.length > 1 && (
          <div className="thumbs">
            {slides.map((s, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={media(s.feed || s.tall)} alt="" className={i === idx ? "on" : ""} onClick={() => setIdx(i)} />
            ))}
          </div>
        )}
      </div>

      <div className="post-body stack">
        {post.error && <div className="error">{post.error}</div>}
        {error && <div className="error">{error}</div>}

        {post.status !== "generating" && (
          <>
            <div className="ptabs">
              {(["instagram", "facebook", "pinterest"] as Platform[]).map((p) => (
                <button key={p} className={tab === p ? "on" : ""} onClick={() => setTab(p)}>
                  {PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>
            {tab === "instagram" && <textarea rows={7} value={captions.instagram} onChange={(e) => edit("instagram", e.target.value)} />}
            {tab === "facebook" && <textarea rows={5} value={captions.facebook} onChange={(e) => edit("facebook", e.target.value)} />}
            {tab === "pinterest" && (
              <>
                <input type="text" value={captions.pinterestTitle} maxLength={100} onChange={(e) => edit("pinterestTitle", e.target.value)} />
                <textarea rows={4} value={captions.pinterestDescription} onChange={(e) => edit("pinterestDescription", e.target.value)} />
              </>
            )}
            {tab !== "pinterest" && (
              <div>
                <label>Hashtags</label>
                <input
                  type="text"
                  value={hashtags}
                  onChange={(e) => {
                    setHashtags(e.target.value);
                    setDirty(true);
                  }}
                />
              </div>
            )}
            <details>
              <summary>Preview final {PLATFORM_LABEL[tab]} text</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13 }}>
                {composeCaption({ captions, hashtags: hashtags.split(/[\s,]+/).filter(Boolean) }, tab)}
              </pre>
            </details>
            <div>
              <label>Post to</label>
              <div className="checks">
                {(["instagram", "facebook", "pinterest"] as Platform[]).map((p) => (
                  <span
                    key={p}
                    className={`check ${platforms.includes(p) ? "on" : ""}`}
                    onClick={() => {
                      setPlatforms(toggle(platforms, p));
                      setDirty(true);
                    }}
                  >
                    <input type="checkbox" readOnly checked={platforms.includes(p)} /> {PLATFORM_LABEL[p]}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {Object.keys(post.results).length > 0 && (
          <div className="results">
            {(Object.entries(post.results) as [Platform, Post["results"][Platform]][]).map(([p, r]) =>
              r ? (
                <div key={p} className={`result ${r.status === "published" ? "ok" : "bad"}`}>
                  {r.status === "published" ? "✓" : "✕"} {PLATFORM_LABEL[p]}:{" "}
                  {r.status === "published" ? (
                    r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer">
                        view post
                      </a>
                    ) : (
                      "published"
                    )
                  ) : (
                    r.error
                  )}
                </div>
              ) : null,
            )}
          </div>
        )}

        <div className="actions">
          {dirty && (
            <button onClick={save} disabled={working || running}>
              Save
            </button>
          )}
          {["draft", "partial", "failed", "scheduled"].includes(post.status) && slides.length > 0 && (
            <button className="primary" onClick={publish} disabled={working || running || !platforms.length}>
              {post.status === "partial" || (post.status === "failed" && anyPublished) ? "Retry failed" : "Publish now"}
            </button>
          )}
          {post.status === "draft" && slides.length > 0 && (
            <>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              <button onClick={schedule} disabled={working}>
                Schedule
              </button>
            </>
          )}
          {post.status === "scheduled" && (
            <button onClick={unschedule} disabled={working}>
              Unschedule
            </button>
          )}
          {(post.status === "failed" || post.status === "draft") && !anyPublished && (
            <button onClick={retry} disabled={working}>
              {post.status === "failed" ? "Retry" : "Regenerate"}
            </button>
          )}
          <span style={{ flex: 1 }} />
          {!running && (
            <button className="danger" onClick={remove} disabled={working}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
