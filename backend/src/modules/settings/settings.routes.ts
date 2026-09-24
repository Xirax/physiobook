import {
  errorResponseSchema,
  practiceSettingsSchema,
  updatePracticeSettingsSchema,
} from '@physiobook/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { getSettings, updateSettings } from './settings.service.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const dependencies = { db: app.db };

  typed.get(
    '/settings',
    {
      onRequest: app.requireAuth,
      schema: {
        response: {
          200: practiceSettingsSchema,
          401: errorResponseSchema,
        },
      },
    },
    async () => getSettings(dependencies),
  );

  typed.put(
    '/settings',
    {
      onRequest: app.requireRole('admin'),
      schema: {
        body: updatePracticeSettingsSchema,
        response: {
          200: practiceSettingsSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => updateSettings(request.body, dependencies),
  );
}
