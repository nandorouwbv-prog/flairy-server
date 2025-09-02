// api/suggest.ts — Vercel Edge Function (stabiele variant)
export const runtime = "edge";
// Optioneel: voorkom caching in sommige setups
export const dynamic = "force-dynamic";

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
  try {
    if (req.method === "OPTIONS") return json({ ok: true });

    // Healthcheck (GET /api/suggest?ping=1)
    if (req.method === "GET") {
      let ping = false;
      try {
        const url = new URL(req.url ?? "");
        ping = url.searchParams.get("ping") != null;
      } catch {
        // ignore URL parse errors
      }
      if (ping) return json({ pong: true });
      return json({ ok: true, hint: "POST { prompt } to this endpoint" });
    }

    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Body parsing
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const prompt: string = (body?.prompt ?? "").toString().trim();
    if (!prompt) return json({ error: "Missing 'prompt' in body" }, 400);

    // Edge runtime: geen Node types – haal env via globalThis (zonder TS-errors)
    const env = (globalThis as any).process?.env ?? {};
    const key: string | undefined = env.OPENAI_API_KEY;

    // Fallback zonder key
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

    // OpenAI-call (zonder npm client)
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
      const detail = await safeText(r);
      return json({ error: "OpenAI error", detail }, r.status);
    }

    const data = await safeJson(r);
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    const suggestions = text
      .split("\n")
      .map((s: string) => s.replace(/^[\-\*\d\.\s]+/, ""))
      .filter((s: string) => s.trim().length > 0)
      .slice(0, 5);

    return json({ model: "gpt-4o-mini", suggestions });
  } catch (e: any) {
    // Log verschijnt in Vercel function logs
    console.error("suggest.ts crash:", e);
    return json({ error: "Server error", detail: String(e) }, 500);
  }
}

// Helpers: defensief parsen
async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    const t = await safeText(res);
    return { raw: t };
  }
}
