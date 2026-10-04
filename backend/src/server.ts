import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { authRoutes } from './modules/auth/auth.routes.js';
import { businessHoursRoutes } from './modules/availability/business-hours.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import authPlugin from './plugins/auth.js';
import cookiePlugin from './plugins/cookie.js';
import databasePlugin from './plugins/db.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import jobsPlugin from './plugins/jobs.js';
import rateLimitPlugin from './plugins/rate-limit.js';

export interface RateLimitOptions {
  max: number;
  refreshMax: number;
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
  await app.register(jobsPlugin, { connectionString: options.databaseUrl });
  await app.register(cookiePlugin, { secure: options.secureCookies });
  await app.register(rateLimitPlugin, options.rateLimit);
  await app.register(authPlugin, {
    jwtSecret: options.jwtSecret,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  app.get('/health', () => ({ status: 'ok' }));

  await app.register(authRoutes, {
    jwtSecret: options.jwtSecret,
    jwtTtlSeconds: options.jwtTtlSeconds,
    refreshTtlSeconds: options.refreshTtlSeconds,
    refreshRateLimitMax: options.rateLimit.refreshMax,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  await app.register(settingsRoutes);
  await app.register(businessHoursRoutes);

  return app;
}
