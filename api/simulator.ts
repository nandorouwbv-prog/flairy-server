// api/simulator.ts
export const config = { runtime: "edge" };

type Msg = { role: "user" | "ai"; text: string };
type Body = {
  history?: Msg[];        // laatste berichten
  user?: string;          // huidige invoer
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
  return (l || "nl").toLowerCase().startsWith("en") ? "en" : "nl";
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

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return json({}, 200);

  const rid = crypto.randomUUID();
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (req.method === "GET") {
    return json({ ok: true, rid, hint: "POST { history?: [{role,text}], user, tone?, persona?, language? }" });
  }
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const b = (await req.json().catch(() => ({}))) as Body;
    const lang = normalizeLang(b.language);
    const tone = normalizeTone(b.tone);
    const persona = normalizePersona(b.persona);

    const history = Array.isArray(b.history) ? b.history.slice(-6) : [];
    const user = (b.user || "").toString().trim();

    if (!user && history.length === 0) {
      return json({ error: "missing_input", message: "Provide { user } or { history }" }, 400);
    }

    const personaHint =
      persona === "funny"
        ? (lang === "en" ? "Use light humor." : "Gebruik luchtige humor.")
        : persona === "classy"
        ? (lang === "en" ? "Elegant and confident." : "Elegant en zelfverzekerd.")
        : persona === "wing"
        ? (lang === "en" ? "Socially smart and supportive." : "Sociaal slim en ondersteunend.")
        : (lang === "en" ? "Natural and friendly." : "Natuurlijk en vriendelijk.");

    const toneHint =
      tone === "flirty"
        ? (lang === "en" ? "Flirty but respectful." : "Flirterig maar respectvol.")
        : tone === "playful"
        ? (lang === "en" ? "Playful and positive." : "Speels en positief.")
        : (lang === "en" ? "Safe and friendly." : "Veilig en vriendelijk.");

    // Build compact context
    const ctx =
      history
        .map((m) => `${m.role === "user" ? (lang === "en" ? "User" : "Gebruiker") : (lang === "en" ? "You" : "Jij")}: ${m.text}`)
        .join("\n") + (user ? `\n${lang === "en" ? "User" : "Gebruiker"}: ${user}` : "");

    if (!hasOpenAI) {
      const reply =
        lang === "en"
          ? "Haha, that’s cute. Tell me more 😉"
          : "Haha, leuk! Vertel eens meer 😉";
      console.log(`[simulator:${rid}] dummy`, { lang, tone, persona });
      return json({
        model: "dummy",
        reply,
        style: tone,
        why: persona ? `Persona ${persona}, tone ${tone}` : `Tone ${tone}`,
        rid
      });
    }

    const system =
      lang === "en"
        ? "You simulate a realistic dating-app match. Reply in 1–2 sentences, natural, no emojis overkill, no explicit content."
        : "Je simuleert een realistische dating-app match. Antwoord in 1–2 zinnen, natuurlijk, geen emoji-overdaad, geen expliciete inhoud.";

    const prompt =
      lang === "en"
        ? `${personaHint} ${toneHint}\nContext:\n${ctx}\nReply as my match now:`
        : `${personaHint} ${toneHint}\nContext:\n${ctx}\nAntwoord nu als mijn match:`;

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
          { role: "system", content: system },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "<no body>");
      console.log(`[simulator:${rid}] openai_error`, r.status, detail.slice(0, 200));
      if (detail.includes("insufficient_quota")) {
        const reply =
          lang === "en"
            ? "I glitched for a sec. Try again?"
            : "Ik had even een hikje. Probeer het nog eens?";
        return json({ model: "dummy", reply, style: tone, note: "OpenAI quota", rid });
      }
      return json({ error: "openai_error", detail, rid }, r.status);
    }

    const data = await r.json().catch(() => ({} as any));
    const reply: string = (data?.choices?.[0]?.message?.content || "").trim();

    console.log(`[simulator:${rid}] ok`, { lang, tone, persona, hasHistory: history.length > 0 });
    return json({ model: "gpt-4o-mini", reply, style: tone, rid });
  } catch (e: any) {
    console.log(`[simulator] server_error`, String(e));
    return json({ error: "server_error", detail: String(e) }, 500);
  }
}
