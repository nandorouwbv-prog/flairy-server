// api/analyze-chat.ts — geeft 3 vervolgzinnen (≥5 woorden) + 2 coach tips (Edge)
export const config = { runtime: "edge" };

type Body = {
  pastedText: string;
  language?: "nl" | "en" | string;
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

function normLang(v?: string): "nl" | "en" {
  const s = String(v || "nl").toLowerCase();
  return s.startsWith("nl") ? "nl" : "en";
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return json({}, 200);

  if (req.method === "GET") {
    return json({
      ok: true,
      hint: "POST { pastedText, language?: 'nl'|'en', coachPersona?, tone?, model? }",
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

    const language = normLang(body.language);
    const coachPersona = (body.coachPersona || "wing").toString();
    const tone = (body.tone || "playful").toString();
    const model = body.model || process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!process.env.OPENAI_API_KEY) {
      // Dev fallback zonder key
      return json({
        model: "dummy",
        suggestions: [
          language === "nl"
            ? "Vertel eens wat jouw ideale weekend inhoudt?"
            : "Tell me what your ideal weekend looks like?",
          language === "nl"
            ? "Welke kleine gewoonte maakt je dag beter?"
            : "Which small habit makes your day better?",
          language === "nl"
            ? "Wat is het laatste waar je hard om moest lachen?"
            : "What’s the last thing that really made you laugh?",
        ],
        coach: [
          language === "nl"
            ? "Stel concrete, kleine vragen (makkelijk te beantwoorden)."
            : "Ask concrete, small questions (easy to answer).",
          language === "nl"
            ? "Wissel invalshoeken: speels, direct, nieuwsgierig."
            : "Vary angles: playful, direct, curious.",
        ],
      });
    }

    const system = `
Je bent Flairy. Je geeft geoptimaliseerde vervolgzinnen voor een chat.
Regels:
- Geef EXACT 3 suggesties, elk ≥ 5 woorden.
- Elke suggestie heeft een andere invalshoek (speels, direct, nieuwsgierig).
- Begin niet met dezelfde 2 woorden als eerdere suggesties of de oorspronkelijke chat.
- Sluit af met "Coach 👇" en 2 bullets over structuur/inhakers.
- Taal = ${language}, Persona = ${coachPersona}, Toon = ${tone}.
Output JSON: { "suggestions": ["...","...","..."], "coach": ["tip1","tip2"] }.
`.trim();

    const user = `
Chat tekst (samengeplakt):
${pastedText}

Graag EXACT 3 vervolgzinnen (≥ 5 woorden) + 2 coach tips.
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

    // Extra guard: ≥ 5 woorden
    const clean = (s: string) => (s || "").replace(/^[\s"“”]+|["“”]+$/g, "").trim();
    const suggestions =
      (parsed.suggestions || [])
        .map(clean)
        .filter((s) => s.split(/\s+/).filter(Boolean).length >= 5)
        .slice(0, 3);

    const coach =
      (parsed.coach || [])
        .map(clean)
        .filter(Boolean)
        .slice(0, 2);

    if (suggestions.length === 0) {
      // minimal fallback
      suggestions.push(
        language === "nl"
          ? "Vertel eens wat je het leukst vond aan je dag vandaag?"
          : "Tell me the best part of your day today?"
      );
    }

    return json({ model, suggestions, coach }, 200);
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
