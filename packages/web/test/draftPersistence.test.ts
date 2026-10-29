import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { NotesBlock, Load, Persist } from "../src/features/Notes.ts";
import { emptyBoard } from "@retro/domain/Room/Values";

const { Message } = NotesBlock;

const context = {
  roomId: "room",
  actorId: "host",
  board: { ...emptyBoard, phase: "write" as const },
  column: "mad",
  busy: false,
};

let stored: Record<string, string>;

beforeEach(() => {
  stored = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored[k] ?? null,
    setItem: (k: string, v: string) => {
      stored[k] = v;
    },
    removeItem: (k: string) => {
      delete stored[k];
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

const persist = (model: typeof NotesBlock.Model.Type) =>
  Effect.runPromise(
    Persist({
      roomId: "room",
      actorId: "host",
      drafts: model.drafts,
      draftIds: model.draftIds,
    }).effect.pipe(Effect.provide(Persist.layer)),
  );

const load = (roomId = "room", actorId = "host") =>
  Effect.runPromise(
    Load({ roomId, actorId, revision: 0 }).effect.pipe(
      Effect.provide(Load.layer),
    ),
  );

it("restores categories and stable ids scoped to room and participant", async () => {
  const m = {
    ...NotesBlock.init().model,
    drafts: { mad: "Mad draft", sad: "Sad draft" },
    draftIds: { mad: "stable-id" },
  };

  await persist(m);
  expect(await load()).toMatchObject({
    drafts: m.drafts,
    draftIds: m.draftIds,
  });
  expect(await load("other")).toMatchObject({ drafts: {} });
  expect(await load("room", "guest")).toMatchObject({ drafts: {} });
});

it("retains a stable id after a lost acknowledgement and clears only the saved draft", async () => {
  let m = {
    ...NotesBlock.init().model,
    draft: "Retry",
    drafts: { mad: "Retry", sad: "Other" },
    busy: true,
  };

  const prepared = NotesBlock.update(
    m,
    Message.Prepared({ id: "stable" }),
    context,
  ).model;

  await persist(prepared);

  const restored = NotesBlock.update(
    NotesBlock.init().model,
    await load(),
    context,
  ).model;

  const retry = NotesBlock.update(restored, Message.Save(), context);
  expect(retry.commands?.[0]?.args).toMatchObject({
    id: "stable",
    text: "Retry",
  });
  const saved = NotesBlock.update(retry.model, Message.Saved(), context).model;
  await persist(saved);
  expect(await load()).toMatchObject({
    drafts: { mad: "", sad: "Other" },
    draftIds: { mad: "" },
  });
});

it("does not overwrite newly typed text with a late hydration response", () => {
  const typed = NotesBlock.update(
    NotesBlock.init().model,
    Message.Changed({ value: "New typing" }),
    context,
  ).model;

  const hydrated = NotesBlock.update(
    typed,
    Message.Loaded({ drafts: { mad: "Old" }, draftIds: {}, revision: 0 }),
    context,
  ).model;

  expect(hydrated.draft).toBe("New typing");
});

it("clears backup on conclusion or deletion", async () => {
  for (const board of [{ ...emptyBoard, phase: "closed" as const }, null]) {
    const m = {
      ...NotesBlock.init().model,
      draft: "Private",
      drafts: { mad: "Private" },
    };

    await persist(m);

    const cleared = NotesBlock.update(
      m,
      Message.InformedOfRoom({ load: false }),
      { ...context, board },
    ).model;

    await persist(cleared);
    expect(stored).toEqual({});
  }
});

it("tolerates corrupt or unavailable storage and keeps the draft", async () => {
  stored["cg_drafts_v2:room:host"] = "{broken";
  expect(await load()).toEqual(Message.BackupFailed());
  vi.stubGlobal("localStorage", {
    setItem: () => {
      throw Error("Quota");
    },
  });

  const m = {
    ...NotesBlock.init().model,
    draft: "Still here",
    drafts: { mad: "Still here" },
  };

  const result = NotesBlock.update(m, await persist(m), context);
  expect(result.model.draft).toBe("Still here");
  expect(result.outMessage).toMatchObject({
    text: expect.stringContaining("Keep this tab open"),
  });
});
