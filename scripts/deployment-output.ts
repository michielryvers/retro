import * as Schema from "effect/Schema";

const Deployment = Schema.Struct({
  workerName: Schema.String.check(Schema.isPattern(/^[a-z0-9_-]+$/)),
});

export function parseDeploymentOutput(text: string) {
  // `alchemy state read` prints a pretty-printed JSON document last, but a
  // remote backend may first print credential-refresh logs to stdout. Its
  // unindented opening brace is the boundary, not a bracket in a log timestamp.
  // Use the last such boundary so earlier structured diagnostic logs cannot
  // be mistaken for the actual stack output. Do not scrape worker names from
  // log messages or accept null/malformed state as a successful deployment.
  const start = Array.from(text.matchAll(/^\{/gm)).at(-1)?.index;

  try {
    return Schema.decodeUnknownSync(Deployment)(JSON.parse(start === undefined ? text : text.slice(start)));
  } catch (cause) {
    throw new Error(
      "Could not read the deployed Worker from Alchemy stack outputs. Read CommonGround/prod/output with --backend cloudflare --name alchemy-state-store-retro; the output must end with valid JSON containing workerName.",
      { cause },
    );
  }
}
