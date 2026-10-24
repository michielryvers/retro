import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { Room } from "@retro/domain/Room/Room.aggregate";
import { RoomId } from "@retro/domain/Room/Room.id";
import { Refused } from "@retro/domain/Room/Refused.rejection";
import { sameSecret } from "@retro/domain/Room/Access";
import { randomSecret, inviteToken, passwordHash } from "./Secrets.ts";

export const AccessPayload = Schema.Struct({
  target: RoomId,
  password: Schema.Redacted(Schema.String),
  token: Schema.optionalKey(Schema.Redacted(Schema.String)),
  participantId: Schema.optionalKey(Schema.String),
});

export const prepareAccess = Effect.fn(function* (
  tag: string,
  input: typeof AccessPayload.Type | null,
) {
  const empty = {
    id: "",
    seed: Redacted.make(""),
    salt: "",
    hash: Redacted.make(""),
    validToken: false,
  };

  if (tag === "InviteParticipant") return { ...empty, id: crypto.randomUUID() };

  if (tag !== "CreateRoom" && tag !== "JoinRoom") return empty;

  if (!input) return yield* new Refused({ reason: "Invalid credentials." });
  const password = Redacted.value(input.password);

  if (password.length > 128 || (tag === "CreateRoom" && password.length < 3))
    return yield* new Refused({
      reason: "Use a room password between 3 and 128 characters.",
    });

  if (tag === "CreateRoom") {
    const salt = randomSecret();
    const hash = yield* Effect.promise(() => passwordHash(password, salt));

    return {
      ...empty,
      id: crypto.randomUUID(),
      seed: Redacted.make(randomSecret()),
      salt,
      hash: Redacted.make(hash),
    };
  }

  const rooms = yield* Room;
  const room = yield* rooms.state(RoomId.make(input.target));

  if (
    room.lifecycle !== "created" ||
    !room.invitations.some((p) => p.id === input.participantId)
  )
    return empty;

  if (!input.token || !input.participantId) return empty;
  const participantId = input.participantId;
  const token = Redacted.value(input.token);

  if (token.length !== 64) return empty;

  const expected = yield* Effect.promise(() =>
    inviteToken(Redacted.value(room.inviteSeed), participantId),
  );

  if (!sameSecret(expected, token)) return empty;

  const hash = yield* Effect.promise(() =>
    passwordHash(password, room.passwordSalt),
  );

  return {
    ...empty,
    seed: room.inviteSeed,
    hash: Redacted.make(hash),
    validToken: true,
  };
});
