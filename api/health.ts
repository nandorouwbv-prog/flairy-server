export const config = { runtime: "edge" };

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

  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasOCR = !!process.env.OCRSPACE_API_KEY;

  return json({
    ok: true,
    suggest: hasOpenAI ? "openai" : "dummy",
    ocr: hasOpenAI ? "openai-vision" : hasOCR ? "ocrspace" : "none",
  });
}


