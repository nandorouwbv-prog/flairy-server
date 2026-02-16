// api/openers.ts
export const config = { runtime: "edge" };

// ---------- Types ----------
type Body = {
  name?: string;
  interests?: string;
  tone?: "safe" | "playful" | "flirty" | string;
  persona?: "funny" | "classy" | "wing" | "wingwoman" | string;
  language?: string; // full code (de, pt-BR, zh, tr, ...)
};

type Suggestion = {
  id: string;
  text: string;
  style: "safe" | "playful" | "flirty";
  why?: string;
};

// ---------- Helpers ----------
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

function safeLower(v: any): string {
  try {
    return String(v || "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeFullLang(l?: string): string {
  try {
    return String(l || "en").toLowerCase();
  } catch {
    return "en";
  }
}

function normalizeTone(t?: string): "safe" | "playful" | "flirty" {
  const v = safeLower(t);
  if (v === "playful") return "playful";
  if (v === "flirty") return "flirty";
  return "safe";
}

function normalizePersona(p?: string): "funny" | "classy" | "wing" {
  const v = safeLower(p);
  if (v === "wingwoman" || v === "wingman") return "wing";
  if (v === "funny" || v === "classy" || v === "wing") return v as any;
  return "classy";
}

// heel simpele mapping van code -> taalnaam voor prompt
function languageNameFromCode(code: string): string {
  const c = safeLower(code);
  if (c.startsWith("nl")) return "Dutch";
  if (c.startsWith("de")) return "German";
  if (c.startsWith("fr")) return "French";
  if (c.startsWith("es")) return "Spanish";
  if (c.startsWith("pt")) return "Portuguese";
  if (c.startsWith("it")) return "Italian";
  if (c.startsWith("tr")) return "Turkish";
  if (c.startsWith("pl")) return "Polish";
  if (c.startsWith("sv")) return "Swedish";
  if (c.startsWith("no")) return "Norwegian";
  if (c.startsWith("da")) return "Danish";
  if (c.startsWith("fi")) return "Finnish";
  if (c.startsWith("cs")) return "Czech";
  if (c.startsWith("hu")) return "Hungarian";
  if (c.startsWith("ro")) return "Romanian";
  if (c.startsWith("ru")) return "Russian";
  if (c.startsWith("el")) return "Greek";
  if (c.startsWith("ar")) return "Arabic";
  if (c.startsWith("hi")) return "Hindi";
  if (c.startsWith("zh")) return "Chinese";
  if (c.startsWith("ja")) return "Japanese";
  if (c.startsWith("ko")) return "Korean";
  return "English";
}

function uniqueLinesFromText(text: string, limit = 5): string[] {
  const set = new Set<string>();
  for (const raw of text.split("\n")) {
    const t = raw.replace(/^[-*\d\.\s"“”]+/, "").replace(/["“”]+$/, "").trim();
    if (!t) continue;
    if (!set.has(t)) set.add(t);
    if (set.size >= limit) break;
  }
  return Array.from(set);
}

function dummySuggestions(
  name: string,
  interests: string,
  tone: "safe" | "playful" | "flirty",
  persona: string
): Suggestion[] {
  const subject = name || "you";
  const ctx = interests ? ` (${interests})` : "";
  const base: string[] = [
    `Hey ${subject}, wat is het verhaal achter ${ctx || "je profielfoto"}?`,
    `Ik moest je even een bericht sturen, je vibe valt echt op.`,
    `Als je één perfecte ${ctx || "zondag"} mocht plannen, hoe zou die eruitzien?`,
    `Oké belangrijke vraag: wat bestel jij als eerste op een terrasje?`,
    `Je klinkt interessant – zin om dit gesprek niet bij 'hey' te laten?`,
  ];
  return base.slice(0, 5).map((text, i) => ({
    id: `opener_${i + 1}`,
    text,
    style: tone,
    why: `Dummy opener, persona ${persona}, tone ${tone}`,
  }));
}

// ---------- Handler ----------
export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return json({}, 200);

  const rid =
    (globalThis as any).crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2);

  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (req.method === "GET") {
    return json({
      ok: true,
      rid,
      hint: "POST { name?, interests?, tone?, persona?, language? }",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const rawBody = (await req.json().catch(() => ({}))) as Body | undefined;
    const body: Body = rawBody && typeof rawBody === "object" ? rawBody : {};

    console.log("[openers] incoming body:", body);

    const language = normalizeFullLang(body.language);
    const target = languageNameFromCode(language);

    const tone = normalizeTone(body.tone);
    const persona = normalizePersona(body.persona);
    const name = (body.name || "").toString().trim();
    const interests = (body.interests || "").toString().trim();

    console.log("[openers] normalized:", {
      rid,
      language,
      target,
      tone,
      persona,
      name,
      interests,
    });

    const key = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // Geen key → dummy openers teruggeven
    if (!hasOpenAI || !key) {
      const suggestions = dummySuggestions(name, interests, tone, persona);
      console.log("[openers] no OPENAI key, returning dummy", {
        rid,
        count: suggestions.length,
      });
      return json(
        {
          model: "dummy",
          suggestions,
          rid,
          langEcho: target,
        },
        200
      );
    }

    // ---------- OpenAI call ----------
    const sys = `
You are Flairy, a concise dating opener writer.
Rules:
- Return short, message-ready openers (max ~120 characters each).
- Vary angle (playful, curious, direct). Avoid emojis unless user used them.
- Write ALL outputs in ${target}. Use only ${target}. Do not mix languages.
- Persona = ${persona}. Tone = ${tone}.
- Output ONLY valid JSON: { "suggestions": ["...","...","...","...","..."] }.
`.trim();

    const usr = `
Context:
- Name: ${name || "-"}
- Interests: ${interests || "-"}
- Task: Create 5 opening lines for a dating app conversation in ${target}.
`.trim();

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
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
      console.log("[openers] openai_error", r.status, detail.slice(0, 200));

      if (detail.includes("insufficient_quota")) {
        const suggestions = dummySuggestions(name, interests, tone, persona);
        return json(
          {
            model: "dummy",
            suggestions,
            note: "OpenAI quota",
            rid,
            langEcho: target,
          },
          200
        );
      }

      return json({ error: "openai_error", detail, rid }, r.status);
    }

    const data = (await r.json().catch(() => ({}))) as any;
    let content: string = data?.choices?.[0]?.message?.content ?? "";

    // Probeer JSON te parsen
    let texts: string[] = [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed?.suggestions)) {
        texts = parsed.suggestions
          .map((x: any) => (typeof x === "string" ? x : x?.text))
          .filter(Boolean);
      }
    } catch {
      // ignore
    }

    // Als JSON niet lukt → tekst per regel verwerken
    if (!texts.length) {
      texts = uniqueLinesFromText(content, 5);
    }

    if (!texts.length) {
      const suggestions = dummySuggestions(name, interests, tone, persona);
      return json(
        {
          model: "fallback",
          suggestions,
          rid,
          langEcho: target,
        },
        200
      );
    }

    const suggestions: Suggestion[] = texts.slice(0, 5).map((text, i) => ({
      id: `opener_${i + 1}`,
      text,
      style: tone,
      why: `Persona ${persona}, tone ${tone}`,
    }));

    console.log("[openers] ok", {
      rid,
      language,
      target,
      tone,
      persona,
      count: suggestions.length,
    });

    return json(
      {
        model,
        suggestions,
        rid,
        langEcho: target,
      },
      200
    );
  } catch (e: any) {
    console.log("[openers] server_error", e?.stack || String(e));
    return json(
      { error: "server_error", detail: e?.stack || String(e) },
      500
    );
  }
}
