// api/simulator.ts
export const config = { runtime: "edge" };

import {
  normalizeTone,
  normalizePersona,
  personaHint,
  toneHint,
} from "../lib/promptHelpers";
import { languageNameFromCode, langForHelpers } from "../lib/lang";

type Msg = { role: "user" | "ai"; text: string };

type Body = {
  history?: Msg[];
  user?: string;

  tone?: "safe" | "playful" | "flirty" | string;
  persona?: "funny" | "classy" | "wing" | "wingwoman" | string;
  language?: string; // full language code

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

/** Normalize full lang code -> e.g. "en", "nl", "de", "pt-br" (lowercase) */
function normalizeFullLang(l?: string) {
  return String(l ?? "en").toLowerCase();
}

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
      hint:
        "POST { history, user, tone?, persona?, language?, name?, intent?, interests?, shortHistory?, turn? }",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const b = (await req.json().catch(() => ({}))) as Body;

    /* --------- Language handling (volledige code) --------- */
    const language = normalizeFullLang(b.language);
    const langForH: "en" | "nl" = langForHelpers(language); // EN/NL for helper-teksten
    const target = languageNameFromCode(language); // nette taalnaam voor prompt

    const tone = normalizeTone(b.tone);
    const persona = normalizePersona(b.persona);

    const history: Msg[] = Array.isArray(b.history)
      ? b.history
          .filter(
            (m) =>
              m &&
              (m.role === "user" || m.role === "ai") &&
              typeof m.text === "string"
          )
          .slice(-6)
      : [];

    const user = (b.user || "").toString().trim();

    if (!user && history.length === 0) {
      return json(
        { error: "missing_input", message: "Provide 'user' or 'history'." },
        400
      );
    }

    const name = (b.name || "").toString().trim();
    const intent = (b.intent || "").toString().trim();
    const interests = Array.isArray(b.interests) ? b.interests : [];
    const shortHistory = (b.shortHistory || "").toString().trim();

    /* --------- Bepaal of we een coach-blok moeten geven --------- */
    const rawTurn =
      typeof b.turn === "number" && Number.isFinite(b.turn)
        ? Number(b.turn)
        : undefined;

    const aiCount = history.filter((m) => m.role === "ai").length;
    const nextAiTurn = rawTurn ?? Math.max(0, aiCount - 1) + 1;
    const mustCoach = nextAiTurn % 3 === 0;

    /* Helper hints (NL/EN copy) */
    const pHint = personaHint(langForH, persona);
    const tHint = toneHint(langForH, tone);

    /* Transcript formatting in doeltaal */
    const labelUser = language.startsWith("nl") ? "Gebruiker" : "User";
    const labelYou = language.startsWith("nl") ? "Jij" : "You";

    const transcriptLines = history.map((m) =>
      m.role === "user"
        ? `${labelUser}: ${m.text}`
        : `${labelYou}: ${m.text}`
    );

    if (user) {
      transcriptLines.push(`${labelUser}: ${user}`);
    }

    const ctx = transcriptLines.join("\n");

    /* --------- DUMMY fallback als OPENAI_API_KEY ontbreekt --------- */
    if (!hasOpenAI) {
      const reply = language.startsWith("nl")
        ? "Klinkt leuk — wat vind je van sushi?"
        : "Sounds fun — what do you think about sushi?";

      const micro_topic = language.startsWith("nl") ? "eten" : "food";
      const coach = mustCoach
        ? [
            langForH === "nl"
              ? "Stel een concrete keuzevraag (bijv. sushi of pizza?)."
              : "Ask a specific either-or question (e.g., sushi or pizza?).",
            langForH === "nl"
              ? "Breng een klein nieuw onderwerp in, niet te zwaar."
              : "Introduce a small, light new topic.",
          ]
        : undefined;

      return json(
        {
          model: "dummy",
          reply,
          micro_topic,
          coach,
          style: tone,
          rid,
          languageEcho: language,
        },
        200
      );
    }

    const key = process.env.OPENAI_API_KEY!;
    const model = b.model || process.env.OPENAI_MODEL || "gpt-4o-mini";

    /* ------------------ SYSTEM PROMPT ------------------ */
    const system = `
You are Flairy, a dating coach and chat simulation partner.
Rules:
- Reply in 1–2 natural sentences.
- Introduce exactly 1 small new micro-topic each turn.
- Avoid repeating earlier sentence structures.
- Language output = ${target}. Use ONLY ${target}.
- Persona = ${persona}. Tone = ${tone}.
${
  mustCoach
    ? '- Add a coaching block (Coach 👇) with 2–3 bullet tips.'
    : "- No coach block this turn."
}
Return ONLY JSON:
{
  "reply": "...",
  "micro_topic": "..."${
    mustCoach
      ? `,
  "coach": ["tip1","tip2"]`
      : ""
  }
}
`.trim();

    /* ------------------ USER PROMPT ------------------ */
    const userPrompt = `
${pHint} ${tHint}

User context:
- Name: ${name || "-"}
- Intent: ${intent || "-"}
- Interests: ${(interests || []).join(", ") || "-"}

Short history:
${shortHistory || "-"}

Conversation:
${ctx}

Task:
- Reply as the match.
- 1–2 short sentences.
- Add one micro-topic.
${mustCoach ? "- Include Coach 👇 block." : "- No coaching block."}
`.trim();

    /* ------------------ OPENAI CALL ------------------ */
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
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

    // ❗ In plaats van 4xx teruggeven aan de app, sturen we een nette fallback
    if (!r.ok) {
      const detail = await r.text().catch(() => "<no detail>");
      const fallbackReply = language.startsWith("nl")
        ? "Ik ben even in de war — kun je het nog een keer proberen of iets korter formuleren? 😊"
        : "I glitched a bit — could you try again or phrase it a bit shorter? 😊";

      const fallbackCoach = mustCoach
        ? [
            langForH === "nl"
              ? "Houd het luchtig en stel één concrete vervolg­vraag."
              : "Keep it light and ask one specific follow-up question.",
            langForH === "nl"
              ? "Verwijs kort naar iets uit de eerdere chat voor continuïteit."
              : "Reference something from earlier in the chat to keep continuity.",
          ]
        : undefined;

      return json(
        {
          model,
          reply: fallbackReply,
          micro_topic: "",
          coach: fallbackCoach,
          style: tone,
          rid,
          error: "openai_error",
          detail: detail.slice(0, 400),
          languageEcho: language,
        },
        200
      );
    }

    const data = await r.json().catch(() => ({} as any));
    let parsed: any = {};

    try {
      parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
    } catch {
      parsed = {};
    }

    let reply = clean(parsed.reply || "");
    let micro_topic = clean(parsed.micro_topic || "");
    let coach = Array.isArray(parsed.coach)
      ? parsed.coach.slice(0, 3).map((c: any) => clean(String(c || "")))
      : undefined;

    /* ------------------ FORCE TRANSLATION (non-EN) ------------------ */
    if (reply && !language.startsWith("en")) {
      try {
        const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [
              {
                role: "system",
                content: `Translate to natural ${target}, ≤30 words. No quotes.`,
              },
              { role: "user", content: reply },
            ],
          }),
        });

        const d2 = await r2.json().catch(() => ({} as any));
        reply = clean(d2?.choices?.[0]?.message?.content ?? reply);
      } catch {
        // als vertaling faalt, gebruik originele reply
      }
    }

    // Als er nog steeds geen reply is (heel zeldzaam) → mini fallback
    if (!reply) {
      reply = language.startsWith("nl")
        ? "Interessant! Vertel eens wat meer 😊"
        : "Interesting! Tell me a bit more 😊";
    }

    return json(
      {
        model,
        reply,
        micro_topic,
        coach,
        style: tone,
        rid,
        languageEcho: language,
      },
      200
    );
  } catch (e: any) {
    return json(
      { error: "server_error", detail: String(e?.message || e), rid },
      500
    );
  }
}
