import type { BusinessHoursWindow, WeeklyBusinessHours } from '@physiobook/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';

import styles from './AvailabilityForm.module.scss';
import { describeSaveError } from './save-errors';
import {
  nextWindowFor,
  sameWeek,
  sortWindows,
  toWindows,
  validateRows,
  WEEK,
  withKey,
  type RowErrors,
  type WindowRow,
} from './weekly-windows';

const QUARTER_HOUR_SECONDS = 900;

export interface BusinessHoursEditorProps {
  initial: WeeklyBusinessHours;
  onSave: (week: WeeklyBusinessHours) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

type SaveState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'saved' }
  | { status: 'failed'; message: string };

interface TimeInputProps {
  label: string;
  value: string;
  error: string | undefined;
  errorId: string;
  onChange: (value: string) => void;
}

const TimeInput = ({ label, value, error, errorId, onChange }: TimeInputProps) => (
  <label className={styles.timeField}>
    <span className={styles.label}>{label}</span>
    <input
      className={styles.input}
      type="time"
      step={QUARTER_HOUR_SECONDS}
      value={value}
      required
      aria-invalid={error !== undefined}
      aria-describedby={error === undefined ? undefined : errorId}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  </label>
);

const messagesOf = (errors: RowErrors | undefined) =>
  [errors?.opens_at, errors?.closes_at, errors?.overlap].filter(
    (message): message is string => message !== undefined,
  );

export const BusinessHoursEditor = ({
  initial,
  onSave,
  onDirtyChange,
}: BusinessHoursEditorProps) => {
  const headingId = useId();

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
    edit([...rows, withKey({ day_of_week: day, ...nextWindowFor(day, rows) })]);
  };

  const remove = (key: string) => {
    edit(rows.filter((row) => row.key !== key));
  };

  const discard = () => {
    edit(baseline.map(withKey));
    setAttempted(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

  const pending = saveState.status === 'pending';

  return (
    <form className={styles.form} noValidate onSubmit={handleSubmit} aria-labelledby={headingId}>
      <h2 className={styles.heading} id={headingId}>
        Business hours
      </h2>
      <p className={styles.hint}>
        Times are wall-clock in the practice timezone. Slots start on the hour inside each window.
      </p>

      {overlappingDays.length > 0 && (
        <p className={styles.alert} role="alert">
          {`Windows overlap on ${overlappingDays.join(', ')}. Windows on the same day must not overlap.`}
        </p>
      )}

      {attempted && errors.size > 0 && overlappingDays.length === 0 && (
        <p className={styles.alert} role="alert">
          Fix the highlighted windows before saving.
        </p>
      )}

      {saveState.status === 'failed' && (
        <p className={styles.alert} role="alert">
          {saveState.message}
        </p>
      )}

      <div className={styles.week}>
        {WEEK.map(({ day, name }) => {
          const dayRows = rows.filter((row) => row.day_of_week === day);

          return (
            <fieldset className={styles.day} key={day}>
              <legend className={styles.dayName}>{name}</legend>

              {dayRows.length === 0 && <p className={styles.closed}>Closed</p>}

              {dayRows.map((row, position) => {
                const rowErrors = errors.get(row.key);
                const errorId = `${row.key}-errors`;
                const label = `${name} window ${String(position + 1)}`;

                return (
                  <div className={styles.window} key={row.key} role="group" aria-label={label}>
                    <TimeInput
                      label="Opens"
                      value={row.opens_at}
                      error={rowErrors?.opens_at ?? rowErrors?.overlap}
                      errorId={errorId}
                      onChange={(opens_at) => {
                        update(row.key, { opens_at });
                      }}
                    />
                    <TimeInput
                      label="Closes"
                      value={row.closes_at}
                      error={rowErrors?.closes_at ?? rowErrors?.overlap}
                      errorId={errorId}
                      onChange={(closes_at) => {
                        update(row.key, { closes_at });
                      }}
                    />
                    <button
                      className={styles.secondary}
                      type="button"
                      aria-label={`Remove ${label}`}
                      onClick={() => {
                        remove(row.key);
                      }}
                    >
                      Remove
                    </button>

                    {rowErrors !== undefined && (
                      <ul className={styles.errors} id={errorId}>
                        {messagesOf(rowErrors).map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}

              <button
                className={styles.secondary}
                type="button"
                aria-label={`Add a window on ${name}`}
                onClick={() => {
                  add(day);
                }}
              >
                Add window
              </button>
            </fieldset>
          );
        })}
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="submit" disabled={!dirty || pending}>
          {pending ? 'Saving…' : 'Save hours'}
        </button>
        <button
          className={styles.secondary}
          type="button"
          disabled={!dirty || pending}
          onClick={discard}
        >
          Discard changes
        </button>
        {saveState.status === 'saved' && (
          <p className={styles.success} role="status">
            Business hours saved.
          </p>
        )}
      </div>
    </form>
  );
};
