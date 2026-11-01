import type { BusinessHoursWindow } from '@physiobook/shared';
import { useId } from 'react';

import styles from './AvailabilityForm.module.scss';
import type { RowErrors, WindowRow } from './weekly-windows';
import { WindowFields } from './WindowFields';

export interface DayFieldsetProps {
  name: string;
  rows: readonly WindowRow[];
  errors: ReadonlyMap<string, RowErrors>;
  onChange: (key: string, change: Partial<BusinessHoursWindow>) => void;
  onRemove: (key: string) => void;
  canAdd: boolean;
  onAdd: () => void;
}

export const DayFieldset = ({
  name,
  rows,
  errors,
  onChange,
  onRemove,
  canAdd,
  onAdd,
}: DayFieldsetProps) => {
  const fullDayId = useId();

  return (
    <fieldset className={styles.day}>
      <legend className={styles.dayName}>{name}</legend>

      {rows.length === 0 && <p className={styles.closed}>Closed</p>}

      {rows.map((row, position) => (
        <WindowFields
          key={row.key}
          label={`${name} window ${String(position + 1)}`}
          row={row}
          errors={errors.get(row.key)}
          onChange={(change) => {
            onChange(row.key, change);
          }}
          onRemove={() => {
            onRemove(row.key);
          }}
        />
      ))}

      <button
        className={styles.secondary}
        type="button"
        aria-label={`Add a window on ${name}`}
        aria-describedby={canAdd ? undefined : fullDayId}
        disabled={!canAdd}
        onClick={onAdd}
      >
        Add window
      </button>

      {!canAdd && (
        <p className={styles.closed} id={fullDayId}>
          The day already runs to 23:59.
        </p>
      )}
    </fieldset>
  );
};
