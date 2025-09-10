// api/analyze-chat.ts — geeft 3 vervolgzinnen (≥5 woorden) + 2 coach tips (Edge)
export const config = { runtime: "edge" };

import { languageNameFromCode } from "../lib/lang";

type Body = {
  pastedText: string;
  language?: string;                       // alle codes (en/nl/hi/zh/...)
  coachPersona?: "wing" | "funny" | "classy" | string;
  tone?: "safe" | "playful" | "flirty" | string;
  model?: string; // optioneel override (default gpt-4o-mini)
  debug?: boolean;
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
  });
}

const clean = (s: string) => (s || "").replace(/^[\s"“”]+|["“”]+$/g, "").trim();

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return json({}, 200);

  if (req.method === "GET") {
    return json({
      ok: true,
      hint: "POST { pastedText, language?: string, coachPersona?, tone?, model? }",
      modelDefault: process.env.OPENAI_MODEL || "gpt-4o-mini",
    });
  }

  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const pastedText = (body.pastedText || "").toString().trim();
    if (!pastedText) {
      return json({ error: "missing_input", message: "Provide { pastedText }" }, 400);
    }

    // ✅ Volledige taalcode → nette taalnaam voor prompt
    const language = String(body.language || "en").toLowerCase();
    const target = languageNameFromCode(language);
    const coachPersona = (body.coachPersona || "wing").toString();
    const tone = (body.tone || "playful").toString();
    const model = body.model || process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!process.env.OPENAI_API_KEY) {
      return json({
        model: "dummy",
        suggestions: [
          language.startsWith("en")
            ? "Tell me what your ideal weekend looks like?"
            : "Vertel eens wat jouw ideale weekend inhoudt?",
          language.startsWith("en")
            ? "Which small habit makes your day better?"
            : "Welke kleine gewoonte maakt je dag beter?",
          language.startsWith("en")
            ? "What’s the last thing that really made you laugh?"
            : "Wat is het laatste waar je hard om moest lachen?",
        ],
        coach: [
          language.startsWith("en")
            ? "Ask concrete, small questions (easy to answer)."
            : "Stel concrete, kleine vragen (makkelijk te beantwoorden).",
          language.startsWith("en")
            ? "Vary angles: playful, direct, curious."
            : "Wissel invalshoeken: speels, direct, nieuwsgierig.",
        ],
        langEcho: language,
      });
    }

    const system = `
You are Flairy. Produce optimized follow-up lines for a dating chat.
Rules:
- EXACTLY 3 suggestions, each ≥ 5 words.
- Each suggestion uses a different angle (playful, direct, curious).
- Do not start with the same 2 words as earlier suggestions or the original chat.
- END with "Coach 👇" and 2 bullet tips about structure/hooks.
- Write all outputs in: ${target}. Use only ${target}. Do not mix languages.
- Persona = ${coachPersona}. Tone = ${tone}.
Return ONLY JSON: { "suggestions": ["...","...","..."], "coach": ["tip1","tip2"] }.
`.trim();

    const user = `
Chat text (flattened):
${pastedText}

Please return EXACTLY 3 follow-up lines (≥ 5 words) + 2 coach tips.
`.trim();

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        presence_penalty: 0.7,
        frequency_penalty: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "<no body>");
      return json({ error: "openai_error", detail }, r.status);
    }

    const data = await r.json().catch(() => ({} as any));
    let parsed: { suggestions?: string[]; coach?: string[] } = {};
    try {
      parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
    } catch {
      parsed = { suggestions: [] };
    }

    // Clean + guards
    let suggestions =
      (parsed.suggestions || [])
        .map(clean)
        .filter((s) => s.split(/\s+/).filter(Boolean).length >= 5)
        .slice(0, 3);

    let coach =
      (parsed.coach || [])
        .map(clean)
        .filter(Boolean)
        .slice(0, 2);

    // ✅ Altijd vertalen naar de app-taal wanneer ≠ Engels
    if (!language.startsWith("en")) {
      const toTranslate = [
        ...suggestions.map((s) => `S: ${s}`),
        ...coach.map((c) => `C: ${c}`),
      ].join("\n");

      const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: `Translate to natural ${target}. Keep "S:" and "C:" prefixes; return plain text lines, no quotes.`,
            },
            { role: "user", content: toTranslate },
          ],
        }),
      });
      const d2 = await r2.json().catch(() => ({}));
      const translated = (d2?.choices?.[0]?.message?.content ?? toTranslate)
        .split("\n")
        .map(clean)
        .filter(Boolean);

      const newS: string[] = [];
      const newC: string[] = [];
      for (const line of translated) {
        if (line.startsWith("S:")) newS.push(clean(line.slice(2)));
        else if (line.startsWith("C:")) newC.push(clean(line.slice(2)));
      }
      if (newS.length) suggestions = newS.slice(0, 3);
      if (newC.length) coach = newC.slice(0, 2);
    }

    if (suggestions.length === 0) {
      suggestions.push(
        language.startsWith("en")
          ? "Tell me the best part of your day today?"
          : "Vertel eens wat je het leukst vond aan je dag vandaag?"
      );
    }

    return json({ model, langEcho: language, suggestions, coach }, 200);
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
