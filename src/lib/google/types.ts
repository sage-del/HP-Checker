export interface SeoDateRange {
  startDate: string;
  endDate: string;
}

export interface Ga4Totals {
  sessions: number;
  activeUsers: number;
  engagedSessions: number;
  keyEvents: number;
  engagementRate: number | null;
}

export interface Ga4LandingPage {
  path: string;
  sessions: number;
  activeUsers: number;
  engagedSessions: number;
  keyEvents: number;
  engagementRate: number | null;
}

export interface Ga4OrganicReport {
  propertyId: string;
  dateRange: SeoDateRange;
  totals: Ga4Totals;
  landingPages: Ga4LandingPage[];
}

export interface GscMetricRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQueryPageRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscSearchReport {
  siteUrl: string;
  dateRange: SeoDateRange;
  totals: Omit<GscMetricRow, "key">;
  topQueries: GscMetricRow[];
  topPages: GscMetricRow[];
  queryPages: GscQueryPageRow[];
}
