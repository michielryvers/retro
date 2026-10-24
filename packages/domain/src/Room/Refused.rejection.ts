import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class Refused extends Domain.Rejection("Refused", {
  reason: Schema.String,
}) {}
