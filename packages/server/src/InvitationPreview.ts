import * as Redacted from "effect/Redacted";
import * as Effect from "effect/Effect";
import { Room } from "@retro/domain/Room/Room.aggregate";
import { RoomId } from "@retro/domain/Room/Room.id";
import { inviteToken } from "./Secrets.ts";
import { sameSecret } from "@retro/domain/Room/Access";
import type { InvitationPreviewRequest } from "@retro/domain/HttpContracts";

// Possessing a valid personal link reveals only its recipient and room title.
// This read grants no membership and does not record events or password attempts.
export const invitationPreview = (
  input: typeof InvitationPreviewRequest.Type,
) =>
  Effect.gen(function* () {
    if (
      !/^[a-zA-Z0-9-]{1,100}$/.test(input.roomId) ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(input.participantId) ||
      !/^[a-f0-9]{64}$/.test(input.token)
    )
      return null;
    const rooms = yield* Room;
    const room = yield* rooms.state(RoomId.make(input.roomId));
    const person = room.invitations.find((p) => p.id === input.participantId);

    if (!room.title || !room.inviteSeed || !person) return null;

    const expected = yield* Effect.promise(() =>
      inviteToken(Redacted.value(room.inviteSeed), person.id),
    );

    if (!sameSecret(expected, input.token)) return null;

    return { name: person.name, title: room.title };
  });
