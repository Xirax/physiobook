import { createTransport } from 'nodemailer';

import type { WorkerEnv } from '../config/env.js';
import type { MailContent } from './mail-template.js';

export interface MailerConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  from: string;
}

export interface MailMessage extends MailContent {
  to: string;
}

/**
 * The one way the app sends mail. `send` rejects on any transport failure so
 * a pg-boss job fails and is retried, rather than reporting a mail it lost.
 */
export interface Mailer {
  send: (message: MailMessage) => Promise<void>;
  close: () => void;
}

export function mailerConfigFromEnv(env: WorkerEnv): MailerConfig {
  return {
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: env.MAIL_SECURE,
    ...(env.MAIL_USER !== undefined && env.MAIL_PASSWORD !== undefined
      ? { auth: { user: env.MAIL_USER, pass: env.MAIL_PASSWORD } }
      : {}),
    from: env.MAIL_FROM,
  };
}

export function createMailer({ host, port, secure, auth, from }: MailerConfig): Mailer {
  const transport = createTransport({ host, port, secure, ...(auth ? { auth } : {}) });

  return {
    send: async ({ to, subject, text, html }) => {
      await transport.sendMail({ from, to, subject, text, html });
    },
    close: () => {
      transport.close();
    },
  };
}
