// api/openers.ts
export const config = { runtime: "edge" };

import {
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

type Body = {
  name?: string;
  interests?: string;
  tone?: "safe" | "playful" | "flirty" | string;
  persona?: "funny" | "classy" | "wing" | "wingwoman" | string;
  language?: string; // full code (de, pt-BR, zh, tr, ...)
};

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

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return json({}, 200);

  const rid = crypto.randomUUID();
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (req.method === "GET") {
    return json({
      ok: true,
      rid,
      hint: "POST { name?, interests?, tone?, persona?, language? }",
    });
  }
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    // Full code in; helpers get en|nl; prompts get full language name
    const language = String(body.language || "en").toLowerCase();
    const langForH: "en" | "nl" = langForHelpers(language);
    const target = languageNameFromCode(language);

    const tone = normalizeTone(body.tone);
    const persona = normalizePersona(body.persona);

    const name = (body.name || "").toString().trim();
    const interests = (body.interests || "").toString().trim();

    if (!hasOpenAI) {
      const base = language.startsWith("en") ? "Opener about" : "Openingszin over";
      const lines = uniq5(
        stripLines(
          `${base} ${name || "jou"} ${interests ? `(${interests})` : ""} (1)\n(2)\n(3)\n(4)\n(5)`
        )
      );
      const suggestions = lines.map((text, i) => ({
        id: `opener_${i + 1}`,
        text,
        style: tone,
        why: persona ? `Persona ${persona}, tone ${tone}` : `Tone ${tone}`,
      }));
      console.log(`[openers:${rid}] dummy`, { language, tone, persona });
      return json({ model: "dummy", suggestions, rid }, 200);
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // 1) hoofd-call met JSON afdwingen
    const sys = systemFor(langForH, "list5");
    const usr =
      `${personaHint(langForH, persona)} ${toneHint(langForH, tone)}\n` +
      `Write all outputs in: ${target}. Use only ${target}. Do not mix languages.\n` +
      `Name: ${name || "-"}\nInterests: ${interests || "-"}\n` +
      `Context: openingszinnen voor een dating app.\n` +
      jsonListSchema(tone);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
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
      console.log(`[openers:${rid}] openai_error`, r.status, detail.slice(0, 200));
      if (detail.includes("insufficient_quota")) {
        const lines = uniq5(
          stripLines(
            `Openingszin over ${name || "jou"} ${interests ? `(${interests})` : ""} (1)\n(2)\n(3)\n(4)\n(5)`
          )
        );
        const suggestions = lines.map((text, i) => ({
          id: `opener_${i + 1}`,
          text,
          style: tone,
          why: `Quota exhausted — fallback (${tone})`,
        }));
        return json({ model: "dummy", suggestions, note: "OpenAI quota", rid }, 200);
      }
      return json({ error: "openai_error", detail, rid }, r.status);
    }

    const data = await r.json().catch(() => ({} as any));
    let out: string = data?.choices?.[0]?.message?.content ?? "";

    // Probeer JSON te parsen
    type Sug = { text: string; style?: string; why?: string };
    let suggestions: Sug[] = [];
    try {
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed?.suggestions)) suggestions = parsed.suggestions;
    } catch {}

    // Fallback: text → strip/uniq
    if (!suggestions.length) {
      if (!language.startsWith("en") && looksEnglish(out)) {
        const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [
              {
                role: "system",
                content: `Translate to natural ${target}. Return 5 separate single-line openers, no numbering or quotes.`,
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

    // 2) Post-translate bestaande suggestions als taal ≠ Engels
    if (!language.startsWith("en") && suggestions.length) {
      const toTranslate = suggestions.map((s) => `S: ${s.text}`).join("\n");

      const r3 = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: `Translate to natural ${target}. Return plain text lines, keep "S:" prefixes, no quotes.`,
            },
            { role: "user", content: toTranslate },
          ],
        }),
      });

      const d3 = await r3.json().catch(() => ({} as any));
      const rawTranslated = String(d3?.choices?.[0]?.message?.content ?? "").trim();
      const translatedSource = rawTranslated || toTranslate;

      const translated = translatedSource
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const newS: string[] = [];
      for (const line of translated) {
        if (line.startsWith("S:")) newS.push(line.slice(2).trim());
      }
      if (newS.length) {
        suggestions = newS.map((t) => ({ text: t, style: tone }));
      }
    }

    // Format-repair naar EXACT 5 indien nodig
    if (suggestions.length !== 5) {
      const fmt = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: formatRepairSystem(langForH, tone) },
            { role: "user", content: suggestions.map((s) => s.text).join("\n") || out },
          ],
        }),
      });
      const fmtData = await fmt.json().catch(() => ({}));
      const fixed = fmtData?.choices?.[0]?.message?.content ?? out;
      const lines = uniq5(stripLines(fixed));
      suggestions = lines.map((t) => ({ text: t, style: tone }));
    }

    // cap en why invullen
    const final = suggestions.slice(0, 5).map((s, i) => ({
      id: `opener_${i + 1}`,
      text: s.text,
      style: (s.style as any) || tone,
      why: s.why || (persona ? `Persona ${persona}, tone ${tone}` : ""),
    }));

    console.log(`[openers:${rid}] ok`, { language, target, tone, persona, count: final.length });
    return json({ model, suggestions: final, rid }, 200);
  } catch (e: any) {
    console.log(`[openers] server_error`, String(e));
    return json({ error: "server_error", detail: String(e) }, 500);
  }
}
