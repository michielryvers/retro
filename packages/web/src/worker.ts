import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { DeleteRequest, type AdminResponse, type RoomSummary } from "@retro/domain/HttpContracts";
import { authorizeAdmin } from "./adminAuth.ts";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
  BACKEND: Fetcher & {
    adminList(): Promise<ReadonlyArray<RoomSummary>>;
    adminDelete(id: string, title: string): Promise<{ deleted: true }>;
  };
  ADMIN_AUD: string;
  ADMIN_EMAIL?: string;
  ACCESS_ISSUER?: string;
  LOCAL_ADMIN?: string;
}

const json = (value: AdminResponse, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      if (
        !(
          env.LOCAL_ADMIN === "true" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        ) &&
        !(await authorizeAdmin(request, env))
      )
        return new Response("Cloudflare Access authentication required.", {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        });

      if (url.pathname === "/admin/api/rooms" && request.method === "GET") {
        try {
          return json(await env.BACKEND.adminList());
        } catch {
          console.error("Admin list failed");

          return json(
            { error: "Could not load rooms. Please try again." },
            503,
          );
        }
      }

      if (url.pathname === "/admin/api/rooms" && request.method === "DELETE") {
        if (
          request.headers.get("Origin") !== url.origin ||
          !request.headers.get("Content-Type")?.startsWith("application/json")
        )
          return json({ error: "Origin not allowed" }, 403);

        try {
          const parsed = Schema.decodeUnknownOption(DeleteRequest)(
            await request.json(),
          );

          if (Option.isNone(parsed))
            return json({ error: "Choose a room and confirm its name." }, 400);
          const body = parsed.value;

          return json(await env.BACKEND.adminDelete(body.id, body.title));
        } catch {
          return json(
            { error: "Deletion could not finish. Refresh and retry." },
            503,
          );
        }
      }

      if (url.pathname.startsWith("/admin/api"))
        return json({ error: "Not found" }, 404);
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store");

      return new Response(response.body, { status: response.status, headers });
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const headers = new Headers(request.headers);
      headers.set("x-retro-origin", url.origin);

      return env.BACKEND.fetch(new Request(request, { headers }));
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Referrer-Policy", "no-referrer");

    return new Response(response.body, { status: response.status, headers });
  },
};
