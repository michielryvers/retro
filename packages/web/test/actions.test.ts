import { ActionEditorBlock } from "../src/features/ActionEditor.ts";

const { Message } = ActionEditorBlock;

const context = () => ({
  roomId: "room",
  actorId: "host",
  board: base().board,
  busy: false,
});

const update = (
  m: typeof ActionEditorBlock.Model.Type,
  msg: typeof Message.Type,
) => ActionEditorBlock.update(m, msg, context());

import { describe, expect, it } from "vitest";
import { init } from "../src/application/init.ts";


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
    const editing = update(
      ActionEditorBlock.init().model,
      Message.Edit({ id: "action" }),
    ).model;

    expect(editing).toMatchObject({
      selected: "note",
      actionId: "action",
      action: "Original",
      owner: "guest",
      due: "2026-11-01",
    });

    const saving = update(editing, Message.Save());

    expect(saving.commands?.[0]?.args).toMatchObject({
      id: "action",
      noteId: "note",
    });
    const cancelled = update(editing, Message.Cancel()).model;
    expect(cancelled).toMatchObject({ actionId: "", action: "", selected: "" });
  });
  it("rejects participant action controls and forged mutations", () => {
    const guest = { ...base(), actorId: "guest" };

    for (const message of [
      Message.Add({ id: "note" }),
      Message.Edit({ id: "action" }),
      Message.Save(),
      Message.Delete({ id: "action" }),
    ]) {
      expect(
        ActionEditorBlock.update(ActionEditorBlock.init().model, message, {
          ...context(),
          actorId: guest.actorId,
        }).commands,
      ).toBeUndefined();
    }
  });
});

it("retries a new action using the same id after a lost acknowledgement", () => {
  const first = update(
    {
      ...ActionEditorBlock.init().model,
      selected: "note",
      action: "Follow up",
      actionDraftId: "draft-action",
    },
    Message.Save(),
  );

  const failed = update(
    first.model,
    Message.Failed({ reason: "Connection lost" }),
  ).model;

  const retry = update(failed, Message.Save());

  expect(retry.commands?.[0]?.args?.id).toBe(first.commands?.[0]?.args?.id);
  expect(retry.commands?.[0]?.args?.id).toBeTruthy();
  expect(update(retry.model, Message.Saved()).model.actionDraftId).toBe("");
});
