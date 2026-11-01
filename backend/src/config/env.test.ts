import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_JWT_SECRET, JWT_SECRET_MIN_LENGTH, loadEnv, loadWorkerEnv } from './env.js';

describe('loadEnv', () => {
  const valid = {
    DATABASE_URL: 'postgres://user:pw@localhost:5432/physiobook',
    JWT_SECRET: 'x'.repeat(JWT_SECRET_MIN_LENGTH),
  };

  it('Accepts a minimal valid environment and applies defaults', () => {
    const env = loadEnv(valid);

    expect(env.NODE_ENV).toBe('development');
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TTL_SECONDS).toBe(604_800);
    expect(env.AUTH_RATE_LIMIT_MAX).toBe(10);
    expect(env.AUTH_RATE_LIMIT_WINDOW_SECONDS).toBe(60);
    expect(env.REFRESH_RATE_LIMIT_MAX).toBe(100);
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.BACKEND_PORT).toBe(3000);
    expect(env.BACKEND_HOST).toBe('0.0.0.0');
  });

  it('Coerces the numeric variables, which arrive as strings', () => {
    const env = loadEnv({ ...valid, JWT_ACCESS_TTL_SECONDS: '60', BACKEND_PORT: '8080' });

    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(60);
    expect(env.BACKEND_PORT).toBe(8080);
  });

  it('Rejects a missing JWT_SECRET', () => {
    const { JWT_SECRET: _omitted, ...withoutSecret } = valid;

    expect(() => loadEnv(withoutSecret)).toThrow(/JWT_SECRET/);
  });

  it('Rejects a JWT_SECRET shorter than the hash it feeds', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('Never puts the secret in the error message', () => {
    const secret = 'short-but-secret';

    expect(() => loadEnv({ ...valid, JWT_SECRET: secret })).toThrow(
      expect.not.stringContaining(secret) as unknown as string,
    );
  });

  it('Rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omitted, ...withoutUrl } = valid;

    expect(() => loadEnv(withoutUrl)).toThrow(/DATABASE_URL/);
  });

  it('Rejects a non-numeric TTL', () => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_TTL_SECONDS: 'fifteen' })).toThrow(
      /JWT_ACCESS_TTL_SECONDS/,
    );
  });

  it('Rejects a zero TTL, which would mint already-expired tokens', () => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_TTL_SECONDS: '0' })).toThrow(
      /JWT_ACCESS_TTL_SECONDS/,
    );
  });

  it('Rejects a zero refresh TTL, which would end a session as it began', () => {
    expect(() => loadEnv({ ...valid, REFRESH_TTL_SECONDS: '0' })).toThrow(/REFRESH_TTL_SECONDS/);
  });

  it('Rejects a zero rate-limit max, which would refuse every login', () => {
    expect(() => loadEnv({ ...valid, AUTH_RATE_LIMIT_MAX: '0' })).toThrow(/AUTH_RATE_LIMIT_MAX/);
  });

  describe('TRUST_PROXY, which decides what the rate limit is keyed on', () => {
    it('Reads a hop count', () => {
      expect(loadEnv({ ...valid, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    });

    it('Reads a list of trusted proxy addresses', () => {
      expect(loadEnv({ ...valid, TRUST_PROXY: '10.0.0.0/8, loopback' }).TRUST_PROXY).toEqual([
        '10.0.0.0/8',
        'loopback',
      ]);
    });

    it('Treats an explicit false, a blank and an absent value alike', () => {
      expect(loadEnv({ ...valid, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
      expect(loadEnv({ ...valid, TRUST_PROXY: '' }).TRUST_PROXY).toBe(false);
      expect(loadEnv(valid).TRUST_PROXY).toBe(false);
    });

    it('Refuses `true`, which would let a client forge its own rate-limit bucket', () => {
      expect(() => loadEnv({ ...valid, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
      expect(() => loadEnv({ ...valid, TRUST_PROXY: 'true' })).toThrow(/X-Forwarded-For/);
    });

    it('Refuses a zero hop count, which says nothing false does not', () => {
      expect(() => loadEnv({ ...valid, TRUST_PROXY: '0' })).toThrow(/TRUST_PROXY/);
    });

    it('Refuses a list of nothing', () => {
      expect(() => loadEnv({ ...valid, TRUST_PROXY: ',,' })).toThrow(/TRUST_PROXY/);
    });
  });

  it('Rejects an unknown NODE_ENV', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('Names every problem at once, not just the first', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*JWT_SECRET/);
  });

  describe('Blank variables, which is how compose passes an unset one', () => {
    it('Falls back to the TTL default rather than coercing an empty string to zero', () => {
      expect(loadEnv({ ...valid, JWT_ACCESS_TTL_SECONDS: '' }).JWT_ACCESS_TTL_SECONDS).toBe(900);
    });

    it('Falls back to the refresh and rate-limit defaults', () => {
      const env = loadEnv({
        ...valid,
        REFRESH_TTL_SECONDS: '',
        AUTH_RATE_LIMIT_MAX: '',
        AUTH_RATE_LIMIT_WINDOW_SECONDS: '',
        REFRESH_RATE_LIMIT_MAX: '',
      });

      expect(env.REFRESH_TTL_SECONDS).toBe(604_800);
      expect(env.AUTH_RATE_LIMIT_MAX).toBe(10);
      expect(env.AUTH_RATE_LIMIT_WINDOW_SECONDS).toBe(60);
      expect(env.REFRESH_RATE_LIMIT_MAX).toBe(100);
    });

    it('Falls back to the port and host defaults', () => {
      const env = loadEnv({ ...valid, BACKEND_PORT: '', BACKEND_HOST: '' });

      expect(env.BACKEND_PORT).toBe(3000);
      expect(env.BACKEND_HOST).toBe('0.0.0.0');
    });

    it('Refuses a blank NODE_ENV, which selects the security posture', () => {
      expect(() => loadEnv({ ...valid, NODE_ENV: '' })).toThrow(/NODE_ENV/);
    });

    it('Still defaults NODE_ENV when it is genuinely absent', () => {
      expect(loadEnv(valid).NODE_ENV).toBe('development');
    });

    it('Still refuses a blank JWT_SECRET, where failing is the point', () => {
      expect(() => loadEnv({ ...valid, JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
    });

    it('Still refuses a blank DATABASE_URL', () => {
      expect(() => loadEnv({ ...valid, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
    });
  });

  describe('The public placeholder secret', () => {
    it('Boots in development, so a fresh clone runs', () => {
      expect(loadEnv({ ...valid, JWT_SECRET: DEVELOPMENT_JWT_SECRET }).JWT_SECRET).toBe(
        DEVELOPMENT_JWT_SECRET,
      );
    });

    it('Refuses to boot in production', () => {
      expect(() =>
        loadEnv({ ...valid, JWT_SECRET: DEVELOPMENT_JWT_SECRET, NODE_ENV: 'production' }),
      ).toThrow(/JWT_SECRET/);
    });

    it('Accepts a real secret in production', () => {
      expect(() =>
        loadEnv({ ...valid, JWT_SECRET: 'y'.repeat(48), NODE_ENV: 'production' }),
      ).not.toThrow();
    });

    it('Cannot be disarmed by a blank NODE_ENV beating the image default', () => {
      expect(() => loadEnv({ ...valid, JWT_SECRET: DEVELOPMENT_JWT_SECRET, NODE_ENV: '' })).toThrow(
        /NODE_ENV/,
      );
    });

    it('Is the same string .env.example ships', () => {
      const envExample = readFileSync(
        fileURLToPath(new URL('../../../.env.example', import.meta.url)),
        'utf8',
      );

      expect(envExample).toContain(`JWT_SECRET=${DEVELOPMENT_JWT_SECRET}`);
    });
  });
});

describe('loadWorkerEnv', () => {
  const valid = {
    DATABASE_URL: 'postgres://user:pw@localhost:5432/physiobook',
    MAIL_HOST: 'mailpit',
    MAIL_PORT: '1025',
    MAIL_FROM: 'no-reply@physiobook.local',
  };

  it('Boots without any of the API secrets and applies defaults', () => {
    const env = loadWorkerEnv(valid);

    expect(env).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: valid.DATABASE_URL,
      WORKER_HEALTH_PORT: 3001,
      WORKER_HEALTH_HOST: '0.0.0.0',
      MAIL_HOST: 'mailpit',
      MAIL_PORT: 1025,
      MAIL_SECURE: false,
      MAIL_FROM: 'no-reply@physiobook.local',
    });
  });

  it('Coerces the health port and treats a blank one as unset', () => {
    expect(loadWorkerEnv({ ...valid, WORKER_HEALTH_PORT: '4001' }).WORKER_HEALTH_PORT).toBe(4001);
    expect(loadWorkerEnv({ ...valid, WORKER_HEALTH_PORT: '' }).WORKER_HEALTH_PORT).toBe(3001);
  });

  it('Rejects a missing DATABASE_URL, naming the worker', () => {
    expect(() => loadWorkerEnv({})).toThrow(/worker cannot start[\s\S]*DATABASE_URL/);
  });

  it('Rejects an out-of-range health port', () => {
    expect(() => loadWorkerEnv({ ...valid, WORKER_HEALTH_PORT: '70000' })).toThrow(
      /WORKER_HEALTH_PORT/,
    );
  });

  describe('Mail transport', () => {
    it.each(['MAIL_HOST', 'MAIL_PORT', 'MAIL_FROM'] as const)(
      'Fails fast when %s is missing or blank',
      (key) => {
        const { [key]: _omitted, ...without } = valid;

        expect(() => loadWorkerEnv(without)).toThrow(new RegExp(key));
        expect(() => loadWorkerEnv({ ...valid, [key]: '' })).toThrow(new RegExp(key));
      },
    );

    it('Rejects a sender that is not an email address', () => {
      expect(() => loadWorkerEnv({ ...valid, MAIL_FROM: 'PhysioBook' })).toThrow(/MAIL_FROM/);
    });

    it('Rejects an out-of-range port', () => {
      expect(() => loadWorkerEnv({ ...valid, MAIL_PORT: '70000' })).toThrow(/MAIL_PORT/);
    });

    it('Reads MAIL_SECURE as a boolean and refuses anything but true/false', () => {
      expect(loadWorkerEnv({ ...valid, MAIL_SECURE: 'true' }).MAIL_SECURE).toBe(true);
      expect(loadWorkerEnv({ ...valid, MAIL_SECURE: '' }).MAIL_SECURE).toBe(false);
      expect(() => loadWorkerEnv({ ...valid, MAIL_SECURE: 'yes' })).toThrow(/MAIL_SECURE/);
    });

    it('Accepts credentials given as a pair', () => {
      const env = loadWorkerEnv({ ...valid, MAIL_USER: 'apikey', MAIL_PASSWORD: 's3cret' });

      expect(env.MAIL_USER).toBe('apikey');
      expect(env.MAIL_PASSWORD).toBe('s3cret');
    });

    it('Rejects a user without a password and a password without a user', () => {
      expect(() => loadWorkerEnv({ ...valid, MAIL_USER: 'apikey' })).toThrow(/MAIL_PASSWORD/);
      expect(() => loadWorkerEnv({ ...valid, MAIL_PASSWORD: 's3cret' })).toThrow(/MAIL_USER/);
    });

    it('Never puts the mail password in the error message', () => {
      const secret = 'smtp-secret-value';

      expect(() => loadWorkerEnv({ ...valid, MAIL_HOST: '', MAIL_PASSWORD: secret })).toThrow(
        expect.not.stringContaining(secret) as unknown as string,
      );
    });
  });
});
