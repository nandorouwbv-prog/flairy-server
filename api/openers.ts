// api/openers.ts
export const config = { runtime: "edge" };

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
      "access-control-allow-headers": "content-type,authorization"
    }
  });
}

function normalizeLang(l?: string): "nl" | "en" {
  const v = (l || "nl").toLowerCase();
  return v.startsWith("en") ? "en" : "nl";
}
function normalizeTone(t?: string): "safe" | "playful" | "flirty" {
  const v = (t || "safe").toLowerCase();
  if (v === "playful") return "playful";
  if (v === "flirty" || v === "flirt" || v === "flirterig") return "flirty";
  return "safe";
}
function normalizePersona(p?: string) {
  const v = (p || "").toLowerCase();
  if (v === "wingwoman" || v === "wingman") return "wing";
  if (v === "funny" || v === "classy" || v === "wing") return v;
  return undefined;
}

function toObjects(lines: string[], style: "safe" | "playful" | "flirty", why: string) {
  return lines
    .map((s) => s.replace(/^[\-\*\d\.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((text, i) => ({
      id: `opener_${i + 1}`,
      text,
      style,
      why
    }));
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return json({}, 200);

  const rid = crypto.randomUUID();
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (req.method === "GET") {
    return json({ ok: true, rid, hint: "POST { name?, interests?, tone?, persona?, language? }" });
  }
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const lang = normalizeLang(body.language);
    const tone = normalizeTone(body.tone);
    const persona = normalizePersona(body.persona);

    const name = (body.name || "").toString().trim();
    const interests = (body.interests || "").toString().trim();

    const personaHint =
      persona === "funny"
        ? (lang === "en" ? "Use light humor." : "Gebruik luchtige humor.")
        : persona === "classy"
        ? (lang === "en" ? "Keep it elegant and confident." : "Houd het elegant en zelfverzekerd.")
        : persona === "wing"
        ? (lang === "en" ? "Be socially smart and supportive." : "Wees sociaal slim en ondersteunend.")
        : (lang === "en" ? "Be natural." : "Blijf natuurlijk.");

    const toneHint =
      tone === "flirty"
        ? (lang === "en" ? "Flirty but respectful." : "Flirterig maar respectvol.")
        : tone === "playful"
        ? (lang === "en" ? "Playful and positive." : "Speels en positief.")
        : (lang === "en" ? "Safe and friendly." : "Veilig en vriendelijk.");

    if (!hasOpenAI) {
      const why = persona ? `Persona ${persona}, tone ${tone}` : `Tone ${tone}`;
      const base = lang === "en" ? "Opener about" : "Openingszin over";
      const dummy = toObjects(
        [
          `${base} ${name || "you"} ${interests ? `(${interests})` : ""} (1)`,
          `${base} ${name || "you"} ${interests ? `(${interests})` : ""} (2)`,
          `${base} ${name || "you"} ${interests ? `(${interests})` : ""} (3)`
        ],
        tone,
        why
      );
      console.log(`[openers:${rid}] dummy`, { lang, tone, persona });
      return json({ model: "dummy", suggestions: dummy, note: "OPENAI_API_KEY missing", rid });
    }

    const prompt =
      lang === "en"
        ? `Generate 5 original dating app opener lines.\n${personaHint} ${toneHint}\nUser details: name=${name || "-"}, interests=${interests || "-"}.\nKeep each line short, natural, non-cringy. Return only the lines separated by newlines.`
        : `Genereer 5 originele openingszinnen voor een dating app.\n${personaHint} ${toneHint}\nGebruikersdetails: naam=${name || "-"}, interesses=${interests || "-"}.\nHoud elke zin kort, natuurlijk en niet cringe. Geef alleen de zinnen, gescheiden door nieuwe regels.`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY!}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.8,
        messages: [
          { role: "system", content: "You craft concise, high-quality dating openers." },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "<no body>");
      console.log(`[openers:${rid}] openai_error`, r.status, detail.slice(0, 200));
      if (detail.includes("insufficient_quota")) {
        const why = `Quota exhausted — returning dummy (${tone})`;
        const dummy = toObjects(
          [
            `Openingszin over ${name || "jou"} ${interests ? `(${interests})` : ""} (1)`,
            `Openingszin over ${name || "jou"} ${interests ? `(${interests})` : ""} (2)`,
            `Openingszin over ${name || "jou"} ${interests ? `(${interests})` : ""} (3)`
          ],
          tone,
          why
        );
        return json({ model: "dummy", suggestions: dummy, note: "OpenAI quota", rid });
      }
      return json({ error: "openai_error", detail, rid }, r.status);
    }

    const data = await r.json().catch(() => ({} as any));
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    const lines = text.split("\n");
    const why = persona ? `Persona ${persona}, tone ${tone}` : `Tone ${tone}`;
    const suggestions = toObjects(lines, tone, why);

    console.log(`[openers:${rid}] ok`, { lang, tone, persona, count: suggestions.length });
    return json({ model: "gpt-4o-mini", suggestions, rid });
  } catch (e: any) {
    console.log(`[openers] server_error`, String(e));
    return json({ error: "server_error", detail: String(e) }, 500);
  }
}
