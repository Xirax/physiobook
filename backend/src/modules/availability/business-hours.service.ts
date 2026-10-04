import { businessHours, type Database } from '@physiobook/db';
import type { BusinessHoursWindow, WeeklyBusinessHours } from '@physiobook/shared';
import { asc, sql } from 'drizzle-orm';

export interface BusinessHoursDependencies {
  db: Database;
}

type Executor = Pick<Database, 'select'>;

// Postgres renders TIME as HH:MM:SS; the contract speaks HH:MM.
const toTimeOfDay = (value: string): string => value.slice(0, 5);

async function readWeek(executor: Executor): Promise<WeeklyBusinessHours> {
  const rows = await executor
    .select({
      dayOfWeek: businessHours.dayOfWeek,
      opensAt: businessHours.opensAt,
      closesAt: businessHours.closesAt,
    })
    .from(businessHours)
    .orderBy(asc(businessHours.dayOfWeek), asc(businessHours.opensAt));

  return {
    windows: rows.map((row): BusinessHoursWindow => ({
      day_of_week: row.dayOfWeek,
      opens_at: toTimeOfDay(row.opensAt),
      closes_at: toTimeOfDay(row.closesAt),
    })),
  };
}

export async function getBusinessHours({
  db,
}: BusinessHoursDependencies): Promise<WeeklyBusinessHours> {
  return readWeek(db);
}

export async function replaceBusinessHours(
  input: WeeklyBusinessHours,
  { db }: BusinessHoursDependencies,
): Promise<WeeklyBusinessHours> {
  return db.transaction(async (tx) => {
    // Without this, two concurrent replaces under READ COMMITTED each delete
    // only the rows their snapshot saw and both commit, leaving the union of
    // two weeks. SHARE ROW EXCLUSIVE conflicts with itself but not with plain
    // reads, so GET keeps answering with the previous week until commit.
    await tx.execute(sql`LOCK TABLE ${businessHours} IN SHARE ROW EXCLUSIVE MODE`);

    await tx.delete(businessHours);

    if (input.windows.length > 0) {
      await tx.insert(businessHours).values(
        input.windows.map((window) => ({
          dayOfWeek: window.day_of_week,
          opensAt: window.opens_at,
          closesAt: window.closes_at,
        })),
      );
    }

    return readWeek(tx);
  });
}
