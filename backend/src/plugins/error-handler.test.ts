import { errorCodes } from '@physiobook/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DomainError } from '../lib/errors.js';
import errorHandlerPlugin from './error-handler.js';

describe('Error handler', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(errorHandlerPlugin);

    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get('/throws-unknown', () => {
      throw new Error('something nobody anticipated');
    });

    typed.get('/throws-string', () => {
      throw 'a bare string';
    });

    typed.get('/throws-domain', () => {
      throw new DomainError(
        errorCodes.EMAIL_TAKEN,
        409,
        'That email address is already registered',
      );
    });

    typed.get(
      '/breaks-its-own-contract',
      { schema: { response: { 200: z.strictObject({ expected: z.string() }) } } },
      () => ({ unexpected: 'value' }) as unknown as { expected: string },
    );

    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('Turns an unmapped error into a 500 that reveals nothing', async () => {
    const response = await app.inject({ method: 'GET', url: '/throws-unknown' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: errorCodes.INTERNAL_ERROR,
      message: 'Internal server error',
    });
    expect(response.body).not.toContain('something nobody anticipated');
  });

  it('Survives a thrown non-error', async () => {
    const response = await app.inject({ method: 'GET', url: '/throws-string' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: errorCodes.INTERNAL_ERROR,
      message: 'Internal server error',
    });
    expect(response.body).not.toContain('in operator');
  });

  it('Maps a domain error to its own status and code', async () => {
    const response = await app.inject({ method: 'GET', url: '/throws-domain' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: errorCodes.EMAIL_TAKEN,
      message: 'That email address is already registered',
    });
  });

  it('Answers 500 when a handler returns a shape its own schema forbids', async () => {
    const response = await app.inject({ method: 'GET', url: '/breaks-its-own-contract' });

    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe(errorCodes.INTERNAL_ERROR);
    expect(response.body).not.toContain('unexpected');
  });

  it('Answers an unknown route in the same error shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/no-such-route' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: errorCodes.NOT_FOUND,
      message: 'Route GET /no-such-route not found',
    });
  });
});
