# One-year retention: rollout and data safety

## What changes

- An unfinished room stays open for **365 days from creation**. Automatic closure keeps private notes private.
- A closed room remains available for **365 days from its recorded closure**, whether or not it is archived. An unfinished room that closes automatically therefore has a separate 365-day closed-retention period.
- Existing rooms receive the same protection. Already closed rooms are not reopened, and their historical timestamps are not rewritten.
- Explicit facilitator/admin deletion remains available. Imported, administrator-only historical archives retain their existing behavior; this change does not add automatic deletion to them.

## How existing data is preserved

There is no bulk data migration, room snapshot rewrite, namespace recreation, or change to room IDs, sessions, passwords, invitation secrets, notes, votes, or actions.

Old seven-day timers are allowed to wake up, but their command handlers check the new deadline and commit a durable replacement request with a new, stable `retention:v2:*` command ID. Reusing a completed old command ID would not reschedule anything. Duplicate replacement requests share an ID and do not create multiple expiry jobs.

An old `RoomDeletionRequested` event still waiting in an outbox/policy inbox is checked against the current aggregate state. Finally, automatic cleanup rechecks the deadline **inside the aggregate's exclusive physical-purge operation**, before any room data is removed. When retained, the caller also leaves every projection and the admin directory untouched.

The shared-board view increments its version from 0 to 1. It is keyed by the original aggregate, so Alchemy recomputes each key **in place**, from preserved event history, on access. This corrects displayed seven-day deadlines without replacing the view's Durable Object namespace.

Deletion that already finished cannot be undone by this change. A deletion tombstone means cleanup already started; retries finish that cleanup instead of pretending partially deleted data can be recovered.

## Before merging / production checklist

1. Open known real active and finished retros with their existing links. Record titles and expected note/action counts without putting private content in the PR.
2. Download available finished-retro JSON exports from `/admin` and keep them in appropriate private storage **outside Git**. These are portable archives, **not full-fidelity backups**: passwords, sessions, invitation credentials, and active/private drafts are intentionally excluded. Do not reveal or close an active retro merely to export it.
3. This PR does not implement or perform a complete encrypted backup of live Durable Object storage. If full restore coverage is required before deployment, stop here and establish that backup path first. Infrastructure-state exports are **not room-data backups**.
4. Review the deployment for updates/in-place view rebuilding, not deletions or replacement of existing room/view namespaces. Keep `alchemy-state-store-retro` and all infrastructure identifiers unchanged.
5. After deployment, use the same links and sessions to verify the known rooms, private notes, completed actions, and new expiry dates. Confirm that the production smoke check succeeds.

No real room contents were accessed, exported, or changed while developing this PR. The previous production log confirms data-preserving class renames, but logs alone cannot verify room contents or constitute a backup.

## Local upgrade rehearsal

`scripts/retention-migration-smoke.ts` refuses non-local hosts and uses only fictional data. Run an instance of the previous release, seed a fixture outside Git, then restart the **same directory and Alchemy stage** using this release. Wait for `/api/session` to be ready before each phase:

```sh
bun scripts/retention-migration-smoke.ts seed /tmp/opencode/retention-upgrade-fixture.json
# Stop the old local server; upgrade its code, preserving .alchemy and the stage.
bun scripts/retention-migration-smoke.ts verify /tmp/opencode/retention-upgrade-fixture.json
```

The rehearsal checks existing IDs, grants, active private notes, completed board contents, votes and actions, and verifies the old seven-day date now reads as 365 days. Clock-controlled tests additionally cover old timers, duplicate rescheduling, queued deletion events, exact year boundaries, late execution, archiving, and the final physical-purge guard.

## Deployment-verification prerequisite

The previous release deployed successfully but its smoke check read `null` from local state: the `state read` CLI invocation does not infer the `prod` stage from the path when selecting a configured backend. The workflow now explicitly selects `--backend cloudflare --name alchemy-state-store-retro` when reading production outputs. No new credentials or state store are introduced.
