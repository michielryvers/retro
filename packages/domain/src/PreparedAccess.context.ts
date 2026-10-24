import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

// Server-generated evidence travels with the command into its Durable Object.
// The aggregate compares it against its current state before granting access.
export class PreparedAccess extends Domain.RequestContext<PreparedAccess>()(
  "Retro/PreparedAccess",
  Schema.Struct({
    id: Schema.String,
    seed: Schema.Redacted(Schema.String),
    salt: Schema.String,
    hash: Schema.Redacted(Schema.String),
    validToken: Schema.Boolean,
  }),
) {}
