import { createSign } from "node:crypto";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
] as const;

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface GoogleIntegrationConfig {
  credentials: ServiceAccountCredentials;
  ga4PropertyId: string;
  gscSiteUrl: string;
}

export class GoogleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleConfigError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new GoogleConfigError(`${name} が設定されていません`);
  return value;
}

export function readGoogleConfig(env: Environment = process.env): GoogleIntegrationConfig {
  const raw = required(env, "GOOGLE_SERVICE_ACCOUNT_JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GoogleConfigError("GOOGLE_SERVICE_ACCOUNT_JSON は有効な JSON ではありません");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new GoogleConfigError("GOOGLE_SERVICE_ACCOUNT_JSON の形式が不正です");
  }
  const value = parsed as Partial<ServiceAccountCredentials>;
  if (typeof value.client_email !== "string" || !value.client_email.includes("@")) {
    throw new GoogleConfigError("サービスアカウントの client_email がありません");
  }
  if (typeof value.private_key !== "string" || !value.private_key.includes("PRIVATE KEY")) {
    throw new GoogleConfigError("サービスアカウントの private_key がありません");
  }

  const property = required(env, "GA4_PROPERTY_ID").replace(/^properties\//, "");
  if (!/^\d+$/.test(property)) {
    throw new GoogleConfigError("GA4_PROPERTY_ID は数字のプロパティ ID で指定してください");
  }
  const siteUrl = required(env, "GSC_SITE_URL");
  if (!siteUrl.startsWith("sc-domain:") && !/^https?:\/\//.test(siteUrl)) {
    throw new GoogleConfigError("GSC_SITE_URL は sc-domain:example.com または完全な URL で指定してください");
  }

  return {
    credentials: {
      client_email: value.client_email,
      private_key: value.private_key.replace(/\\n/g, "\n"),
      token_uri: value.token_uri,
    },
    ga4PropertyId: property,
    gscSiteUrl: siteUrl,
  };
}

interface TokenCache {
  key: string;
  token: string;
  expiresAt: number;
}

function tokenCache(): { value?: TokenCache } {
  const global = globalThis as typeof globalThis & { __siteKenshinGoogleToken?: { value?: TokenCache } };
  global.__siteKenshinGoogleToken ??= {};
  return global.__siteKenshinGoogleToken;
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function clearGoogleAccessToken(): void {
  tokenCache().value = undefined;
}

export async function getGoogleAccessToken(
  config: GoogleIntegrationConfig,
  now = Date.now(),
): Promise<string> {
  const cache = tokenCache();
  const cacheKey = `${config.credentials.client_email}|${GOOGLE_SCOPES.join(" ")}`;
  if (cache.value?.key === cacheKey && cache.value.expiresAt - 60_000 > now) {
    return cache.value.token;
  }

  const tokenUri = config.credentials.token_uri || "https://oauth2.googleapis.com/token";
  const issuedAt = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: config.credentials.client_email,
      scope: GOOGLE_SCOPES.join(" "),
      aud: tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .end()
    .sign(config.credentials.private_key, "base64url");

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error_description?: string }
    | null;
  if (!response.ok || !body?.access_token) {
    throw new Error(
      `Google OAuth 認証に失敗しました（HTTP ${response.status}）${body?.error_description ? `: ${body.error_description}` : ""}`,
    );
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  cache.value = { key: cacheKey, token: body.access_token, expiresAt: now + expiresIn * 1000 };
  return body.access_token;
}
