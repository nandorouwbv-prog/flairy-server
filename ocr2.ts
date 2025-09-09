export const config = { runtime: "edge" };

export default function handler() {
  return new Response(JSON.stringify({
    ok: true,
    hint: "OCR2 route is alive"
  }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    }
  });
}
