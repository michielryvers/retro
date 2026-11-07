// Fixed UTC durations: keep unfinished rooms for 365 days, then retain the
// closed record for 365 days after closure. Archiving does not shorten this.
export const RETENTION_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const roomClosesAt = (createdAt: number) => createdAt + RETENTION_YEAR_MS;
export const roomDeletesAt = (closedAt: number) => closedAt + RETENTION_YEAR_MS;

export const deletionDue = (
  room: { readonly lifecycle: string; readonly phase: string; readonly closedAt: number },
  now: number,
) => room.lifecycle === "created" && room.phase === "closed" &&
  Number.isFinite(room.closedAt) && room.closedAt > 0 && now >= roomDeletesAt(room.closedAt);
