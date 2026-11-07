import * as Redacted from "effect/Redacted";
import { initialRoom } from "@retro/domain/Room/RoomState";
import { exportArchive } from "../../src/ArchiveExport.ts";

export const archiveFixture = () =>
  exportArchive("old-room", {
    ...initialRoom,
    lifecycle: "created",
    phase: "closed",
    title: "Team retro",
    createdAt: 1_700_000_000_000,
    closedAt: 1_700_003_600_000,
    adminId: "host",
    participants: [
      { id: "host", name: "Host", ready: true },
      { id: "guest", name: "Guest", ready: false },
    ],
    notes: [
      { id: "a", column: "glad", text: "Pairing worked", authorId: "host" },
      { id: "b", column: "glad", text: "More pairing", authorId: "guest" },
    ],
    combinations: [{ sourceId: "b", targetId: "a" }],
    votes: [{ noteId: "a", participantId: "guest" }],
    voters: ["guest"],
    actions: [
      {
        id: "action",
        noteId: "a",
        text: "Schedule pairing",
        ownerId: "guest",
        dueDate: "2026-12-01",
      },
    ],
    inviteSeed: Redacted.make("never-export-seed"),
    passwordHash: Redacted.make("never-export-hash"),
    passwordSalt: "never-export-salt",
    grants: [{ sessionId: "session", participantId: "host" }],
  });
