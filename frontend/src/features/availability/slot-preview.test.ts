import { describe, expect, it } from 'vitest';

import { groupSlotsByDay, previewRange } from './slot-preview';

const slot = (start: string, end: string) => ({ start, end });

describe('previewRange', () => {
  it('Covers today and the six days after it', () => {
    expect(previewRange(new Date('2026-11-02T10:00:00Z'), 'Europe/Warsaw')).toEqual({
      from: '2026-11-02',
      to: '2026-11-08',
    });
  });

  it('Counts today in the practice timezone, not in UTC', () => {
    // 23:30 UTC on the 1st is already 00:30 on the 2nd in Warsaw.
    expect(previewRange(new Date('2026-11-01T23:30:00Z'), 'Europe/Warsaw').from).toBe('2026-11-02');
    expect(previewRange(new Date('2026-11-01T23:30:00Z'), 'UTC').from).toBe('2026-11-01');
  });

  it('Rolls over the end of a month', () => {
    expect(previewRange(new Date('2026-11-28T10:00:00Z'), 'UTC')).toEqual({
      from: '2026-11-28',
      to: '2026-12-04',
    });
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
