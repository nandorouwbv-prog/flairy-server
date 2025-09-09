// api/chat.ts
export const config = { runtime: "edge" };

import {
  normalizeLang,
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


type Body = {
  input?: string;
  text?: string;
  prompt?: string;
  message?: string;
  content?: string;
  language?: "nl" | "en" | string;
  persona?: "funny" | "classy" | "wing" | "wingwoman" | string;
  tone?: "safe" | "playful" | "flirty" | string;
  flirtLevel?: "safe" | "playful" | "flirty" | string;
};

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
  });
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return jsonResp({}, 200);

  if (req.method === "GET") {
    return jsonResp({
      ok: true,
      hint: "POST { input|text|prompt, language?, persona?, tone? }",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    });
  }

  if (req.method !== "POST") return jsonResp({ error: "Method Not Allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const input = String(
      body.input ?? body.text ?? body.prompt ?? body.message ?? body.content ?? ""
    ).trim();

    if (!input) return jsonResp({ error: "missing_input", message: "Send { input } or { text }" }, 400);

    const language = normalizeLang(body.language);
    const tone = normalizeTone(body.tone ?? body.flirtLevel);
    const persona = normalizePersona(body.persona);

    const key = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // Geen key → dummy
    if (!key) {
      const lines = uniq5(stripLines(language === "nl"
        ? `Variaties op: ${input}\n(2)\n(3)\n(4)\n(5)`
        : `Variations on: ${input}\n(2)\n(3)\n(4)\n(5)`));
      return jsonResp({
        model: "dummy",
        langEcho: language,
        suggestions: lines.map((text) => ({ style: tone, text })),
      });
    }

    // 1) hoofd-call: vraag JSON
    const sys = systemFor(language, "list5");
    const usr =
      `${personaHint(language, persona)} ${toneHint(language, tone)}\n` +
      `Context: ${input}\n` +
      jsonListSchema(tone);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.7,
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
        const lines = uniq5(stripLines(language === "nl"
          ? `Variaties op: ${input}\n(2)\n(3)\n(4)\n(5)`
          : `Variations on: ${input}\n(2)\n(3)\n(4)\n(5)`));
        return jsonResp({
          model: "dummy",
          langEcho: language,
          suggestions: lines.map((text) => ({ style: tone, text })),
          note: "OpenAI quota",
        });
      }
      return jsonResp({ error: "openai_error", detail }, r.status);
    }

    const data = await r.json().catch(() => ({}));
    let out = data?.choices?.[0]?.message?.content ?? "";

    // 2) probeer JSON te parsen
    type Sug = { text: string; style?: string; why?: string };
    let suggestions: Sug[] = [];
    try {
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed?.suggestions)) suggestions = parsed.suggestions;
    } catch {
      // ignore
    }

    // 3) Fallback als geen JSON: text → strip/uniq
    if (!suggestions.length) {
      // NL fallback-vertaling als model toch Engels gaf
      if (language === "nl" && looksEnglish(out)) {
        const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model, temperature: 0,
            messages: [
              { role: "system", content: "Vertaal naar natuurlijk Nederlands. Geef 5 losse zinnen, zonder nummering of aanhalingstekens." },
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

    // 4) Format-repair naar EXACT 5 indien nodig
    if (suggestions.length !== 5) {
      const fmt = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, temperature: 0.2,
          messages: [
            { role: "system", content: formatRepairSystem(language, tone) },
            { role: "user", content: (suggestions.map((s) => s.text).join("\n") || out) },
          ],
        }),
      });
      const fmtData = await fmt.json().catch(() => ({}));
      const fixed = fmtData?.choices?.[0]?.message?.content ?? out;
      const lines = uniq5(stripLines(fixed));
      suggestions = lines.map((t) => ({ text: t, style: tone }));
    }

    // (extra: cap op 5)
    suggestions = suggestions.slice(0, 5).map((s) => ({ text: s.text, style: s.style || tone }));

    return jsonResp({
      model,
      langEcho: language,
      suggestions,
    });
  } catch (e: any) {
    return jsonResp({ error: "server_error", detail: String(e) }, 500);
  }
}
