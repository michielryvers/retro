import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";
import { TallyChanged } from "./TallyChanged.event.ts";

export class NoteDeleted extends Domain.Event("NoteDeleted", {
  id: Schema.String,
  authorId: Schema.String,
}) {}

export class DeleteNote extends Domain.Command("DeleteNote", {
  target: RoomId,
  middleware: [Session],
  input: { id: Schema.String },
  events: [NoteDeleted, TallyChanged],
  rejects: [Refused],
}) {}
