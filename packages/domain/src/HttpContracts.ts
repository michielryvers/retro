import * as Schema from "effect/Schema";
import { Template } from "./Room/Templates.ts";

export const SessionResponse = Schema.Struct({ id: Schema.String });

export const DeleteRequest = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
});

export const DeleteResponse = Schema.Struct({ deleted: Schema.Literal(true) });
export const ErrorResponse = Schema.Struct({ error: Schema.String });

export const RoomSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  template: Template,
  phase: Schema.String,
  participants: Schema.Int,
  notes: Schema.Int,
  actions: Schema.Int,
  createdAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.NullOr(Schema.Number),
});

export type RoomSummary = typeof RoomSummary.Type;

export const RoomSummaries = Schema.Array(RoomSummary);

export type AdminResponse =
  | typeof RoomSummaries.Type
  | typeof DeleteResponse.Type
  | typeof ErrorResponse.Type;

export const InvitationPreviewRequest = Schema.Struct({
  roomId: Schema.String,
  participantId: Schema.String,
  token: Schema.String,
});

export const InvitationPreview = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
});
