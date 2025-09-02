export default async function handler(req: any, res: any) {
  try {
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    if (req.method === "OPTIONS") return res.status(200).send("{}");

    // Robuuste URL-parsing (niet vertrouwen op req.query)
    const url = new URL(req.url || "", `https://${req.headers.host}`);
    if (req.method === "GET" && url.searchParams.has("ping")) {
      return res.status(200).send(JSON.stringify({ pong: true }));
    }

    return res.status(200).send(JSON.stringify({ ok: true, runtime: "node" }));
  } catch (e: any) {
    return res.status(500).send(JSON.stringify({ error: String(e) }));
  }
}





