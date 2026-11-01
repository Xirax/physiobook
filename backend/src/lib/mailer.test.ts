import { describe, expect, it } from 'vitest';

import { loadWorkerEnv } from '../config/env.js';
import { mailerConfigFromEnv } from './mailer.js';

const env = {
  DATABASE_URL: 'postgres://user:pw@localhost:5432/physiobook',
  MAIL_HOST: 'smtp.example.com',
  MAIL_PORT: '587',
  MAIL_FROM: 'no-reply@physiobook.local',
};

describe('mailerConfigFromEnv', () => {
  it('Maps the transport settings and sender', () => {
    expect(mailerConfigFromEnv(loadWorkerEnv(env))).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      from: 'no-reply@physiobook.local',
    });
  });

  it('Passes credentials through when they are set', () => {
    const config = mailerConfigFromEnv(
      loadWorkerEnv({ ...env, MAIL_SECURE: 'true', MAIL_USER: 'apikey', MAIL_PASSWORD: 's3cret' }),
    );

    expect(config.secure).toBe(true);
    expect(config.auth).toEqual({ user: 'apikey', pass: 's3cret' });
  });
});
