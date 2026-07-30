import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { authRoutes } from './modules/auth/auth.routes.js';
import databasePlugin from './plugins/db.js';
import errorHandlerPlugin from './plugins/error-handler.js';

export interface BuildServerOptions {
  logger?: boolean;
  databaseUrl: string;
  jwtSecret: string;
  jwtTtlSeconds: number;

  now?: () => Date;
}
export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin, { connectionString: options.databaseUrl });

  app.get('/health', () => ({ status: 'ok' }));

  await app.register(authRoutes, {
    jwtSecret: options.jwtSecret,
    jwtTtlSeconds: options.jwtTtlSeconds,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return app;
}
