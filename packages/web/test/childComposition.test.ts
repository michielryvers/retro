import { Enter, EntryBlock } from "../src/features/Entry.ts";
import { EnterRoomViewport } from "../src/application/command.ts";
import { Load } from "../src/features/Notes.ts";
import { view } from "../src/application/view.ts";
import { it } from "vitest";
import { Scene } from "foldkit";
import { ApplicationBlock } from "../src/block.ts";
import { ApplicationComposition } from "../src/application/composition.ts";
import { subscriptions } from "../src/application/subscription.ts";
import { Message } from "../src/application/definition.ts";
import { NotesBlock, Persist } from "../src/features/Notes.ts";
import {
  ActionEditorBlock,
  FocusAction,
} from "../src/features/ActionEditor.ts";
import { emptyBoard } from "@retro/domain/Room/Values";

const base = () => ({
  ...ApplicationBlock.init({
    actorId: "host",
    roomId: "room",
    participantId: "",
    inviteToken: "",
    name: "Host",
  }).model,
  entered: true,
  connected: true,
  board: {
    ...emptyBoard,
    title: "Block composition",
    phase: "write" as const,
    adminId: "host",
    participants: [{ id: "host", name: "Host", ready: false }],
    notes: [
      {
        id: "note",
        authorId: "host",
        column: "mad",
        text: "Make releases easier",
      },
    ],
  },
});

const config = {
  update: ApplicationBlock.update,
  view,
  subscriptions: Scene.subscriptions(ApplicationComposition, subscriptions),
};

it("routes composer events, reciprocal category operations, and local commands through the registered graph", () => {
  Scene.scene(
    config,
    Scene.given(base()),
    Scene.type(Scene.label("Your Mad note"), "Mad draft"),
    Scene.Command.resolve(Persist, NotesBlock.Message.Persisted()),
    Scene.click(Scene.role("button", { name: /Sad/ })),
    Scene.expect(Scene.label("Your Sad note")).toHaveValue(""),
    Scene.type(Scene.label("Your Sad note"), "Sad draft"),
    Scene.Command.resolve(Persist, NotesBlock.Message.Persisted()),
    Scene.click(Scene.role("button", { name: /Mad/ })),
    Scene.expect(Scene.label("Your Mad note")).toHaveValue("Mad draft"),
    Scene.Subscription.emit(
      subscriptions.board,
      Message.Board({ board: { ...base().board, phase: "closed" } }),
    ),
    Scene.Command.resolve(Persist, NotesBlock.Message.Persisted()),
    Scene.expect(Scene.label("Your Mad note")).toBeAbsent(),
  );
});

it("closes an action editor immediately when facilitator permission is lost", () => {
  const m = {
    ...base(),
    board: { ...base().board, phase: "actions" as const },
  };

  Scene.scene(
    config,
    Scene.given(m),
    Scene.click(Scene.role("button", { name: "Add action" })),
    Scene.Command.resolve(
      FocusAction,
      ActionEditorBlock.Message.Focused({ text: "" }),
    ),
    Scene.type(Scene.label("What will we do?"), "Unsaved plan"),
    Scene.expect(
      Scene.role("button", { name: "Close retrospective" }),
    ).toBeDisabled(),
    Scene.Subscription.emit(
      subscriptions.board,
      Message.Board({ board: { ...m.board, adminId: "guest" } }),
    ),
    Scene.expect(Scene.label("What will we do?")).toBeAbsent(),
    Scene.expect(Scene.role("button", { name: "Add action" })).toBeAbsent(),
  );
});

it("routes nested password/format Blocks and retires entry after a successful join", () => {
  const flags = {
    actorId: "host",
    roomId: "",
    participantId: "",
    inviteToken: "",
    name: "",
  };

  const board = {
    ...base().board,
    template: "start-stop-continue" as const,
    grants: [{ sessionId: "host", participantId: "host" }],
  };

  Scene.scene(
    config,
    Scene.given(ApplicationBlock.init(flags).model),
    Scene.type(Scene.label("Room name"), "Team retro"),
    Scene.type(Scene.label("Your name"), "Host"),
    Scene.type(Scene.label("Room password"), "abc"),
    Scene.click(Scene.role("button", { name: "Show password" })),
    Scene.expect(Scene.label("Room password")).toHaveAttr("type", "text"),
    Scene.change(
      Scene.selector('input[value="start-stop-continue"]'),
      "start-stop-continue",
    ),
    Scene.submit(Scene.selector(".entry-form")),
    Scene.Command.expectHas(
      Enter({
        roomId: "",
        title: "Team retro",
        name: "Host",
        template: "start-stop-continue",
        password: "abc",
        participantId: "",
        token: "",
      }),
    ),
    Scene.Command.resolve(
      Enter,
      EntryBlock.Message.Entered({ roomId: "room", board, links: [] }),
    ),
    Scene.Command.resolve(EnterRoomViewport, Message.Notify({ text: "" })),
    Scene.Command.resolve(
      Load,
      NotesBlock.Message.Loaded({ drafts: {}, draftIds: {}, revision: 0 }),
    ),
    Scene.expect(Scene.label("Room password")).toBeAbsent(),
    Scene.expect(Scene.label("Your Start note")).toExist(),
  );
});
