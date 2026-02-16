// api/chat.ts
export const config = { runtime: "edge" };

// ❗ Gebruik dezelfde helpers als suggest.ts
import {
  normalizeTone,
  normalizePersona,
  stripLines,
  uniq5,
  looksEnglish,
  jsonListSchema,
  systemFor,
  personaHint,
  toneHint,
  formatRepairSystem,
  // ❌ normalizeLang bestaat niet meer → zelf taal normaliseren
} from "../lib/promptHelpers";

function json(data: any, status = 200) {
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

// simpele language normalizer (zelfde als aiService)
function normalizeFullLang(l?: string): string {
  return String(l ?? "en").toLowerCase();
}

export default async function handler(req: Request) {
  try {
    if (req.method === "OPTIONS") return json({}, 200);

    if (req.method === "GET") {
      return json({
        ok: true,
        hint: "POST { input|text|prompt, language?, persona?, tone? }",
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      });
    }

    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const body = await req.json().catch(() => ({}));

    const rawInput =
      body.input ??
      body.text ??
      body.prompt ??
      body.message ??
      body.content ??
      "";

    const input = String(rawInput).trim();
    if (!input) {
      return json(
        { error: "missing_input", message: "Send { input } or { text }" },
        400
      );
    }

    // taal exact doorgeven, geen EN/NL limit meer
    const language = normalizeFullLang(body.language);

    const tone = normalizeTone(body.tone ?? body.flirtLevel);
    const persona = normalizePersona(body.persona);

    const key = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    /* -------------------------------------------------------
       GEEN OPENAI KEY → DUMMY SUGGESTIES 
    ------------------------------------------------------- */
    if (!key) {
      const lines = uniq5(stripLines(`Variations:\n${input}\n2\n3\n4\n5`));
      return json({
        model: "dummy",
        langEcho: language,
        suggestions: lines.map((text) => ({ text, style: tone })),
      });
    }

    /* -------------------------------------------------------
       1) Hoofd OpenAI call (JSON enforced)
    ------------------------------------------------------- */
    const sys = systemFor("en", "list5"); // helpers gebruiken EN/NL → EN werkt altijd stabiel
    const usr =
      `${personaHint("en", persona)} ${toneHint("en", tone)}\n` +
      `Write ALL outputs in: ${language}.\n` +
      `Context: ${input}\n` +
      jsonListSchema(tone);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${key}`,
      },
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
      return json({ error: "openai_error", detail }, r.status);
    }

    const data = await r.json();
    let out = data?.choices?.[0]?.message?.content ?? "";

    /* -------------------------------------------------------
       2) JSON parse proberen
    ------------------------------------------------------- */
    let suggestions: { text: string; style?: string }[] = [];
    try {
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed?.suggestions)) {
        suggestions = parsed.suggestions;
      }
    } catch {}

    /* -------------------------------------------------------
       3) Fallback → text strippen indien geen JSON
    ------------------------------------------------------- */
    if (!suggestions.length) {
      if (language !== "en" && looksEnglish(out)) {
        const tr = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [
              {
                role: "system",
                content: `Translate to ${language}. Return 5 lines.`,
              },
              { role: "user", content: out },
            ],
          }),
        });
        const translated = await tr.json().catch(() => ({}));
        out = translated?.choices?.[0]?.message?.content ?? out;
      }

      const lines = uniq5(stripLines(out));
      suggestions = lines.map((t) => ({ text: t, style: tone }));
    }

    /* -------------------------------------------------------
       4) Format repair → EXACT 5 rules
    ------------------------------------------------------- */
    if (suggestions.length !== 5) {
      const fmt = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: formatRepairSystem("en", tone) },
            {
              role: "user",
              content: suggestions.map((s) => s.text).join("\n") || out,
            },
          ],
        }),
      });

      const fmtData = await fmt.json().catch(() => ({}));
      const fixed = fmtData?.choices?.[0]?.message?.content ?? out;
      const lines = uniq5(stripLines(fixed));
      suggestions = lines.map((t) => ({ text: t, style: tone }));
    }

    /* -------------------------------------------------------
       5) Final return
    ------------------------------------------------------- */
    return json({
      ok: true,
      model,
      langEcho: language,
      suggestions: suggestions.slice(0, 5),
    });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e) }, 500);
  }
}
