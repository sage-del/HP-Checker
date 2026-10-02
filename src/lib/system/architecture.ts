import architectureData from "@/data/system-architecture.json";

export type IntegrationStatus = "active" | "pending-env" | "pending-verification" | "optional";

export interface SystemFlow {
  id: string;
  title: string;
  description: string;
  steps: string[];
}

export interface SystemIntegration {
  name: string;
  service: string;
  category: string;
  purpose: string;
  authentication: string;
  status: IntegrationStatus;
  configuration: string[];
}

export interface InternalApi {
  method: string;
  path: string;
  purpose: string;
  auth: string;
}

export interface SystemArchitecture {
  schemaVersion: number;
  updatedAt: string;
  systemName: string;
  sourceOfTruth: string;
  repository: { name: string; branch: string; hosting: string };
  runtime: { name: string; framework: string; project: string };
  flows: SystemFlow[];
  integrations: SystemIntegration[];
  internalApis: InternalApi[];
  maintenanceRules: string[];
  reproductionSteps: string[];
}

export const systemArchitecture = architectureData as SystemArchitecture;

export const INTEGRATION_STATUS: Record<IntegrationStatus, { label: string; tone: "pass" | "warn" | "info" }> = {
  active: { label: "稼働中", tone: "pass" },
  "pending-env": { label: "環境変数の設定待ち", tone: "warn" },
  "pending-verification": { label: "疎通確認待ち", tone: "warn" },
  optional: { label: "任意機能", tone: "info" },
};
