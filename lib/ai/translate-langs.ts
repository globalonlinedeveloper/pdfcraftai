// Target-language catalog.
//
// Extracted from `lib/ai/translate.ts` (which is `server-only`) so the
// client picker in TranslatePdfTool can share the same list without
// pulling the server-only helper into the client bundle.
//
// Keep `name` fields in the TARGET LANGUAGE, not English — seeing
// "Español" is friendlier than "Spanish" and previews the output.

export const COMMON_TARGET_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "nl", name: "Nederlands" },
  { code: "ru", name: "Русский" },
  { code: "uk", name: "Українська" },
  { code: "pl", name: "Polski" },
  { code: "tr", name: "Türkçe" },
  { code: "ar", name: "العربية" },
  { code: "he", name: "עברית" },
  { code: "hi", name: "हिन्दी" },
  { code: "bn", name: "বাংলা" },
  { code: "ta", name: "தமிழ்" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh", name: "中文" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "th", name: "ภาษาไทย" },
] as const;

export type CommonTargetLanguageCode =
  (typeof COMMON_TARGET_LANGUAGES)[number]["code"];
