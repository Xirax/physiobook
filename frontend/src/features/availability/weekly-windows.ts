import { weeklyBusinessHoursSchema } from '@physiobook/shared';
import type { BusinessHoursWindow } from '@physiobook/shared';

/** The editor's row: a window plus a stable React key, since windows have no id. */
export interface WindowRow extends BusinessHoursWindow {
  key: string;
}

export interface RowErrors {
  opens_at?: string;
  closes_at?: string;
  overlap?: string;
}

/** Monday first: the working week reads left to right, the weekend at its end. */
export const WEEK = [
  { day: 1, name: 'Monday' },
  { day: 2, name: 'Tuesday' },
  { day: 3, name: 'Wednesday' },
  { day: 4, name: 'Thursday' },
  { day: 5, name: 'Friday' },
  { day: 6, name: 'Saturday' },
  { day: 0, name: 'Sunday' },
] as const;

let lastKey = 0;

export const withKey = (window: BusinessHoursWindow): WindowRow => {
  lastKey += 1;

  return { ...window, key: `window-${String(lastKey)}` };
};

const DEFAULT_OPEN = '09:00';
const DEFAULT_CLOSE = '17:00';
const LAST_MINUTE = '23:59';

const pad = (value: number) => String(value).padStart(2, '0');

const oneHourLater = (time: string): string => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);

  return hours >= 23 ? LAST_MINUTE : `${pad(hours + 1)}:${pad(minutes)}`;
};

export const toWindows = (rows: readonly WindowRow[]): BusinessHoursWindow[] =>
  rows.map(({ day_of_week, opens_at, closes_at }) => ({ day_of_week, opens_at, closes_at }));

/** The order the API answers in, so an unchanged week compares equal whatever order it was edited in. */
export const sortWindows = (windows: readonly BusinessHoursWindow[]): BusinessHoursWindow[] =>
  [...windows].sort(
    (a, b) =>
      a.day_of_week - b.day_of_week ||
      a.opens_at.localeCompare(b.opens_at) ||
      a.closes_at.localeCompare(b.closes_at),
  );

export const sameWeek = (
  a: readonly BusinessHoursWindow[],
  b: readonly BusinessHoursWindow[],
): boolean => JSON.stringify(sortWindows(a)) === JSON.stringify(sortWindows(b));

/** A split shift picks up where the day's last window closes, so it does not start out overlapping. */
export const nextWindowFor = (
  day: number,
  rows: readonly WindowRow[],
): Omit<BusinessHoursWindow, 'day_of_week'> => {
  const latestClose = rows
    .filter((row) => row.day_of_week === day)
    .map((row) => row.closes_at)
    .sort()
    .at(-1);

  return latestClose === undefined
    ? { opens_at: DEFAULT_OPEN, closes_at: DEFAULT_CLOSE }
    : { opens_at: latestClose, closes_at: oneHourLater(latestClose) };
};

/** The shared contract's verdict on each row, so the editor blocks exactly what the API would refuse. */
export const validateRows = (rows: readonly WindowRow[]): Map<string, RowErrors> => {
  const errors = new Map<string, RowErrors>();
  const result = weeklyBusinessHoursSchema.safeParse({ windows: toWindows(rows) });

  if (result.success) return errors;

  for (const { path, message } of result.error.issues) {
    const [, index, field] = path;
    const row = typeof index === 'number' ? rows[index] : undefined;

    if (row === undefined) continue;

    const rowErrors = errors.get(row.key) ?? {};
    const slot = field === 'opens_at' || field === 'closes_at' ? field : 'overlap';

    rowErrors[slot] ??= message;
    errors.set(row.key, rowErrors);
  }

  return errors;
};
