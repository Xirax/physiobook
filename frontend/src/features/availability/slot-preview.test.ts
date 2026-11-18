import { describe, expect, it } from 'vitest';

import { previewRange } from './slot-preview';

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
