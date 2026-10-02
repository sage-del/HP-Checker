# Codex SEO automation

When the user asks for an SEO report or SEO improvement priorities, use the deployed Site Kenshin automation API instead of operating the browser UI.

1. Use the target URL supplied by the user. If it is omitted, use `SEO_TARGET_URL`; ask only when neither is available.
2. From `/workspace/HP-Checker`, run:
   `npm run seo:report -- --url "https://example.com"`
3. The command requires `HP_CHECKER_BASE_URL` and `HP_CHECKER_API_KEY`. Never print, inspect, or commit the API key.
4. Base conclusions on the returned `audit`, `ga4`, `gsc`, and `opportunities` fields. State when a source is unavailable; never invent missing metrics.
5. Prioritize issues supported by both search demand (GSC) and technical audit evidence. Use GA4 engagement to refine the order.
6. Do not modify a diagnosed website's repository unless the user has authorized changes to that repository.
