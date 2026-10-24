import { PreparedAccess } from "./PreparedAccess.context.ts";
import { Refused } from "./Room/Refused.rejection.ts";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Schema from "effect/Schema";
import { CurrentActor } from "./CurrentActor.context.ts";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
) {}

export class Session extends RpcMiddleware.Service<
  Session,
  { provides: CurrentActor | PreparedAccess }
>()("Retro/Session", { error: Schema.Union([Unauthorized, Refused]) }) {}
