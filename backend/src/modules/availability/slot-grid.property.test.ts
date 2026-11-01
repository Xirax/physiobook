import type { BusinessHoursWindow } from '@physiobook/shared';
import fc from 'fast-check';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { bookingWindow, generateSlots, isSlotBookable, type TimeRange } from './slot-grid.js';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

const toTimeOfDay = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const minutesOf = (timeOfDay: string): number => {
  const [hours = 0, minutes = 0] = timeOfDay.split(':').map(Number);
  return hours * 60 + minutes;
};

// Distinct sorted boundaries paired off give a day's windows: each closes after
// it opens and none overlaps the next, as the shared contract requires.
const dayWindows = (day_of_week: number): fc.Arbitrary<BusinessHoursWindow[]> =>
  fc.uniqueArray(fc.integer({ min: 0, max: 23 * 60 + 59 }), { maxLength: 6 }).map((boundaries) => {
    const sorted = [...boundaries].sort((a, b) => a - b);
    const windows: BusinessHoursWindow[] = [];
    for (let index = 0; index + 1 < sorted.length; index += 2) {
      windows.push({
        day_of_week,
        opens_at: toTimeOfDay(sorted[index] ?? 0),
        closes_at: toTimeOfDay(sorted[index + 1] ?? 0),
      });
    }
    return windows;
  });

const week = fc.tuple(...[0, 1, 2, 3, 4, 5, 6].map(dayWindows)).map((days) => days.flat());

const scenario = fc
  .record({
    timezone: fc.constantFrom('Europe/Warsaw', 'America/New_York', 'America/Santiago', 'UTC'),
    firstDay: fc.integer({ min: 0, max: 364 }),
    dayCount: fc.integer({ min: 1, max: 14 }),
    windows: week,
    blocks: fc.array(
      fc.record({
        offsetMinutes: fc.integer({ min: -24 * 60, max: 16 * 24 * 60 }),
        durationMinutes: fc.integer({ min: 1, max: 10 * 60 }),
      }),
      { maxLength: 15 },
    ),
    nowOffsetMinutes: fc.integer({ min: -24 * 60, max: 16 * 24 * 60 }),
  })
  .map(({ timezone, firstDay, dayCount, windows, blocks, nowOffsetMinutes }) => {
    const first = DateTime.fromISO('2026-01-01', { zone: 'UTC' }).plus({ days: firstDay });
    const origin = first.toMillis();
    const at = (minutes: number): Date => new Date(origin + minutes * MS_PER_MINUTE);

    return {
      timezone,
      windows,
      from: first.toISODate() ?? '',
      to: first.plus({ days: dayCount - 1 }).toISODate() ?? '',
      blocks: blocks.map(({ offsetMinutes, durationMinutes }): TimeRange => ({
        start: at(offsetMinutes),
        end: at(offsetMinutes + durationMinutes),
      })),
      now: at(nowOffsetMinutes),
    };
  });

const overlaps = (a: TimeRange, b: TimeRange): boolean => a.start < b.end && b.start < a.end;

describe('generateSlots properties', () => {
  it('Emits one-hour slots on the local hour, in order, never overlapping each other or a block', () => {
    fc.assert(
      fc.property(scenario, ({ timezone, windows, from, to, blocks }) => {
        const slots = generateSlots({ timezone, windows, from, to, blocks });

        slots.forEach((slot, index) => {
          const local = DateTime.fromJSDate(slot.start, { zone: timezone });
          expect(local.minute).toBe(0);
          expect(local.second).toBe(0);
          expect(local.millisecond).toBe(0);
          expect(slot.end.getTime() - slot.start.getTime()).toBe(MS_PER_HOUR);

          const next = slots[index + 1];
          if (next !== undefined) expect(slot.end <= next.start).toBe(true);

          expect(blocks.some((block) => overlaps(slot, block))).toBe(false);
        });
      }),
    );
  });

  it('Emits only slots that fit inside one open window on their local day', () => {
    fc.assert(
      fc.property(scenario, ({ timezone, windows, from, to }) => {
        for (const slot of generateSlots({ timezone, windows, from, to })) {
          const local = DateTime.fromJSDate(slot.start, { zone: timezone });
          const opensBy = local.hour * 60;

          const containing = windows.filter(
            (window) =>
              window.day_of_week === local.weekday % 7 &&
              minutesOf(window.opens_at) <= opensBy &&
              opensBy + 60 <= minutesOf(window.closes_at),
          );
          expect(containing).toHaveLength(1);
        }
      }),
    );
  });

  it('Drops a slot only because a block overlaps it', () => {
    fc.assert(
      fc.property(scenario, ({ timezone, windows, from, to, blocks }) => {
        const free = generateSlots({ timezone, windows, from, to }).filter(
          (slot) => !blocks.some((block) => overlaps(slot, block)),
        );

        expect(generateSlots({ timezone, windows, from, to, blocks })).toEqual(free);
      }),
    );
  });

  it('Keeps only slots inside the booking window, and isSlotBookable accepts each of them', () => {
    fc.assert(
      fc.property(scenario, ({ timezone, windows, from, to, now }) => {
        const within = bookingWindow(now);
        const slots = generateSlots({ timezone, windows, from, to, within });

        for (const slot of slots) {
          expect(slot.start > within.after && slot.start < within.before).toBe(true);
          expect(isSlotBookable(slot.start, { timezone, windows, now })).toBe(true);
        }
      }),
    );
  });
});
