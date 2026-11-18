import type { Slot, SlotsResponse } from '@physiobook/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { useBookableSlots } from '../features/availability/availability-api';
import { useBookAppointment } from '../features/booking/booking-api';
import { describeBookingError } from '../features/booking/booking-errors';
import { bookingWeek } from '../features/booking/booking-week';
import styles from '../features/booking/Booking.module.scss';
import { ConfirmBookingDialog } from '../features/booking/ConfirmBookingDialog';
import { SlotPicker, type SlotPickerState } from '../features/booking/SlotPicker';
import { slotLabel } from '../lib/practice-time';
import { useNow } from '../lib/useNow';
import pageStyles from './Page.module.scss';
import { paths } from './paths';

// "Today" has to roll over at the practice's midnight while the page is open.
const CLOCK_MS = 60_000;

type Outcome = { status: 'booked'; label: string } | { status: 'refused'; message: string };

const pickerState = (slots: UseQueryResult<SlotsResponse>): SlotPickerState => {
  const onRetry = () => {
    void slots.refetch();
  };

  if (slots.data === undefined)
    return slots.isError ? { status: 'error', onRetry } : { status: 'pending' };

  return slots.isError
    ? { status: 'stale', data: slots.data, onRetry }
    : { status: 'success', data: slots.data };
};

const OutcomeMessage = ({ outcome }: { outcome: Outcome }) =>
  outcome.status === 'booked' ? (
    <p className={styles.success} role="status">
      {`Booked: ${outcome.label}. `}
      <Link to={paths.myAppointments}>See your appointments</Link>
    </p>
  ) : (
    <p className={styles.alert} role="alert">
      {outcome.message}
    </p>
  );

export const BookAppointment = () => {
  const now = useNow(CLOCK_MS);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // A patient cannot read GET /settings, so the practice timezone is learned
  // from the first /slots answer; until then the browser's stands in, which
  // differs only when the two calendars sit on different dates.
  const practiceTimezone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { week, canGoBack, canGoForward } = bookingWeek(now, practiceTimezone, offset);

  const slots = useBookableSlots(week);
  const book = useBookAppointment();

  if (slots.data !== undefined && slots.data.timezone !== timezone) {
    setTimezone(slots.data.timezone);
  }

  const pick = (slot: Slot) => {
    setOutcome(null);
    setPicked(slot);
  };

  const confirm = (slot: Slot) => {
    book.mutate(
      { start: slot.start },
      {
        onSuccess: (appointment) => {
          setOutcome({ status: 'booked', label: slotLabel(appointment, practiceTimezone) });
        },
        onError: (error) => {
          setOutcome({ status: 'refused', message: describeBookingError(error) });
        },
        onSettled: () => {
          setPicked(null);
        },
      },
    );
  };

  return (
    <main className={pageStyles.page}>
      <h1>Book an appointment</h1>
      <p className={pageStyles.lead}>Pick an open hour. Each appointment lasts one hour.</p>

      {outcome !== null && <OutcomeMessage outcome={outcome} />}

      <SlotPicker
        state={pickerState(slots)}
        week={week}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onPrevious={() => {
          setOffset((current) => current - 1);
        }}
        onNext={() => {
          setOffset((current) => current + 1);
        }}
        onPick={pick}
      />

      {picked !== null && (
        <ConfirmBookingDialog
          slot={picked}
          timezone={practiceTimezone}
          booking={book.isPending}
          onConfirm={() => {
            confirm(picked);
          }}
          onCancel={() => {
            setPicked(null);
          }}
        />
      )}
    </main>
  );
};
