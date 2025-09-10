// api/ocr.ts — OpenAI Vision primary, OCR.space fallback (Edge) + optional last-question reply
export const config = { runtime: "edge" };

import { languageNameFromCode } from "../lib/lang"; // ✅ nieuw

type Body = {
  imageBase64?: string;
  image?: string;
  language?: string; // ✅ any BCP-47-ish code (e.g. 'de', 'pt-BR', 'zh', 'nl')
  debug?: boolean;

  // Nieuw: optionele reply-generator op basis van de laatste vraag
  answerLastQuestion?: boolean; // true => genereer antwoord
  coachPersona?: "funny" | "classy" | "wing" | string;
  tone?: "safe" | "playful" | "flirty" | string;
  shortContext?: string; // bv. "Ik ben Sam, interesses: sushi, hiken"
  model?: string; // optioneel override (default gpt-4o-mini)
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

function pickImageField(body: Body) {
  const v = (body.imageBase64 ?? body.image ?? "").toString();
  return v.trim();
}

function toDataUrl(b64orDataUrl: string) {
  const trimmed = (b64orDataUrl ?? "").toString().trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:image/")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

// ✅ Only for OCR engines that support limited langs we collapse to en/nl
function langForOCR(full?: string): "nl" | "en" {
  const v = String(full || "en").toLowerCase();
  return v.startsWith("nl") ? "nl" : "en";
}

function normalizeText(input: string) {
  return (input ?? "")
    .toString()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

function extractLastQuestion(text: string) {
  // Simpele heuristiek: laatste regel met vraagteken
  const lines = (text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/[?？！]$/.test(l)) return l;
  }
  const m = text.match(/([^?.!]{3,}\?)[^?]*$/s);
  return m ? m[1].trim() : "";
}

async function generateReplyForLastQuestion(params: {
  ocrText: string;
  language: string; // ✅ full code used for generation
  coachPersona?: string;
  tone?: string;
  shortContext?: string;
  model?: string;
  apiKey: string;
}) {
  const { ocrText, language, coachPersona = "wing", tone = "playful", shortContext = "", apiKey } = params;
  const model = params.model || "gpt-4o-mini";
  const lastQuestion = extractLastQuestion(ocrText);

  // ✅ gebruik nette taalnaam voor het model
  const target = languageNameFromCode(language);

  const system = `
Je bent Flairy. Geef een direct antwoord op de LAATSTE vraag van de ander.
Regels:
- Antwoord kort en duidelijk, 1–2 zinnen.
- Geef daarna 2 alternatieven met andere invalshoek (speels vs direct vs nieuwsgierig).
- Sluit af met "Coach 👇" en 2 bullets (waarom dit werkt).
- Taal = ${target}. Persona = ${coachPersona}. Toon = ${tone}.
Output JSON: { "direct": "...", "alt1": "...", "alt2": "...", "coach": ["tip1","tip2"] }.
`.trim();

  const user = `
Laatste vraag: "${lastQuestion || "(niet gevonden)"}"
Context (kort): ${shortContext}

Als er geen duidelijke vraag is gevonden, herformuleer dan kort wat een logisch vervolg is op basis van de context en lever alsnog dezelfde JSON-structuur.
`.trim();

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      presence_penalty: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => "<no body>");
    throw new Error(`openai_reply_error:${r.status}:${detail}`);
  }

  const data = await r.json().catch(() => ({} as any));
  let parsed: { direct?: string; alt1?: string; alt2?: string; coach?: string[] } = {};
  try {
    parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
  } catch {
    // laat fallback leeg; caller handelt af
  }

  return { lastQuestion, ...parsed };
}

async function ocrWithOpenAI(
  imageBase64: string,
  language: "nl" | "en",
  apiKey: string,
  model: string
) {
  const prompt =
    language === "nl"
      ? "Lees ALLE chat-tekst uit de afbeelding. Geef uitsluitend de platte tekst terug (geen opsomming of uitleg)."
      : "Extract ALL chat text from the image. Return plain text only (no bullets or explanations).";

  const body = {
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "You are a precise OCR assistant. Return only the raw plain text you read.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: toDataUrl(imageBase64) } },
        ],
      },
    ],
  };

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "<no body>");
    throw new Error(`openai_error:${resp.status}:${detail}`);
  }

  const data = await resp.json().catch(() => ({} as any));
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  return normalizeText(text);
}

