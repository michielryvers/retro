import { flow } from "effect/Function";
import { Option, Schema } from "effect";

export const explainFailure = flow(
  Schema.decodeUnknownOption(Schema.Struct({ reason: Schema.String })),
  Option.match({
    onSome: (error) => error.reason,
    onNone: () =>
      "Could not connect. Your draft is safe here. Please try again.",
  }),
);
