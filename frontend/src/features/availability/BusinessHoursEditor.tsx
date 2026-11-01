import { useId } from 'react';

import styles from './AvailabilityForm.module.scss';
import { DayFieldset } from './DayFieldset';
import { useBusinessHoursEditor, type BusinessHoursEditorOptions } from './useBusinessHoursEditor';
import { WEEK } from './weekly-windows';

export type BusinessHoursEditorProps = BusinessHoursEditorOptions;

export const BusinessHoursEditor = (props: BusinessHoursEditorProps) => {
  const headingId = useId();
  const editor = useBusinessHoursEditor(props);

  return (
    <form
      className={styles.form}
      noValidate
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        editor.submit();
      }}
    >
      <h2 className={styles.heading} id={headingId}>
        Business hours
      </h2>
      <p className={styles.hint}>
        Times are wall-clock in the practice timezone. Slots start on the hour inside each window.
      </p>

      {editor.overlappingDays.length > 0 && (
        <p className={styles.alert} role="alert">
          {`Windows overlap on ${editor.overlappingDays.join(', ')}. Windows on the same day must not overlap.`}
        </p>
      )}

      {editor.blockedSave && (
        <p className={styles.alert} role="alert">
          Fix the highlighted windows before saving.
        </p>
      )}

      {editor.saveState.status === 'failed' && (
        <p className={styles.alert} role="alert">
          {editor.saveState.message}
        </p>
      )}

      <div className={styles.week}>
        {WEEK.map(({ day, name }) => (
          <DayFieldset
            key={day}
            name={name}
            rows={editor.rowsOf(day)}
            canAdd={editor.canAddTo(day)}
            errors={editor.errors}
            onChange={editor.update}
            onRemove={editor.remove}
            onAdd={() => {
              editor.add(day);
            }}
          />
        ))}
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="submit" disabled={!editor.dirty || editor.pending}>
          {editor.pending ? 'Saving…' : 'Save hours'}
        </button>
        <button
          className={styles.secondary}
          type="button"
          disabled={!editor.dirty || editor.pending}
          onClick={editor.discard}
        >
          Discard changes
        </button>
        {editor.saveState.status === 'saved' && (
          <p className={styles.success} role="status">
            Business hours saved.
          </p>
        )}
      </div>
    </form>
  );
};
