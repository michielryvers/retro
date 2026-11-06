import {
  ARCHIVE_MAX_BYTES,
  decodeArchive,
  type RetroArchive,
} from "@retro/domain/RetroArchive";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import {
  DeleteRequest,
  DeleteResponse,
  RoomSummaries,
  type AdminResponse,
  type RoomSummary,
} from "@retro/domain/HttpContracts";
import { authorizeAdmin } from "./adminAuth.ts";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
  BACKEND: Fetcher & {
    adminExport(id: string): Promise<RetroArchive>;
    adminImport(data: RetroArchive): Promise<{ id: string }>;
    adminList(): Promise<ReadonlyArray<RoomSummary>>;
    adminDelete(id: string, title: string): Promise<{ deleted: true }>;
  };
  ADMIN_AUD: string;
  ADMIN_EMAIL?: string;
  ACCESS_ISSUER?: string;
  LOCAL_ADMIN?: string;
}

const json = (
  value: AdminResponse | RetroArchive | { id: string },
  status = 200,
) =>
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

      if (url.pathname === "/admin/api/export" && request.method === "GET") {
        try {
          const archive = decodeArchive(
            await env.BACKEND.adminExport(url.searchParams.get("id") ?? ""),
          );

          return json(archive);
        } catch {
          return json(
            {
              error:
                "Only finished retros can be exported. Refresh and try again.",
            },
            409,
          );
        }
      }

      if (url.pathname === "/admin/api/import" && request.method === "POST") {
        if (
          request.headers.get("Origin") !== url.origin ||
          !request.headers.get("Content-Type")?.startsWith("application/json")
        )
          return json({ error: "Origin not allowed" }, 403);
        // Bound streamed bodies too; Content-Length is optional and untrusted.
        const reader = request.body?.getReader();

        if (!reader) return json({ error: "Choose a retro JSON export." }, 400);
        let size = 0;
        const chunks: Uint8Array[] = [];

        try {
          while (true) {
            const part = await reader.read();

            if (part.done) break;
            size += part.value.byteLength;

            if (size > ARCHIVE_MAX_BYTES) {
              await reader.cancel();

              return json(
                { error: "This archive is too large (maximum 1.8 MB)." },
                413,
              );
            }

            chunks.push(part.value);
          }
        } catch {
          return json({ error: "Upload interrupted. Try again." }, 400);
        }

        let archive: RetroArchive;

        try {
          const bytes = new Uint8Array(size);
          let offset = 0;

          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }

          archive = decodeArchive(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
          );
        } catch {
          return json(
            {
              error:
                "Not a valid version 1 retro archive. Use the JSON export from administration.",
            },
            400,
          );
        }

        try {
          return json(
            Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
              await env.BACKEND.adminImport(archive),
            ),
          );
        } catch {
          return json(
            {
              error: "Import could not finish. You can safely retry this file.",
            },
            503,
          );
        }
      }

      if (url.pathname === "/admin/api/rooms" && request.method === "GET") {
        try {
          return json(
            Schema.decodeUnknownSync(RoomSummaries)(
              await env.BACKEND.adminList(),
            ),
          );
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

          return json(
            Schema.decodeUnknownSync(DeleteResponse)(
              await env.BACKEND.adminDelete(body.id, body.title),
            ),
          );
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
