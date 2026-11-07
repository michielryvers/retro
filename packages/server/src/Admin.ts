import { decodeArchive, type RetroArchive } from "@retro/domain/RetroArchive";
import { RoomSummary as Summary } from "@retro/domain/Room/RoomSummary.view";
import { Room } from "@retro/domain/Room/Room.aggregate";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { RoomSummary } from "@retro/domain/HttpContracts";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { makeRpcStub } from "@alchemy.run/cloudflare";

// Domain beta.85 prefixes Durable Object bindings with the model name.
export class Environment extends Context.Service<
  Environment,
  {
    "CommonGround.RetroRoomAggregate": DurableObjectNamespace;
    "CommonGround.SharedBoardView": DurableObjectNamespace;
    "CommonGround.MyNotesView": DurableObjectNamespace;
    "CommonGround.InvitationsView": DurableObjectNamespace;
    "CommonGround.RoomSummaryView": DurableObjectNamespace;
    "CommonGround.RoomRetentionPolicy": DurableObjectNamespace;
  }
>()("Cloudflare.Workers.WorkerEnvironment") {}

type AdminStub = {
  exportArchive: (id: string) => Effect.Effect<RetroArchive, Error>;
  readArchive: (id: string) => Effect.Effect<RetroArchive | undefined, Error>;
  listArchives: () => Effect.Effect<RoomSummary[], Error>;
  importArchive: (id: string, data: RetroArchive) => Effect.Effect<void, Error>;
  deleteArchive: (id: string, title: string) => Effect.Effect<void, Error>;
  listRooms: () => Effect.Effect<Array<{ id: string }>, Error>;
  forgetRoom: (id: string) => Effect.Effect<void, Error>;
  purge: (authorization?: {
    actorId: string;
    title: string;
  }) => Effect.Effect<{ participants?: ReadonlyArray<string> }, Error>;
  finishPurge: () => Effect.Effect<void, Error>;
};

export const administration = Effect.gen(function* () {
  const env = Option.getOrThrow(yield* Effect.serviceOption(Environment));
  const rooms = env["CommonGround.RetroRoomAggregate"];
  const summaries = yield* Summary;

  const stub = (namespace: DurableObjectNamespace, name: string) =>
    makeRpcStub<AdminStub>(namespace.getByName(name));

  const directory = stub(rooms, "__admin_directory__");

  const list = Effect.gen(function* () {
    const entries = yield* directory.listRooms();
    const result: RoomSummary[] = [];

    for (const entry of entries) {
      const summary = Option.getOrNull(
        yield* summaries.query(Room.ref(entry.id)),
      );

      if (summary) result.push(summary);
      else
        result.push({
          id: entry.id,
          title: "Deletion in progress",
          phase: "deleting",
          participants: 0,
          notes: 0,
          actions: 0,
          template: "mad-sad-glad",
          createdAt: null,
          updatedAt: null,
        });
    }

    result.push(...(yield* directory.listArchives()));

    return result.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  });

  const remove = (id: string, title: string, actorId?: string) =>
    Effect.gen(function* () {
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(id))
        return yield* Effect.die("Invalid room");

      if (id.startsWith("archive-")) {
        if (actorId) return yield* Effect.die("Admin access required");
        yield* directory.deleteArchive(id, title);

        return { deleted: true };
      }

      const room = stub(rooms, id);
      const summary = Option.getOrNull(yield* summaries.query(Room.ref(id)));

      if (summary && title !== summary.title)
        return yield* Effect.die("Room name does not match");

      // First freeze the source. Its retryable manifest survives a partial cleanup.
      const manifest = yield* room.purge(
        actorId ? { actorId, title } : undefined,
      );

      yield* stub(env["CommonGround.SharedBoardView"], id).purge();
      yield* stub(env["CommonGround.InvitationsView"], id).purge();
      yield* stub(env["CommonGround.InvitationsView"], id).finishPurge();

      for (const actor of manifest.participants ?? []) {
        yield* stub(env["CommonGround.MyNotesView"], `${id}:${actor}`).purge();
        yield* stub(env["CommonGround.MyNotesView"], `${id}:${actor}`).finishPurge();
      }

      yield* stub(env["CommonGround.SharedBoardView"], id).finishPurge();
      yield* stub(env["CommonGround.RoomSummaryView"], id).purge();
      yield* stub(env["CommonGround.RoomSummaryView"], id).finishPurge();
      yield* stub(env["CommonGround.RoomRetentionPolicy"], id).purge();
      yield* stub(env["CommonGround.RoomRetentionPolicy"], id).finishPurge();
      yield* room.finishPurge();
      yield* directory.forgetRoom(id);

      return { deleted: true };
    });

  const exportRoom = (id: string) =>
    Effect.gen(function* () {
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(id))
        return yield* Effect.die("Invalid room");

      if (id.startsWith("archive-")) {
        const archive = yield* directory.readArchive(id);

        if (!archive) return yield* Effect.die("Archive not found");

        return archive;
      }

      return yield* stub(rooms, id).exportArchive(id);
    });

  const importRoom = (input: RetroArchive) =>
    Effect.gen(function* () {
      const archive = decodeArchive(input);
      // Canonical schema field order makes retries / repeated uploads idempotent.
      const bytes = new TextEncoder().encode(JSON.stringify(archive));

      const hash = yield* Effect.promise(() =>
        crypto.subtle.digest("SHA-256", bytes),
      );

      const id = `archive-${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}`;
      yield* directory.importArchive(id, archive);

      return { id };
    });

  return { list, remove, exportRoom, importRoom };
});
