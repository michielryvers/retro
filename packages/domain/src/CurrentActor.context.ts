import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class CurrentActor extends Domain.RequestContext<CurrentActor>()(
  "Retro/CurrentActor",
  Schema.Struct({ id: Schema.String }),
) {}
