import { calendarBlocks } from '@physiobook/db';
import { sql } from 'drizzle-orm';

// Drizzle's pg driver hands a selected timestamptz expression back as a string.
const toDate = (value: unknown): Date => new Date(value as string);

const toInstant = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export const periodStart = sql`lower(${calendarBlocks.period})`.mapWith(toDate);
export const periodEnd = sql`upper(${calendarBlocks.period})`.mapWith(toDate);

export const tstzrangeOf = ({ start, end }: { start: Date | string; end: Date | string }) =>
  sql`tstzrange(${toInstant(start)}, ${toInstant(end)}, '[)')`;
