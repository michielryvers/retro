import { Block } from "foldkit";
import { ApplicationComposition } from "./application/composition.ts";
import { EffectsLayer } from "./application/effects.ts";
import { Model } from "./application/definition.ts";
import { init } from "./application/init.ts";
import { subscriptions } from "./application/subscription.ts";
import { view } from "./application/view.ts";
import { update } from "./application/update.ts";

const prepare = () =>
  ApplicationComposition.prepareBlock({
    init,
    update,
    view,
    subscriptions,
    EffectsLayer,
  });

export const ApplicationBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
