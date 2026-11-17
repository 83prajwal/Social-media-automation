import { fetchWithTimeout } from "./util";

export function llmProvider(): "gemini" | "groq" | null {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  return null;
}

function parseJSON(text: string) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

async function gemini(system: string, prompt: string): Promise<string> {
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const r = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
      }),
    },
    120_000,
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`Gemini: ${j.error?.message || r.status}`);
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text || "").join("");
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

async function groq(system: string, prompt: string): Promise<string> {
  const r = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.9,
      }),
    },
    120_000,
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`Groq: ${j.error?.message || r.status}`);
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned no text");
  return text;
}

/** Ask the configured free LLM for JSON. Tries Gemini, then Groq, with one retry each. */
export async function generateJSON<T>(system: string, prompt: string): Promise<T> {
  const chain: ((s: string, p: string) => Promise<string>)[] = [];
  if (process.env.GEMINI_API_KEY) chain.push(gemini);
  if (process.env.GROQ_API_KEY) chain.push(groq);
  if (!chain.length) {
    throw new Error("No AI key configured. Add a free GEMINI_API_KEY (or GROQ_API_KEY) to .env.local and restart.");
  }
  let lastErr: unknown;
  for (const fn of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return parseJSON(await fn(system, prompt)) as T;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr;
}
