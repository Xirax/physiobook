import { errorCodes, type ErrorResponse } from '@physiobook/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

import { isDomainError } from '../lib/errors.js';

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === 'number' ? statusCode : undefined;
}

async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, request, reply) => {
    if (typeof error !== 'object' || error === null) {
      request.log.error({ err: error }, 'handler threw a non-error value');

      return reply.status(500).send({
        code: errorCodes.INTERNAL_ERROR,
        message: 'Internal server error',
      } satisfies ErrorResponse);
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const body: ErrorResponse = {
        code: errorCodes.VALIDATION_FAILED,
        message: 'Request validation failed',
        details: error.validation.map((issue) => ({
          path: issue.instancePath.replace(/^\//, ''),
          message: issue.message ?? 'Invalid value',
        })),
      };

      return reply.status(400).send(body);
    }

    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: error, issues: error.cause.issues },
        'response did not match its schema',
      );

      return reply.status(500).send({
        code: errorCodes.INTERNAL_ERROR,
        message: 'Internal server error',
      } satisfies ErrorResponse);
    }

    if (isDomainError(error)) {
      request.log.info({ code: error.code }, error.message);

      // RFC 9110 §15.5.2 requires a 401 to name the scheme. Deliberately bare:
      // RFC 6750's `error="invalid_token"` parameter would tell a prober which
      // 401 it hit, which is the distinction the single body exists to deny.
      if (error.statusCode === 401) reply.header('WWW-Authenticate', 'Bearer');

      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
      } satisfies ErrorResponse);
    }

    const clientErrorStatus = httpStatusOf(error);
    if (clientErrorStatus !== undefined && clientErrorStatus >= 400 && clientErrorStatus < 500) {
      return reply.status(clientErrorStatus).send({
        code: errorCodes.BAD_REQUEST,
        message: error instanceof Error ? error.message : 'Bad request',
      } satisfies ErrorResponse);
    }

    request.log.error({ err: error }, 'unhandled error');

    return reply.status(500).send({
      code: errorCodes.INTERNAL_ERROR,
      message: 'Internal server error',
    } satisfies ErrorResponse);
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      code: errorCodes.NOT_FOUND,
      message: `Route ${request.method} ${request.url} not found`,
    } satisfies ErrorResponse);
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
