import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from "jose";
import { authorizeAdmin } from "../src/adminAuth.ts";
import worker from "../src/worker.ts";

let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let key: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  key = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test" }],
  });
});

const config = { ADMIN_AUD: "retro-admin", ADMIN_EMAIL: "admin@example.com", ACCESS_ISSUER: "https://test.cloudflareaccess.com" };

const token = (
  email = "admin@example.com",
  audience = "retro-admin",
  expires = "1h",
) =>
  new SignJWT({ email, type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("user")
    .setIssuer("https://test.cloudflareaccess.com")
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(pair.privateKey);

const request = (jwt: string) =>
  new Request("https://retro.example.com/admin", {
    headers: { "Cf-Access-Jwt-Assertion": jwt },
  });

describe("admin boundary", () => {
  it("accepts only the signed allowed identity for this Access application", async () => {
    expect(
      await authorizeAdmin(request(await token()), config, key),
    ).toBe(true);
    expect(
      await authorizeAdmin(
        request(await token("other@example.com")),
        config,
        key,
      ),
    ).toBe(false);
    expect(
      await authorizeAdmin(
        request(await token(undefined, "another-app")),
        config,
        key,
      ),
    ).toBe(false);
    expect(
      await authorizeAdmin(
        request(await token(undefined, undefined, "-1h")),
        config,
        key,
      ),
    ).toBe(false);
    expect(await authorizeAdmin(request("forged"), config, key)).toBe(
      false,
    );
    expect(await authorizeAdmin(request(await token()), { ...config, ADMIN_AUD: "" }, key)).toBe(false);
  });
  it("denies alternate hosts and forged email headers before assets or backend calls", async () => {
    const fail = () => {
      throw new Error("Unauthenticated request reached a binding");
    };

    for (const host of ["retro.example.com", "example.workers.dev"])
      for (const path of ["/admin", "/admin/", "/admin/api/rooms"]) {
        const response = await worker.fetch(
          new Request(`https://${host}${path}`, {
            headers: {
              "Cf-Access-Authenticated-User-Email": "admin@example.com",
            },
          }),
          {
            ADMIN_AUD: "retro-admin",
            ASSETS: { fetch: fail },
            BACKEND: { fetch: fail, adminList: fail, adminDelete: fail },
          },
        );

        expect(response.status).toBe(403);
      }
  });
});

it("fails closed without identity configuration or for a different issuer", async () => {
  const signed = request(await token());

  for (const invalid of [
    { ...config, ADMIN_EMAIL: "" },
    { ...config, ACCESS_ISSUER: "" },
    { ...config, ACCESS_ISSUER: "https://another.cloudflareaccess.com" },
  ]) {
    expect(await authorizeAdmin(signed, invalid, key)).toBe(false);
  }
});
