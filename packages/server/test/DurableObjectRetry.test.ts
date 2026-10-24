import { expect, it } from "vitest";
import * as Effect from "effect/Effect";
import {
  retryableTransit,
  transit,
} from "../../../node_modules/@alchemy.run/cloudflare/src/Domain/Retry.ts";

it("retries only flagged transient failures, including wrapped RPC errors", () => {
  const transient = Object.assign(new Error("reset"), { retryable: true });

  expect(retryableTransit(transient)).toBe(true);
  expect(retryableTransit(new Error("RPC failed", { cause: transient }))).toBe(
    true,
  );
  expect(retryableTransit(new Error("application failure"))).toBe(false);
  expect(retryableTransit(Object.assign(transient, { overloaded: true }))).toBe(
    false,
  );
});

it("does not retry overloads hidden inside retryable wrappers or cyclic causes", () => {
  const overloaded = Object.assign(new Error("busy"), { overloaded: true });

  const wrapper = Object.assign(
    new Error("RPC failed", { cause: overloaded }),
    { retryable: true },
  );

  const cyclic = new Error("cycle");

  cyclic.cause = cyclic;
  expect(retryableTransit(wrapper)).toBe(false);
  expect(retryableTransit(cyclic)).toBe(false);
});

it("acquires a new stub after a transient failure instead of reusing the broken one", async () => {
  let acquisitions = 0;

  const getStub = () => {
    const attempt = ++acquisitions;

    return () =>
      attempt === 1
        ? Effect.fail(
            Object.assign(new Error("broken stub"), { retryable: true }),
          )
        : Effect.succeed("recovered");
  };

  const result = await Effect.runPromise(transit(() => getStub()()));

  expect(result).toBe("recovered");
  expect(acquisitions).toBe(2);
});
