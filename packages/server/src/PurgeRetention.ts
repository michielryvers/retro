import * as Effect from "effect/Effect";
import { deletionDue } from "@retro/domain/Room/Retention";

type Retained = { readonly participants: ReadonlyArray<string>; readonly retained: true };

// Call inside the aggregate's exclusive purge operation, after authorization.
// Supplying an Effect keeps the physical storage operation lazy until allowed.
export const purgeWithRetention = <A, E, R>(
  room: Parameters<typeof deletionDue>[0] | null,
  automatic: boolean,
  alreadyStarted: boolean,
  purge: Effect.Effect<A, E, R>,
) => Effect.suspend((): Effect.Effect<A | Retained, E, R> => automatic && !alreadyStarted && (!room || !deletionDue(room, Date.now()))
  ? Effect.succeed({ participants: [], retained: true })
  : purge);
