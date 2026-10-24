import * as Schema from "effect/Schema";

export const Invitation = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

export const Grant = Schema.Struct({
  participantId: Schema.String,
  sessionId: Schema.String,
});

export const grantParticipant = (
  grants: ReadonlyArray<typeof Grant.Type>,
  sessionId: string,
) => grants.find((g) => g.sessionId === sessionId)?.participantId;

export const sameSecret = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let mismatch = 0;

  for (let i = 0; i < a.length; i++)
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);

  return mismatch === 0;
};
