import * as Redacted from "effect/Redacted";
import * as Effect from "effect/Effect";
import { RetroApi } from "../packages/domain/src/RetroApi.api.ts";
import { RoomId } from "../packages/domain/src/Room/Room.id.ts";
import { inviteToken } from "../packages/server/src/Secrets.ts";

// Exercise the supported minimum throughout the invitation smoke flows.
export const testPassword = "abc";

export const joinInvited = Effect.fn(function* (
  api: Effect.Success<typeof RetroApi.client>,
  target: typeof RoomId.Type,
  name: string,
  host: { headers: { cookie: string } },
  guest: { headers: { cookie: string } },
) {
  const receipt = yield* api.InviteParticipant({ target, name }, host);

  const invitations = yield* api.Invitations.get(target, {
    ...host,
    atLeast: receipt,
  });

  if (!invitations) throw new Error("Missing invitations");
  const person = invitations.people.at(-1)!;

  const token = yield* Effect.promise(() =>
    inviteToken(Redacted.value(invitations.seed), person.id),
  );

  yield* api.JoinRoom(
    {
      target,
      participantId: person.id,
      token: Redacted.make(token),
      password: Redacted.make(testPassword),
    },
    guest,
  );

  return person.id;
});
