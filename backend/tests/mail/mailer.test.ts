import { type AddressInfo, createServer } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defineTemplate } from '../../src/lib/mail-template.js';
import { createMailer, type Mailer } from '../../src/lib/mailer.js';
import { mailpitConfig, uniqueRecipient, waitForMessage } from '../helpers/mailpit.js';

const FROM = 'no-reply@physiobook.local';

const sample = defineTemplate((data: { name: string }) => ({
  subject: `Sample for ${data.name}`,
  paragraphs: [`Hello ${data.name} & co.`],
}));

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));

  return port;
}

describe('mailer over SMTP (Mailpit)', () => {
  let mailer: Mailer;

  beforeAll(() => {
    const { host, smtpPort } = mailpitConfig();
    mailer = createMailer({ host, port: smtpPort, secure: false, from: FROM });
  });

  afterAll(() => {
    mailer?.close();
  });

  it('delivers a templated mail with its subject, recipient, sender, text and html', async () => {
    const to = uniqueRecipient('mailer');

    await mailer.send({ to, ...sample({ name: 'Ada' }) });
    const message = await waitForMessage(to);

    expect(message.Subject).toBe('Sample for Ada');
    expect(message.To.map(({ Address }) => Address)).toEqual([to]);
    expect(message.From.Address).toBe(FROM);
    expect(message.Text.trim()).toBe('Hello Ada & co.');
    expect(message.HTML).toContain('Hello Ada &amp; co.');
  });

  it('rejects when the SMTP server cannot be reached, so a job can retry', async () => {
    const unreachable = createMailer({
      host: '127.0.0.1',
      port: await closedPort(),
      secure: false,
      from: FROM,
    });

    try {
      await expect(
        unreachable.send({ to: uniqueRecipient('lost'), ...sample({ name: 'Ada' }) }),
      ).rejects.toThrow();
    } finally {
      unreachable.close();
    }
  });
});
