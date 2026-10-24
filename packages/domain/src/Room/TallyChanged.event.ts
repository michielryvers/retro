import * as Domain from "@alchemy.run/domain";
import { Tally } from "./Values.ts";

export class TallyChanged extends Domain.Event("TallyChanged", {
  tally: Tally,
}) {}
