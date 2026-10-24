import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";
import { Template } from "./Templates.ts";

export class RoomCreated extends Domain.Event("RoomCreated", {
  title: Schema.String,
  template: Template,
  adminId: Schema.String,
  name: Schema.String,
  sessionId: Schema.String,
  inviteSeed: Schema.Redacted(Schema.String),
  passwordSalt: Schema.String,
  passwordHash: Schema.Redacted(Schema.String),
}) {}

export class CreateRoom extends Domain.Command("CreateRoom", {
  target: RoomId,
  middleware: [Session],
  input: {
    password: Schema.Redacted(Schema.String),
    title: Schema.String,
    name: Schema.String,
    template: Template,
  },
  events: [RoomCreated],
  rejects: [Refused],
}) {}
