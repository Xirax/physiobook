import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SECRET_BYTES = 32;
const SEPARATOR = '.';

export interface RefreshToken {
  value: string;
  hash: string;
}

export function mintRefreshToken(sessionId: string): RefreshToken {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');

  return {
    value: `${sessionId}${SEPARATOR}${secret}`,
    hash: hashRefreshSecret(secret),
  };
}

export function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export interface ParsedRefreshToken {
  sessionId: string;
  secret: string;
}

export function parseRefreshToken(value: string): ParsedRefreshToken | undefined {
  const separator = value.indexOf(SEPARATOR);
  if (separator <= 0) return undefined;

  const sessionId = value.slice(0, separator);
  const secret = value.slice(separator + 1);

  if (secret === '') return undefined;

  return { sessionId, secret };
}

export function refreshSecretMatches(secret: string, storedHash: string): boolean {
  const presented = Buffer.from(hashRefreshSecret(secret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');

  if (presented.length !== stored.length) return false;

  return timingSafeEqual(presented, stored);
}
