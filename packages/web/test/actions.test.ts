import { describe, expect, it } from "vitest";
import { init } from "../src/application/init.ts";
import { Message } from "../src/application/definition.ts";
import { update } from "../src/application/update.ts";
import { emptyBoard } from "@retro/domain/Room/Values";

const base = () => ({
  ...init({
    actorId: "host",
    roomId: "room",
    participantId: "",
    inviteToken: "",
    name: "Host",
  }).model,
  entered: true,
  board: {
    ...emptyBoard,
    adminId: "host",
    phase: "actions" as const,
    actions: [
      {
        id: "action",
        noteId: "note",
        text: "Original",
        ownerId: "guest",
        dueDate: "2026-11-01",
        done: false,
      },
    ],
  },
});

describe("action editing", () => {
  it("loads existing fields and saves using the same action id", () => {
    const editing = update(base(), Message.EditAction({ id: "action" })).model;
    expect(editing).toMatchObject({
      selected: "note",
      actionId: "action",
      action: "Original",
      owner: "guest",
      due: "2026-11-01",
    });

    const saving = update(
      editing,
      Message.Run({ op: "action", id: "", selected: false }),
    );

    expect(saving.commands?.[0]?.args).toMatchObject({
      id: "action",
      noteId: "note",
    });
    const cancelled = update(editing, Message.Select({ id: "" })).model;
    expect(cancelled).toMatchObject({ actionId: "", action: "", selected: "" });
    expect(cancelled.board?.actions[0]?.text).toBe("Original");
  });
  it("rejects participant action controls and forged mutations", () => {
    const guest = { ...base(), actorId: "guest" };

    for (const message of [
      Message.Select({ id: "note" }),
      Message.EditAction({ id: "action" }),
      Message.Run({ op: "action", id: "", selected: false }),
      Message.Run({ op: "deleteAction", id: "action", selected: false }),
    ]) {
      expect(update(guest, message).commands).toBeUndefined();
    }
  });
});

it("retries a new action using the same id after a lost acknowledgement", () => {
  const first = update(
    { ...base(), selected: "note", action: "Follow up" },
    Message.Run({ op: "action", id: "", selected: false }),
  );

  const failed = update(
    first.model,
    Message.Failed({ reason: "Connection lost" }),
  ).model;

  const retry = update(
    failed,
    Message.Run({ op: "action", id: "", selected: false }),
  );

  expect(retry.commands?.[0]?.args?.id).toBe(first.commands?.[0]?.args?.id);
  expect(retry.commands?.[0]?.args?.id).toBeTruthy();
  expect(
    update(retry.model, Message.Succeeded({ op: "action" })).model
      .actionDraftId,
  ).toBe("");
});

it("filters to actions from a different mobile category without changing room data", () => {
  const model = base();
  model.board.notes = [
    { id: "plain", column: "mad", text: "Plain note", authorId: "host" },
    { id: "note", column: "glad", text: "With action", authorId: "host" },
  ];
  const filtered = update(model, Message.ToggleActions()).model;
  expect(filtered.actionsOnly).toBe(true);
  expect(filtered.mobileColumn).toBe("glad");
  expect(filtered.board).toBe(model.board);
  expect(update(filtered, Message.ToggleActions()).model.actionsOnly).toBe(
    false,
  );
  const editing = update(model, Message.EditAction({ id: "action" })).model;
  expect(update(editing, Message.ToggleActions()).model).toBe(editing);
});
