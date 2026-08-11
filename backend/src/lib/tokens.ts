import type { UserRole } from '@physiobook/shared';
import jwt from 'jsonwebtoken';

const ALGORITHM = 'HS256';

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  session_id: string;
  exp: number;
  iat: number;
}

export interface AccessTokenSubject {
  id: string;
  role: UserRole;
  sessionId: string;
}

export interface SignAccessTokenOptions {
  secret: string;
  ttlSeconds: number;
  now?: () => Date;
}

export function signAccessToken(
  user: AccessTokenSubject,
  { secret, ttlSeconds, now = () => new Date() }: SignAccessTokenOptions,
): string {
  const issuedAt = Math.floor(now().getTime() / 1000);

  return jwt.sign(
    { role: user.role, session_id: user.sessionId, iat: issuedAt, exp: issuedAt + ttlSeconds },
    secret,
    {
      algorithm: ALGORITHM,
      subject: user.id,
    },
  );
}

export interface VerifyAccessTokenOptions {
  now?: () => Date;
}

export function verifyAccessToken(
  token: string,
  secret: string,
  { now = () => new Date() }: VerifyAccessTokenOptions = {},
): AccessTokenClaims {
  const payload = jwt.verify(token, secret, {
    algorithms: [ALGORITHM],
    clockTimestamp: Math.floor(now().getTime() / 1000),
  });

  if (typeof payload === 'string') {
    throw new jwt.JsonWebTokenError('Token payload is not an object');
  }

  const { sub, role, session_id: sessionId, exp, iat } = payload;

  if (
    typeof sub !== 'string' ||
    typeof sessionId !== 'string' ||
    typeof exp !== 'number' ||
    typeof iat !== 'number'
  ) {
    throw new jwt.JsonWebTokenError('Token is missing required claims');
  }
  if (role !== 'user' && role !== 'admin') {
    throw new jwt.JsonWebTokenError('Token carries an unknown role');
  }

  return { sub, role, session_id: sessionId, exp, iat };
}
