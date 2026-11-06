import * as Schema from "effect/Schema";

// Portable content, independent of sessions, projections and Alchemy storage.
const Person = Schema.Struct({ id: Schema.String, name: Schema.String });

const Note = Schema.Struct({
  id: Schema.String,
  column: Schema.String,
  text: Schema.String,
  authorId: Schema.String,
});

const Action = Schema.Struct({
  id: Schema.String,
  noteId: Schema.String,
  text: Schema.String,
  ownerId: Schema.String,
  dueDate: Schema.String,
});

export const RetroArchive = Schema.Struct({
  format: Schema.Literal("retro-archive"),
  version: Schema.Literal(1),
  sourceRoomId: Schema.String,
  title: Schema.String,
  createdAt: Schema.Number,
  closedAt: Schema.Number,
  template: Schema.String,
  columns: Schema.Array(
    Schema.Struct({ id: Schema.String, title: Schema.String }),
  ),
  facilitatorId: Schema.String,
  participants: Schema.Array(Person),
  notes: Schema.Array(Note),
  combinations: Schema.Array(
    Schema.Struct({ sourceId: Schema.String, targetId: Schema.String }),
  ),
  votes: Schema.Array(
    Schema.Struct({ participantId: Schema.String, noteId: Schema.String }),
  ),
  voters: Schema.Array(Schema.String),
  voteLimit: Schema.Int,
  actions: Schema.Array(Action),
});

export type RetroArchive = typeof RetroArchive.Type;

export const ARCHIVE_MAX_BYTES = 1_800_000;

// This is the shared untrusted-file / RPC decoding boundary.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
export function decodeArchive(input: unknown): RetroArchive {
  const data = Schema.decodeUnknownSync(RetroArchive)(input, {
    onExcessProperty: "error",
  });

  const fail = () => {
    throw new Error("Invalid retro archive: inconsistent content.");
  };

  const unique = (values: ReadonlyArray<string>) => {
    if (values.some((v) => !v.trim()) || new Set(values).size !== values.length)
      fail();

    return new Set(values);
  };

  if (
    new TextEncoder().encode(JSON.stringify(data)).byteLength >
    ARCHIVE_MAX_BYTES
  )
    fail();

  if (
    !data.title.trim() ||
    !data.sourceRoomId.trim() ||
    !Number.isSafeInteger(data.createdAt) ||
    !Number.isSafeInteger(data.closedAt) ||
    data.createdAt <= 0 ||
    data.closedAt < data.createdAt ||
    data.voteLimit < 1
  )
    fail();
  const people = unique(data.participants.map((p) => p.id));
  const columns = unique(data.columns.map((c) => c.id));
  const notes = unique(data.notes.map((n) => n.id));
  unique(data.actions.map((a) => a.id));
  unique(data.voters);

  if (
    !people.has(data.facilitatorId) ||
    !columns.size ||
    data.participants.some((p) => !p.name.trim()) ||
    data.columns.some((c) => !c.title.trim())
  )
    fail();

  if (
    data.notes.some(
      (n) =>
        !people.has(n.authorId) || !columns.has(n.column) || !n.text.trim(),
    )
  )
    fail();
  // A group edge consumes a visible source. This rejects cycles, missing notes
  // and double merges before any archive is written.
  const visible = new Set(notes);

  for (const edge of data.combinations) {
    if (
      edge.sourceId === edge.targetId ||
      !visible.has(edge.sourceId) ||
      !visible.has(edge.targetId)
    )
      fail();
    visible.delete(edge.sourceId);
  }

  if (
    data.votes.some(
      (v) => !people.has(v.participantId) || !visible.has(v.noteId),
    ) ||
    data.voters.some((id) => !people.has(id))
  )
    fail();

  const votesByPerson = new Map<string, number>();

  for (const vote of data.votes) {
    const count = (votesByPerson.get(vote.participantId) ?? 0) + 1;

    if (count > data.voteLimit) fail();
    votesByPerson.set(vote.participantId, count);
  }

  if (
    data.actions.some(
      (a) =>
        !visible.has(a.noteId) ||
        (a.ownerId !== "" && !people.has(a.ownerId)) ||
        !a.text.trim() ||
        (a.dueDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)),
    )
  )
    fail();

  return data;
}
