import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../tests/helpers/test-db.js';

describe('buildServer', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({ databaseUrl: database.connectionString });
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  it('serves a liveness response on /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('decorates the instance with the Drizzle client', async () => {
    expect(app.db).toBeDefined();

    const result = await app.db.execute('SELECT 1 AS one');
    expect(result.rows[0]).toEqual({ one: 1 });
  });
});
