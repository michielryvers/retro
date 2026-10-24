import * as Redacted from "effect/Redacted";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Room } from "./Room.aggregate.ts";
import { Session } from "../Session.middleware.ts";
import { CurrentActor } from "../CurrentActor.context.ts";
import { Refused } from "./Refused.rejection.ts";
import { Invitation, Grant, grantParticipant } from "./Access.ts";

export const InvitationState = Schema.Struct({
  adminId: Schema.String,
  seed: Schema.Redacted(Schema.String),
  people: Schema.Array(Invitation),
  grants: Schema.Array(Grant),
});

// Administrative secrets never enter the shared board or its event history.
// This view is fetched on demand; it emits no stream events.
export class Invitations extends Domain.View("Invitations", {
  from: [Room],
  key: Room,
  state: InvitationState,
  initial: { adminId: "", seed: Redacted.make(""), people: [], grants: [] },
  middleware: [Session],
  rejects: [Refused],
  events: [],
  validate: Effect.fn(function* (_request, s) {
    const actor = yield* CurrentActor;

    if (!s?.adminId || grantParticipant(s.grants, actor.id) !== s.adminId)
      return yield* new Refused({
        reason: "Only the facilitator can manage invitations.",
      });
  }),
  evolve: {
    RoomCreated: (_s, e) => ({
      adminId: e.adminId,
      seed: e.inviteSeed,
      people: [{ id: e.adminId, name: e.name }],
      grants: [{ participantId: e.adminId, sessionId: e.sessionId }],
    }),
    ParticipantInvited: (s, e) => ({
      ...s,
      people: [...s.people, { id: e.id, name: e.name }],
    }),
    SessionGranted: (s, e) => ({
      ...s,
      grants: [
        ...s.grants,
        { participantId: e.participantId, sessionId: e.sessionId },
      ],
    }),
    FacilitatorChanged: (s, e) => ({ ...s, adminId: e.adminId }),
  },
  emit: { RetroRoom: () => undefined },
}) {}
