import {
  clearGoogleAccessToken,
  getGoogleAccessToken,
  type GoogleIntegrationConfig,
} from "./auth";
import type {
  Ga4LandingPage,
  Ga4OrganicReport,
  GscMetricRow,
  GscQueryPageRow,
  GscSearchReport,
  SeoDateRange,
} from "./types";

interface GoogleApiErrorBody {
  error?: { message?: string; status?: string };
}

export class GoogleApiError extends Error {
  constructor(
    public readonly source: "ga4" | "gsc",
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

async function googlePost<T>(
  config: GoogleIntegrationConfig,
  source: "ga4" | "gsc",
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getGoogleAccessToken(config);
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
    if (response.status === 401 && attempt === 0) {
      clearGoogleAccessToken();
      continue;
    }
    const json = (await response.json().catch(() => null)) as (T & GoogleApiErrorBody) | null;
    if (!response.ok || !json) {
      const detail = json?.error?.message;
      throw new GoogleApiError(
        source,
        response.status,
        `${source.toUpperCase()} API の取得に失敗しました（HTTP ${response.status}）${detail ? `: ${detail}` : ""}`,
      );
    }
    return json;
  }
  throw new GoogleApiError(source, 401, `${source.toUpperCase()} API の認証に失敗しました`);
}

function number(value: string | number | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function engagementRate(engaged: number, sessions: number): number | null {
  return sessions > 0 ? engaged / sessions : null;
}

interface Ga4Response {
  rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
  totals?: Array<{ metricValues?: Array<{ value?: string }> }>;
}

export async function fetchGa4OrganicReport(
  config: GoogleIntegrationConfig,
  dateRange: SeoDateRange,
  limit = 100,
  signal?: AbortSignal,
): Promise<Ga4OrganicReport> {
  const response = await googlePost<Ga4Response>(
    config,
    "ga4",
    `https://analyticsdata.googleapis.com/v1beta/properties/${config.ga4PropertyId}:runReport`,
    {
      dateRanges: [dateRange],
      dimensions: [{ name: "landingPagePlusQueryString" }],
      metrics: [
        { name: "sessions" },
        { name: "activeUsers" },
        { name: "engagedSessions" },
        { name: "keyEvents" },
      ],
      dimensionFilter: {
        filter: {
          fieldName: "sessionDefaultChannelGroup",
          stringFilter: { matchType: "EXACT", value: "Organic Search" },
        },
      },
      metricAggregations: ["TOTAL"],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: String(Math.min(Math.max(limit, 1), 1000)),
    },
    signal,
  );

  const landingPages: Ga4LandingPage[] = (response.rows ?? []).map((row) => {
    const metrics = row.metricValues ?? [];
    const sessions = number(metrics[0]?.value);
    const engagedSessions = number(metrics[2]?.value);
    return {
      path: row.dimensionValues?.[0]?.value || "(not set)",
      sessions,
      activeUsers: number(metrics[1]?.value),
      engagedSessions,
      keyEvents: number(metrics[3]?.value),
      engagementRate: engagementRate(engagedSessions, sessions),
    };
  });
  const totalValues = response.totals?.[0]?.metricValues ?? [];
  const totalSessions = number(totalValues[0]?.value);
  const totalEngaged = number(totalValues[2]?.value);
  return {
    propertyId: config.ga4PropertyId,
    dateRange,
    totals: {
      sessions: totalSessions,
      activeUsers: number(totalValues[1]?.value),
      engagedSessions: totalEngaged,
      keyEvents: number(totalValues[3]?.value),
      engagementRate: engagementRate(totalEngaged, totalSessions),
    },
    landingPages,
  };
}

interface GscResponse {
  rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }>;
}

function aggregate(
  rows: GscQueryPageRow[],
  keyOf: (row: GscQueryPageRow) => string,
  limit: number,
): GscMetricRow[] {
  const values = new Map<string, { clicks: number; impressions: number; weightedPosition: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = values.get(key) ?? { clicks: 0, impressions: 0, weightedPosition: 0 };
    current.clicks += row.clicks;
    current.impressions += row.impressions;
    current.weightedPosition += row.position * row.impressions;
    values.set(key, current);
  }
  return [...values.entries()]
    .map(([key, value]) => ({
      key,
      clicks: value.clicks,
      impressions: value.impressions,
      ctr: value.impressions > 0 ? value.clicks / value.impressions : 0,
      position: value.impressions > 0 ? value.weightedPosition / value.impressions : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit);
}

export async function fetchGscSearchReport(
  config: GoogleIntegrationConfig,
  dateRange: SeoDateRange,
  limit = 100,
  signal?: AbortSignal,
): Promise<GscSearchReport> {
  const response = await googlePost<GscResponse>(
    config,
    "gsc",
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.gscSiteUrl)}/searchAnalytics/query`,
    {
      ...dateRange,
      dimensions: ["query", "page"],
      rowLimit: 25_000,
      dataState: "final",
    },
    signal,
  );
  const queryPages: GscQueryPageRow[] = (response.rows ?? []).map((row) => ({
    query: row.keys?.[0] || "(not set)",
    page: row.keys?.[1] || "(not set)",
    clicks: number(row.clicks),
    impressions: number(row.impressions),
    ctr: number(row.ctr),
    position: number(row.position),
  }));
  const clicks = queryPages.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = queryPages.reduce((sum, row) => sum + row.impressions, 0);
  const weightedPosition = queryPages.reduce(
    (sum, row) => sum + row.position * row.impressions,
    0,
  );
  return {
    siteUrl: config.gscSiteUrl,
    dateRange,
    totals: {
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      position: impressions > 0 ? weightedPosition / impressions : 0,
    },
    topQueries: aggregate(queryPages, (row) => row.query, limit),
    topPages: aggregate(queryPages, (row) => row.page, limit),
    queryPages: queryPages.slice(0, Math.min(Math.max(limit * 5, 100), 1000)),
  };
}
