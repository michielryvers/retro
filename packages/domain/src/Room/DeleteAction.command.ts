import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class ActionDeleted extends Domain.Event("ActionDeleted", {
  id: Schema.String,
}) {}

export class DeleteAction extends Domain.Command("DeleteAction", {
  target: RoomId,
  middleware: [Session],
  input: { id: Schema.String },
  events: [ActionDeleted],
  rejects: [Refused],
}) {}
