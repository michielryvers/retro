import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

// Old scheduled commands may execute before the current deadline. Commit a
// durable replacement request instead of silently losing the future timer.
export class RoomRetentionScheduled extends Domain.Event("RoomRetentionScheduled", {
  operation: Schema.Literals(["close", "delete"]),
  at: Schema.Number,
}) {}
