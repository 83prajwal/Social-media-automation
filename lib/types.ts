export type Platform = "instagram" | "facebook" | "pinterest";
export type PostFormat = "single" | "carousel" | "reel";
export type PostStatus =
  | "generating"
  | "draft"
  | "failed"
  | "scheduled"
  | "publishing"
  | "published"
  | "partial";

export const PLATFORMS: Platform[] = ["instagram", "facebook", "pinterest"];
export const FORMATS: PostFormat[] = ["single", "carousel", "reel"];

export interface Product {
  id: string;
  url: string;
  name: string;
  description: string;
  price?: string;
  currency?: string;
  brand?: string;
  images: string[];
  pageText: string;
  createdAt: string;
}

export interface Captions {
  instagram: string;
  facebook: string;
  pinterestTitle: string;
  pinterestDescription: string;
}

export interface Slide {
  prompt?: string;
  headline?: string;
  subtext?: string;
  /** ai-ref = AI scene generated from the real product photo; ai = text-to-image; product = original photo */
  source: "ai-ref" | "ai" | "product";
  provider?: string;
  /** media-relative paths (served from /api/media/...) */
  src?: string;
  feed?: string; // 1080x1350 (Instagram / Facebook)
  pin?: string; // 1000x1500 (Pinterest)
  tall?: string; // 1080x1920 (reel frame)
}

export interface PlatformResult {
  status: "published" | "failed";
  id?: string;
  url?: string;
  error?: string;
  at: string;
}

export interface GenOptions {
  slideCount: number;
  sceneCount: number;
  useProductPhotos: boolean;
  textOverlay: boolean;
  style: string;
  tone: string;
  notes: string;
  after: "draft" | "publish" | "schedule";
  scheduledAt?: string;
}

export interface Post {
  id: string;
  productId: string;
  format: PostFormat;
  platforms: Platform[];
  status: PostStatus;
  progress?: string;
  error?: string;
  captions: Captions;
  hashtags: string[];
  slides: Slide[];
  video?: string;
  scheduledAt?: string;
  results: Partial<Record<Platform, PlatformResult>>;
  genOptions: GenOptions;
  createdAt: string;
  updatedAt: string;
}
