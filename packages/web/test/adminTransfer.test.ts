import { expect, it } from "vitest";
import worker from "../src/worker.ts";
import { archiveFixture } from "../../server/test/fixtures/archive.ts";

const origin = "http://localhost";

const setup = () => {
  let imports = 0;

  const env = {
    ADMIN_AUD: "",
    LOCAL_ADMIN: "true",
    ASSETS: { fetch: async () => new Response("assets") },
    BACKEND: {
      fetch: async () => new Response("not found", { status: 404 }),
      adminList: async () => [],
      adminDelete: async () => ({ deleted: true as const }),
      adminExport: async () => archiveFixture(),
      adminImport: async () => {
        imports++;

        return { id: "archive-id" };
      },
    },
  };

  const upload = (body: string, from = origin) =>
    worker.fetch(
      new Request(`${origin}/admin/api/import`, {
        method: "POST",
        headers: { Origin: from, "Content-Type": "application/json" },
        body,
      }),
      env,
    );

  return { env, upload, imports: () => imports };
};

it("accepts a validated archive only with admin access and same-origin mutation", async () => {
  const { upload, imports, env } = setup();
  const body = JSON.stringify(archiveFixture());
  expect((await upload(body, "https://other.example")).status).toBe(403);
  expect(imports()).toBe(0);
  expect(
    (
      await worker.fetch(
        new Request("https://retro.example/admin/api/import", {
          method: "POST",
          body,
          headers: {
            Origin: "https://retro.example",
            "Content-Type": "application/json",
          },
        }),
        env,
      )
    ).status,
  ).toBe(403);
  expect(imports()).toBe(0);
  const response = await upload(body);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(imports()).toBe(1);
});

it("rejects malformed, future-version and oversized uploads before RPC", async () => {
  const { upload, imports } = setup();
  expect((await upload("not json")).status).toBe(400);
  expect(
    (await upload(JSON.stringify({ ...archiveFixture(), version: 2 }))).status,
  ).toBe(400);
  expect((await upload(" ".repeat(1_800_001))).status).toBe(413);
  expect(imports()).toBe(0);
});
