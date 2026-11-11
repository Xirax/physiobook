const MS_PER_DAY = 86_400_000;

// Calendar dates parse as UTC midnight, so the difference is a whole number of
// days whatever the practice timezone — the range is counted in dates, not hours.
export const inclusiveDays = (from: string, to: string): number =>
  (Date.parse(to) - Date.parse(from)) / MS_PER_DAY + 1;
