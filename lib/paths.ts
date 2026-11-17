import path from "path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const MEDIA_DIR = path.join(DATA_DIR, "media");

/** Convert a media-relative path ("post_x/s0_feed.jpg") to an absolute file path. */
export const mediaAbs = (rel: string) => path.join(MEDIA_DIR, ...rel.split("/"));
