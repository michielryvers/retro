import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Note } from "./Values.ts";

export class NotesUncombined extends Domain.Event("NotesUncombined", {
  source: Note,
  target: Note,
  order: Schema.Array(Schema.String),
  canUndoCombine: Schema.Boolean,
}) {}
