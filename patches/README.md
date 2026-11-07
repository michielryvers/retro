# Alchemy beta.85 compatibility

All dependencies resolve from npm. Bun applies these version-specific patches:

- **Cloudflare:** retain bounded queue drains and lease renewal, retry only Cloudflare-marked transient failures (never overloads), reacquire RPC stubs on retries, and expose storage cleanup plus aggregate maintenance hooks. Both published source and compiled JavaScript are patched. The hooks support authorized room deletion, archive export/import, and the private administrator directory; they are not public Domain API commands.
- **Domain Story:** add `assertAllEvents` (default `true`). Existing state/projection scenarios explicitly opt out of the new exhaustive event requirement while keeping their original assertions. The private-view event-order test uses the default exhaustive mode. This does not change application runtime behavior.

The old internal-export and Bun-loader patches are no longer needed.

## Existing deployments

- Keep the state store Worker **`alchemy-state-store-retro`**, not `retro` or the default store. Beta.85's `workerName` is the literal name; the old `name: "retro"` added the prefix automatically. Changing it would lose track of existing infrastructure.
- Domain beta.85 migrates the six existing Durable Object classes to `CommonGround.*` with Cloudflare class **renames**, preserving their namespaces and stored data. `Retro.layer(..., { legacyData: true })` identifies the model retaining the legacy data. Administrator/cleanup service bindings now use those model-prefixed names.
- Do not delete or recreate the existing state store or Durable Object namespaces. Review the production plan before merging. Local integration checks cover new rooms, archive round trips, cleanup, and live reads; the migration regression test covers the legacy class rename plan. A production migration still needs verification against the deployed account.
