import type { SlotsResponse } from '@physiobook/shared';
import { useId } from 'react';

import styles from './AvailabilityForm.module.scss';
import { groupSlotsByDay, PREVIEW_DAYS } from './slot-preview';

export type SlotPreviewState =
  | { status: 'pending' }
  | { status: 'error'; onRetry: () => void }
  | { status: 'success'; data: SlotsResponse };

export interface SlotPreviewProps {
  state: SlotPreviewState;
}

const PreviewBody = ({ state }: SlotPreviewProps) => {
  if (state.status === 'pending') return <p role="status">Loading the bookable slots…</p>;

  if (state.status === 'error') {
    return (
      <div className={styles.alert} role="alert">
        <p>The slot preview could not be loaded.</p>
        <button className={styles.secondary} type="button" onClick={state.onRetry}>
          Try again
        </button>
      </div>
    );
  }

  const days = groupSlotsByDay(state.data.slots, state.data.timezone);

  if (days.length === 0) {
    return (
      <p className={styles.closed}>
        No bookable slots in the next {PREVIEW_DAYS} days. Add business hours to open some.
      </p>
    );
  }

  return (
    <ul className={styles.previewDays}>
      {days.map((day) => (
        <li key={day.date}>
          <h3 className={styles.previewDay}>{day.label}</h3>
          <ul className={styles.previewTimes} aria-label={day.label}>
            {day.times.map((time) => (
              <li className={styles.previewTime} key={time.start}>
                <time dateTime={time.start}>{time.label}</time>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
};

export const SlotPreview = ({ state }: SlotPreviewProps) => {
  const headingId = useId();

  return (
    <section className={styles.form} aria-labelledby={headingId}>
      <h2 className={styles.heading} id={headingId}>
        Bookable slots
      </h2>
      <p className={styles.hint}>
        What patients can book over the next {PREVIEW_DAYS} days with the saved hours and settings.
        Taken and past slots are left out.
        {state.status === 'success' && ` Times are shown in ${state.data.timezone}.`}
      </p>

      <PreviewBody state={state} />
    </section>
  );
};
