import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Action } from "./Values.ts";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class ActionAssigned extends Domain.Event("ActionAssigned", {
  action: Action,
}) {}

export class SaveAction extends Domain.Command("SaveAction", {
  target: RoomId,
  middleware: [Session],
  input: {
    id: Schema.String,
    noteId: Schema.String,
    text: Schema.String,
    ownerId: Schema.String,
    dueDate: Schema.String,
  },
  events: [ActionAssigned],
  rejects: [Refused],
}) {}
