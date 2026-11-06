import { describe, expect, it } from "vitest";
import { archiveFixture } from "./fixtures/archive.ts";
import { initialRoom } from "@retro/domain/Room/RoomState";
import { decodeArchive } from "@retro/domain/RetroArchive";
import { exportArchive } from "../src/ArchiveExport.ts";

describe("portable retro archives", () => {
  it("round trips content without credentials or runtime state", () => {
    const archive = archiveFixture();
    expect(decodeArchive(JSON.parse(JSON.stringify(archive)))).toEqual(archive);
    expect(archive.notes).toHaveLength(2);
    expect(archive.actions[0]?.ownerId).toBe("guest");
    expect(archive.combinations).toEqual([{ sourceId: "b", targetId: "a" }]);

    for (const secret of [
      "never-export",
      "grants",
      "invitations",
      "password",
      "timer",
      "attempts",
      "ready",
    ])
      expect(JSON.stringify(archive)).not.toContain(secret);
  });
  it("does not export unfinished rooms", () => {
    expect(() => exportArchive("room", initialRoom)).toThrow("Only finished");
  });
  it("rejects future versions and unknown fields rather than silently dropping data", () => {
    expect(() => decodeArchive({ ...archiveFixture(), version: 2 })).toThrow();
    expect(() =>
      decodeArchive({ ...archiveFixture(), passwordHash: "secret" }),
    ).toThrow();
  });
  it("rejects dangling references, cycles, duplicate IDs and oversized content", () => {
    const base = archiveFixture();

    for (const change of [
      { participants: [base.participants[0], base.participants[0]] },
      { combinations: [{ sourceId: "a", targetId: "a" }] },
      {
        combinations: [...base.combinations, { sourceId: "a", targetId: "b" }],
      },
      { votes: [{ participantId: "guest", noteId: "b" }] },
      { actions: [{ ...base.actions[0], ownerId: "missing" }] },
      { closedAt: base.createdAt - 1 },
      { title: "x".repeat(1_800_001) },
    ])
      expect(() => decodeArchive({ ...base, ...change })).toThrow();
  });
});
