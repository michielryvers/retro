import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Note } from "./Values.ts";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class NotesRevealed extends Domain.Event("NotesRevealed", {
  notes: Schema.Array(Note),
}) {}

export class RevealNotes extends Domain.Command("RevealNotes", {
  target: RoomId,
  middleware: [Session],
  input: {},
  events: [NotesRevealed],
  rejects: [Refused],
}) {}
