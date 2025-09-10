// api/simulator.ts
export const config = { runtime: "edge" };

import {
  // normalizeLang, // ❌ niet meer forceren naar en/nl
  normalizeTone,
  normalizePersona,
  personaHint,
  toneHint,
} from "../lib/promtHelpers";
import { languageNameFromCode, langForHelpers } from "../lib/lang";

type Msg = { role: "user" | "ai"; text: string };

type Body = {
  history?: Msg[];
  user?: string;

  tone?: "safe" | "playful" | "flirty" | string;
  persona?: "funny" | "classy" | "wing" | "wingwoman" | string;
  language?: string; // ✅ full code accepted

  name?: string;
  intent?: string;
  interests?: string[];
  shortHistory?: string;
  turn?: number;
  model?: string;
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "cache-control": "no-store",
    },
  });
}

const clean = (s: string) =>
  String(s || "").replace(/^[\s"“”]+/, "").replace(/["“”]+$/, "").trim();

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return json({}, 200);

  const rid = crypto.randomUUID();
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (req.method === "GET") {
    return json({
      ok: true,
      rid,
      hint:
        "POST { history?: [{role:'user'|'ai',text}], user, tone?, persona?, language?, name?, intent?, interests?, shortHistory?, turn? }",
    });
  }
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const b = (await req.json().catch(() => ({}))) as Body;

    // ✅ full code passthrough + en|nl for helpers
    const language = String(b.language || "en").toLowerCase();
    const langForH: "en" | "nl" = langForHelpers(language);      // helpers
    const target = languageNameFromCode(language);                // mooie taalnaam

    const tone = normalizeTone(b.tone);
    const persona = normalizePersona(b.persona);

    const history: Msg[] = Array.isArray(b.history) ? b.history.slice(-6) : [];
    const user = (b.user || "").toString().trim();

    if (!user && history.length === 0) {
      return json(
        { error: "missing_input", message: "Provide { user } or { history }" },
        400
      );
    }

    const name = (b.name || "").toString().trim();
    const intent = (b.intent || "").toString().trim();
    const interests = Array.isArray(b.interests) ? b.interests : [];
    const shortHistory = (b.shortHistory || "").toString().trim();

    const rawTurn =
      typeof b.turn === "number" && Number.isFinite(b.turn) ? Number(b.turn) : undefined;

    let nextAiTurn: number;
    if (typeof rawTurn === "number") {
      nextAiTurn = Math.max(1, rawTurn);
    } else {
      const aiCount = history.filter((m) => m.role === "ai").length;
      nextAiTurn = Math.max(0, aiCount - 1) + 1;
    }

    const mustCoach = nextAiTurn % 3 === 0;

    // ✅ hints gevoed met en|nl helper-lang
    const pHint = personaHint(langForH, persona);
    const tHint = toneHint(langForH, tone);

    const ctx =
      history
        .map((m) =>
          `${
            m.role === "user"
              ? (language.startsWith("nl") ? "Gebruiker" : "User")
              : language.startsWith("nl")
              ? "Jij"
              : "You"
          }: ${m.text}`
        )
        .join("\n") +
      (user ? `\n${language.startsWith("nl") ? "Gebruiker" : "User"}: ${user}` : "");

    if (!hasOpenAI) {
      const reply =
        language.startsWith("nl")
          ? "Klinkt leuk—wat vind je van sushi?"
          : "Sounds fun—what do you think about sushi?";
      const micro_topic = language.startsWith("nl") ? "eten" : "food";
      const coach = mustCoach
        ? [
            language.startsWith("nl")
              ? "Maak het concreet: stel een kleine keuzevraag."
              : "Be specific: ask a small either-or.",
            language.startsWith("nl")
              ? "Haak aan op een nieuw micro-onderwerp voor variatie."
              : "Introduce a small new topic to vary.",
          ]
        : undefined;
      console.log(`[simulator:${rid}] dummy`, {
        language,
        tone,
        persona,
        mustCoach,
        nextAiTurn,
      });
      return json({ model: "dummy", reply, micro_topic, coach, style: tone, rid });
    }

    const model = b.model || process.env.OPENAI_MODEL || "gpt-4o-mini";

    // ————— System prompt —————
    const system = `
Je bent Flairy, een empathische dating coach en chatsimulatie-partner.
Regels:
- Antwoord kort (1–2 zinnen) als "match", spreektaal, speels en concreet.
- Breng ELKE beurt minstens 1 subtiel nieuw micro-onderwerp in (hobby, film, trip, muziek, eten, sport, werk, huisdier).
- Vermijd exact dezelfde opener of zinstructuur als eerder in dit gesprek.
- ${mustCoach ? "SLUIT AF met een coachingblok:" : "Geen coachingblok in deze beurt."}
  "Coach 👇"
  - 2–3 ultrakorte tips (bullet points) over toon, concreetheid of vraagstelling.
- Taal = ${target}. Gebruik uitsluitend ${target}. Geen mengtaal.
- Persona = ${persona}. Toon = ${tone}.
Geef ALTIJD JSON-antwoord met keys: "reply" (string), "micro_topic" (string)${
      mustCoach ? ', "coach" (string[])' : ""
    }.
`.trim();

    // ————— User prompt —————
    const userPrompt = `
${pHint} ${tHint}

Mijn context:
- Naam: ${name || "-"}
- Intentie: ${intent || "-"}
- Interesses: ${(interests || []).join(", ") || "-"}

Vorige beurten (kort):
${shortHistory || "-"}

Context (recent transcript):
${ctx}

Doel:
- Reageer als "match" in 1–2 zinnen.
- Introduceer 1 nieuw micro-onderwerp.
${mustCoach ? "- Voeg ook Coach 👇 toe met 2–3 bullets." : "- Geen Coach-blok deze beurt."}

Beoogd JSON:
{
  "reply": "1–2 zinnen",
  "micro_topic": "nieuw micro-onderwerp"${
    mustCoach ? `,
  "coach": ["tip1","tip2"]` : ""
  }
}
`.trim();

    // 1) hoofd-call
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        presence_penalty: 0.6,
        frequency_penalty: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "<no body>");
      console.log(`[simulator:${rid}] openai_error`, r.status, detail.slice(0, 200));
      if (detail.includes("insufficient_quota")) {
        const reply =
          language.startsWith("nl")
            ? "Ik had even een hikje. Probeer het nog eens?"
            : "I glitched for a sec. Try again?";
        return json(
          { model: "dummy", reply, micro_topic: "small talk", note: "OpenAI quota", rid },
          200
        );
      }
      return json({ error: "openai_error", detail, rid }, r.status);
    }

    const data = await r.json().catch(() => ({} as any));
    let parsed: { reply?: string; micro_topic?: string; coach?: string[] } = {};
    try {
      parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
    } catch {
      parsed = { reply: clean(data?.choices?.[0]?.message?.content ?? "") };
    }

    let reply = clean(parsed?.reply ?? "");
    const micro_topic = clean(parsed?.micro_topic ?? "");
    let coach = Array.isArray(parsed?.coach) ? parsed.coach.slice(0, 3) : undefined;

    // 2) Forceer vertaling altijd wanneer target ≠ English
    if (!language.startsWith("en")) {
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
              content: `Translate to natural ${target}, keep it short (≤30 words). Return only the sentence(s), no quotes.`,
            },
            { role: "user", content: reply },
          ],
        }),
      });
      const d2 = await r2.json().catch(() => ({}));
      reply = clean(d2?.choices?.[0]?.message?.content ?? reply);
    }

    console.log(`[simulator:${rid}] ok`, {
      language,
      tone,
      persona,
      hasHistory: history.length > 0,
      mustCoach,
      nextAiTurn,
    });

    return json({ model, reply, micro_topic, coach, style: tone, rid }, 200);
  } catch (e: any) {
    console.log(`[simulator] server_error`, String(e));
    return json({ error: "server_error", detail: String(e) }, 500);
  }
}