async function ocrWithOcrSpace(
  imageBase64: string,
  language: "nl" | "en",
  engine: 1 | 2,
  detectOrientation = false,
  apiKey?: string
) {
  const ocrLang = language === "nl" ? "nld" : "eng";
  const key = apiKey || process.env.OCRSPACE_API_KEY || "helloworld";

  const form = new URLSearchParams();
  form.set("base64Image", toDataUrl(imageBase64));
  form.set("language", ocrLang);
  form.set("isOverlayRequired", "false");
  form.set("OCREngine", String(engine));
  form.set("scale", "true");
  if (detectOrientation) form.set("detectOrientation", "true");

  const r = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: key, "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => "<no body>");
    throw new Error(`ocrspace_error:${r.status}:${detail}`);
  }

  const data = await r.json().catch(() => ({} as any));
  const parts: string[] =
    (data?.ParsedResults || [])
      .map((pr: any) => (pr?.ParsedText || ""))
      .filter(Boolean) || [];

  const text = normalizeText(parts.join(" ").trim());
  return text;
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return json({}, 200);

  if (req.method === "GET") {
    return json(
      {
        ok: true,
        hint:
          "POST { imageBase64|image, language?: string, debug?: true, " +
          "answerLastQuestion?: true, coachPersona?, tone?, shortContext?, model? }",
        visionModel: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
      },
      200
    );
  }

  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const body = (await req.json()) as Body;
    const rawImage = pickImageField(body);

    if (!rawImage) {
      return json(
        { error: "missing_image", message: "Missing 'imageBase64' (or 'image') in body" },
        400
      );
    }

    // ✅ Full language passthrough + derived lang for OCR engines
    const languageFull = String(body.language || "en").toLowerCase();
    const lang = langForOCR(languageFull); // only for OCR engines & simple prompts

    const dataUrl = toDataUrl(rawImage);
    const base64Len =
      dataUrl.startsWith("data:image/")
        ? (dataUrl.split(",")[1] || "").length
        : rawImage.length;

    if (base64Len < 1000) {
      return json(
        {
          error: "image_too_small",
          message: "Base64 lijkt te klein om tekst uit te lezen. Stuur een volledige screenshot (PNG/JPG).",
          provider: "none",
          debug: body.debug ? { base64Len } : undefined,
        },
        400
      );
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    const preferredModel = process.env.OPENAI_VISION_MODEL;

    let text = "";
    let provider: "openai" | "ocrspace" | "none" = "none";
    let modelUsed: string | undefined;
    let engineUsed: 1 | 2 | undefined;

    // 1) Vision (indien key aanwezig)
    if (openaiKey) {
      const first = preferredModel || "gpt-4o-mini";
      try {
        const t1 = await ocrWithOpenAI(dataUrl, lang, openaiKey, first);
        if (t1 && t1.length >= 6) {
          text = t1;
          provider = "openai";
          modelUsed = first;
        } else {
          const fallbackModel = first === "gpt-4o-mini" ? "gpt-4o" : "gpt-4o-mini";
          const t2 = await ocrWithOpenAI(dataUrl, lang, openaiKey, fallbackModel);
          if (t2) {
            text = t2;
            provider = "openai";
            modelUsed = fallbackModel;
          }
        }
      } catch {
        // ga door naar OCR.space
      }
    }

    // 2) OCR.space fallback (engine 2 -> engine 1)
    if (!text) {
      try {
        const t1 = await ocrWithOcrSpace(dataUrl, lang, 2, true, process.env.OCRSPACE_API_KEY);
        if (t1) {
          text = t1;
          provider = "ocrspace";
          engineUsed = 2;
        } else {
          const t2 = await ocrWithOcrSpace(dataUrl, lang, 1, true, process.env.OCRSPACE_API_KEY);
          if (t2) {
            text = t2;
            provider = "ocrspace";
            engineUsed = 1;
          }
        }
      } catch (err) {
        const msg = String(err || "");
        return json(
          {
            error: "ocr_failed",
            detail: msg,
            provider: "none",
            debug: body.debug ? { base64Len } : undefined,
          },
          502
        );
      }
    }

    // Basis-respons (alleen OCR)
    const base = {
      provider,
      model: modelUsed,
      engine: engineUsed,
      text,
      langEcho: languageFull,
      debug: body.debug ? { base64Len } : undefined,
    };

    // Optioneel: meteen antwoord genereren op laatste vraag
    if (body.answerLastQuestion && text) {
      if (!openaiKey) {
        return json({
          ...base,
          warning: "answerLastQuestion requested but OPENAI_API_KEY is missing",
        });
      }
      const reply = await generateReplyForLastQuestion({
        ocrText: text,
        language: languageFull, // ✅ full code for generation (inside we convert to name)
        coachPersona: body.coachPersona || "wing",
        tone: body.tone || "playful",
        shortContext: body.shortContext || "",
        model: body.model || "gpt-4o-mini",
        apiKey: openaiKey,
      });

      return json({
        ...base,
        lastQuestion: reply.lastQuestion,
        direct: reply.direct,
        alt1: reply.alt1,
        alt2: reply.alt2,
        coach: reply.coach,
      });
    }

    // Alleen OCR-output
    return json(base, 200);
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
