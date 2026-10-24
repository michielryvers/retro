import * as Schema from "effect/Schema";

export const RoomId = Schema.String.pipe(Schema.brand("RoomId"));

export type RoomId = typeof RoomId.Type;
