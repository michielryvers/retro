import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";
import { NotesUncombined } from "./NotesUncombined.event.ts";

export class SplitNote extends Domain.Command("SplitNote", {
  target: RoomId,
  middleware: [Session],
  rejects: [Refused],
  events: [NotesUncombined],
  input: { noteId: Schema.String },
}) {}
