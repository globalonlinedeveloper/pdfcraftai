// i18n/request.ts — next-intl request config.
//
// Phase 1 (2026-06-08): foundation only. Single locale ("en"), NO i18n
// routing — so URLs are unchanged (no /en/ prefix, no SEO churn) and no
// middleware. This wires next-intl end-to-end (config -> provider ->
// useTranslations) so strings can be externalized into messages/en.json
// incrementally. Adding Hindi later = add messages/hi.json + a locale
// resolver here (cookie/header) + a switcher; the call sites don't change.
import { getRequestConfig } from "next-intl/server";

export const DEFAULT_LOCALE = "en" as const;

export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
