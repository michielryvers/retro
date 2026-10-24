import * as Schema from "effect/Schema";
import { Note, NotePart } from "./Values.ts";

// Original notes remain immutable after Reveal. Replaying these edges recovers
// the visible groups without keeping copies of their text at every merge.
export const Combination = Schema.Struct({
  sourceId: Schema.String,
  targetId: Schema.String,
});

export const combinedNotes = (
  originals: ReadonlyArray<typeof NotePart.Type>,
  combinations: ReadonlyArray<typeof Combination.Type>,
): ReadonlyArray<typeof Note.Type> => {
  const groups = new Map(originals.map((note) => [note.id, [note]]));

  for (const { sourceId, targetId } of combinations) {
    groups.set(targetId, [...groups.get(targetId)!, ...groups.get(sourceId)!]);
    groups.delete(sourceId);
  }

  return [...groups.values()].map((parts) =>
    parts.length === 1
      ? parts[0]!
      : { ...parts[0]!, parts, text: parts.map((n) => n.text).join("\n\n—\n\n") },
  );
};

export const restoreCombination = (
  current: ReadonlyArray<typeof Note.Type>,
  restored: { source: typeof Note.Type; target: typeof Note.Type },
  order: ReadonlyArray<string>,
) =>
  [...current.filter((n) => n.id !== restored.target.id), restored.source, restored.target].sort(
    (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
  );
