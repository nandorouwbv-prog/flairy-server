// Helper: lees body als string als Vercel het niet geparsed heeft
function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: any, res: any) {
  try {
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type,authorization");
    if (req.method === "OPTIONS") return res.status(200).send("{}");

    const url = new URL(req.url || "", `https://${req.headers.host}`);

    // Healthcheck (GET ?ping=1)
    if (req.method === "GET") {
      if (url.searchParams.has("ping")) {
        return res.status(200).send(JSON.stringify({ pong: true }));
      }
      return res.status(200).send(JSON.stringify({ ok: true, hint: "POST { prompt }" }));
    }

    if (req.method !== "POST") {
      return res.status(405).send(JSON.stringify({ error: "Method not allowed" }));
    }

    // Body-parsing: pak geparste body of lees de stream
    let raw = "";
    if (req.body && typeof req.body === "string") raw = req.body;
    else if (req.body && typeof req.body === "object") raw = JSON.stringify(req.body);
    else raw = await readBody(req);

    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* laat body {} */ }

    const prompt: string = (body?.prompt ?? "").toString().trim();
    if (!prompt) return res.status(400).send(JSON.stringify({ error: "Missing 'prompt' in body" }));

    const key: string | undefined = (globalThis as any)?.process?.env?.OPENAI_API_KEY;

    // Fallback zonder key
    if (!key) {
      return res.status(200).send(JSON.stringify({
        model: "dummy",
        suggestions: [
          `Icebreaker over: ${prompt} (1)`,
          `Icebreaker over: ${prompt} (2)`,
          `Icebreaker over: ${prompt} (3)`
        ],
        note: "OPENAI_API_KEY ontbreekt — dummy response"
      }));
    }

    // Echte OpenAI-call
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You generate short, catchy dating app openers. Return only bullet points." },
          { role: "user", content: `Give 5 openers about: ${prompt}` }
        ],
        temperature: 0.8
      })
    });

if (!r.ok) {
  const detail = await r.text().catch(() => "<no body>");
  // Als quota op is, geef dummy terug i.p.v. error
  if (detail.includes("insufficient_quota")) {
    return res.status(200).send(JSON.stringify({
      model: "dummy",
      suggestions: [
        `Icebreaker over: ${prompt} (1)`,
        `Icebreaker over: ${prompt} (2)`,
        `Icebreaker over: ${prompt} (3)`
      ],
      note: "OpenAI quota op — dummy response"
    }));
  }
  return res.status(r.status).send(JSON.stringify({ error: "OpenAI error", detail }));
}

    const data = await r.json().catch(() => ({}));
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    const suggestions = text
      .split("\n")
      .map((s: string) => s.replace(/^[\-\*\d\.\s]+/, ""))
      .filter((s: string) => s.trim())
      .slice(0, 5);

    return res.status(200).send(JSON.stringify({ model: "gpt-4o-mini", suggestions }));
  } catch (e: any) {
    return res.status(500).send(JSON.stringify({ error: "Server error", detail: String(e) }));
  }
}

