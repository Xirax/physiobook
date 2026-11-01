import { users, type Database } from '@physiobook/db';
import { eq } from 'drizzle-orm';

// The single admin is practitioner #1 (SCHEMA.md §2.5); users_single_admin_idx
// guarantees there is exactly one.
export async function findPractitionerId(db: Database): Promise<string> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .limit(1);

  if (admin === undefined) throw new Error('the practitioner (admin) user is missing');

  return admin.id;
}
