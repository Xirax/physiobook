import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { authRoutes } from './modules/auth/auth.routes.js';
import cookiePlugin from './plugins/cookie.js';
import databasePlugin from './plugins/db.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import rateLimitPlugin from './plugins/rate-limit.js';

export interface RateLimitOptions {
  max: number;
  timeWindow: number | string;
}

export interface BuildServerOptions {
  logger?: boolean;
  databaseUrl: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  refreshTtlSeconds: number;
  secureCookies: boolean;
  rateLimit: RateLimitOptions;
  trustProxy: boolean | number | string[];

  now?: () => Date;
}
export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    trustProxy: options.trustProxy,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin, { connectionString: options.databaseUrl });
  await app.register(cookiePlugin, { secure: options.secureCookies });
  await app.register(rateLimitPlugin, options.rateLimit);

  app.get('/health', () => ({ status: 'ok' }));

  await app.register(authRoutes, {
    jwtSecret: options.jwtSecret,
    jwtTtlSeconds: options.jwtTtlSeconds,
    refreshTtlSeconds: options.refreshTtlSeconds,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return app;
}
