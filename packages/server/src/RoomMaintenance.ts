import type { AggregateExtension } from "@alchemy.run/cloudflare/Domain";
import { makeRpcStub } from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { RoomState } from "@retro/domain/Room/RoomState";
import { Grant, grantParticipant } from "@retro/domain/Room/Access";
import { Environment } from "./Admin.ts";

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
          }>(env.RetroRoomAggregate.getByName("__admin_directory__"));

          yield* directory.registerRoom(id).pipe(Effect.orDie);
          yield* state.storage.put("admin-indexed", true);
        }).pipe(Effect.orDie),
      methods: {
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
        purge: (authorization?: { actorId: string; title: string }) =>
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

              if (
                authorization &&
                (grantParticipant(manifest.grants, authorization.actorId) !==
                  manifest.adminId ||
                  authorization.title !== manifest.title ||
                  (!previous && room?.phase !== "closed"))
              )
                return yield* Effect.die(
                  "Only the facilitator can delete a finished room, using its exact name.",
                );
              yield* storage.purge(manifest);

              return manifest;
            }),
          ),
      },
    };
  });
