// server/lib/prompt.ts
import { Lang, langName } from "../lang";

export function personaLine(p?: string) {
  if (p === "wing" || p === "wingwoman") return "You are a supportive, practical wingwoman coach.";
  if (p === "classy") return "You are a classy, elegant dating coach.";
  return "You are a witty, funny dating coach.";
}

export function styleLine(s?: string) {
  if (s === "flirty") return "Tone: flirty but respectful.";
  if (s === "playful") return "Tone: playful and light.";
  return "Tone: safe and friendly.";
}

export function languageRule(lang: Lang) {
  const n = langName(lang);
  // KERN: altijd in gekozen taal antwoorden
  return `Always reply in ${n}. Even if the input is in another language, keep responding in ${n}.`;
}
