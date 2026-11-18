import { describe, expect, it } from 'vitest';

import { addDays, calendarDate, dayMonthLabel, dayRange, groupSlotsByDay } from './practice-time';

const slot = (start: string, end: string) => ({ start, end });

describe('calendarDate', () => {
  it('Reads the date in the given timezone, not in UTC', () => {
    // 23:30 UTC on the 1st is already 00:30 on the 2nd in Warsaw.
    expect(calendarDate(new Date('2026-11-01T23:30:00Z'), 'Europe/Warsaw')).toBe('2026-11-02');
    expect(calendarDate(new Date('2026-11-01T23:30:00Z'), 'UTC')).toBe('2026-11-01');
  });
});

describe('addDays', () => {
  it('Steps forward and back across month and year ends', () => {
    expect(addDays('2026-11-28', 7)).toBe('2026-12-05');
    expect(addDays('2027-01-03', -7)).toBe('2026-12-27');
  });

  it('Is unaffected by a DST change between the two dates', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });
});

describe('dayRange', () => {
  it('Spans the given number of days, both ends inclusive', () => {
    expect(dayRange('2026-11-02', 7)).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(dayRange('2026-11-02', 1)).toEqual({ from: '2026-11-02', to: '2026-11-02' });
  });
});

describe('dayMonthLabel', () => {
  it('Names the calendar day it is given, whatever the browser timezone', () => {
    expect(dayMonthLabel('2026-11-02')).toBe('2 November');
    expect(dayMonthLabel('2026-12-31')).toBe('31 December');
  });
});

describe('groupSlotsByDay', () => {
  it('Labels each slot with its wall-clock hour in the practice timezone', () => {
    const [monday] = groupSlotsByDay(
      [slot('2026-11-02T08:00:00.000Z', '2026-11-02T09:00:00.000Z')],
      'Europe/Warsaw',
    );

    expect(monday).toEqual({
      date: '2026-11-02',
      label: 'Monday 2 November',
      times: [{ start: '2026-11-02T08:00:00.000Z', label: '09:00' }],
    });
  });

  it('Files a slot under the practice day it falls on, even when the UTC date differs', () => {
    const days = groupSlotsByDay(
      [
        slot('2026-11-02T22:00:00.000Z', '2026-11-02T23:00:00.000Z'),
        slot('2026-11-02T23:00:00.000Z', '2026-11-03T00:00:00.000Z'),
      ],
      'Europe/Warsaw',
    );

    expect(days.map(({ date, times }) => [date, times.map(({ label }) => label)])).toEqual([
      ['2026-11-02', ['23:00']],
      ['2026-11-03', ['00:00']],
    ]);
  });

  it('Keeps the same wall-clock hour across a DST change', () => {
    // Warsaw is UTC+2 before 25 October 2026 and UTC+1 after it.
    const days = groupSlotsByDay(
      [
        slot('2026-10-24T07:00:00.000Z', '2026-10-24T08:00:00.000Z'),
        slot('2026-10-26T08:00:00.000Z', '2026-10-26T09:00:00.000Z'),
      ],
      'Europe/Warsaw',
    );

    expect(days.map(({ times }) => times[0]?.label)).toEqual(['09:00', '09:00']);
  });

  it('Has nothing to show for no slots', () => {
    expect(groupSlotsByDay([], 'UTC')).toEqual([]);
  });
});
