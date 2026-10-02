import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(root, "src/data/system-architecture.json");
const readmePath = path.join(root, "README.md");
const START = "<!-- SYSTEM_ARCHITECTURE:START -->";
const END = "<!-- SYSTEM_ARCHITECTURE:END -->";

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const statusLabel = {
  active: "稼働中",
  "pending-env": "環境変数の設定待ち",
  "pending-verification": "疎通確認待ち",
  optional: "任意機能"
};

export function renderSystemArchitectureMarkdown(architecture = data) {
  const lines = [
    START,
    "## システム構成（自動生成）",
    "",
    `この節は \`${architecture.sourceOfTruth}\` から生成しています（構成情報の更新日: ${architecture.updatedAt}）。画面の「システム構成」タブも同じデータを表示します。`,
    "",
    "```text"
  ];

  for (const flow of architecture.flows) {
    lines.push(`${flow.title}: ${flow.steps.join(" → ")}`);
  }
  lines.push("```", "", "### 連携API・サービス", "", "| API / サービス | 分類 | 用途 | 認証 | 状態 | 設定 |", "|---|---|---|---|---|---|");
  for (const item of architecture.integrations) {
    lines.push(`| ${item.name}<br>${item.service} | ${item.category} | ${item.purpose} | ${item.authentication} | ${statusLabel[item.status] ?? item.status} | ${item.configuration.map((value) => `\`${value}\``).join("<br>")} |`);
  }
  lines.push("", "### 内部API", "", "| Method | Path | 用途 | 認証 |", "|---|---|---|---|");
  for (const api of architecture.internalApis) {
    lines.push(`| ${api.method} | \`${api.path}\` | ${api.purpose} | ${api.auth} |`);
  }
  lines.push("", "### 再現手順", "");
  architecture.reproductionSteps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  lines.push("", "### 更新ルール", "");
  architecture.maintenanceRules.forEach((rule) => lines.push(`- ${rule}`));
  lines.push(END);
  return lines.join("\n");
}

export function replaceGeneratedSection(readme, generated) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.mdに ${START} と ${END} が必要です`);
  }
  return `${readme.slice(0, start)}${generated}${readme.slice(end + END.length)}`;
}

const readme = fs.readFileSync(readmePath, "utf8");
const expected = replaceGeneratedSection(readme, renderSystemArchitectureMarkdown());
if (process.argv.includes("--check")) {
  if (readme !== expected) {
    console.error("READMEのシステム構成が最新ではありません。npm run docs:system を実行してください。");
    process.exitCode = 1;
  } else {
    console.log("READMEのシステム構成は最新です。");
  }
} else {
  fs.writeFileSync(readmePath, expected);
  console.log("READMEのシステム構成を更新しました。");
}
