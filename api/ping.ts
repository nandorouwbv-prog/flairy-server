// api/ping.ts — Node serverless sanity check
export default async function handler(req: any, res: any) {
  res.setHeader("content-type", "application/json");
  res.setHeader("access-control-allow-origin", "*");
  if (req.method === "OPTIONS") {
    res.status(200).send(JSON.stringify({ ok: true }));
    return;
  }
  res.status(200).send(JSON.stringify({ ok: true, runtime: "node" }));
}



