import { BOOKING_HORIZON_DAYS } from '@physiobook/shared';
import type { BusinessHoursWindow } from '@physiobook/shared';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { bookingWindow, generateSlots, isSlotBookable, type TimeRange } from './slot-grid.js';

const TIMEZONE = 'Europe/Warsaw';

const window = (day_of_week: number, opens_at: string, closes_at: string): BusinessHoursWindow => ({
  day_of_week,
  opens_at,
  closes_at,
});

const range = (start: string, end: string): TimeRange => ({
  start: new Date(start),
  end: new Date(end),
});

const startsOf = (slots: TimeRange[]): string[] => slots.map((slot) => slot.start.toISOString());

const WEEKDAYS_9_TO_17 = [1, 2, 3, 4, 5].map((day) => window(day, '09:00', '17:00'));

// 2026-11-09 is a Monday; Warsaw is on CET (UTC+1) after 25 October.
const MONDAY = '2026-11-09';

describe('generateSlots', () => {
  it('Emits every on-the-hour slot of a normal Mon-Fri 09:00-17:00 week, and none at the weekend', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: WEEKDAYS_9_TO_17,
      from: MONDAY,
      to: '2026-11-15',
    });

    expect(slots).toHaveLength(5 * 8);
    expect(startsOf(slots).slice(0, 8)).toEqual([
      '2026-11-09T08:00:00.000Z',
      '2026-11-09T09:00:00.000Z',
      '2026-11-09T10:00:00.000Z',
      '2026-11-09T11:00:00.000Z',
      '2026-11-09T12:00:00.000Z',
      '2026-11-09T13:00:00.000Z',
      '2026-11-09T14:00:00.000Z',
      '2026-11-09T15:00:00.000Z',
    ]);
    expect(startsOf(slots).at(-1)).toBe('2026-11-13T15:00:00.000Z');
  });

  it('Makes every slot exactly one hour long', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: WEEKDAYS_9_TO_17,
      from: MONDAY,
      to: MONDAY,
    });

    for (const slot of slots) expect(slot.end.getTime() - slot.start.getTime()).toBe(3_600_000);
  });

  it('Keeps only slots fully inside the window: 09:30-17:30 yields 10:00..16:00', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: [window(1, '09:30', '17:30')],
      from: MONDAY,
      to: MONDAY,
    });

    expect(startsOf(slots)).toEqual(
      [10, 11, 12, 13, 14, 15, 16].map(
        (hour) => `2026-11-09T${String(hour - 1).padStart(2, '0')}:00:00.000Z`,
      ),
    );
  });

  it('Emits no slot for a window shorter than a whole hour on the hour', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: [window(1, '09:15', '10:45'), window(1, '23:00', '23:59')],
      from: MONDAY,
      to: MONDAY,
    });

    expect(slots).toEqual([]);
  });

  it('Emits the slots of each window of a split shift and nothing in the gap', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: [window(1, '14:00', '16:00'), window(1, '09:00', '11:00')],
      from: MONDAY,
      to: MONDAY,
    });

    expect(startsOf(slots)).toEqual([
      '2026-11-09T08:00:00.000Z',
      '2026-11-09T09:00:00.000Z',
      '2026-11-09T13:00:00.000Z',
      '2026-11-09T14:00:00.000Z',
    ]);
  });

  it('Reads day_of_week 0 as Sunday', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: [window(0, '10:00', '11:00')],
      from: MONDAY,
      to: '2026-11-15',
    });

    expect(startsOf(slots)).toEqual(['2026-11-15T09:00:00.000Z']);
  });

  it('Emits nothing when the practice has no business hours', () => {
    expect(generateSlots({ timezone: TIMEZONE, windows: [], from: MONDAY, to: MONDAY })).toEqual(
      [],
    );
  });

  it('Emits no slots for a fully booked day', () => {
    const fullyBooked = [8, 9, 10, 11, 12, 13, 14, 15].map((hour) => {
      const start = `2026-11-09T${String(hour).padStart(2, '0')}:00:00Z`;
      const end = `2026-11-09T${String(hour + 1).padStart(2, '0')}:00:00Z`;
      return range(start, end);
    });

    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: WEEKDAYS_9_TO_17,
      from: MONDAY,
      to: MONDAY,
      blocks: fullyBooked,
    });

    expect(slots).toEqual([]);
  });

  it('Excludes every slot a time-off range touches, even partially', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: WEEKDAYS_9_TO_17,
      from: MONDAY,
      to: MONDAY,
      // 10:30-12:15 local
      blocks: [range('2026-11-09T09:30:00Z', '2026-11-09T11:15:00Z')],
    });

    expect(startsOf(slots)).toEqual([
      '2026-11-09T08:00:00.000Z',
      '2026-11-09T12:00:00.000Z',
      '2026-11-09T13:00:00.000Z',
      '2026-11-09T14:00:00.000Z',
      '2026-11-09T15:00:00.000Z',
    ]);
  });

  it('Does not exclude the slots either side of a block, which only touch it', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: [window(1, '09:00', '12:00')],
      from: MONDAY,
      to: MONDAY,
      blocks: [range('2026-11-09T09:00:00Z', '2026-11-09T10:00:00Z')],
    });

    expect(startsOf(slots)).toEqual(['2026-11-09T08:00:00.000Z', '2026-11-09T10:00:00.000Z']);
  });

  it('Excludes blocked slots whatever order the blocks come in, including a block nested in a longer one', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: WEEKDAYS_9_TO_17,
      from: MONDAY,
      to: '2026-11-10',
      blocks: [
        range('2026-11-10T14:00:00Z', '2026-11-10T15:00:00Z'),
        range('2026-11-09T09:00:00Z', '2026-11-09T13:00:00Z'),
        range('2026-11-09T10:00:00Z', '2026-11-09T11:00:00Z'),
        range('2026-11-09T15:00:00Z', '2026-11-10T09:00:00Z'),
      ],
    });

    expect(startsOf(slots)).toEqual([
      '2026-11-09T08:00:00.000Z',
      '2026-11-09T13:00:00.000Z',
      '2026-11-09T14:00:00.000Z',
      '2026-11-10T09:00:00.000Z',
      '2026-11-10T10:00:00.000Z',
      '2026-11-10T11:00:00.000Z',
      '2026-11-10T12:00:00.000Z',
      '2026-11-10T13:00:00.000Z',
      '2026-11-10T15:00:00.000Z',
    ]);
  });

  it('Skips the nonexistent hour on the spring-forward day (2026-03-29, 02:00 -> 03:00)', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: [window(0, '00:00', '06:00')],
      from: '2026-03-29',
      to: '2026-03-29',
    });

    // Local 00:00 and 01:00 are CET (UTC+1); 03:00 onwards is CEST (UTC+2).
    expect(startsOf(slots)).toEqual([
      '2026-03-28T23:00:00.000Z',
      '2026-03-29T00:00:00.000Z',
      '2026-03-29T01:00:00.000Z',
      '2026-03-29T02:00:00.000Z',
      '2026-03-29T03:00:00.000Z',
    ]);
  });

  it('Emits the repeated hour once, at the earlier offset, on the fall-back day (2026-10-25)', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: [window(0, '00:00', '06:00')],
      from: '2026-10-25',
      to: '2026-10-25',
    });

    // Local 02:00 happens at 00:00Z (CEST) and again at 01:00Z (CET).
    expect(startsOf(slots)).toEqual([
      '2026-10-24T22:00:00.000Z',
      '2026-10-24T23:00:00.000Z',
      '2026-10-25T00:00:00.000Z',
      '2026-10-25T02:00:00.000Z',
      '2026-10-25T03:00:00.000Z',
      '2026-10-25T04:00:00.000Z',
    ]);
  });

  it('Keeps the last day of a range that starts on a day whose midnight does not exist', () => {
    // America/Santiago springs forward at 00:00 on 2026-09-06, straight to 01:00.
    const slots = generateSlots({
      timezone: 'America/Santiago',
      windows: [window(0, '09:00', '10:00'), window(1, '09:00', '10:00')],
      from: '2026-09-06',
      to: '2026-09-07',
    });

    expect(startsOf(slots)).toEqual(['2026-09-06T12:00:00.000Z', '2026-09-07T12:00:00.000Z']);
  });

  it.each([
    'Europe/Warsaw',
    'America/New_York',
    'America/Santiago',
    'Asia/Beirut',
    'Australia/Sydney',
    'Asia/Kolkata',
    'Asia/Kathmandu',
  ])('Matches a UTC-to-local oracle for every hour of 2026 in %s', (timezone) => {
    const expected: string[] = [];
    const seen = new Set<string>();
    for (
      let instant = Date.parse('2025-12-31T00:00:00Z');
      instant < Date.parse('2027-01-02T00:00:00Z');
      instant += 15 * 60_000
    ) {
      const local = DateTime.fromMillis(instant, { zone: timezone });
      const key = local.toFormat('yyyy-MM-dd HH');
      if (local.year !== 2026 || local.minute !== 0 || local.hour > 22 || seen.has(key)) continue;
      seen.add(key);
      expected.push(new Date(instant).toISOString());
    }

    const slots = generateSlots({
      timezone,
      windows: [0, 1, 2, 3, 4, 5, 6].map((day) => window(day, '00:00', '23:59')),
      from: '2026-01-01',
      to: '2026-12-31',
    });

    expect(startsOf(slots)).toEqual(expected);
  });

  it('Keeps only slots starting strictly after now inside the booking window', () => {
    // 11:00 local: the 11:00 slot starts exactly now and is no longer bookable.
    const now = new Date('2026-11-09T10:00:00Z');

    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: WEEKDAYS_9_TO_17,
      from: MONDAY,
      to: MONDAY,
      within: bookingWindow(now),
    });

    expect(startsOf(slots)[0]).toBe('2026-11-09T11:00:00.000Z');
    expect(slots).toHaveLength(5);
  });

  it(`Drops slots starting ${BOOKING_HORIZON_DAYS} days or more after now`, () => {
    const now = new Date('2026-11-09T09:00:00Z');
    const horizon = '2027-01-10';

    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: [window(0, '09:00', '12:00')],
      from: horizon,
      to: horizon,
      within: bookingWindow(now),
    });

    // 2027-01-10T09:00Z is exactly now + 62 days, so only the 09:00 local slot survives.
    expect(startsOf(slots)).toEqual(['2027-01-10T08:00:00.000Z']);
  });

  it('Includes past slots when no booking window is given', () => {
    const slots = generateSlots({
      timezone: TIMEZONE,
      windows: WEEKDAYS_9_TO_17,
      from: '2020-01-06',
      to: '2020-01-06',
    });

    expect(slots).toHaveLength(8);
  });
});

