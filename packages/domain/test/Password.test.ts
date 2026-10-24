import { expect, it } from "vitest";
import { passwordHash } from "../../server/src/Secrets.ts";

it("matches native PBKDF2-SHA256 at the full 600k work factor", async () => {
  const password = new TextEncoder().encode("a long password with café");
  const salt = new TextEncoder().encode("test salt");

  const key = await crypto.subtle.importKey("raw", password, "PBKDF2", false, [
    "deriveBits",
  ]);

  const native = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000 },
    key,
    256,
  );

  const expected = Array.from(new Uint8Array(native), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  expect(await passwordHash("a long password with café", "test salt")).toBe(
    expected,
  );
});
