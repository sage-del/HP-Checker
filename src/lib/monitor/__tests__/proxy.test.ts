import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const originalUser = process.env.BASIC_AUTH_USER;
const originalPassword = process.env.BASIC_AUTH_PASSWORD;

afterEach(() => {
  if (originalUser === undefined) delete process.env.BASIC_AUTH_USER;
  else process.env.BASIC_AUTH_USER = originalUser;
  if (originalPassword === undefined) delete process.env.BASIC_AUTH_PASSWORD;
  else process.env.BASIC_AUTH_PASSWORD = originalPassword;
});

describe("proxy automation authentication", () => {
  it("automation API は専用Bearer認証へ渡し、通常画面はBasic認証で保護する", () => {
    process.env.BASIC_AUTH_USER = "admin";
    process.env.BASIC_AUTH_PASSWORD = "monitor-password";

    const automation = proxy(
      new NextRequest("https://example.com/api/automation/seo-report", {
        headers: { authorization: "Bearer automation-key" },
      }),
    );
    expect(automation.status).toBe(200);
    expect(automation.headers.get("x-middleware-next")).toBe("1");

    const page = proxy(new NextRequest("https://example.com/"));
    expect(page.status).toBe(401);
    expect(page.headers.get("www-authenticate")).toContain("Basic");
  });
});
