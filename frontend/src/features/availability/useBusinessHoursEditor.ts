import type { BusinessHoursWindow, WeeklyBusinessHours } from '@physiobook/shared';
import { useEffect, useState } from 'react';

import { describeSaveError } from './save-errors';
import {
  nextWindowFor,
  sameWeek,
  sortWindows,
  toWindows,
  validateRows,
  WEEK,
  withKey,
  type WindowRow,
} from './weekly-windows';

export interface BusinessHoursEditorOptions {
  initial: WeeklyBusinessHours;
  onSave: (week: WeeklyBusinessHours) => Promise<void>;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
}

export type SaveState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'saved' }
  | { status: 'failed'; message: string };

export function useBusinessHoursEditor({
  initial,
  onSave,
  onDirtyChange,
}: BusinessHoursEditorOptions) {
  const [baseline, setBaseline] = useState(() => sortWindows(initial.windows));
  const [rows, setRows] = useState(() => baseline.map(withKey));
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [attempted, setAttempted] = useState(false);

  const errors = validateRows(rows);
  const dirty = !sameWeek(toWindows(rows), baseline);
  const overlappingDays = WEEK.filter(({ day }) =>
    rows.some((row) => row.day_of_week === day && errors.get(row.key)?.overlap !== undefined),
  ).map(({ name }) => name);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const edit = (next: WindowRow[]) => {
    setRows(next);
    setSaveState({ status: 'idle' });
  };

  const update = (key: string, change: Partial<BusinessHoursWindow>) => {
    edit(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  };

  const add = (day: number) => {
    const next = nextWindowFor(day, rows);

    if (next !== null) edit([...rows, withKey({ day_of_week: day, ...next })]);
  };

  const remove = (key: string) => {
    edit(rows.filter((row) => row.key !== key));
  };

  const discard = () => {
    edit(baseline.map(withKey));
    setAttempted(false);
  };

  const submit = () => {
    setAttempted(true);

    if (errors.size > 0) return;

    const week = { windows: sortWindows(toWindows(rows)) };

    setSaveState({ status: 'pending' });

    onSave(week)
      .then(() => {
        setBaseline(week.windows);
        setAttempted(false);
        setSaveState({ status: 'saved' });
      })
      .catch((error: unknown) => {
        setSaveState({ status: 'failed', message: describeSaveError(error) });
      });
  };

  return {
    rowsOf: (day: number) => rows.filter((row) => row.day_of_week === day),
    canAddTo: (day: number) => nextWindowFor(day, rows) !== null,
    errors,
    dirty,
    overlappingDays,
    blockedSave: attempted && errors.size > 0 && overlappingDays.length === 0,
    saveState,
    pending: saveState.status === 'pending',
    update,
    add,
    remove,
    discard,
    submit,
  };
}
