import { expect, it } from "vitest";
import { checkDeployment, type HttpRequest } from "../../../scripts/deployment-check.ts";

const origin = "https://retro-prod.example.workers.dev";
const config = { accountId: "account", token: "secret", domain: "retro.example.com" };
const deployment = { workerName: "retro-prod" };
const html = '<div id="root"></div><script type="module" src="/assets/app.js"></script>';

function mock(edgeStatus = 403, challenge = true, broken?: string) {
  const urls: string[] = [];

  const request: HttpRequest = async (input, init) => {
    const url = String(input);
    urls.push(url);

    if (url.startsWith("https://api.cloudflare.com/")) {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");

      return Response.json({ success: true, result: { subdomain: "example" } });
    }

    expect(new Headers(init?.headers).has("authorization")).toBe(false);

    if (url === broken) return new Response("Broken", { status: 500 });

    if (url.startsWith("https://retro.example.com") && edgeStatus !== 200) return new Response("Forbidden", {
      status: edgeStatus, headers: challenge ? { "cf-mitigated": "challenge" } : {},
    });

    if (url.endsWith("/assets/app.js")) return new Response("console.log('app')", { headers: { "content-type": "application/javascript" } });

    if (url.endsWith("/api/session")) return Response.json({ id: "a".repeat(64) });

    return new Response(html);
  };

  return { request, urls };
}

it("checks the deployed application and binding despite a confirmed edge challenge", async () => {
  const { request, urls } = mock();
  const warnings: string[] = [];
  await checkDeployment(deployment, config, request, (message) => warnings.push(message));
  expect(urls).toContain(`${origin}/assets/app.js`);
  expect(urls).toContain(`${origin}/api/session`);
  expect(warnings).toHaveLength(1);
});

it("does not mask ordinary 403 or 500 responses", async () => {
  for (const status of [403, 500]) await expect(checkDeployment(deployment, config, mock(status, false).request)).rejects.toThrow(`HTTP ${status}`);
});

it("fails if the deployed frontend, asset or backend is broken", async () => {
  for (const path of ["/", "/assets/app.js", "/api/session"]) {
    await expect(checkDeployment(deployment, config, mock(403, true, origin + path).request)).rejects.toThrow("HTTP 500");
  }
});

it("also checks the custom domain when it is accessible", async () => {
  const { request, urls } = mock(200);
  await checkDeployment(deployment, config, request);
  expect(urls).toContain("https://retro.example.com/api/session");
});
