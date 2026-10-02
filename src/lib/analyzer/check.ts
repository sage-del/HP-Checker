import type { CategoryId, CheckResult, CheckStatus } from "./types";

const EARN_RATIO: Record<CheckStatus, number> = {
  pass: 1,
  warn: 0.5,
  fail: 0,
  info: 0,
};

export interface CheckInput {
  id: string;
  category: CategoryId;
  status: CheckStatus;
  label: string;
  evidence?: string;
  advice?: string;
  /** 配点。省略時 1。info の場合は無視され 0 になる */
  weight?: number;
}

/** CheckResult を組み立てる小さなヘルパー。earned を一箇所で計算する */
export function check(input: CheckInput): CheckResult {
  const weight = input.status === "info" ? 0 : (input.weight ?? 1);
  return {
    id: input.id,
    category: input.category,
    status: input.status,
    label: input.label,
    evidence: input.evidence,
    advice: input.status === "pass" ? undefined : input.advice,
    weight,
    earned: Math.round(weight * EARN_RATIO[input.status] * 100) / 100,
  };
}

/**
 * 任意項目（info）用: あれば pass、なければ info。
 * 「設定があれば pass に変わるがスコアには影響しない」を表現するため、
 * pass のときも weight は 0 にする。
 */
export function optionalCheck(
  input: Omit<CheckInput, "status" | "weight"> & { present: boolean },
): CheckResult {
  const { present, ...rest } = input;
  return {
    ...check({ ...rest, status: present ? "pass" : "info", weight: 0 }),
    weight: 0,
    earned: 0,
  };
}
