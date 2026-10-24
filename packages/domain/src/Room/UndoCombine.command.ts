import * as Domain from "@alchemy.run/domain";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";
import { NotesUncombined } from "./NotesUncombined.event.ts";

export class UndoCombine extends Domain.Command("UndoCombine", {
  target: RoomId,
  middleware: [Session],
  rejects: [Refused],
  events: [NotesUncombined],
  input: {},
}) {}
