import type { BusinessHoursWindow } from '@physiobook/shared';
import { DateTime } from 'luxon';

export const BOOKING_HORIZON_DAYS = 62;

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface SlotGridInput {
  timezone: string;
  windows: readonly BusinessHoursWindow[];
  /** Practice-tz calendar dates, both inclusive. */
  from: string;
  to: string;
  /** Occupied ranges to subtract; the caller chooses which kinds count. */
  blocks?: readonly TimeRange[];
  /** Keep only slots starting strictly inside this range; omit to keep past and far-future slots. */
  within?: { after: Date; before: Date };
}

export function bookingWindow(now: Date): { after: Date; before: Date } {
  return { after: now, before: new Date(now.getTime() + BOOKING_HORIZON_DAYS * MS_PER_DAY) };
}

const minutesOf = (timeOfDay: string): number => {
  const [hours, minutes] = timeOfDay.split(':').map(Number);
  return (hours ?? 0) * MINUTES_PER_HOUR + (minutes ?? 0);
};

// Luxon resolves a repeated fall-back hour to its later offset; the domain rule
// is the earlier one, so step back an hour whenever that lands on the same
// wall-clock hour. Assumes whole-hour DST shifts, as SCHEMA.md §2.5 does.
function startOfLocalHour(day: DateTime, hour: number): DateTime | undefined {
  const start = day.set({ hour });
  if (start.hour !== hour) return undefined;

  const earlier = start.minus({ hours: 1 });
  return earlier.hour === hour ? earlier : start;
}

// On a day whose UTC offset holds from its midnight to the next (every day but
// a DST switch), local hour to UTC is plain arithmetic. Only switch days, and
// days whose midnight does not exist, pay for Luxon's per-hour resolution.
function slotStartsOn(day: DateTime, nextDay: DateTime, hours: readonly number[]): Date[] {
  if (day.hour !== 0 || day.offset !== nextDay.offset) {
    return hours.flatMap((hour) => startOfLocalHour(day, hour)?.toJSDate() ?? []);
  }

  const midnight = Date.UTC(day.year, day.month - 1, day.day) - day.offset * MS_PER_MINUTE;
  return hours.map((hour) => new Date(midnight + hour * MS_PER_HOUR));
}

function hoursInside(window: BusinessHoursWindow): number[] {
  const firstHour = Math.ceil(minutesOf(window.opens_at) / MINUTES_PER_HOUR);
  const lastHour = Math.floor(minutesOf(window.closes_at) / MINUTES_PER_HOUR) - 1;

  const hours: number[] = [];
  for (let hour = firstHour; hour <= lastHour; hour += 1) hours.push(hour);
  return hours;
}

/** Open slot hours per day of week (0 = Sunday), ascending. */
function openHoursByWeekday(windows: readonly BusinessHoursWindow[]): number[][] {
  const byWeekday: number[][] = Array.from({ length: 7 }, () => []);
  for (const window of windows) byWeekday[window.day_of_week]?.push(...hoursInside(window));
  for (const hours of byWeekday) hours.sort((a, b) => a - b);
  return byWeekday;
}

// Queried with slots in ascending start order, so a block is skipped for good
// once it ends at or before a slot's start. The first block not skipped then
// has the earliest start of all that remain: if it starts before the slot ends
// it overlaps the slot, and if it does not, no later block can.
function blockOverlapChecker(blocks: readonly TimeRange[]): (slot: TimeRange) => boolean {
  const byStart = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  let next = 0;

  return (slot) => {
    let block = byStart[next];
    while (block !== undefined && block.end <= slot.start) block = byStart[++next];
    return block !== undefined && block.start < slot.end;
  };
}

export function generateSlots({
  timezone,
  windows,
  from,
  to,
  blocks = [],
  within,
}: SlotGridInput): TimeRange[] {
  const hoursByWeekday = openHoursByWeekday(windows);
  const isBlocked = blockOverlapChecker(blocks);
  const isWithin = (start: Date): boolean =>
    within === undefined || (start > within.after && start < within.before);

  const slots: TimeRange[] = [];
  const dayCount = (Date.parse(to) - Date.parse(from)) / MS_PER_DAY + 1;
  const firstDay = DateTime.fromISO(from, { zone: timezone });

  // Each day is derived from the first, not from the previous one: stepping
  // from a day whose midnight did not exist would carry its shifted 01:00 on.
  let day = firstDay;
  for (let index = 1; index <= dayCount; index += 1) {
    const nextDay = firstDay.plus({ days: index });
    const hours = hoursByWeekday[day.weekday % 7] ?? [];

    for (const start of slotStartsOn(day, nextDay, hours)) {
      const slot = { start, end: new Date(start.getTime() + MS_PER_HOUR) };
      if (isWithin(start) && !isBlocked(slot)) slots.push(slot);
    }

    day = nextDay;
  }

  return slots;
}

/**
 * Whether `start` is a slot of the bookable grid: on a practice-local hour,
 * inside an open window, and inside the booking window. Deliberately says
 * nothing about freeness — the EXCLUDE constraint decides that (ticket 3.2).
 */
export function isSlotBookable(
  start: Date,
  {
    timezone,
    windows,
    now,
  }: { timezone: string; windows: readonly BusinessHoursWindow[]; now: Date },
): boolean {
  const day = DateTime.fromJSDate(start, { zone: timezone }).toISODate();
  if (day === null) return false;

  return generateSlots({ timezone, windows, from: day, to: day, within: bookingWindow(now) }).some(
    (slot) => slot.start.getTime() === start.getTime(),
  );
}
