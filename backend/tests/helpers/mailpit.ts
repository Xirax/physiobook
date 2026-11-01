import { randomUUID } from 'node:crypto';

import { inject, vi } from 'vitest';
import { z } from 'zod';

/**
 * Reads the run's shared Mailpit (ticket 4.2) through its HTTP API.
 *
 * The inbox is shared by every test file, so a test never clears it: it sends
 * to an address from `uniqueRecipient()` and looks only for that address.
 *
 * Usage:
 *
 *   const to = uniqueRecipient('reminder');
 *   await mailer.send({ to, ...template(data) });
 *   const message = await waitForMessage(to);
 */

const addressSchema = z.object({ Name: z.string(), Address: z.string() });

const searchSchema = z.object({
  messages: z.array(z.object({ ID: z.string() })),
});

const messageSchema = z.object({
  ID: z.string(),
  From: addressSchema,
  To: z.array(addressSchema),
  Subject: z.string(),
  Text: z.string(),
  HTML: z.string(),
});

export type MailpitMessage = z.infer<typeof messageSchema>;

export function mailpitConfig(): { host: string; smtpPort: number; apiUrl: string } {
  return inject('mailpit');
}

export function uniqueRecipient(label: string): string {
  return `${label}-${randomUUID()}@test.physiobook.local`;
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(new URL(path, mailpitConfig().apiUrl));

  if (!response.ok) {
    throw new Error(`Mailpit ${path} answered ${String(response.status)}`);
  }

  return response.json();
}

export async function findMessages(recipient: string): Promise<MailpitMessage[]> {
  const query = new URLSearchParams({ query: `to:"${recipient}"` });
  const { messages } = searchSchema.parse(await getJson(`/api/v1/search?${query.toString()}`));

  return Promise.all(
    messages.map(async ({ ID }) => messageSchema.parse(await getJson(`/api/v1/message/${ID}`))),
  );
}

/**
 * SMTP delivery and Mailpit's indexing are asynchronous, so a message the
 * mailer has just handed over may not be searchable yet — hence the poll.
 */
export async function waitForMessage(
  recipient: string,
  { timeout = 5_000 }: { timeout?: number } = {},
): Promise<MailpitMessage> {
  return vi.waitFor(
    async () => {
      const [message, ...rest] = await findMessages(recipient);

      if (message === undefined) throw new Error(`No mail for ${recipient} in Mailpit yet`);
      if (rest.length > 0) {
        throw new Error(`Expected one mail for ${recipient}, found ${String(rest.length + 1)}`);
      }

      return message;
    },
    { timeout, interval: 100 },
  );
}
