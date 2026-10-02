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

type GoogleAuthSource =
  | { kind: "service-account-key"; credentials: ServiceAccountCredentials }
  | {
      kind: "workload-identity";
      audience: string;
      oidcToken: string;
      serviceAccountEmail: string;
    };

export interface GoogleIntegrationConfig {
  auth: GoogleAuthSource;
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
  const property = required(env, "GA4_PROPERTY_ID").replace(/^properties\//, "");
  if (!/^\d+$/.test(property)) {
    throw new GoogleConfigError("GA4_PROPERTY_ID は数字のプロパティ ID で指定してください");
  }
  const siteUrl = required(env, "GSC_SITE_URL");
  if (!siteUrl.startsWith("sc-domain:") && !/^https?:\/\//.test(siteUrl)) {
    throw new GoogleConfigError("GSC_SITE_URL は sc-domain:example.com または完全な URL で指定してください");
  }

  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  let auth: GoogleAuthSource;
  if (raw) {
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
    auth = {
      kind: "service-account-key",
      credentials: {
        client_email: value.client_email,
        private_key: value.private_key.replace(/\\n/g, "\n"),
        token_uri: value.token_uri,
      },
    };
  } else {
    const serviceAccountEmail = required(env, "GOOGLE_SERVICE_ACCOUNT_EMAIL");
    if (!serviceAccountEmail.endsWith(".iam.gserviceaccount.com")) {
      throw new GoogleConfigError("GOOGLE_SERVICE_ACCOUNT_EMAIL の形式が不正です");
    }
    const audience = required(env, "GOOGLE_WORKLOAD_IDENTITY_AUDIENCE");
    if (
      !/^\/\/iam\.googleapis\.com\/projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(
        audience,
      )
    ) {
      throw new GoogleConfigError("GOOGLE_WORKLOAD_IDENTITY_AUDIENCE の形式が不正です");
    }
    auth = {
      kind: "workload-identity",
      audience,
      oidcToken: required(env, "VERCEL_OIDC_TOKEN"),
      serviceAccountEmail,
    };
  }

  return {
    auth,
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
  const cacheKey =
    config.auth.kind === "service-account-key"
      ? `key|${config.auth.credentials.client_email}|${GOOGLE_SCOPES.join(" ")}`
      : `wif|${config.auth.serviceAccountEmail}|${config.auth.audience}|${GOOGLE_SCOPES.join(" ")}`;
  if (cache.value?.key === cacheKey && cache.value.expiresAt - 60_000 > now) {
    return cache.value.token;
  }

  if (config.auth.kind === "workload-identity") {
    const result = await workloadIdentityAccessToken(config.auth, now);
    cache.value = { key: cacheKey, token: result.token, expiresAt: result.expiresAt };
    return result.token;
  }

  const credentials = config.auth.credentials;
  const tokenUri = credentials.token_uri || "https://oauth2.googleapis.com/token";
  const issuedAt = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: credentials.client_email,
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
    .sign(credentials.private_key, "base64url");

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

interface TokenResult {
  token: string;
  expiresAt: number;
}

async function workloadIdentityAccessToken(
  auth: Extract<GoogleAuthSource, { kind: "workload-identity" }>,
  now: number,
): Promise<TokenResult> {
  const stsResponse = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      audience: auth.audience,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      subject_token: auth.oidcToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    }),
    cache: "no-store",
  });
  const sts = (await stsResponse.json().catch(() => null)) as
    | { access_token?: string; error_description?: string }
    | null;
  if (!stsResponse.ok || !sts?.access_token) {
    throw new Error(
      `Google Workload Identity認証に失敗しました（HTTP ${stsResponse.status}）${sts?.error_description ? `: ${sts.error_description}` : ""}`,
    );
  }

  const email = encodeURIComponent(auth.serviceAccountEmail);
  const impersonationResponse = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${sts.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope: GOOGLE_SCOPES, lifetime: "3600s" }),
      cache: "no-store",
    },
  );
  const impersonated = (await impersonationResponse.json().catch(() => null)) as
    | { accessToken?: string; expireTime?: string; error?: { message?: string } }
    | null;
  if (!impersonationResponse.ok || !impersonated?.accessToken) {
    throw new Error(
      `Googleサービスアカウントの一時認証に失敗しました（HTTP ${impersonationResponse.status}）${impersonated?.error?.message ? `: ${impersonated.error.message}` : ""}`,
    );
  }
  const parsedExpiry = impersonated.expireTime ? Date.parse(impersonated.expireTime) : Number.NaN;
  return {
    token: impersonated.accessToken,
    expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : now + 3600_000,
  };
}
