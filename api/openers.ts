// api/openers.ts
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
  name?: string;
  interests?: string;
  tone?: "safe" | "playful" | "flirty" | string;
  persona?: "funny" | "classy" | "wing" | "wingwoman" | string;
  language?: "nl" | "en" | string;
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
    const lang = normalizeLang(body.language);
    const tone = normalizeTone(body.tone);
    const persona = normalizePersona(body.persona);

    const name = (body.name || "").toString().trim();
    const interests = (body.interests || "").toString().trim();

    if (!hasOpenAI) {
      const base = lang === "en" ? "Opener about" : "Openingszin over";
      const lines = uniq5(
        stripLines(
          `${base} ${name || "jou"} ${interests ? `(${interests})` : ""} (1)\n(2)\n(3)\n(4)\n(5)`,
        ),
      );
      const suggestions = lines.map((text, i) => ({
        id: `opener_${i + 1}`,
        text,
        style: tone,
        why: persona ? `Persona ${persona}, tone ${tone}` : `Tone ${tone}`,
      }));
      console.log(`[openers:${rid}] dummy`, { lang, tone, persona });
      return json({ model: "dummy", suggestions, rid }, 200);
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // 1) hoofd-call met JSON afdwingen
    const sys = systemFor(lang, "list5");
    const usr =
      `${personaHint(lang, persona)} ${toneHint(lang, tone)}\n` +
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
            `Openingszin over ${name || "jou"} ${interests ? `(${interests})` : ""} (1)\n(2)\n(3)\n(4)\n(5)`,
          ),
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

    // Fallback: text → NL-vertaling indien Engels → strip/uniq
    if (!suggestions.length) {
      if (lang === "nl" && looksEnglish(out)) {
        const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY!}` },
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

    // Format-repair naar EXACT 5 indien nodig
    if (suggestions.length !== 5) {
      const fmt = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY!}` },
        body: JSON.stringify({
          model, temperature: 0.2,
          messages: [
            { role: "system", content: formatRepairSystem(lang, tone) },
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

    console.log(`[openers:${rid}] ok`, { lang, tone, persona, count: final.length });
    return json({ model, suggestions: final, rid }, 200);
  } catch (e: any) {
    console.log(`[openers] server_error`, String(e));
    return json({ error: "server_error", detail: String(e) }, 500);
  }
}

