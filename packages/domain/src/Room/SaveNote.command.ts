import { TallyChanged } from "./TallyChanged.event.ts";
import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Column, Note } from "./Values.ts";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class NoteSaved extends Domain.Event("NoteSaved", { note: Note }) {}

export class SaveNote extends Domain.Command("SaveNote", {
  target: RoomId,
  middleware: [Session],
  input: { id: Schema.String, column: Column, text: Schema.String },
  events: [NoteSaved, TallyChanged],
  rejects: [Refused],
}) {}
