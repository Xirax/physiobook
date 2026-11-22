import { notificationLog, type Database } from '@physiobook/db';

import type { MailContent } from '../lib/mail-template.js';
import type { Mailer } from '../lib/mailer.js';

export interface NotificationDependencies {
  db: Database;
  mailer: Mailer;
  now: () => Date;
}

export interface Notification {
  dedupeKey: string;
  type: 'reminder_user' | 'reminder_admin_grouped';
  recipientRole: 'user' | 'admin';
  recipientUserId: string;
  to: string;
  content: MailContent;
}

/**
 * The claim and the send share a transaction: a failed send rolls the claim
 * back so pg-boss can retry, and a concurrent duplicate blocks on the unique
 * dedupe_key until this commits, then finds the key taken.
 */
export async function claimAndSend(
  { to, content, ...entry }: Notification,
  { db, mailer, now }: NotificationDependencies,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(notificationLog)
      .values({ ...entry, sentAt: now(), payload: { to, subject: content.subject } })
      .onConflictDoNothing({ target: notificationLog.dedupeKey })
      .returning({ id: notificationLog.id });

    if (claimed === undefined) return;

    await mailer.send({ to, ...content });
  });
}
