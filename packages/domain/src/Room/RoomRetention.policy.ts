import * as Match from "effect/Match";
import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { Room } from "./Room.aggregate.ts";
import { RoomCreated } from "./CreateRoom.command.ts";
import { RoomClosed } from "./CloseRoom.command.ts";
import { ExpireRoom } from "./ExpireRoom.command.ts";
import { RequestRoomDeletion, RoomDeletionRequested, RoomDeletionDeferred } from "./RequestRoomDeletion.command.ts";
import { RoomCleanup } from "./RoomCleanup.external.ts";
import { RETENTION_WEEK_MS, CLOSED_RETENTION_MS } from "./Retention.ts";

export class RoomRetention extends Domain.Policy("RoomRetention", {
  from: Room,
  on: [RoomCreated, RoomClosed, RoomDeletionRequested, RoomDeletionDeferred],
}) {}

export const RoomRetentionLive = RoomRetention.toLayer(
  Effect.gen(function* () {
    const rooms = yield* Room;
    const cleanup = yield* RoomCleanup;

    return Effect.fn(function* ({ source, event, envelope }) {
      yield* Match.value(event).pipe(
        Match.tag("RoomCreated", () => rooms.schedule(source, new ExpireRoom({}), {
          at: DateTime.makeUnsafe(DateTime.toEpochMillis(envelope.at) + RETENTION_WEEK_MS),
        })),
        Match.tag("RoomClosed", (event) => rooms.schedule(source, new RequestRoomDeletion({}), {
          at: DateTime.makeUnsafe(event.closedAt + CLOSED_RETENTION_MS),
          commandId: `retention-delete:${event.closedAt + CLOSED_RETENTION_MS}`,
        })),
        Match.tag("RoomDeletionDeferred", (event) => rooms.schedule(source, new RequestRoomDeletion({}), {
          at: DateTime.makeUnsafe(event.deletesAt),
          commandId: `retention-delete:${event.deletesAt}`,
        })),
        Match.tag("RoomDeletionRequested", (event) => cleanup.remove({ id: source.id, title: event.title })),
        Match.exhaustive,
      );
    });
  }),
);
