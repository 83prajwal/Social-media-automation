import fs from "fs";
import path from "path";
import { MEDIA_DIR } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const root = path.resolve(MEDIA_DIR);
  const abs = path.resolve(root, ...parts);
  if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return new Response("Not found", { status: 404 });
  }
  const buf = fs.readFileSync(abs);
  const type = TYPES[path.extname(abs).toLowerCase()] || "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    return new Response(new Uint8Array(buf.subarray(start, end + 1)), {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${buf.length}`,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
      },
    });
  }
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": type, "Content-Length": String(buf.length), "Accept-Ranges": "bytes", "Cache-Control": "no-cache" },
  });
}
