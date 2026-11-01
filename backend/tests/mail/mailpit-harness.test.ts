import { describe, expect, it } from 'vitest';

import {
  findMessages,
  mailpitConfig,
  uniqueRecipient,
  waitForMessage,
} from '../helpers/mailpit.js';

/**
 * Tests of the Mailpit harness itself (ticket 4.2), seeded through Mailpit's
 * own send API so they prove the helper independently of the app's mailer.
 */
async function seed(to: string, subject: string): Promise<void> {
  const response = await fetch(new URL('/api/v1/send', mailpitConfig().apiUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      From: { Email: 'harness@test.physiobook.local' },
      To: [{ Email: to }],
      Subject: subject,
      Text: `text of ${subject}`,
      HTML: `<p>html of ${subject}</p>`,
    }),
  });

  expect(response.ok).toBe(true);
}

describe('Mailpit harness', () => {
  it('finds a message by recipient with its subject, text and html', async () => {
    const to = uniqueRecipient('harness');
    await seed(to, 'Harness check');

    const message = await waitForMessage(to);

    expect(message.To.map(({ Address }) => Address)).toEqual([to]);
    expect(message.Subject).toBe('Harness check');
    expect(message.Text).toContain('text of Harness check');
    expect(message.HTML).toContain('<p>html of Harness check</p>');
  });

  it('sees only the mail addressed to the recipient it is asked about', async () => {
    const mine = uniqueRecipient('mine');
    const theirs = uniqueRecipient('theirs');
    await seed(theirs, 'Not mine');
    await seed(mine, 'Mine');

    await waitForMessage(mine);
    const messages = await findMessages(mine);

    expect(messages.map(({ Subject }) => Subject)).toEqual(['Mine']);
  });

  it('gives up on a recipient that never receives anything', async () => {
    await expect(waitForMessage(uniqueRecipient('nobody'), { timeout: 300 })).rejects.toThrow(
      /No mail for/,
    );
  });
});
