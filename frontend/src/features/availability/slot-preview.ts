import type { Slot, SlotsQuery } from '@physiobook/shared';

export const PREVIEW_DAYS = 7;

const MS_PER_DAY = 86_400_000;

// Pinned rather than left to the browser, so the admin's preview and its tests
// read the same whatever machine renders them.
const LOCALE = 'en-GB';

/** `en-CA` formats a date as YYYY-MM-DD, the shape the /slots query takes. */
const calendarDate = (instant: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

/**
 * Today and the following days, counted in the practice timezone — not the
 * browser's — because that is the calendar the slot grid is built on.
 */
export function previewRange(now: Date, timezone: string): SlotsQuery {
  const from = calendarDate(now, timezone);
  const to = new Date(Date.parse(from) + (PREVIEW_DAYS - 1) * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

  return { from, to };
}

export interface PreviewDay {
  date: string;
  label: string;
  times: { start: string; label: string }[];
}

export function groupSlotsByDay(slots: readonly Slot[], timezone: string): PreviewDay[] {
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

  const days = new Map<string, PreviewDay>();

  for (const { start } of slots) {
    const instant = new Date(start);
    const date = calendarDate(instant, timezone);
    const day = days.get(date) ?? { date, label: dayLabel.format(instant), times: [] };

    day.times.push({ start, label: timeLabel.format(instant) });
    days.set(date, day);
  }

  return [...days.values()];
}
