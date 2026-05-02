// Two token formats live side by side:
//
//   Match token (legacy room flow):
//     `${matchId}.${playerId}.${base64(HMAC-SHA256(matchId.playerId, secret))}`
//     Issued by Convex `matchmaker.getMyMatchToken`. Verifies that the
//     bearer is allowed to join a specific match (room → match handshake).
//
//   World token (io flow):
//     `world.${playerId}.${base64(HMAC-SHA256(world.playerId, secret))}`
//     Issued by the bun server itself at `POST /world-token` (no Convex
//     round-trip required). Verifies the bearer is who they claim to be —
//     anyone with a valid name can join the singleton world.
//
// The shared signing primitive (`sign`) is identical so the same
// GAME_SERVER_SECRET secures both paths.

export type ParsedToken = {
  matchId: string;
  playerId: string;
};

export async function verifyMatchToken(
  rawToken: string,
  secret: string,
): Promise<ParsedToken | null> {
  const parts = rawToken.split(".");
  if (parts.length !== 3) return null;
  const [matchId, playerId, sigB64] = parts;
  if (!matchId || !playerId || !sigB64) return null;

  const expected = await sign(`${matchId}.${playerId}`, secret);
  if (!constantTimeEquals(expected, sigB64)) return null;

  return { matchId, playerId };
}

/**
 * Mint a world token for `playerId`. No Convex round-trip — the bun server
 * is the issuer. This is intentionally permissive: io-style worlds let
 * anyone join. The token still proves the bearer can't impersonate
 * another player after-the-fact (no token forgery without the secret).
 */
export async function mintWorldToken(
  playerId: string,
  secret: string,
): Promise<string> {
  const message = `world.${playerId}`;
  const sigB64 = await sign(message, secret);
  return `${message}.${sigB64}`;
}

export type ParsedWorldToken = {
  playerId: string;
};

export async function verifyWorldToken(
  rawToken: string,
  secret: string,
): Promise<ParsedWorldToken | null> {
  const parts = rawToken.split(".");
  if (parts.length !== 3) return null;
  const [prefix, playerId, sigB64] = parts;
  if (prefix !== "world" || !playerId || !sigB64) return null;

  const expected = await sign(`world.${playerId}`, secret);
  if (!constantTimeEquals(expected, sigB64)) return null;

  return { playerId };
}

async function sign(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return bytesToBase64(new Uint8Array(sig));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
