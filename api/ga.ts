import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});

    const name = body?.name ?? "event";
    const params = body?.params && typeof body.params === "object" ? body.params : {};
    const clientId = body?.clientId ?? "unknown";

    const measurement_id = process.env.GA4_MEASUREMENT_ID;
    const api_secret = process.env.GA4_API_SECRET;

    if (!measurement_id || !api_secret) {
      return res.status(500).json({ ok: false, error: "Missing GA4 env vars" });
    }

    const mpBody = {
      client_id: String(clientId),
      events: [{ name: String(name), params }],
    };

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
      measurement_id
    )}&api_secret=${encodeURIComponent(api_secret)}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mpBody),
    });

    return res.status(200).json({ ok: r.status === 204, status: r.status });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? "Unknown error" });
  }
}
