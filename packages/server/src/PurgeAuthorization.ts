// Only trusted Worker service bindings can call physical purge RPCs.
export type PurgeAuthorization = {
  readonly title: string;
  readonly actorId?: string;
  readonly automatic?: true;
};
