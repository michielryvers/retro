import type { RoomSummary } from "@retro/domain/HttpContracts";
import { exportArchive } from "./ArchiveExport.ts";
import { decodeArchive, type RetroArchive } from "@retro/domain/RetroArchive";
import type { AggregateExtension } from "@alchemy.run/cloudflare/Domain";
import { makeRpcStub } from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { RoomState } from "@retro/domain/Room/RoomState";
import { Grant, grantParticipant } from "@retro/domain/Room/Access";
import { Environment } from "./Admin.ts";
import type { PurgeAuthorization } from "./PurgeAuthorization.ts";
import { purgeWithRetention } from "./PurgeRetention.ts";

const Manifest = Schema.Struct({
  adminId: Schema.String,
  title: Schema.String,
  grants: Schema.Array(Grant),
  participants: Schema.Array(Schema.String),
});

type Manifest = typeof Manifest.Type;

// App-specific service-binding RPCs. The adapter only supplies storage cleanup
// and a post-commit hook; it knows nothing about rooms or facilitator permissions.
export const roomMaintenance: AggregateExtension = (name, state, storage) =>
  Effect.sync(() => {
    if (name !== "RetroRoom") return {};

    const exclusive = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      state
        .blockConcurrencyWhile(() => Effect.exit(effect))
        .pipe(Effect.flatMap((exit) => exit));

    return {
      afterCommit: (id: string) =>
        Effect.gen(function* () {
          if (yield* state.storage.get("admin-indexed")) return;
          const env = yield* Environment;

          const directory = makeRpcStub<{
            registerRoom: (id: string) => Effect.Effect<void, Error>;
          }>(env["CommonGround.RetroRoomAggregate"].getByName("__admin_directory__"));

          yield* directory.registerRoom(id).pipe(Effect.orDie);
          yield* state.storage.put("admin-indexed", true);
        }).pipe(Effect.orDie),
      methods: {
        exportArchive: (id: string) =>
          exclusive(
            Effect.gen(function* () {
              if (yield* state.storage.get("deleted"))
                return yield* Effect.die("Room deleted");
              const meta = yield* state.storage.get<{ state: unknown }>("meta");

              if (!meta) return yield* Effect.die("Room not found");

              const room = yield* Schema.decodeUnknownEffect(
                Schema.toCodecJson(RoomState),
              )(meta.state).pipe(Effect.orDie);

              return exportArchive(id, room);
            }),
          ),
        readArchive: (id: string) =>
          state.storage.get<RetroArchive>(`archive:${id}`),
        listArchives: () =>
          state.storage
            .list<RoomSummary>({ prefix: "archive-summary:" })
            .pipe(Effect.map((rows) => [...rows.values()])),
        importArchive: (id: string, input: RetroArchive) =>
          exclusive(
            Effect.gen(function* () {
              const archive = decodeArchive(input);
              yield* state.storage.transaction(
                Effect.gen(function* () {
                  yield* state.storage.put(`archive:${id}`, archive);
                  yield* state.storage.put(`archive-summary:${id}`, {
                    id,
                    title: archive.title,
                    template: archive.template,
                    imported: true,
                    phase: "closed",
                    participants: archive.participants.length,
                    notes: archive.notes.length - archive.combinations.length,
                    actions: archive.actions.length,
                    createdAt: archive.createdAt,
                    updatedAt: archive.closedAt,
                  });
                }),
              );
            }),
          ),
        deleteArchive: (id: string, title: string) =>
          exclusive(
            Effect.gen(function* () {
              const archive = yield* state.storage.get<RetroArchive>(
                `archive:${id}`,
              );

              if (!archive || archive.title !== title)
                return yield* Effect.die("Archive name does not match");
              yield* state.storage.transaction(
                Effect.gen(function* () {
                  yield* state.storage.delete(`archive:${id}`);
                  yield* state.storage.delete(`archive-summary:${id}`);
                }),
              );
            }),
          ),
        registerRoom: (id: string) =>
          exclusive(
            Effect.gen(function* () {
              if (!(yield* state.storage.get(`gone:${id}`)))
                yield* state.storage.put(`room:${id}`, true);
            }),
          ),
        listRooms: () =>
          state.storage
            .list<boolean>({ prefix: "room:" })
            .pipe(
              Effect.map((rows) =>
                [...rows.keys()].map((key) => ({ id: key.slice(5) })),
              ),
            ),
        forgetRoom: (id: string) =>
          exclusive(
            state.storage.transaction(
              Effect.gen(function* () {
                yield* state.storage.put(`gone:${id}`, true);
                yield* state.storage.delete(`room:${id}`);
              }),
            ),
          ),
        purge: (authorization?: PurgeAuthorization) =>
          exclusive(
            Effect.gen(function* () {
              const previous = yield* state.storage.get<Manifest | true>(
                "deleted",
              );

              if (previous === true) return { participants: [] };
              const meta = yield* state.storage.get<{ state: unknown }>("meta");

              const room = meta
                ? yield* Schema.decodeUnknownEffect(
                    Schema.toCodecJson(RoomState),
                  )(meta.state).pipe(Effect.orDie)
                : null;

              const manifest =
                previous ??
                (room
                  ? {
                      adminId: room.adminId,
                      title: room.title,
                      grants: room.grants,
                      participants: room.participants.map((p) => p.id),
                    }
                  : null);

              if (!manifest) return yield* Effect.die("Room does not exist");

              // Last line of defence, inside the same exclusive operation as
              // physical deletion. Protect against already queued old cleanup
              // calls as well as stale Domain timers/events. A tombstone means
              // deletion already started; allow its cleanup to finish safely.
              if (authorization?.automatic && !previous) {
                if (authorization.title !== manifest.title)
                  return yield* Effect.die("Room name does not match");
              }

              if (
                authorization?.actorId &&
                (grantParticipant(manifest.grants, authorization.actorId) !==
                  manifest.adminId ||
                  authorization.title !== manifest.title ||
                  (!previous && room?.phase !== "closed"))
              )
                return yield* Effect.die(
                  "Only the facilitator can delete a finished room, using its exact name.",
                );

              return yield* purgeWithRetention(
                room, authorization?.automatic === true, !!previous,
                storage.purge(manifest).pipe(Effect.as(manifest)),
              );
            }),
          ),
      },
    };
  });
