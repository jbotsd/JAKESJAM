// Validate per-player auth tokens issued by Convex matchmaker.getMyMatchToken.
// Token format: `${matchId}.${playerId}.${base64(HMAC-SHA256(matchId.playerId, secret))}`

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
