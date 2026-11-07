import * as Match from "effect/Match";
import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { Room } from "./Room.aggregate.ts";
import { RoomCreated } from "./CreateRoom.command.ts";
import { RoomClosed } from "./CloseRoom.command.ts";
import { ExpireRoom } from "./ExpireRoom.command.ts";
import { RequestRoomDeletion, RoomDeletionRequested } from "./RequestRoomDeletion.command.ts";
import { RoomRetentionScheduled } from "./RoomRetentionScheduled.event.ts";
import { RoomCleanup } from "./RoomCleanup.external.ts";
import { roomClosesAt, roomDeletesAt, deletionDue } from "./Retention.ts";

export class RoomRetention extends Domain.Policy("RoomRetention", {
  from: Room,
  on: [RoomCreated, RoomClosed, RoomDeletionRequested, RoomRetentionScheduled],
}) {}

export const reconcileDeletion = <E, R>(
  room: Parameters<typeof deletionDue>[0],
  requestedAt: number,
  remove: Effect.Effect<unknown, E, R>,
  reschedule: Effect.Effect<unknown, E, R>,
) => deletionDue(room, requestedAt)
  ? remove
  : room.lifecycle === "created" && room.phase === "closed"
    ? reschedule
    : Effect.void;

export const RoomRetentionLive = RoomRetention.toLayer(
  Effect.gen(function* () {
    const rooms = yield* Room;
    const cleanup = yield* RoomCleanup;

    return Effect.fn(function* ({ source, event, envelope }) {
      const schedule = (operation: "close" | "delete", at: number) => rooms.schedule(
        source,
        operation === "close" ? new ExpireRoom({}) : new RequestRoomDeletion({}),
        {
          at: DateTime.makeUnsafe(at),
          // A new id is essential: a legacy timer may already have executed.
          // Stable ids also make duplicate deliveries/reschedules idempotent.
          commandId: `retention:v2:${operation}:${at}`,
        },
      );

      yield* Match.value(event).pipe(
        Match.tag("RoomCreated", () => schedule("close", roomClosesAt(DateTime.toEpochMillis(envelope.at)))),
        Match.tag("RoomClosed", (event) => schedule("delete", roomDeletesAt(event.closedAt))),
        Match.tag("RoomRetentionScheduled", (event) => schedule(event.operation, event.at)),
        Match.tag("RoomDeletionRequested", () => Effect.gen(function* () {
          // Old deletion events can still be queued at deployment time. Never
          // trust their old deadline; read the authoritative current room.
          const room = yield* rooms.state(source);

          yield* reconcileDeletion(
            room, DateTime.toEpochMillis(envelope.at),
            cleanup.remove({ id: source.id, title: room.title }),
            schedule("delete", roomDeletesAt(room.closedAt)),
          );
        })),
        Match.exhaustive,
      ).pipe(Effect.catchTag("AlreadyExecuted", () => Effect.void));
    });
  }),
);
