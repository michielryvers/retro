import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class VotingProgressChanged extends Domain.Event("VotingProgressChanged", {
  voters: Schema.Array(Schema.String),
}) {}
