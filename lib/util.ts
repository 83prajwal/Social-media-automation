import crypto from "crypto";

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(5).toString("hex")}`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : min)));

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 60_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`Request timed out after ${ms / 1000}s: ${url.slice(0, 80)}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Wrap a Node Buffer as a Blob (for FormData / fetch bodies). */
export const toBlob = (buf: Buffer, type: string) => new Blob([new Uint8Array(buf)], { type });

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
