// verwijder: import OpenAI from "openai";
import { normalizeLang, SUPPORTED, type Lang } from "../lang";

export async function detectLanguageISO(
  // type losjes houden; je geeft toch al een client instance door
  client: any,
  text: string
): Promise<Lang> {
  const r = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'Return only a JSON: {"lang":"xx"} where lang is ISO 639-1 of the text language, best guess among: en,nl,hi,zh,ar,de,es,fr,it,ja,ko,pl,pt,ru,tr.'
      },
      { role: "user", content: text.slice(0, 1000) }
    ]
  });

  try {
    const content = r.choices?.[0]?.message?.content ?? "{}";
    const j = JSON.parse(content);
    const code = String(j.lang || "").toLowerCase();
    const norm = normalizeLang(code);
    return SUPPORTED.includes(norm) ? norm : "en";
  } catch {
    return "en";
  }
}
