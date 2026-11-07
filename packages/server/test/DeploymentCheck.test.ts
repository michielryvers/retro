import { expect, it } from "vitest";
import { checkDeployment, type HttpRequest } from "../../../scripts/deployment-check.ts";
import { parseDeploymentOutput } from "../../../scripts/deployment-output.ts";

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

it("reads plain production stack JSON", () => {
  expect(parseDeploymentOutput(JSON.stringify({
    url: "https://retro.example.com", api: "https://backend.example.workers.dev", workerName: "retro-prod",
  }, null, 2))).toEqual(deployment);
});

it("reads remote state output preceded by Cloudflare credential-refresh diagnostics", async () => {
  const output = [
    "[17:01:43.123] INFO: Loading Cloudflare State Store credentials",
    "• Refreshing Cloudflare State Store credentials",
    "✓ Refreshing Cloudflare State Store credentials",
    JSON.stringify({ workerName: "retro-prod" }, null, 2),
    "",
  ].join("\n");

  expect(parseDeploymentOutput(output)).toEqual(deployment);
  await checkDeployment(parseDeploymentOutput(output), config, mock(200).request);
});

it("does not confuse earlier structured diagnostics with the final stack output", () => {
  const output = '{"level":"info","workerName":"not-the-deployed-worker"}\n' + JSON.stringify(deployment, null, 2);

  expect(parseDeploymentOutput(output)).toEqual(deployment);
});

it("fails clearly for missing, malformed or unsafe deployment output", () => {
  for (const output of ["", "null", "[17:01:43] INFO: no output", '{"workerName":', '{"url":"https://retro.example.com"}', '{"workerName":"https://wrong.example.com"}']) {
    expect(() => parseDeploymentOutput(output)).toThrow("Could not read the deployed Worker");
  }
});
