import type { Slot, SlotsQuery, SlotsResponse } from '@physiobook/shared';
import { useId } from 'react';

import { dayMonthLabel, groupSlotsByDay } from '../../lib/practice-time';
import styles from './Booking.module.scss';

export type SlotPickerState =
  | { status: 'pending' }
  | { status: 'error'; onRetry: () => void }
  | { status: 'success'; data: SlotsResponse }
  /** A refresh failed, so `data` is what was loaded before it. */
  | { status: 'stale'; data: SlotsResponse; onRetry: () => void };

export interface SlotPickerProps {
  state: SlotPickerState;
  week: SlotsQuery;
  canGoBack: boolean;
  canGoForward: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPick: (slot: Slot) => void;
}

const Alert = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <div className={styles.alert} role="alert">
    <p>{message}</p>
    <button className={styles.secondary} type="button" onClick={onRetry}>
      Try again
    </button>
  </div>
);

const Slots = ({ state, onPick }: Pick<SlotPickerProps, 'state' | 'onPick'>) => {
  if (state.status === 'pending') return <p role="status">Loading the open slots…</p>;

  if (state.status === 'error') {
    return <Alert message="The open slots could not be loaded." onRetry={state.onRetry} />;
  }

  const { slots, timezone } = state.data;
  const days = groupSlotsByDay(slots, timezone);

  if (days.length === 0) return <p className={styles.empty}>No open slots this week.</p>;

  const slotAt = new Map(slots.map((slot) => [slot.start, slot]));

  return (
    <ul className={styles.days}>
      {days.map((day) => (
        <li key={day.date}>
          <h3 className={styles.day}>{day.label}</h3>
          <ul className={styles.times} aria-label={day.label}>
            {day.times.map((time) => (
              <li key={time.start}>
                <button
                  className={styles.time}
                  type="button"
                  aria-label={`${day.label}, ${time.label}`}
                  onClick={() => {
                    const slot = slotAt.get(time.start);

                    if (slot !== undefined) onPick(slot);
                  }}
                >
                  <time dateTime={time.start}>{time.label}</time>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
};

export const SlotPicker = ({
  state,
  week,
  canGoBack,
  canGoForward,
  onPrevious,
  onNext,
  onPick,
}: SlotPickerProps) => {
  const headingId = useId();
  const hasData = state.status === 'success' || state.status === 'stale';

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <div className={styles.weekNav}>
        <button
          className={styles.secondary}
          type="button"
          onClick={onPrevious}
          disabled={!canGoBack}
        >
          Previous week
        </button>
        <h2 className={styles.heading} id={headingId}>
          {`${dayMonthLabel(week.from)} – ${dayMonthLabel(week.to)}`}
        </h2>
        <button
          className={styles.secondary}
          type="button"
          onClick={onNext}
          disabled={!canGoForward}
        >
          Next week
        </button>
      </div>

      {hasData && <p className={styles.hint}>{`Times are shown in ${state.data.timezone}.`}</p>}
      {state.status === 'stale' && (
        <Alert
          message="The latest slots could not be fetched. These are the ones loaded earlier."
          onRetry={state.onRetry}
        />
      )}

      <Slots state={state} onPick={onPick} />
    </section>
  );
};