describe('isSlotBookable', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const context = { timezone: TIMEZONE, windows: WEEKDAYS_9_TO_17, now };

  it('Accepts an on-the-hour slot inside business hours and the booking window', () => {
    expect(isSlotBookable(new Date('2026-11-09T08:00:00Z'), context)).toBe(true);
  });

  it('Rejects a start that is not on the hour', () => {
    expect(isSlotBookable(new Date('2026-11-09T08:30:00Z'), context)).toBe(false);
    expect(isSlotBookable(new Date('2026-11-09T08:00:01Z'), context)).toBe(false);
  });

  it('Rejects a slot outside business hours', () => {
    expect(isSlotBookable(new Date('2026-11-09T16:00:00Z'), context)).toBe(false);
    expect(isSlotBookable(new Date('2026-11-08T09:00:00Z'), context)).toBe(false);
  });

  it('Rejects a slot that starts at or before now', () => {
    const atNow = { ...context, now: new Date('2026-11-09T08:00:00Z') };

    expect(isSlotBookable(new Date('2026-11-09T08:00:00Z'), atNow)).toBe(false);
    expect(isSlotBookable(new Date('2026-11-02T08:00:00Z'), atNow)).toBe(false);
  });

  it('Rejects a slot beyond the booking horizon', () => {
    expect(isSlotBookable(new Date('2027-01-04T08:00:00Z'), context)).toBe(false);
  });

  it('Accepts only the earlier occurrence of the repeated fall-back hour', () => {
    const fallBack = {
      timezone: TIMEZONE,
      windows: [window(0, '00:00', '06:00')],
      now: new Date('2026-10-01T00:00:00Z'),
    };

    expect(isSlotBookable(new Date('2026-10-25T00:00:00Z'), fallBack)).toBe(true);
    expect(isSlotBookable(new Date('2026-10-25T01:00:00Z'), fallBack)).toBe(false);
  });
});
