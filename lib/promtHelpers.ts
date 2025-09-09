// /lib/promtHelpers.ts
// Central helpers for language, prompts, diversity, and formatting

/* ---------- Types ---------- */
export type LangKey = "ar"|"de"|"en"|"es"|"fr"|"hi"|"it"|"ja"|"ko"|"nl"|"pl"|"pt"|"ru"|"tr"|"zh";
export type ToneKey = "safe" | "playful" | "flirty";
export type PersonaKey = "funny" | "classy" | "wing";

/* ---------- Supported languages ---------- */
export const SUPPORTED_LANGS: LangKey[] = ["ar","de","en","es","fr","hi","it","ja","ko","nl","pl","pt","ru","tr","zh"];

/* ---------- Normalizers ---------- */
// Default = EN (as requested)
export const normalizeLang = (l?: string): LangKey => {
  const v = String(l || "en").toLowerCase();
  // quick map by prefix
  const byPref = (pref: string, code: LangKey) => v.startsWith(pref) ? code : undefined;
  return (
    byPref("en","en") || byPref("nl","nl") || byPref("de","de") || byPref("fr","fr") ||
    byPref("es","es") || byPref("pt","pt") || byPref("it","it") || byPref("pl","pl") ||
    byPref("ru","ru") || byPref("tr","tr") || byPref("ja","ja") || byPref("ko","ko") ||
    byPref("zh","zh") || byPref("ar","ar") || byPref("hi","hi") || "en"
  );
};

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

/* ---------- Language names (for instruction clarity) ---------- */
const LANG_NAME: Record<LangKey,string> = {
  ar:"Arabic", de:"German", en:"English", es:"Spanish", fr:"French",
  hi:"Hindi", it:"Italian", ja:"Japanese", ko:"Korean", nl:"Dutch",
  pl:"Polish", pt:"Portuguese", ru:"Russian", tr:"Turkish", zh:"Chinese"
};

/* ---------- System prompts ---------- */
/* We keep instructions robust and language-agnostic: they *force* output in target language */
export const systemFor = (lang: LangKey, kind: "list5" | "shortReply") => {
  const lname = LANG_NAME[lang] || "the target language";
  if (kind === "list5") {
    return `You are Flairy. You MUST answer ONLY in ${lname}. Produce EXACTLY 5 standalone natural lines. No numbering. No quotes. No disclaimers.`;
  }
  // shortReply
  return `You are Flairy. You MUST answer ONLY in ${lname}. Keep it brief (max 30 words). No disclaimers.`;
};

/* ---------- Hints per persona/tone (language-agnostic content) ---------- */
export const personaHint = (_lang: LangKey, p?: PersonaKey) => {
  if (p === "funny")  return "Use light humor.";
  if (p === "classy") return "Keep it elegant and confident.";
  if (p === "wing")   return "Be supportive and socially smart, like a wingwoman.";
  return "Be natural.";
};

export const toneHint = (_lang: LangKey, t: ToneKey) => {
  if (t === "flirty")  return "Flirty but respectful.";
  if (t === "playful") return "Playful and positive.";
  return "Safe and friendly.";
};

/* ---------- JSON-output schema-tekst ---------- */
export const jsonListSchema = (tone: ToneKey) =>
  `Return ONLY valid JSON: {"suggestions":[{"text":"<line1>","style":"${tone}","why":"<short reason>"} ...]}. No extra keys, no text before/after JSON.`;

/* ---------- Diversiteit & dedupe ---------- */
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const jaccard = (a: string, b: string) => {
  const A = new Set(normalize(a).split(/\W+/));
  const B = new Set(normalize(b).split(/\W+/));
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.max(1, A.size + B.size - inter);
};
export function uniq5(lines: string[]): string[] {
  const out: string[] = [];
  for (const s of lines) {
    if (!s) continue;
    if (!out.some((x) => jaccard(x, s) > 0.7)) out.push(s);
    if (out.length >= 5) break;
  }
  while (out.length > 0 && out.length < 5) out.push(out[out.length - 1]);
  return out.slice(0, 5);
}

/* ---------- Engelse output detectie ---------- */
export const looksEnglish = (s: string) =>
  /\b(the|you|your|let's|how's|what's|life|adventure|story|together|ready)\b/i.test(s || "");

/* ---------- Utility: strip bullets/quotes + cap ---------- */
export const stripLines = (text: string) =>
  (text || "")
    .split("\n")
    .map((s) => s.replace(/^[\-\*\d\.\s"“”]+/, "").replace(/["“”]+$/, "").trim())
    .filter(Boolean)
    .slice(0, 5);

/* ---------- Reparatie-prompt als model geen 5 geeft ---------- */
export const formatRepairSystem = (lang: LangKey, tone: ToneKey) =>
  `Convert input into EXACTLY 5 standalone natural ${LANG_NAME[lang] || "target language"} lines (style: ${tone}). Each on a new line. No numbering. No quotes.`;
