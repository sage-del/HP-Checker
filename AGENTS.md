# Codex SEO automation

When the user asks for an SEO report or SEO improvement priorities, use the deployed Site Kenshin automation API instead of operating the browser UI.

1. Use the target URL supplied by the user. If it is omitted, use `SEO_TARGET_URL`; ask only when neither is available.
2. From `/workspace/HP-Checker`, run:
   `npm run seo:report -- --url "https://example.com"`
3. The command requires `HP_CHECKER_BASE_URL` and `HP_CHECKER_API_KEY`. Never print, inspect, or commit the API key.
4. Base conclusions on the returned `audit`, `ga4`, `gsc`, and `opportunities` fields. State when a source is unavailable; never invent missing metrics.
5. Prioritize issues supported by both search demand (GSC) and technical audit evidence. Use GA4 engagement to refine the order.
6. Do not modify a diagnosed website's repository unless the user has authorized changes to that repository.

## System architecture documentation

`src/data/system-architecture.json` is the single source of truth for the system diagram, integrations, internal APIs, reproduction steps, and maintenance rules. The `/system` screen reads it directly, and the README section is generated from it.

Whenever a change adds, removes, or changes an external service, API, authentication method, environment variable, major internal API, or data flow:

1. Update `src/data/system-architecture.json` in the same change.
2. Run `npm run docs:system` to regenerate README.md. Do not hand-edit the generated section.
3. Run `npm run docs:system:check` before committing.
4. Never put secret values in the architecture JSON, README, screenshots, logs, or UI. Record variable names and authentication methods only.
