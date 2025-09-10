// server/lib/lang.ts
export const SUPPORTED = [
  "en","nl","hi","zh","ar","de","es","fr","it","ja","ko","pl","pt","ru","tr"
] as const;
export type Lang = typeof SUPPORTED[number];

export function normalizeLang(raw?: string): Lang {
  const x = (raw || "en").toLowerCase();
  if (x.startsWith("zh")) return "zh";
  if (x.startsWith("pt")) return "pt";
  if (x.startsWith("ja")) return "ja";
  if (x.startsWith("ko")) return "ko";
  if (x.startsWith("ar")) return "ar";
  if (x.startsWith("nl")) return "nl";
  if (x.startsWith("hi")) return "hi";
  if (x.startsWith("de")) return "de";
  if (x.startsWith("es")) return "es";
  if (x.startsWith("fr")) return "fr";
  if (x.startsWith("it")) return "it";
  if (x.startsWith("pl")) return "pl";
  if (x.startsWith("ru")) return "ru";
  if (x.startsWith("tr")) return "tr";
  return "en";
}

// ✅ Volledige taalnaam voor prompts (OpenAI begrijpt "German" beter dan "de")
export function languageNameFromCode(code?: string): string {
  const raw = String(code || "en").trim();
  const base = raw.split("-")[0].toLowerCase(); // e.g. "pt-BR" -> "pt"

  // Region-aware tweaks
  if (/^pt(-br)?$/i.test(raw)) return "Portuguese (Brazil)";
  if (/^pt(-pt)?$/i.test(raw)) return "Portuguese";
  if (/^zh(-hans)?$/i.test(raw)) return "Chinese (Simplified)";
  if (/^zh(-hant)?$/i.test(raw)) return "Chinese (Traditional)";

  const map: Record<string, string> = {
    en: "English",
    nl: "Dutch",
    de: "German",
    es: "Spanish",
    fr: "French",
    hi: "Hindi",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    pl: "Polish",
    pt: "Portuguese",
    ru: "Russian",
    tr: "Turkish",
    ar: "Arabic",
    zh: "Chinese (Simplified)",
  };
  return map[base] || "English";
}

// ✅ Voor helpers (personaHint/toneHint) die alleen en/nl accepteren
export function langForHelpers(code?: string): "en" | "nl" {
  const c = String(code || "en").toLowerCase();
  return c.startsWith("nl") ? "nl" : "en";  // ✅ alleen NL → nl, anders EN
}

