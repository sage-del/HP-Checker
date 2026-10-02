#!/usr/bin/env node

function args(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} の値がありません`);
    values[key.slice(2)] = value;
    i += 1;
  }
  return values;
}

const options = args(process.argv.slice(2));
const baseUrl = (process.env.HP_CHECKER_BASE_URL || "").replace(/\/$/, "");
const apiKey = process.env.HP_CHECKER_API_KEY;
const url = options.url || process.env.SEO_TARGET_URL;

if (!baseUrl) throw new Error("HP_CHECKER_BASE_URL が設定されていません");
if (!apiKey) throw new Error("HP_CHECKER_API_KEY が設定されていません");
if (!url) throw new Error("--url または SEO_TARGET_URL を指定してください");

const payload = { url };
if (options["start-date"]) payload.startDate = options["start-date"];
if (options["end-date"]) payload.endDate = options["end-date"];
if (options["max-pages"]) payload.maxPages = Number(options["max-pages"]);
if (options.limit) payload.limit = Number(options.limit);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 290_000);
try {
  const response = await fetch(`${baseUrl}/api/automation/seo-report`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  const result = await response.json().catch(() => ({ error: "JSON応答を読み取れませんでした" }));
  if (!response.ok) {
    throw new Error(`SEO API が HTTP ${response.status} を返しました: ${result.error || "不明なエラー"}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  clearTimeout(timeout);
}
