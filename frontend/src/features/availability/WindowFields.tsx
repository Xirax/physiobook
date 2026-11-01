import type { BusinessHoursWindow } from '@physiobook/shared';

import styles from './AvailabilityForm.module.scss';
import type { RowErrors, WindowRow } from './weekly-windows';

const QUARTER_HOUR_SECONDS = 900;

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

const messagesOf = (errors: RowErrors) =>
  [errors.opens_at, errors.closes_at, errors.overlap].filter(
    (message): message is string => message !== undefined,
  );

export interface WindowFieldsProps {
  label: string;
  row: WindowRow;
  errors: RowErrors | undefined;
  onChange: (change: Partial<BusinessHoursWindow>) => void;
  onRemove: () => void;
}

export const WindowFields = ({ label, row, errors, onChange, onRemove }: WindowFieldsProps) => {
  const errorId = `${row.key}-errors`;

  return (
    <div className={styles.window} role="group" aria-label={label}>
      <TimeInput
        label="Opens"
        value={row.opens_at}
        error={errors?.opens_at ?? errors?.overlap}
        errorId={errorId}
        onChange={(opens_at) => {
          onChange({ opens_at });
        }}
      />
      <TimeInput
        label="Closes"
        value={row.closes_at}
        error={errors?.closes_at ?? errors?.overlap}
        errorId={errorId}
        onChange={(closes_at) => {
          onChange({ closes_at });
        }}
      />
      <button
        className={styles.secondary}
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        Remove
      </button>

      {errors !== undefined && (
        <ul className={styles.errors} id={errorId}>
          {messagesOf(errors).map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
