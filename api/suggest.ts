// api/suggest.ts

/* -------------------- Rate limit (in-memory) -------------------- */
const rateLimitMap = new Map<string, { count: number; ts: number }>();
const WINDOW_MS = 5_000;
const MAX_REQ = 1;

function getClientIp(req: any): string {
  const xf = (req?.headers?.["x-forwarded-for"] as string) || "";
  return xf.split(",")[0]?.trim() || req?.socket?.remoteAddress || "unknown";
}
function hitLimit(ip: string) {
  const now = Date.now();
  const row = rateLimitMap.get(ip);
  if (!row) { rateLimitMap.set(ip, { count: 1, ts: now }); return false; }
  if (now - row.ts < WINDOW_MS) { if (row.count >= MAX_REQ) return true; row.count += 1; return false; }
  rateLimitMap.set(ip, { count: 1, ts: now }); return false;
}

/* -------------------- Helpers -------------------- */
import {
  // normalizeLang,               // ❌ niet meer forceren naar en/nl
  normalizeTone,
  normalizePersona,
  systemFor,
  personaHint,
  toneHint,
  jsonListSchema,
  stripLines,
  uniq5,
  looksEnglish,
  formatRepairSystem,
} from "../lib/promtHelpers";
import { languageNameFromCode, langForHelpers } from "../lib/lang";

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/* -------------------- Handler -------------------- */
export default async function handler(req: any, res: any) {
  try {
    // CORS
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type,authorization");
    if (req.method === "OPTIONS") return res.status(200).send("{}");

    // Health
    if (req.method === "GET") {
      return res.status(200).send(JSON.stringify({
        ok: true,
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        hint: "POST { input|text|prompt, language?, persona?|coach?, tone?|flirtLevel?, emoji? }"
      }));
    }
    if (req.method !== "POST") {
      return res.status(405).send(JSON.stringify({ error: "Method not allowed" }));
    }

    // Rate limit
    const ip = getClientIp(req);
    if (hitLimit(ip)) {
      return res.status(429).send(JSON.stringify({
        error: "rate_limited",
        message: "Too many requests, try again later.",
        retryAfter: Math.ceil(WINDOW_MS / 1000),
      }));
    }

    // Body
    const raw = typeof req.body === "string"
      ? req.body
      : req.body && typeof req.body === "object"
      ? JSON.stringify(req.body)
      : await readBody(req);

    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {}

    // Extract
    const rawTextCandidate = body?.input ?? body?.text ?? body?.prompt ?? body?.message ?? body?.content ?? "";
    const input: string = String(rawTextCandidate ?? "").trim();

    // ✅ volledige taalcode (bv. de, pt-BR, zh, tr)
    const language: string = String(body?.language || "en").toLowerCase();

    // ✅ helpers verwachten ("en" | "nl") → derive alleen hiervoor
    const langForH: "en" | "nl" = langForHelpers(language);

    const persona = normalizePersona(body?.persona ?? body?.coach);
    const tone = normalizeTone(body?.tone ?? body?.flirtLevel);
    const emoji: boolean | undefined = body?.emoji;

    if (!input) {
      return res.status(400).send(JSON.stringify({
        error: "missing_input",
        message: "Missing text: please send { input } or { text } or { prompt } as a non-empty string.",
      }));
    }

    const key: string | undefined = process.env.OPENAI_API_KEY;
    if (!key) {
      const lines = uniq5(
        stripLines(
          language.startsWith("en")
            ? `Short replies for: ${input}\n(2)\n(3)\n(4)\n(5)`
            : `Korte reacties voor: ${input}\n(2)\n(3)\n(4)\n(5)`
        )
      );
      return res.status(200).send(JSON.stringify({
        model: "dummy",
        langEcho: language,
        suggestions: lines.map((text) => ({ style: tone, text, why: persona ? `Persona ${persona}, tone ${tone}` : "" })),
        note: "OPENAI_API_KEY missing",
      }));
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // 1) hoofd-call: JSON afdwingen — helpers op (en|nl), prompt noemt voluit taalnaam
    const target = languageNameFromCode(language);
    const sys = systemFor(langForH, "list5") + (emoji === false ? "\nDo not use emojis." : "");
    const usr =
      `${personaHint(langForH, persona)} ${toneHint(langForH, tone)}\n` +
      `Write all outputs in: ${target}.\n` +
      `Context: ${input}\n` +
      jsonListSchema(tone);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr },
        ],
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "<no body>");
      if (detail.includes("insufficient_quota")) {
        const lines = uniq5(
          stripLines(
            language.startsWith("en")
              ? `Short replies for: ${input}\n(2)\n(3)\n(4)\n(5)`
              : `Korte reacties voor: ${input}\n(2)\n(3)\n(4)\n(5)`
          )
        );
        return res.status(200).send(JSON.stringify({
          model: "dummy",
          langEcho: language,
          suggestions: lines.map((text) => ({ style: tone, text })),
          note: "OpenAI quota",
        }));
      }
      return res.status(r.status).send(JSON.stringify({ error: "openai_error", detail }));
    }

    const data = await r.json().catch(() => ({}));
    let out = data?.choices?.[0]?.message?.content ?? "";

    // probeer JSON te parsen
    type Sug = { text: string; style?: string; why?: string };
    let suggestions: Sug[] = [];
    try {
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed?.suggestions)) suggestions = parsed.suggestions;
    } catch {}

    // Fallback op text → strip/uniq (universele vertaalfallback)
    if (!suggestions.length) {
      if (!language.startsWith("en") && looksEnglish(out)) {
        const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model, temperature: 0,
            messages: [
              {
                role: "system",
                content: `Translate to natural ${languageNameFromCode(language)}. Return 5 separate single-line suggestions, no numbering or quotes.`,
              },
              { role: "user", content: out },
            ],
          }),
        });
        const d2 = await r2.json().catch(() => ({}));
        out = d2?.choices?.[0]?.message?.content ?? out;
      }
      const lines = uniq5(stripLines(out));
      suggestions = lines.map((t) => ({ text: t, style: tone }));
    }

    // Format-repair naar EXACT 5 indien nodig — helpers op (en|nl)
    if (suggestions.length !== 5) {
      const fmt = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, temperature: 0.2,
          messages: [
            { role: "system", content: formatRepairSystem(langForH, tone) },
            { role: "user", content: (suggestions.map((s) => s.text).join("\n") || out) },
          ],
        }),
      });
      const fmtData = await fmt.json().catch(() => ({}));
      const fixed = fmtData?.choices?.[0]?.message?.content ?? out;
      const lines = uniq5(stripLines(fixed));
      suggestions = lines.map((t) => ({ text: t, style: tone }));
    }

    // cap → 5
    suggestions = suggestions.slice(0, 5).map((s) => ({
      text: s.text,
      style: s.style || tone,
      why: s.why || (persona ? `Persona ${persona}, tone ${tone}` : ""),
    }));

    return res.status(200).send(JSON.stringify({
      model,
      langEcho: language,
      suggestions,
    }));
  } catch (e: any) {
    return res.status(500).send(JSON.stringify({ error: "server_error", detail: String(e) }));
  }
}
