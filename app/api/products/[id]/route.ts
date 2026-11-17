import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = db.getProduct(id);
  if (!product) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  db.deleteProduct(id);
  const updated = {
    ...product,
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    ...(typeof body.description === "string" ? { description: body.description } : {}),
    ...(Array.isArray(body.images) ? { images: body.images.filter((u: unknown) => typeof u === "string") } : {}),
  };
  return Response.json(db.addProduct(updated));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  db.deleteProduct(id);
  return Response.json({ ok: true });
}
