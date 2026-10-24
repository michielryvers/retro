export const randomSecret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");

const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");

export const inviteToken = async (seed: string, id: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(seed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id)),
  );
};

import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// Production workerd caps native PBKDF2 at 100k. Keep the standard 600k
// work factor using the maintained JS implementation rather than weakening it.
export const passwordHash = async (password: string, salt: string) =>
  bytesToHex(
    await pbkdf2Async(
      sha256,
      new TextEncoder().encode(password),
      new TextEncoder().encode(salt),
      { c: 600000, dkLen: 32 },
    ),
  );
