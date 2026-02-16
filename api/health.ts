// api/health.ts

// Draai deze route als Edge function (sneller, minder cold starts)
export const config = { runtime: "edge" };

import { SUPPORTED_LANGS } from "../lib/promptHelpers";

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") return json({}, 200);

  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const openaiModel = process.env.OPENAI_MODEL || null;
  const openaiVisionModel = process.env.OPENAI_VISION_MODEL || null;
  const hasOCRSpace = !!process.env.OCRSPACE_API_KEY;

  // Welke provider zou gebruikt worden?
  const suggestProvider = hasOpenAI
    ? `openai:${openaiModel || "gpt-4o-mini"}`
    : "dummy";

  let ocrProvider: string;
  if (hasOpenAI && openaiVisionModel) {
    ocrProvider = `openai-vision:${openaiVisionModel}`;
  } else if (hasOCRSpace) {
    ocrProvider = "ocrspace";
  } else {
    ocrProvider = "none";
  }

  return json({
    ok: true,
    time: new Date().toISOString(),
    env: {
      OPENAI_API_KEY: hasOpenAI,              // boolean
      OPENAI_MODEL: openaiModel,              // string | null
      OPENAI_VISION_MODEL: openaiVisionModel, // string | null
      OCRSPACE_API_KEY: hasOCRSpace,          // boolean
    },
    routing: {
      suggest: suggestProvider,
      ocr: ocrProvider,
    },
    supportedLanguages: SUPPORTED_LANGS, // 👈 lijst uit promptHelpers
    defaultLanguage: "en",               // 👈 server default
  });
}
