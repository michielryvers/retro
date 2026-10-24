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
