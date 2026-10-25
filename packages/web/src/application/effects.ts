import * as Layer from "effect/Layer";
import {
  Enter,
  LoadPreview,
  Resume,
  Facilitate,
  Combine,
  Mutate,
  EnterRoomViewport,
  FocusMerge,
  FocusControl,
  FocusAction,
  LoadInvitations,
  Copy,
  DeleteRetro,
  Export,
} from "./command.ts";
import { subscriptions } from "./subscription.ts";

export const EffectsLayer = Layer.mergeAll(
  Enter.layer,
  LoadPreview.layer,
  Resume.layer,
  Facilitate.layer,
  Combine.layer,
  Mutate.layer,
  EnterRoomViewport.layer,
  FocusMerge.layer,
  FocusControl.layer,
  FocusAction.layer,
  LoadInvitations.layer,
  Copy.layer,
  DeleteRetro.layer,
  Export.layer,
  subscriptions.layer,
);
