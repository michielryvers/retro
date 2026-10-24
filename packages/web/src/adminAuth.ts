import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AdminAccess {
  ADMIN_AUD: string;
  ADMIN_EMAIL?: string;
  ACCESS_ISSUER?: string;
}

const keySets = new Map<string, JWTVerifyGetKey>();

const keysFor = (issuer: string) => {
  const existing = keySets.get(issuer);

  if (existing) return existing;
  const keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  keySets.set(issuer, keys);

  return keys;
};

export async function authorizeAdmin(
  request: Request,
  config: AdminAccess,
  key?: JWTVerifyGetKey,
) {
  const { ADMIN_AUD: audience, ADMIN_EMAIL: email, ACCESS_ISSUER: issuer } = config;

  if (!audience || !email || !issuer) return false;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");

  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, key ?? keysFor(issuer), {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub", "email"],
    });

    return payload.email === email && payload.type === "app";
  } catch {
    return false;
  }
}
