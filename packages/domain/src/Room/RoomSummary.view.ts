import * as Predicate from "effect/Predicate";
import * as Match from "effect/Match";
import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { Room } from "./Room.aggregate.ts";
import { RoomSummary as Summary } from "../HttpContracts.ts";

// Read aggregate events directly: do not retain full-board snapshots as inputs.
// IDs distinguish an action edit from a new action without storing its content.
export class RoomSummary extends Domain.View("RoomSummary", {
  from: [Room],
  key: Room,
  state: Schema.NullOr(Schema.Struct({ ...Summary.fields, actionIds: Schema.Array(Schema.String) })),
  initial: null,
  events: [],
  evolve: {
    RetroRoom: (s, e, { source, at }) => {
      const now = DateTime.toEpochMillis(at);

      if (Predicate.isTagged(e, "RoomCreated")) return {
        id: source.id, title: e.title, template: e.template, phase: "write",
        participants: 1, notes: 0, actions: 0, actionIds: [], createdAt: now, updatedAt: now,
      };

      if (!s) return s;
      const next = { ...s, updatedAt: now };

      return Match.value(e).pipe(
        Match.tag("ParticipantJoined", () => ({ ...next, participants: s.participants + 1 })),
        Match.tag("TallyChanged", (e) => ({ ...next, notes: Object.values(e.tally).reduce((sum, count) => sum + count, 0) })),
        Match.tag("NotesRevealed", () => ({ ...next, phase: "reveal" })),
        Match.tag("NotesCombined", () => ({ ...next, notes: s.notes - 1 })),
        Match.tag("NotesUncombined", () => ({ ...next, notes: s.notes + 1 })),
        Match.tag("VotingStarted", () => ({ ...next, phase: "vote" })),
        Match.tag("VotingFinished", () => ({ ...next, phase: "actions" })),
        Match.tag("RoomClosed", () => ({ ...next, phase: "closed" })),
        Match.tag("ActionAssigned", (e) => {
          const actionIds = [...s.actionIds.filter((id) => id !== e.action.id), e.action.id];

          return { ...next, actionIds, actions: actionIds.length };
        }),

        Match.tag("ActionDeleted", (e) => {
          const actionIds = s.actionIds.filter((id) => id !== e.id);

          return { ...next, actionIds, actions: actionIds.length };
        }),

        Match.orElse(() => next),
      );
    },
  },
  emit: { RetroRoom: () => undefined },
}) {}
