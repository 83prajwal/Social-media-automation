import { db } from "@/lib/db";
import { scrapeProduct } from "@/lib/scrape";
import { errMsg } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(db.listProducts());
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url || !/^https?:\/\//i.test(url)) return Response.json({ error: "Enter a full product URL (https://…)" }, { status: 400 });
    const product = await scrapeProduct(url);
    return Response.json(db.addProduct(product));
  } catch (e) {
    return Response.json({ error: errMsg(e) }, { status: 500 });
  }
}
