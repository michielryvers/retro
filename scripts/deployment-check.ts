import * as Schema from "effect/Schema";
import { SessionResponse } from "@retro/domain/HttpContracts";
import { parseDeploymentOutput } from "./deployment-output.ts";

export type HttpRequest = (url: string, init?: RequestInit) => Promise<Response>;

const Account = Schema.Struct({ success: Schema.Literal(true), result: Schema.Struct({ subdomain: Schema.String }) });

const checked = async (url: string, request: HttpRequest, init?: RequestInit) => {
  const response = await request(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });

  if (response.status !== 200) throw new Error(`${url} returned HTTP ${response.status}`);

  return response;
};

export async function checkSite(url: string, request: HttpRequest = fetch) {
  const html = await (await checked(`${url}/`, request)).text();
  const script = /<script\b[^>]*\bsrc="([^"]+)"/.exec(html)?.[1];

  if (!html.includes('<div id="root"></div>') || !script) throw new Error(`${url} did not serve the Retro application`);
  const asset = new URL(script, url);

  if (asset.origin !== new URL(url).origin) throw new Error("Unexpected cross-origin application script");
  const javascript = await checked(asset.href, request);

  if (!(javascript.headers.get("content-type") ?? "").includes("javascript")) throw new Error("Application script was not JavaScript");
  const session = await checked(`${url}/api/session`, request);
  const body = Schema.decodeUnknownSync(SessionResponse)(await session.json());

  if (!/^[a-f0-9]{64}$/.test(body.id)) throw new Error("Backend session check failed");
}

export async function checkDeployment(
  deployment: { workerName: string },
  config: { accountId: string; token: string; domain: string },
  request: HttpRequest = fetch,
  warn: (message: string) => void = console.warn,
) {
  if (!/^[a-z0-9_-]+$/.test(deployment.workerName)) throw new Error("Missing or invalid deployed Worker name");

  const account = await checked(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/workers/subdomain`, request, {
    headers: { authorization: `Bearer ${config.token}` },
  });

  const data = Schema.decodeUnknownSync(Account)(await account.json());
  const subdomain = data.result.subdomain;

  if (!/^[a-z0-9-]+$/.test(subdomain)) throw new Error("Could not resolve the account's workers.dev subdomain");

  // Test the actual deployed frontend, its built asset, and its backend binding.
  // workers.dev is already enabled; unlike the custom domain it has no zone WAF.
  const origin = `https://${deployment.workerName}.${subdomain}.workers.dev`;
  await checkSite(origin, request);

  const publicUrl = `https://${config.domain}`;
  const edge = await request(`${publicUrl}/`, { redirect: "error", signal: AbortSignal.timeout(15000) });

  if (edge.status === 403 && edge.headers.get("cf-mitigated") === "challenge") {
    warn(`::warning::${publicUrl} challenges automated clients at Cloudflare's edge. The deployed application, asset and backend passed at ${origin}.`);
  } else {
    if (edge.status !== 200) throw new Error(`${publicUrl} returned HTTP ${edge.status}`);
    await checkSite(publicUrl, request);
  }
}

if (import.meta.main) {
  const required = (name: string) => {
    const value = process.env[name];

    if (!value) throw new Error(`Missing ${name}`);

    return value;
  };

  const deployment = parseDeploymentOutput(await Bun.file(process.argv[2]!).text());
  const config = { accountId: required("CLOUDFLARE_ACCOUNT_ID"), token: required("CLOUDFLARE_API_TOKEN"), domain: required("RETRO_DOMAIN") };

  for (let attempt = 0; ; attempt++) {
    try {
      await checkDeployment(deployment, config);
      console.log("Deployed application, JavaScript asset and backend session checks passed.");
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      console.warn(`Deployment check failed; retrying (${attempt + 1}/5).`);
      await Bun.sleep(5000);
    }
  }
}
