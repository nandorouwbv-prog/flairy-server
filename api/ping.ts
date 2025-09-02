// api/ping.ts — simpelste Node handler
export default function handler(req: any, res: any) {
  res.setHeader("content-type", "application/json");
  res.setHeader("access-control-allow-origin", "*");
  if (req.method === "OPTIONS") return res.status(200).send("{}");

  // Gebruik req.query als hij er is; anders gewoon ok:true
  // Dit voorkomt crashes door URL-parsing verschillen.
  if (req.method === "GET" && req?.query && "cb" in req.query || "ping" in (req.query as any)) {
    return res.status(200).send(JSON.stringify({ ok: true, runtime: "node" }));
  }

  return res.status(200).send(JSON.stringify({ ok: true, runtime: "node" }));
}






