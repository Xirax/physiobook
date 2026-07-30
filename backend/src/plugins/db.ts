import { createDatabase, type Database } from '@physiobook/db';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export interface DatabasePluginOptions {
  connectionString: string;
}

async function databasePlugin(
  app: FastifyInstance,
  { connectionString }: DatabasePluginOptions,
): Promise<void> {
  const { db, close } = createDatabase(connectionString);

  app.decorate('db', db);

  app.addHook('onClose', async () => {
    await close();
  });
}

export default fp(databasePlugin, { name: 'db' });
