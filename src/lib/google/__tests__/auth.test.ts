import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGoogleAccessToken,
  getGoogleAccessToken,
  GoogleConfigError,
  readGoogleConfig,
} from "../auth";

const credentials = JSON.stringify({
  client_email: "seo-reader@example-project.iam.gserviceaccount.com",
  private_key: ["-----BEGIN PRIVATE", " KEY-----\\nTEST\\n-----END PRIVATE", " KEY-----\\n"].join(""),
});

describe("readGoogleConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearGoogleAccessToken();
  });

  it("サービスアカウント・GA4・GSC の設定を正規化する", () => {
    const config = readGoogleConfig({
      GOOGLE_SERVICE_ACCOUNT_JSON: credentials,
      GA4_PROPERTY_ID: "properties/123456789",
      GSC_SITE_URL: "sc-domain:example.com",
    });
    expect(config.ga4PropertyId).toBe("123456789");
    expect(config.gscSiteUrl).toBe("sc-domain:example.com");
    expect(config.auth.kind).toBe("service-account-key");
    if (config.auth.kind !== "service-account-key") throw new Error("unexpected auth kind");
    expect(config.auth.credentials.client_email).toContain("gserviceaccount.com");
    expect(config.auth.credentials.private_key).toContain("\nTEST\n");
  });

  it("不足・不正な設定は秘密値を含めずに拒否する", () => {
    expect(() => readGoogleConfig({})).toThrow(GoogleConfigError);
    expect(() =>
      readGoogleConfig({
        GOOGLE_SERVICE_ACCOUNT_JSON: credentials,
        GA4_PROPERTY_ID: "G-XXXX",
        GSC_SITE_URL: "example.com",
      }),
    ).toThrow("GA4_PROPERTY_ID");
  });

  it("秘密鍵でJWTを署名し、Google OAuthのアクセストークンを取得する", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const config = readGoogleConfig({
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "seo-reader@example-project.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      }),
      GA4_PROPERTY_ID: "123456789",
      GSC_SITE_URL: "sc-domain:example.com",
    });
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      expect(body.get("assertion")?.split(".")).toHaveLength(3);
      return Response.json({ access_token: "token-for-test", expires_in: 3600 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGoogleAccessToken(config, Date.UTC(2026, 9, 2))).resolves.toBe("token-for-test");
    await expect(getGoogleAccessToken(config, Date.UTC(2026, 9, 2, 0, 1))).resolves.toBe("token-for-test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Vercel OIDCをGoogle STSで交換し、サービスアカウントの一時トークンを取得する", async () => {
    const audience =
      "//iam.googleapis.com/projects/654210782577/locations/global/workloadIdentityPools/vercel-hp-checker/providers/vercel";
    const config = readGoogleConfig({
      VERCEL_OIDC_TOKEN: "vercel-oidc-token-for-test",
      GOOGLE_SERVICE_ACCOUNT_EMAIL:
        "hp-checker-sage@example-project.iam.gserviceaccount.com",
      GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: audience,
      GA4_PROPERTY_ID: "123456789",
      GSC_SITE_URL: "sc-domain:example.com",
    });
    expect(config.auth.kind).toBe("workload-identity");

    const now = Date.UTC(2026, 9, 2);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_input, init) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("audience")).toBe(audience);
        expect(body.get("subject_token")).toBe("vercel-oidc-token-for-test");
        expect(body.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:jwt");
        return Response.json({ access_token: "federated-token", expires_in: 3600 });
      })
      .mockImplementationOnce(async (input, init) => {
        expect(String(input)).toContain("iamcredentials.googleapis.com");
        expect(init?.headers).toMatchObject({ authorization: "Bearer federated-token" });
        expect(JSON.parse(String(init?.body))).toMatchObject({ lifetime: "3600s" });
        return Response.json({
          accessToken: "impersonated-token",
          expireTime: "2026-10-02T01:00:00.000Z",
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGoogleAccessToken(config, now)).resolves.toBe("impersonated-token");
    await expect(getGoogleAccessToken(config, now + 60_000)).resolves.toBe("impersonated-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
