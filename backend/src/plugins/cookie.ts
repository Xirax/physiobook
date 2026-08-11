import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/auth';

export interface CookiePluginOptions {
  secure: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    setRefreshCookie: (reply: FastifyReply, token: string, maxAgeSeconds: number) => void;
    clearRefreshCookie: (reply: FastifyReply) => void;
  }
}

async function cookiePlugin(app: FastifyInstance, { secure }: CookiePluginOptions): Promise<void> {
  await app.register(fastifyCookie);

  const attributes = {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  } as const;

  app.decorate('setRefreshCookie', (reply, token, maxAgeSeconds) => {
    reply.setCookie(REFRESH_COOKIE_NAME, token, { ...attributes, maxAge: maxAgeSeconds });
  });

  app.decorate('clearRefreshCookie', (reply) => {
    reply.clearCookie(REFRESH_COOKIE_NAME, attributes);
  });
}

export default fp(cookiePlugin, { name: 'cookie' });
