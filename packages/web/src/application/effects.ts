import * as Layer from "effect/Layer";
import { Resume, EnterRoomViewport, FocusControl } from "./command.ts";
import { subscriptions } from "./subscription.ts";

export const EffectsLayer = Layer.mergeAll(
  Resume.layer,
  EnterRoomViewport.layer,
  FocusControl.layer,
  subscriptions.layer,
);
