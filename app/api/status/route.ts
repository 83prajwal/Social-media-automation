import { imageProviders } from "@/lib/images";
import { llmProvider } from "@/lib/llm";
import { getIgUserId, metaConfigured } from "@/lib/publish/meta";
import { pinterestConfigured } from "@/lib/publish/pinterest";
import { ffmpegAvailable } from "@/lib/reel";
import { errMsg } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let instagram = false;
  let metaError: string | undefined;
  if (metaConfigured()) {
    try {
      instagram = !!(await getIgUserId());
    } catch (e) {
      metaError = errMsg(e);
    }
  }
  return Response.json({
    llm: llmProvider(),
    images: imageProviders(),
    ffmpeg: await ffmpegAvailable(),
    meta: { configured: metaConfigured(), instagram, error: metaError },
    pinterest: { configured: pinterestConfigured() },
  });
}
