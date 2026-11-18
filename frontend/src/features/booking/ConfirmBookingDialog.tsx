import type { Slot } from '@physiobook/shared';
import { useEffect, useId, useRef } from 'react';

import { slotLabel } from '../../lib/practice-time';
import styles from './Booking.module.scss';

export interface ConfirmBookingDialogProps {
  slot: Slot;
  timezone: string;
  booking: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmBookingDialog = ({
  slot,
  timezone,
  booking,
  onConfirm,
  onCancel,
}: ConfirmBookingDialogProps) => {
  const titleId = useId();
  const slotId = useId();
  const timezoneId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus moves in on open and back to whatever opened the dialog on close, so
  // a keyboard user lands where they left off rather than at the top of the page.
  useEffect(() => {
    const opener = document.activeElement;

    confirmRef.current?.focus();

    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // A native listener, because jsx-a11y rightly refuses a JSX key handler on a
  // non-interactive element — yet a modal must own Escape and keep Tab inside.
  useEffect(() => {
    const dialog = dialogRef.current;

    if (dialog === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!booking) onCancel();

        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = focusable.at(0);
      const last = focusable.at(-1);

      if (first === undefined || last === undefined) {
        event.preventDefault();

        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);

    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
    };
  }, [booking, onCancel]);

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${slotId} ${timezoneId}`}
      >
        <h2 className={styles.heading} id={titleId}>
          Book this appointment?
        </h2>
        <p id={slotId}>{slotLabel(slot, timezone)}</p>
        <p className={styles.hint} id={timezoneId}>
          {`Times are shown in ${timezone}.`}
        </p>
        <div className={styles.actions}>
          <button
            ref={confirmRef}
            className={styles.primary}
            type="button"
            onClick={onConfirm}
            disabled={booking}
          >
            {booking ? 'Booking…' : 'Book appointment'}
          </button>
          <button className={styles.secondary} type="button" onClick={onCancel} disabled={booking}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
