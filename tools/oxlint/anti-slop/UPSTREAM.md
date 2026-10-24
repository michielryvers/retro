# Upstream provenance

- Source: https://github.com/dmmulroy/anti-slop
- Revision: 13909c9e07590f5a85d93c62712259fe14a883f7
- Copied from: skills/install-anti-slop/assets/anti-slop
- Installed paths: tools/oxlint/anti-slop/index.ts and effect/index.ts
- Installed: 2026-10-20 using the bundled install.mjs script.

Before adding this record, a recursive comparison against the skill assets from
that exact Git checkout found no differences. Plugin source is unmodified. The root MIT LICENSE from the same revision is also included.
Nested vendor/eslint-stylistic/LICENSE and UPSTREAM.md are retained.

Repository configuration enables all generic rules, the native accumulating-spread
companion, and all Effect rules. Oxlint and @oxlint/plugins are pinned to 1.89.0.
Generated Alchemy/Cloudflare/build output and agent tooling are excluded. No owned
application source is excluded to hide diagnostics, and no rule is weakened.

Effect service-constructor import checks currently cover relative project imports;
package-alias imports are not fully enforced by that upstream rule.
