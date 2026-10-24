import { expect, it } from "vitest";
import { init, Message, update } from "../src/App.ts";

const base = () =>
  init({
    actorId: "host",
    roomId: "room",
    participantId: "",
    inviteToken: "",
    name: "Host",
  }).model;

it("keeps a separate draft in each category", () => {
  const mad = update(
    base(),
    Message.Field({ field: "draft", value: "Mad draft" }),
  ).model;

  const sad = update(mad, Message.MobileColumn({ column: "sad" })).model;
  expect(sad).toMatchObject({
    mobileColumn: "sad",
    categoryDirection: "next",
    draft: "",
  });

  const typed = update(
    sad,
    Message.Field({ field: "draft", value: "Sad draft" }),
  ).model;

  const back = update(typed, Message.MobileColumn({ column: "mad" })).model;
  expect(back).toMatchObject({
    categoryDirection: "previous",
    draft: "Mad draft",
  });
  const saved = update(back, Message.Succeeded({ op: "save" })).model;
  expect(saved.drafts).toEqual({ mad: "", sad: "Sad draft" });
  expect(
    update(saved, Message.MobileColumn({ column: "sad" })).model.draft,
  ).toBe("Sad draft");
});

it("keeps new-note drafts separate from editing or deleting existing notes", () => {
  const draft = update(
    base(),
    Message.Field({ field: "draft", value: "Unfinished new note" }),
  ).model;

  const edit = update(
    draft,
    Message.Edit({ column: "mad", id: "existing", text: "Saved note" }),
  ).model;

  const typed = update(
    edit,
    Message.Field({ field: "draft", value: "Edited note" }),
  ).model;

  expect(typed.drafts.mad).toBe("Unfinished new note");

  for (const message of [
    Message.CancelEdit(),
    Message.Succeeded({ op: "save" }),
    Message.Succeeded({ op: "delete" }),
  ]) {
    expect(update(typed, message).model.draft).toBe("Unfinished new note");
  }

  expect(update(draft, Message.CancelEdit()).model.drafts.mad).toBe("");
});

it("keeps note edits and action forms in their current category", () => {
  for (const model of [
    { ...base(), editId: "note", editor: "mad" as const },
    { ...base(), selected: "note", action: "Draft action" },
  ]) {
    expect(
      update(model, Message.MobileColumn({ column: "sad" })).model.mobileColumn,
    ).toBe("mad");
  }
});

it("does not accept typing while a save is pending", () => {
  const model = { ...base(), busy: true, draft: "Being saved" };
  expect(
    update(model, Message.Field({ field: "draft", value: "Racing input" }))
      .model.draft,
  ).toBe("Being saved");
});

import { emptyBoard } from "@retro/domain/Room/Values";
import { templates, columnsFor, type Template } from "@retro/domain/Room/Templates";

// SAFETY: templates is the exhaustive registry keyed by the Template literals.
for (const template of Object.keys(templates) as Template[]) {
  it(`opens ${template} at its first category and isolates drafts`, () => {
    const columns = columnsFor(template);
    let model = update(base(), Message.Entered({ roomId: "room", board: { ...emptyBoard, template } })).model;
    expect(model.mobileColumn).toBe(columns[0]!.id);

    for (const column of columns) {
      model = update(model, Message.MobileColumn({ column: column.id })).model;
      expect(model.draft).toBe("");
      model = update(model, Message.Field({ field: "draft", value: column.title })).model;
    }

    for (const column of columns) {
      model = update(model, Message.MobileColumn({ column: column.id })).model;
      expect(model.draft).toBe(column.title);
    }
  });
}
