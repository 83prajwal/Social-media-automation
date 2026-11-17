import { spawn } from "child_process";
import fs from "fs";

const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";

let ffmpegOk: boolean | null = null;
export function ffmpegAvailable(): Promise<boolean> {
  if (ffmpegOk !== null) return Promise.resolve(ffmpegOk);
  return new Promise((resolve) => {
    const p = spawn(ffmpegBin(), ["-version"]);
    p.on("error", () => resolve((ffmpegOk = false)));
    p.on("close", (code) => resolve((ffmpegOk = code === 0)));
  });
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin(), args);
    let stderr = "";
    p.stderr.on("data", (d) => (stderr = (stderr + d.toString()).slice(-3000)));
    p.on("error", (e) => reject(new Error(`Could not start ffmpeg (${e.message}). Install it or set FFMPEG_PATH.`)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${stderr.slice(-1200)}`))));
  });
}

/**
 * Build a 1080x1920 reel: slow Ken-Burns zoom on each frame, cross-fades between them,
 * optional background music (REEL_MUSIC_PATH) or a silent audio track.
 */
export async function buildReel(frames: string[], outPath: string, secondsPerFrame = 3.2) {
  if (!frames.length) throw new Error("No frames for the reel");
  const fps = 30;
  const T = 0.6; // cross-fade duration
  const D = secondsPerFrame;
  const total = frames.length * D - (frames.length - 1) * T;
  const args: string[] = ["-y"];
  frames.forEach((f) => args.push("-i", f));

  const music = process.env.REEL_MUSIC_PATH;
  const audioIdx = frames.length;
  if (music && fs.existsSync(music)) args.push("-stream_loop", "-1", "-i", music);
  else args.push("-f", "lavfi", "-t", total.toFixed(2), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");

  const filters: string[] = [];
  frames.forEach((_, i) => {
    const zoomIn = i % 2 === 0;
    const z = zoomIn ? "min(zoom+0.0009,1.12)" : "if(eq(on,0),1.12,max(zoom-0.0009,1.0))";
    filters.push(
      `[${i}:v]scale=2160:3840,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(D * fps)}:s=1080x1920:fps=${fps},setsar=1,format=yuv420p[v${i}]`,
    );
  });
  let last = "v0";
  for (let k = 1; k < frames.length; k++) {
    filters.push(`[${last}][v${k}]xfade=transition=fade:duration=${T}:offset=${(k * (D - T)).toFixed(2)}[x${k}]`);
    last = `x${k}`;
  }
  filters.push(`[${audioIdx}:a]afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[a]`);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", `[${last}]`, "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "128k",
    "-t", total.toFixed(2),
    "-movflags", "+faststart",
    outPath,
  );
  await run(args);
}
