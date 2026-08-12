import { sessions, type Database } from '@physiobook/db';
import type { UserRole } from '@physiobook/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { verifyAccessToken, type AccessTokenClaims } from '../lib/tokens.js';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }

  interface FastifyInstance {
    requireAuth: preHandlerHookHandler;
    requireRole: (...roles: [UserRole, ...UserRole[]]) => preHandlerHookHandler;
  }
}

export interface AuthPluginOptions {
  jwtSecret: string;
  now?: () => Date;
}

const BEARER = /^Bearer +([^ ]+)$/i;
const sessionIdSchema = z.uuid();

function bearerTokenOf(header: string | undefined): string | undefined {
  return BEARER.exec(header ?? '')?.[1];
}

function claimsOf(token: string, secret: string, now: () => Date): AccessTokenClaims {
  try {
    return verifyAccessToken(token, secret, { now });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) throw new UnauthorizedError();

    throw error;
  }
}

async function findLiveSession(
  db: Database,
  sessionId: string,
  at: Date,
): Promise<{ userId: string } | undefined> {
  if (!sessionIdSchema.safeParse(sessionId).success) return undefined;

  const [session] = await db
    .select({
      userId: sessions.userId,
      revokedAt: sessions.revokedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (session === undefined || session.revokedAt !== null || session.expiresAt <= at) {
    return undefined;
  }

  return { userId: session.userId };
}

export function authenticatedUser(request: FastifyRequest): AuthenticatedUser {
  if (request.user === null) throw new UnauthorizedError();

  return request.user;
}

async function authPlugin(
  app: FastifyInstance,
  { jwtSecret, now = () => new Date() }: AuthPluginOptions,
): Promise<void> {
  app.decorateRequest('user', null);

  const authenticate = async (request: FastifyRequest): Promise<AuthenticatedUser> => {
    if (request.user !== null) return request.user;

    const token = bearerTokenOf(request.headers.authorization);
    if (token === undefined) throw new UnauthorizedError();

    const claims = claimsOf(token, jwtSecret, now);

    const session = await findLiveSession(app.db, claims.session_id, now());
    if (session === undefined || session.userId !== claims.sub) throw new UnauthorizedError();

    const user: AuthenticatedUser = {
      id: claims.sub,
      role: claims.role,
      sessionId: claims.session_id,
    };

    request.user = user;

    return user;
  };

  const requireAuth: preHandlerHookHandler = async (request) => {
    await authenticate(request);
  };

  app.decorate('requireAuth', requireAuth);

  app.decorate('requireRole', (...roles: [UserRole, ...UserRole[]]) => {
    const allowed = new Set<UserRole>(roles);

    const requireRole: preHandlerHookHandler = async (request) => {
      const { role } = await authenticate(request);

      if (!allowed.has(role)) throw new ForbiddenError();
    };

    return requireRole;
  });
}

export default fp(authPlugin, { name: 'auth', dependencies: ['db'] });
