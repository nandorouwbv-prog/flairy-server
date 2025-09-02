// utils/aiService.ts
export type Suggestion = {
  id: string;
  style: "safe" | "playful" | "flirty";
  text: string;
  why: string;
};

const ENDPOINT = "https://<JOUW-VERCEL-URL>/api/suggest"; // 👈 vul jouw URL in

type GetOpts = {
  input: string;
  language?: "nl" | "en";
  persona?: "funny" | "classy" | "wingwoman";
  flirtLevel?: "safe" | "playful" | "flirty";
};

export async function getSuggestions(input: string, opts?: Omit<GetOpts, "input">): Promise<Suggestion[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input,
        language: opts?.language,
        persona: opts?.persona,
        flirtLevel: opts?.flirtLevel,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn("AI endpoint error:", text);
      return fallbackSuggestions();
    }

    const json = await res.json();
    const arr = Array.isArray(json?.suggestions) ? json.suggestions : [];

    return arr.slice(0, 3).map((s: any, i: number) => ({
      id: `s${i + 1}`,
      style: s?.style === "flirty" ? "flirty" : s?.style === "playful" ? "playful" : "safe",
      text: String(s?.text ?? ""),
      why: String(s?.why ?? ""),
    }));
  } catch (e) {
    console.warn("AI call failed:", e);
    return fallbackSuggestions();
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackSuggestions(): Suggestion[] {
  return [
    { id: "f1", style: "safe",    text: "Leuk! Vertel eens, wat vind je daar het leukste aan?", why: "Open vraag houdt het gesprek gaande." },
    { id: "f2", style: "playful", text: "Oké, je krijgt 1 vraag: stranddag of stadswandeling? 😄", why: "Speelse keuze triggert energie." },
    { id: "f3", style: "flirty",  text: "We matchen qua vibe—zullen we dat testen met koffie? ☕️", why: "Vriendelijk en direct naar afspraak." }
  ];
}
