import { RoomSummary as Summary } from "@retro/domain/Room/RoomSummary.view";
import { Room } from "@retro/domain/Room/Room.aggregate";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { RoomSummary } from "@retro/domain/HttpContracts";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { makeRpcStub } from "@alchemy.run/cloudflare";

// The pinned adapter does not publicly export this runtime service.
export class Environment extends Context.Service<
  Environment,
  {
    RetroRoomAggregate: DurableObjectNamespace;
    SharedBoardView: DurableObjectNamespace;
    MyNotesView: DurableObjectNamespace;
    InvitationsView: DurableObjectNamespace;
    RoomSummaryView: DurableObjectNamespace;
    RoomRetentionPolicy: DurableObjectNamespace;
  }
>()("Cloudflare.Workers.WorkerEnvironment") {}

type AdminStub = {
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
  const rooms = env.RetroRoomAggregate;
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

    return result.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  });

  const remove = (id: string, title: string, actorId?: string) =>
    Effect.gen(function* () {
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(id))
        return yield* Effect.die("Invalid room");
      const room = stub(rooms, id);
      const summary = Option.getOrNull(yield* summaries.query(Room.ref(id)));

      if (summary && title !== summary.title)
        return yield* Effect.die("Room name does not match");

      // First freeze the source. Its retryable manifest survives a partial cleanup.
      const manifest = yield* room.purge(
        actorId ? { actorId, title } : undefined,
      );

      yield* stub(env.SharedBoardView, id).purge();
      yield* stub(env.InvitationsView, id).purge();
      yield* stub(env.InvitationsView, id).finishPurge();

      for (const actor of manifest.participants ?? []) {
        yield* stub(env.MyNotesView, `${id}:${actor}`).purge();
        yield* stub(env.MyNotesView, `${id}:${actor}`).finishPurge();
      }

      yield* stub(env.SharedBoardView, id).finishPurge();
      yield* stub(env.RoomSummaryView, id).purge();
      yield* stub(env.RoomSummaryView, id).finishPurge();
      yield* stub(env.RoomRetentionPolicy, id).purge();
      yield* stub(env.RoomRetentionPolicy, id).finishPurge();
      yield* room.finishPurge();
      yield* directory.forgetRoom(id);

      return { deleted: true };
    });

  return { list, remove };
});
