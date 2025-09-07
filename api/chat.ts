// api/chat.ts
export const config = { runtime: "edge" };

type Body = {
  input?: string;        // chatfragment uit OCR of geplakt
  text?: string;
  prompt?: string;
  message?: string;
  content?: string;
  language?: "nl" | "en" | string;
  persona?: "funny" | "classy" | "wing" | "wingwoman" | string;
  tone?: "safe" | "playful" | "flirty" | string;
  flirtLevel?: "safe" | "playful" | "flirty" | string;
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

const looksEnglish = (s: string) =>
  /\b(the|you|let's|how's|life|adventure|story|together)\b/i.test(s);

const stripLines = (text: string) =>
  text
    .split("\n")
    .map((s) => s.replace(/^[\-\*\d\.\s"“”]+/, "").replace(/["“”]+$/, "").trim())
    .filter(Boolean)
    .slice(0, 5);

const normLang = (l?: string) => (String(l||"nl").toLowerCase().startsWith("en") ? "en" : "nl") as "nl"|"en";
const normTone = (t?: string) => {
  const v = String(t||"safe").toLowerCase();
  return v.startsWith("flirt") ? "flirty" : v === "playful" ? "playful" : "safe";
};
const normPersona = (p?: string) => {
  const v = String(p||"").toLowerCase();
  if (v==="wingwoman"||v==="wingman") return "wing";
  if (["funny","classy","wing"].includes(v)) return v;
  return undefined;
};

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return json({}, 200);
  if (req.method === "GET") {
    return json({ ok: true, hint: "POST { input|text|prompt, language?, persona?, tone? }", model: process.env.OPENAI_MODEL || "gpt-4o-mini" });
  }
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const body = (await req.json().catch(()=>({}))) as Body;

    const input = String(
      body.input ?? body.text ?? body.prompt ?? body.message ?? body.content ?? ""
    ).trim();

    if (!input) return json({ error: "missing_input", message: "Send { input } or { text }" }, 400);

    const language = normLang(body.language);
    const tone = normTone(body.tone ?? body.flirtLevel);
    const persona = normPersona(body.persona);

    const key = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!key) {
      // Dummy variaties
      const lines = stripLines(
        (language==="nl"
          ? `Variaties op: ${input}\n(2)\n(3)\n(4)\n(5)`
          : `Variations on: ${input}\n(2)\n(3)\n(4)\n(5)`)
      );
      return json({ model:"dummy", suggestions: lines.map((text)=>({ style: tone, text })) });
    }

    const personaHint =
      persona==="funny"  ? (language==="nl" ? "Gebruik lichte humor." : "Use light humor.")
      : persona==="classy" ? (language==="nl" ? "Houd het elegant en zelfverzekerd." : "Keep it elegant and confident.")
      : persona==="wing"   ? (language==="nl" ? "Wees supportive en sociaal slim, zoals een wingwoman." : "Be supportive and socially smart, like a wingwoman.")
      : (language==="nl" ? "Doe natuurlijk." : "Be natural.");

    const toneHint =
      tone==="flirty"  ? (language==="nl" ? "Flirterig maar respectvol." : "Flirty but respectful.")
      : tone==="playful"? (language==="nl" ? "Speels en positief." : "Playful and positive.")
      : (language==="nl" ? "Veilig en vriendelijk." : "Safe and friendly.");

    // 🔒 System + user prompts volledig in doeltaal
    const sys =
      language==="nl"
        ? "Je bent Flairy. Je antwoordt UITSLUITEND in natuurlijk Nederlands (jij-vorm). Geef precies 5 korte losse zinnen, zonder nummering of aanhalingstekens. Gebruik NOOIT Engels."
        : "You are Flairy. You MUST answer only in natural English. Provide exactly 5 short standalone lines, no numbering or quotes.";

    const userPrompt =
      language==="nl"
        ? `${personaHint} ${toneHint}\n\nContext (chatfragment):\n${input}\n\nGeef nu precies 5 korte, natuurlijke variaties (max 25 woorden), zonder nummering en zonder aanhalingstekens.`
        : `${personaHint} ${toneHint}\n\nContext (chat excerpt):\n${input}\n\nNow give exactly 5 short, natural variations (max 25 words), no numbering and no quotes.`;

    // 1) hoofd-call
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type":"application/json", authorization:`Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(()=>"<no body>");
      if (detail.includes("insufficient_quota")) {
        const lines = stripLines(
          (language==="nl"
            ? `Variaties op: ${input}\n(2)\n(3)\n(4)\n(5)`
            : `Variations on: ${input}\n(2)\n(3)\n(4)\n(5)`)
        );
        return json({ model:"dummy", suggestions: lines.map((text)=>({ style: tone, text })), note:"OpenAI quota" });
      }
      return json({ error:"openai_error", detail }, r.status);
    }

    const data = await r.json().catch(()=>({}));
    let text: string = data?.choices?.[0]?.message?.content ?? "";

    // 2) NL fallback-vertaling als model toch Engels gaf
    if (language==="nl" && looksEnglish(text)) {
      const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type":"application/json", authorization:`Bearer ${key}` },
        body: JSON.stringify({
          model, temperature: 0,
          messages: [
            { role:"system", content:"Vertaal naar natuurlijk Nederlands. Geef 5 losse zinnen, zonder nummering of aanhalingstekens." },
            { role:"user", content: text },
          ],
        }),
      });
      const d2 = await r2.json().catch(()=>({}));
      text = d2?.choices?.[0]?.message?.content ?? text;
    }

    const lines = stripLines(text);
    return json({ model, suggestions: lines.map((t)=>({ style: tone, text: t })) });
  } catch (e: any) {
    return json({ error:"server_error", detail:String(e) }, 500);
  }
}
