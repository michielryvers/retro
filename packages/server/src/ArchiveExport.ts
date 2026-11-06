import { decodeArchive, type RetroArchive } from "@retro/domain/RetroArchive";
import type { RoomState } from "@retro/domain/Room/RoomState";
import { columnsFor } from "@retro/domain/Room/Templates";

export function exportArchive(
  id: string,
  room: typeof RoomState.Type,
): RetroArchive {
  if (room.lifecycle !== "created" || room.phase !== "closed")
    throw new Error("Only finished retros can be exported.");

  return decodeArchive({
    format: "retro-archive",
    version: 1,
    sourceRoomId: id,
    title: room.title,
    createdAt: room.createdAt,
    closedAt: room.closedAt,
    template: room.template,
    columns: columnsFor(room.template).map(({ id, title }) => ({ id, title })),
    facilitatorId: room.adminId,
    participants: room.participants.map(({ id, name }) => ({ id, name })),
    notes: room.notes,
    combinations: room.combinations,
    votes: room.votes,
    voters: room.voters,
    voteLimit: room.voteLimit,
    actions: room.actions,
  });
}
