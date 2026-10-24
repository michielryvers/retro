import * as Effect from "effect/Effect";
import { RoomCleanup } from "@retro/domain/Room/RoomCleanup.external";
import { RoomSummary } from "@retro/domain/Room/RoomSummary.view";
import { administration } from "./Admin.ts";

export const RoomCleanupLive = RoomCleanup.toLayer(
  Effect.gen(function* () {
    const summaries = yield* RoomSummary;
    // Cloudflare bindings exist at invocation time, not during Alchemy planning.
    const admin = administration.pipe(Effect.provideService(RoomSummary, summaries));

    return { remove: ({ id, title }) => admin.pipe(
      Effect.flatMap((service) => service.remove(id, title)),
      Effect.orDie,
    ) };
  }),
);
