import type { Slot, SlotsQuery } from '@physiobook/shared';

const MS_PER_DAY = 86_400_000;

// Pinned rather than left to the browser, so every screen and its tests read
// the same whatever machine renders them.
const LOCALE = 'en-GB';

/** `en-CA` formats a date as YYYY-MM-DD, the shape the /slots query takes. */
export function calendarDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Calendar arithmetic on a YYYY-MM-DD date, free of any timezone or DST. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `days` consecutive calendar days starting at `from`, both ends inclusive. */
export function dayRange(from: string, days: number): SlotsQuery {
  return { from, to: addDays(from, days - 1) };
}

/**
 * Two YYYY-MM-DD dates as "2 November – 8 November 2026". The end always
 * carries its year and the start does too when the range crosses a year end,
 * since the booking horizon routinely does. The dates name calendar days, so
 * they are formatted in UTC and no timezone moves them.
 */
export function dateRangeLabel(from: string, to: string): string {
  const withYear = new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const withoutYear = new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  });
  const start = (from.slice(0, 4) === to.slice(0, 4) ? withoutYear : withYear).format(
    Date.parse(from),
  );

  return `${start} – ${withYear.format(Date.parse(to))}`;
}

/** A slot in full, as "Monday, 2 November 2026, 09:00–10:00" on the practice's wall clock. */
export function slotLabel({ start, end }: Slot, timezone: string): string {
  const day = new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${day.format(new Date(start))}, ${time.format(new Date(start))}–${time.format(new Date(end))}`;
}

export interface SlotDay {
  date: string;
  label: string;
  times: { start: string; label: string }[];
}

export function groupSlotsByDay(slots: readonly Slot[], timezone: string): SlotDay[] {
  const dayLabel = new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const timeLabel = new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });

  const days = new Map<string, SlotDay>();

  for (const { start } of slots) {
    const instant = new Date(start);
    const date = calendarDate(instant, timezone);
    const day = days.get(date) ?? { date, label: dayLabel.format(instant), times: [] };

    day.times.push({ start, label: timeLabel.format(instant) });
    days.set(date, day);
  }

  return [...days.values()];
}
