import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { FetchError } from "@/lib/analyzer";
import { analyzeSite } from "@/lib/analyzer/site";
import {
  buildSeoOpportunities,
  compactAudit,
  resolveSeoDateRange,
} from "@/lib/automation/report";
import { GoogleConfigError, readGoogleConfig } from "@/lib/google/auth";
import { fetchGa4OrganicReport, fetchGscSearchReport, GoogleApiError } from "@/lib/google/client";

export const runtime = "nodejs";
export const maxDuration = 300;

const JSON_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function authorized(request: NextRequest): "ok" | "missing" | "invalid" {
  const expected = process.env.AUTOMATION_API_KEY;
  if (!expected) return "missing";
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return "invalid";
  const actual = value.slice(7);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "invalid";
}

function authError(state: "missing" | "invalid") {
  return Response.json(
    state === "missing"
      ? { error: "AUTOMATION_API_KEY が設定されていません", code: "not_configured" }
      : { error: "認証に失敗しました", code: "unauthorized" },
    { status: state === "missing" ? 503 : 401, headers: JSON_HEADERS },
  );
}

export async function GET(request: NextRequest) {
  const auth = authorized(request);
  if (auth !== "ok") return authError(auth);
  try {
    const config = readGoogleConfig();
    return Response.json(
      {
        ready: true,
        ga4PropertyId: config.ga4PropertyId,
        gscSiteUrl: config.gscSiteUrl,
      },
      { headers: JSON_HEADERS },
    );
  } catch (error) {
    if (error instanceof GoogleConfigError) {
      return Response.json(
        { ready: false, error: error.message, code: "not_configured" },
        { status: 503, headers: JSON_HEADERS },
      );
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const auth = authorized(request);
  if (auth !== "ok") return authError(auth);

  let body: {
    url?: unknown;
    startDate?: unknown;
    endDate?: unknown;
    maxPages?: unknown;
    limit?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "リクエスト形式が不正です" }, { status: 400, headers: JSON_HEADERS });
  }
  if (typeof body.url !== "string" || !body.url.trim()) {
    return Response.json({ error: "url を指定してください" }, { status: 400, headers: JSON_HEADERS });
  }
  if (body.maxPages !== undefined && (typeof body.maxPages !== "number" || !Number.isFinite(body.maxPages))) {
    return Response.json({ error: "maxPages は数値で指定してください" }, { status: 400, headers: JSON_HEADERS });
  }
  if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isFinite(body.limit))) {
    return Response.json({ error: "limit は数値で指定してください" }, { status: 400, headers: JSON_HEADERS });
  }

  try {
    const config = readGoogleConfig();
    const dateRange = resolveSeoDateRange(body);
    const dataLimit = Math.min(Math.max(Math.trunc((body.limit as number | undefined) ?? 100), 10), 500);
    const [audit, ga4, gsc] = await Promise.all([
      analyzeSite(body.url, { maxPages: body.maxPages as number | undefined }),
      fetchGa4OrganicReport(config, dateRange, dataLimit),
      fetchGscSearchReport(config, dateRange, dataLimit),
    ]);
    return Response.json(
      {
        generatedAt: new Date().toISOString(),
        dateRange,
        audit: compactAudit(audit),
        ga4,
        gsc,
        opportunities: buildSeoOpportunities(audit, ga4, gsc),
      },
      { headers: JSON_HEADERS },
    );
  } catch (error) {
    if (error instanceof GoogleConfigError) {
      return Response.json({ error: error.message, code: "not_configured" }, { status: 503, headers: JSON_HEADERS });
    }
    if (error instanceof GoogleApiError) {
      return Response.json(
        { error: error.message, code: `${error.source}_api_error` },
        { status: error.status === 403 ? 403 : 502, headers: JSON_HEADERS },
      );
    }
    if (error instanceof FetchError) {
      return Response.json({ error: error.message, code: error.code }, { status: 400, headers: JSON_HEADERS });
    }
    console.error("[automation/seo-report] unexpected error", error);
    return Response.json(
      { error: "SEOレポートの作成中に予期しないエラーが発生しました", code: "internal_error" },
      { status: 500, headers: JSON_HEADERS },
    );
  }
}
