import { errorCodes } from '@physiobook/shared';
import type { Appointment, Slot, SlotsResponse } from '@physiobook/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SLOTS_PATH } from '../features/availability/availability-api';
import { APPOINTMENTS_PATH } from '../features/booking/booking-api';
import { ApiError } from '../lib/api-client';
import { currentPath, renderAppAt, testAdmin, testUser } from '../../tests/render-app';

const NOW = new Date('2026-11-02T06:00:00Z');

const nine: Slot = { start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T09:00:00.000Z' };
const ten: Slot = { start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z' };

type Booking = (start: string) => Appointment;

/**
 * A stand-in practice: /slots answers with whatever is still open, and a
 * booking takes its slot out of that list, as the real grid would.
 */
const practice = ({
  timezone = 'Europe/Warsaw',
  open = [nine, ten],
  onBook,
}: { timezone?: string; open?: Slot[]; onBook?: Booking } = {}) => {
  let remaining = open;

  const answer = (path: string, options?: { method?: string; body?: unknown }): unknown => {
    if (path.startsWith(SLOTS_PATH)) return { timezone, slots: remaining } satisfies SlotsResponse;

    if (path === APPOINTMENTS_PATH && options?.method === 'POST') {
      const { start } = options.body as { start: string };
      const appointment = onBook?.(start) ?? {
        id: '0b7e7f0c-3a52-4c1e-8f43-6d1f0f6b9a10',
        start,
        end: remaining.find((slot) => slot.start === start)?.end ?? start,
        status: 'active',
      };

      remaining = remaining.filter((slot) => slot.start !== start);

      return appointment;
    }

    return undefined;
  };

  return {
    answer,
    takeBySomeoneElse: (start: string) => {
      remaining = remaining.filter((slot) => slot.start !== start);
    },
  };
};

const refusing = (status: number, code: string) => (): never => {
  throw new ApiError(status, { code, message: code });
};

const openPage = async (stand = practice()) => {
  const rendered = renderAppAt('/book', { session: testUser, answer: stand.answer });

  await screen.findByRole('button', { name: 'Monday 2 November, 09:00' });

  return { ...rendered, ...stand };
};

const slotRequests = (request: ReturnType<typeof renderAppAt>['api']['request']) =>
  vi.mocked(request).mock.calls.flatMap(([path]) => (path.startsWith(SLOTS_PATH) ? [path] : []));

const bookingRequests = (request: ReturnType<typeof renderAppAt>['api']['request']) =>
  vi.mocked(request).mock.calls.filter(([path]) => path === APPOINTMENTS_PATH);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Reaching the booking page', () => {
  it('Is in the patient’s nav', async () => {
    renderAppAt('/my-appointments', { session: testUser, answer: practice().answer });

    await userEvent.click(await screen.findByRole('link', { name: 'Book' }));

    expect(await screen.findByRole('heading', { name: 'Book an appointment' })).toBeVisible();
    expect(currentPath()).toBe('/book');
  });

  it('Turns the admin away to their own area', async () => {
    renderAppAt('/book', { session: testAdmin, answer: practice().answer });

    await waitFor(() => {
      expect(currentPath()).toBe('/admin');
    });
    expect(screen.queryByRole('heading', { name: 'Book an appointment' })).toBeNull();
  });
});

