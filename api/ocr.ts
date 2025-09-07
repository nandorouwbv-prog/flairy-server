// api/ocr.ts — OpenAI Vision primary, OCR.space fallback (Edge)
export const config = { runtime: "edge" };

type Body = {
  imageBase64?: string;
  image?: string;
  language?: string; // 'nl' | 'en'
  debug?: boolean;
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

function normalizeLang(lang?: string): "nl" | "en" {
  const v = (lang ?? "en").toLowerCase();
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
        content:
          "You are a precise OCR assistant. Return only the raw plain text you read.",
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
  // OCR.space: Dutch = 'nld' (alias 'dut' werkt niet altijd)
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
    headers: {
      apikey: key,
      "content-type": "application/x-www-form-urlencoded",
    },
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
        hint: "POST { imageBase64|image, language?: 'nl'|'en', debug?: true }",
        model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
      },
      200
    );
  }

  if (req.method !== "POST")
    return json({ error: "Method Not Allowed" }, 405);

  try {
    const body = (await req.json()) as Body;
    const rawImage = pickImageField(body);

    if (!rawImage) {
      return json(
        { error: "missing_image", message: "Missing 'imageBase64' (or 'image') in body" },
        400
      );
    }

    const lang = normalizeLang(body.language);
    const dataUrl = toDataUrl(rawImage);
    const base64Len =
      dataUrl.startsWith("data:image/")
        ? (dataUrl.split(",")[1] || "").length
        : rawImage.length;

    if (base64Len < 1000) {
      return json(
        {
          error: "image_too_small",
          message:
            "Base64 lijkt te klein om tekst uit te lezen. Stuur een volledige screenshot (PNG/JPG).",
          provider: "none",
          debug: body.debug ? { base64Len } : undefined,
        },
        400
      );
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    const preferredModel = process.env.OPENAI_VISION_MODEL;

    // 1) Vision (indien key aanwezig)
    if (openaiKey) {
      const first = preferredModel || "gpt-4o-mini";
      try {
        const text = await ocrWithOpenAI(dataUrl, lang, openaiKey, first);
        if (text && text.length >= 6) {
          return json(
            { provider: "openai", model: first, text, debug: body.debug ? { base64Len } : undefined },
            200
          );
        }
        const fallbackModel = first === "gpt-4o-mini" ? "gpt-4o" : "gpt-4o-mini";
        const text2 = await ocrWithOpenAI(dataUrl, lang, openaiKey, fallbackModel);
        if (text2) {
          return json(
            { provider: "openai", model: fallbackModel, text: text2, debug: body.debug ? { base64Len } : undefined },
            200
          );
        }
      } catch {
        // ga door naar OCR.space
      }
    }

    // 2) OCR.space fallback (engine 2 -> engine 1 + detectOrientation)
    try {
      const text = await ocrWithOcrSpace(dataUrl, lang, 2, true, process.env.OCRSPACE_API_KEY);
      if (text)
        return json(
          { provider: "ocrspace", engine: 2, text, debug: body.debug ? { base64Len } : undefined },
          200
        );

      const text2 = await ocrWithOcrSpace(dataUrl, lang, 1, true, process.env.OCRSPACE_API_KEY);
      if (text2)
        return json(
          { provider: "ocrspace", engine: 1, text: text2, debug: body.debug ? { base64Len } : undefined },
          200
        );

      return json(
        {
          provider: "none",
          text: "",
          message: "Geen tekst herkend door Vision en OCR.space.",
          debug: body.debug ? { base64Len } : undefined,
        },
        200
      );
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
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}

