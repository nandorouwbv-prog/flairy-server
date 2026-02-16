import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method Not Allowed" });
    return;
  }

  try {
    const { name, params, clientId } = req.body ?? {};

    const measurement_id = process.env.GA4_MEASUREMENT_ID;
    const api_secret = process.env.GA4_API_SECRET;

    if (!measurement_id || !api_secret) {
      res.status(500).json({ ok: false, error: "Missing GA4 env vars" });
      return;
    }

    const body = {
      client_id: clientId || "unknown",
      events: [
        {
          name: String(name || "event"),
          params: params && typeof params === "object" ? params : {},
        },
      ],
    };

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
      measurement_id
    )}&api_secret=${encodeURIComponent(api_secret)}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    res.status(200).json({ ok: r.ok, status: r.status });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? "Unknown error" });
  }
}