describe('Picking a slot', () => {
  it('Asks for this week in the practice timezone and offers only the open slots', async () => {
    const { api } = renderAppAt('/book', {
      session: testUser,
      answer: practice({ open: [ten] }).answer,
    });

    await screen.findByRole('button', { name: 'Monday 2 November, 10:00' });

    expect(slotRequests(api.request).at(-1)).toBe('/slots?from=2026-11-02&to=2026-11-08');
    expect(screen.queryByRole('button', { name: 'Monday 2 November, 09:00' })).toBeNull();
    expect(screen.getByText('Times are shown in Europe/Warsaw.')).toBeInTheDocument();
  });

  it('Moves to the practice’s today once the /slots answer names its timezone', async () => {
    // 12:00 UTC on the 2nd is already 01:00 on the 3rd in Auckland.
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    const auckland = { start: '2026-11-03T20:00:00.000Z', end: '2026-11-03T21:00:00.000Z' };

    const { api } = renderAppAt('/book', {
      session: testUser,
      answer: practice({ timezone: 'Pacific/Auckland', open: [auckland] }).answer,
    });

    expect(
      await screen.findByRole('heading', { name: '3 November – 9 November 2026' }),
    ).toBeVisible();
    expect(slotRequests(api.request).at(-1)).toBe('/slots?from=2026-11-03&to=2026-11-09');
  });

  it('Explains a week with no open slots', async () => {
    renderAppAt('/book', { session: testUser, answer: practice({ open: [] }).answer });

    expect(await screen.findByText('No open slots this week.')).toBeInTheDocument();
  });

  it('Steps to the next week and asks for its slots', async () => {
    const { api } = await openPage();

    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));

    await waitFor(() => {
      expect(slotRequests(api.request).at(-1)).toBe('/slots?from=2026-11-09&to=2026-11-15');
    });
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeEnabled();
  });

  it('Stops at the end of the 62-day booking horizon', async () => {
    await openPage();

    const next = screen.getByRole('button', { name: 'Next week' });

    for (let week = 0; week < 8; week += 1) await userEvent.click(next);

    expect(
      await screen.findByRole('heading', { name: '28 December 2026 – 3 January 2027' }),
    ).toBeInTheDocument();
    expect(next).toBeDisabled();
  });
});

describe('Booking a slot', () => {
  it('Asks for confirmation first, and books nothing on cancel', async () => {
    const { api } = await openPage();

    await userEvent.click(screen.getByRole('button', { name: 'Monday 2 November, 09:00' }));

    const dialog = screen.getByRole('dialog', { name: 'Book this appointment?' });

    expect(dialog).toHaveTextContent('Monday, 2 November 2026, 09:00–10:00');
    expect(bookingRequests(api.request)).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bookingRequests(api.request)).toHaveLength(0);
  });

  it('Books the confirmed slot, says so, and drops it from the list', async () => {
    const { api } = await openPage();

    await userEvent.click(screen.getByRole('button', { name: 'Monday 2 November, 09:00' }));
    await userEvent.click(screen.getByRole('button', { name: 'Book appointment' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Booked: Monday, 2 November 2026, 09:00–10:00.',
    );
    expect(bookingRequests(api.request)[0]?.[1]).toMatchObject({
      method: 'POST',
      body: { start: nine.start },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Monday 2 November, 09:00' })).toBeNull();
    expect(screen.getByRole('link', { name: 'See your appointments' })).toHaveAttribute(
      'href',
      '/my-appointments',
    );
  });

  it('Says the slot was just taken, and refetches so it is gone', async () => {
    const stand = practice({ onBook: refusing(409, errorCodes.SLOT_TAKEN) });
    const { api } = await openPage(stand);
    const fetchesBefore = slotRequests(api.request).length;

    await userEvent.click(screen.getByRole('button', { name: 'Monday 2 November, 09:00' }));
    stand.takeBySomeoneElse(nine.start);
    await userEvent.click(screen.getByRole('button', { name: 'Book appointment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone else has just booked that slot.',
    );
    expect(slotRequests(api.request).length).toBeGreaterThan(fetchesBefore);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Monday 2 November, 09:00' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Monday 2 November, 10:00' })).toBeInTheDocument();
  });

  it('Says when the slot can no longer be booked', async () => {
    await openPage(practice({ onBook: refusing(422, errorCodes.SLOT_NOT_BOOKABLE) }));

    await userEvent.click(screen.getByRole('button', { name: 'Monday 2 November, 09:00' }));
    await userEvent.click(screen.getByRole('button', { name: 'Book appointment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That slot can no longer be booked.',
    );
  });

  it('Clears the last outcome once another slot is picked', async () => {
    await openPage(practice({ onBook: refusing(422, errorCodes.SLOT_NOT_BOOKABLE) }));

    await userEvent.click(screen.getByRole('button', { name: 'Monday 2 November, 09:00' }));
    await userEvent.click(screen.getByRole('button', { name: 'Book appointment' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Monday 2 November, 10:00' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
