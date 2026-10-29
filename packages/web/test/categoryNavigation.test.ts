import { expect, it } from "vitest";
import { NotesBlock } from "../src/features/Notes.ts";
import { NavigationBlock } from "../src/features/Navigation.ts";
import { emptyBoard } from "@retro/domain/Room/Values";
import {
  templates,
  columnsFor,
  type Template,
} from "@retro/domain/Room/Templates";

const context = (column = "mad") => ({
  roomId: "room",
  actorId: "host",
  board: { ...emptyBoard, phase: "write" as const },
  column,
  busy: false,
});

const { Message } = NotesBlock;

const update = (
  m: typeof NotesBlock.Model.Type,
  msg: typeof Message.Type,
  column = "mad",
) => NotesBlock.update(m, msg, context(column));

it("keeps a separate draft in each category, including after saving another", () => {
  let m = update(
    NotesBlock.init().model,
    Message.Changed({ value: "Mad draft" }),
  ).model;

  m = update(m, Message.InformedOfColumn({ column: "sad" })).model;
  expect(m.draft).toBe("");
  m = update(m, Message.Changed({ value: "Sad draft" }), "sad").model;
  m = update(m, Message.InformedOfColumn({ column: "mad" })).model;
  expect(m.draft).toBe("Mad draft");
  m = update(m, Message.Saved()).model;
  expect(m.drafts).toEqual({ mad: "", sad: "Sad draft" });
  expect(
    update(m, Message.InformedOfColumn({ column: "sad" })).model.draft,
  ).toBe("Sad draft");
});

it("keeps a new draft separate from an existing note's edit or deletion", () => {
  const draft = update(
    NotesBlock.init().model,
    Message.Changed({ value: "Unfinished" }),
  ).model;

  const edit = update(
    draft,
    Message.Edit({ column: "mad", id: "existing", text: "Saved note" }),
  ).model;

  const typed = update(edit, Message.Changed({ value: "Edited" })).model;
  expect(typed.drafts.mad).toBe("Unfinished");

  for (const message of [Message.Cancel(), Message.Saved()])
    expect(update(typed, message).model.draft).toBe("Unfinished");
  expect(update(draft, Message.Cancel()).model.drafts.mad).toBe("");
});

it("blocks category changes during edits and saves", () => {
  const m = NavigationBlock.init().model;

  const c = {
    board: emptyBoard,
    private: { notes: [], votes: [], sessions: [] },
    busy: false,
    editingAction: false,
    editingNote: null,
  };

  for (const change of [
    { editingAction: true },
    { editingNote: "mad" },
    { busy: true },
  ])
    expect(
      NavigationBlock.update(
        m,
        NavigationBlock.Message.MobileColumn({ column: "sad" }),
        { ...c, ...change },
      ).model.mobileColumn,
    ).toBe("mad");
});

it("does not accept typing while saving or after writing closes", () => {
  const m = { ...NotesBlock.init().model, busy: true, draft: "Saving" };
  expect(update(m, Message.Changed({ value: "Race" })).model).toBe(m);
  expect(
    NotesBlock.update(
      { ...m, busy: false },
      Message.Changed({ value: "Late" }),
      { ...context(), board: { ...emptyBoard, phase: "reveal" } },
    ).model.draft,
  ).toBe("Saving");
});

// SAFETY: templates is the exhaustive registry keyed by Template literals.
for (const template of Object.keys(templates) as Template[])
  it(`isolates ${template} drafts`, () => {
    let m: typeof NotesBlock.Model.Type = NotesBlock.init().model;

    for (const column of columnsFor(template)) {
      m = update(m, Message.InformedOfColumn({ column: column.id })).model;
      m = update(m, Message.Changed({ value: column.title }), column.id).model;
    }

    for (const column of columnsFor(template))
      expect(
        update(m, Message.InformedOfColumn({ column: column.id })).model.draft,
      ).toBe(column.title);
  });
