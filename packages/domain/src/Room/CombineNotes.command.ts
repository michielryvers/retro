import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Note } from "./Values.ts";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class NotesCombined extends Domain.Event("NotesCombined", {
  sourceId: Schema.String,
  targetId: Schema.String,
  note: Note,
}) {}

export class CombineNotes extends Domain.Command("CombineNotes", {
  target: RoomId,
  middleware: [Session],
  input: { sourceId: Schema.String, targetId: Schema.String },
  events: [NotesCombined],
  rejects: [Refused],
}) {}

export const combineBoard = (
  notes: ReadonlyArray<typeof Note.Type>,
  e: NotesCombined,
) =>
  notes.flatMap((n) =>
    n.id === e.sourceId ? [] : [n.id === e.targetId ? e.note : n],
  );
