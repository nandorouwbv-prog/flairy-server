// /lib/promtHelpers.ts
// Centrale helpers voor taal, prompts en output-kwaliteit

/* ---------- Types ---------- */
export type LangKey = "nl" | "en";
export type ToneKey = "safe" | "playful" | "flirty";
export type PersonaKey = "funny" | "classy" | "wing";

/* ---------- Normalizers ---------- */
export const normalizeLang = (l?: string): LangKey =>
  String(l || "nl").toLowerCase().startsWith("en") ? "en" : "nl";

export const normalizeTone = (t?: string): ToneKey => {
  const v = String(t || "safe").toLowerCase();
  return v.startsWith("flirt") ? "flirty" : v === "playful" ? "playful" : "safe";
};

export const normalizePersona = (p?: string): PersonaKey | undefined => {
  const v = String(p || "").toLowerCase();
  if (v === "wingwoman" || v === "wingman") return "wing";
  if (v === "funny" || v === "classy" || v === "wing") return v as PersonaKey;
  return undefined;
};

/* ---------- System prompts ---------- */
export const systemFor = (lang: LangKey, kind: "list5" | "shortReply") =>
  lang === "nl"
    ? kind === "list5"
      ? "Je bent Flairy. Antwoord UITSLUITEND in natuurlijk Nederlands (jij-vorm). Geef EXACT 5 losse zinnen, zonder nummering of aanhalingstekens. Geen disclaimers."
      : "Je bent Flairy. Antwoord UITSLUITEND in natuurlijk Nederlands, kort (max 30 woorden). Geen disclaimers."
    : kind === "list5"
    ? "You are Flairy. Answer ONLY in natural English. Provide EXACTLY 5 standalone lines, no numbering or quotes. No disclaimers."
    : "You are Flairy. Answer ONLY in natural English, brief (max 30 words). No disclaimers.";

/* ---------- Hints per persona/tone ---------- */
export const personaHint = (lang: LangKey, p?: PersonaKey) => {
  const nl = {
    funny: "Gebruik lichte humor.",
    classy: "Houd het elegant en zelfverzekerd.",
    wing: "Wees supportive en sociaal slim, zoals een wingwoman.",
  };
  const en = {
    funny: "Use light humor.",
    classy: "Keep it elegant and confident.",
    wing: "Be supportive and socially smart, like a wingwoman.",
  };
  const dict = lang === "nl" ? nl : en;
  if (p && dict[p]) return dict[p];
  return lang === "nl" ? "Doe natuurlijk." : "Be natural.";
};

export const toneHint = (lang: LangKey, t: ToneKey) => {
  if (lang === "nl")
    return t === "flirty"
      ? "Flirterig maar respectvol."
      : t === "playful"
      ? "Speels en positief."
      : "Veilig en vriendelijk.";
  return t === "flirty"
    ? "Flirty but respectful."
    : t === "playful"
    ? "Playful and positive."
    : "Safe and friendly.";
};

/* ---------- JSON-output schema-tekst ---------- */
export const jsonListSchema = (tone: ToneKey) =>
  `Return ONLY valid JSON: {"suggestions":[{"text":"<line1>","style":"${tone}","why":"<short reason>"}, ...]}.
No explanations or extra keys.`;

/* ---------- Diversiteit & dedupe ---------- */
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const jaccard = (a: string, b: string) => {
  const A = new Set(normalize(a).split(/\W+/));
  const B = new Set(normalize(b).split(/\W+/));
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.max(1, A.size + B.size - inter);
};

/** Houd max 5, verwijder (bij benadering) duplicaten en vul aan tot 5 indien nodig */
export function uniq5(lines: string[]): string[] {
  const out: string[] = [];
  for (const s of lines) {
    if (!s) continue;
    if (!out.some((x) => jaccard(x, s) > 0.7)) out.push(s);
    if (out.length >= 5) break;
  }
  // indien <5 en er is tenminste 1 item, dupliceer laatste
  while (out.length > 0 && out.length < 5) out.push(out[out.length - 1]);
  return out.slice(0, 5);
}

/* ---------- Reparatie-prompt als model geen 5 geeft ---------- */
export const formatRepairSystem = (lang: LangKey, tone: ToneKey) =>
  lang === "nl"
    ? `Zet de invoer om naar EXACT 5 losse, natuurlijke Nederlandse zinnen (stijl: ${tone}). Elk op een nieuwe regel. Geen nummering. Geen aanhalingstekens.`
    : `Convert input into EXACTLY 5 standalone natural English lines (style: ${tone}). Each on a new line. No numbering. No quotes.`;

/* ---------- Engelse output detectie ---------- */
export const looksEnglish = (s: string) =>
  /\b(the|you|your|let's|how's|what's|life|adventure|story|together|ready)\b/i.test(
    s || "",
  );

/* ---------- Utility: strip bullets/quotes + kap tot 5 ---------- */
export const stripLines = (text: string) =>
  (text || "")
    .split("\n")
    .map((s) =>
      s
        .replace(/^[\-\*\d\.\s"“”]+/, "")
        .replace(/["“”]+$/, "")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 5);
