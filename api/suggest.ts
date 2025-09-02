// api/suggest.ts — Vercel Edge Function
export const runtime = "edge";

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
  if (req.method === "OPTIONS") return json({ ok: true });

  // Healthcheck
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("ping")) return json({ pong: true });
    return json({ ok: true, hint: "POST { prompt } to this endpoint" });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const prompt: string = body?.prompt ?? "";
  if (!prompt) return json({ error: "Missing 'prompt' in body" }, 400);

  // Edge runtime: geen Node types, dus haal env via globalThis om TS stil te krijgen
const env = (globalThis as any).process?.env ?? {};
const key: string | undefined = env.OPENAI_API_KEY;

  // Fallback zonder key zodat je kunt testen
  if (!key) {
    return json({
      model: "dummy",
      suggestions: [
        `Icebreaker over: ${prompt} (1)`,
        `Icebreaker over: ${prompt} (2)`,
        `Icebreaker over: ${prompt} (3)`,
      ],
      note: "OPENAI_API_KEY ontbreekt — dummy response",
    });
  }

  // OpenAI-call (zonder extra npm packages)
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You generate short, catchy dating app openers. Return only bullet points.",
          },
          { role: "user", content: `Give 5 openers about: ${prompt}` },
        ],
        temperature: 0.8,
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return json({ error: "OpenAI error", detail: errText }, r.status);
    }

    const data = await r.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const suggestions = text
      .split("\n")
      .map((s: string) => s.replace(/^[\-\*\d\.\s]+/, ""))
      .filter((s: string) => s.trim().length > 0)
      .slice(0, 5);

    return json({ model: "gpt-4o-mini", suggestions });
  } catch (e: any) {
    return json({ error: "Server error", detail: String(e) }, 500);
  }
}
