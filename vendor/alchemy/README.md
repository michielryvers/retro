# Pinned Alchemy snapshot

These archives preserve the Alchemy `72f84cc370ae58bdef3ba6b3be0f0e6c3a49de33`
preview and its Distilled dependencies used by Retro. On 6 November 2026,
`pkg.alchemy.run` stopped serving these URLs (404), preventing fresh installs.
They are checked in so deployments do not depend on an expiring preview server.

`manifest.json` records each original URL, original download integrity, package
version, license, and SHA-256 of the repacked archive. **Original integrity values
are provenance, not hashes of these repacked archives.** The archives were
recovered from the existing local installation; original compressed downloads
were unavailable.

Runtime source and compiled files are unchanged. The three existing Retro
patches were reversed before packaging and are still applied by Bun from
`patches/`. Package manifests replace preview URLs with the same package
versions; root overrides resolve every member of the snapshot to these local
archives. Installer tags and installed nested dependencies are excluded.
Licenses, notices, and upstream test fixtures are retained inside the archives.
No application configuration, credentials, or room data is included.

Do not mix newer Alchemy packages into this snapshot. Replace the entire group
with a tested registry release, removing these overrides and archives, when that
migration is ready. Version `2.0.0-beta.85` changes command/API signatures, Domain
hosting, live reads, and state configuration; it requires a separate compatibility
review for existing rooms and our Cloudflare patch.
