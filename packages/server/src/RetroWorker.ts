import { RoomRetentionLive } from "@retro/domain/Room/RoomRetention.policy";
import { RoomCleanupLive } from "./RoomCleanup.ts";
import { RoomSummary } from "@retro/domain/Room/RoomSummary.view";
import { roomMaintenance } from "./RoomMaintenance.ts";
import { Room } from "@retro/domain/Room/Room.aggregate";
import { invitationPreview } from "./InvitationPreview.ts";
import {
  InvitationPreviewRequest,
  DeleteRequest,
} from "@retro/domain/HttpContracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

import { administration } from "./Admin.ts";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainCloudflare from "@alchemy.run/cloudflare/Domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as Response from "effect/http/HttpServerResponse";
import { Retro } from "@retro/domain/Retro.model";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { SessionLive, sessionRoute, cookieToken, identity } from "./Session.ts";

const Live = SessionLive.pipe(
  Layer.provideMerge(Retro.layer(RoomRetentionLive.pipe(Layer.provide(RoomCleanupLive)))),
  Layer.provide(DomainCloudflare.durableObjectsWith(roomMaintenance)),
);

export default class RetroWorker extends Cloudflare.Worker<RetroWorker>()(
  "RetroBackend",
  {
    main: import.meta.url,
    observability: { enabled: true, redactQueryString: true },
  },
  Effect.gen(function* () {
    const api = yield* RetroApi;
    const rooms = yield* Room;
    const summaries = yield* RoomSummary;

    const adminService = administration.pipe(
      Effect.provideService(RoomSummary, summaries),
    );

    return {
      adminList: () => adminService.pipe(Effect.flatMap((a) => a.list)),
      adminDelete: (id: string, title: string) =>
        adminService.pipe(Effect.flatMap((a) => a.remove(id, title))),
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const path = new URL(request.url, "http://localhost").pathname;
        // Origin validation covers HTTP mutations and WebSocket upgrades. Non-browser
        // clients may omit Origin, but must still possess the opaque session cookie.
        const origin = request.headers.origin;
        const forwarded = request.headers["x-retro-origin"];

        if (origin && origin !== (forwarded ?? new URL(request.url).origin))
          return Response.text("Origin not allowed", { status: 403 });

        if (path === "/api/session") return yield* sessionRoute;

        if (path === "/api/invitation-preview" && request.method === "POST") {
          return yield* Effect.gen(function* () {
            const parsed = Schema.decodeUnknownOption(InvitationPreviewRequest)(
              yield* request.json,
            );

            const preview = Option.isSome(parsed)
              ? yield* invitationPreview(parsed.value).pipe(
                  Effect.provideService(Room, rooms),
                  Effect.scoped,
                )
              : null;

            return Response.jsonUnsafe(
              preview ?? { error: "Invitation unavailable" },
              {
                status: preview ? 200 : 404,
                headers: { "cache-control": "no-store" },
              },
            );
          }).pipe(
            Effect.catchCause(() =>
              Effect.succeed(
                Response.jsonUnsafe(
                  { error: "Invitation unavailable" },
                  { status: 404, headers: { "cache-control": "no-store" } },
                ),
              ),
            ),
          );
        }

        if (path === "/api/room-cleanup" && request.method === "DELETE") {
          if (
            !origin ||
            !request.headers["content-type"]?.startsWith("application/json")
          )
            return Response.jsonUnsafe(
              { error: "Origin not allowed" },
              { status: 403 },
            );
          const token = cookieToken(request.headers);

          if (!token)
            return Response.jsonUnsafe(
              { error: "Sign in to your room first." },
              { status: 401 },
            );

          return yield* Effect.gen(function* () {
            const parsed = Schema.decodeUnknownOption(DeleteRequest)(
              yield* request.json,
            );

            if (Option.isNone(parsed))
              return Response.jsonUnsafe(
                { error: "Confirm the room name." },
                { status: 400 },
              );
            const body = parsed.value;
            const actorId = yield* identity(token);
            const admin = yield* adminService;
            const result = yield* admin.remove(body.id, body.title, actorId);

            return Response.jsonUnsafe(result, {
              headers: { "cache-control": "no-store" },
            });
          }).pipe(
            Effect.catchCause(() =>
              Effect.succeed(
                Response.jsonUnsafe(
                  {
                    error:
                      "Could not delete this room. Only its facilitator can delete a finished retro, using its exact name. Retry if cleanup was interrupted.",
                  },
                  { status: 403 },
                ),
              ),
            ),
          );
        }

        if (path.startsWith("/api")) return yield* api.fetch;

        return Response.text("Not found", { status: 404 });
      }),
    };
  }).pipe(Effect.provide(Live)),
) {}
