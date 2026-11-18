import { errorCodes } from '@physiobook/shared';
import type { Appointment, SlotsResponse } from '@physiobook/shared';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { providersWith, type RequestStub } from '../../../tests/with-api';
import { ApiError } from '../../lib/api-client';
import { availabilityKeys, SLOTS_PATH, useBookableSlots } from '../availability/availability-api';
import { APPOINTMENTS_PATH, useBookAppointment } from './booking-api';

const nine = { start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T09:00:00.000Z' };
const ten = { start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z' };

const slots: SlotsResponse = { timezone: 'Europe/Warsaw', slots: [nine, ten] };

const range = { from: '2026-11-02', to: '2026-11-08' };

const booked: Appointment = {
  id: '0b7e7f0c-3a52-4c1e-8f43-6d1f0f6b9a10',
  ...nine,
  status: 'active',
};

const slotTaken = new ApiError(409, { code: errorCodes.SLOT_TAKEN, message: 'Slot taken' });

const answering =
  (book: () => unknown): RequestStub =>
  (path) => {
    if (path.startsWith(SLOTS_PATH)) return slots;
    if (path === APPOINTMENTS_PATH) return book();

    throw new Error(`Unexpected request to ${path}`);
  };

const slotFetches = (request: ReturnType<typeof providersWith>['request']) =>
  request.mock.calls.filter(([path]) => path.startsWith(SLOTS_PATH)).length;

const cachedStarts = (queryClient: ReturnType<typeof providersWith>['queryClient']) =>
  queryClient
    .getQueryData<SlotsResponse>(availabilityKeys.slots(range))
    ?.slots.map(({ start }) => start);

const renderWithLoadedSlots = async (answer: RequestStub) => {
  const providers = providersWith(answer);
  const hook = renderHook(() => ({ slots: useBookableSlots(range), book: useBookAppointment() }), {
    wrapper: providers.wrapper,
  });

  await waitFor(() => {
    expect(hook.result.current.slots.data).toBeDefined();
  });

  return { ...providers, ...hook };
};

describe('Booking a slot', () => {
  it('POSTs the slot start and answers with the booked appointment', async () => {
    const { request, result } = await renderWithLoadedSlots(answering(() => booked));

    await expect(result.current.book.mutateAsync({ start: nine.start })).resolves.toEqual(booked);
    expect(request).toHaveBeenCalledWith(
      APPOINTMENTS_PATH,
      expect.objectContaining({ method: 'POST', body: { start: nine.start } }),
    );
  });

  it('Drops the slot from the list while the booking is in flight', async () => {
    let answer: (value: Appointment) => void = () => undefined;
    const pending = new Promise<Appointment>((resolve) => {
      answer = resolve;
    });
    const { queryClient, result } = await renderWithLoadedSlots(answering(() => pending));

    const booking = result.current.book.mutateAsync({ start: nine.start });

    await waitFor(() => {
      expect(cachedStarts(queryClient)).toEqual([ten.start]);
    });

    answer(booked);
    await booking;
  });

  it('Fetches the slots again once booked', async () => {
    const { request, result } = await renderWithLoadedSlots(answering(() => booked));

    await result.current.book.mutateAsync({ start: nine.start });

    expect(slotFetches(request)).toBe(2);
  });

  it('Puts the slot back when it was just taken, then shows what the refetch answers', async () => {
    let answerRefetch: (value: SlotsResponse) => void = () => undefined;
    const refetch = new Promise<SlotsResponse>((resolve) => {
      answerRefetch = resolve;
    });
    let fetches = 0;

    const { queryClient, result } = await renderWithLoadedSlots((path) => {
      if (path.startsWith(SLOTS_PATH)) return ++fetches === 1 ? slots : refetch;
      if (path === APPOINTMENTS_PATH) throw slotTaken;

      throw new Error(`Unexpected request to ${path}`);
    });

    const booking = result.current.book.mutateAsync({ start: nine.start });

    await waitFor(() => {
      expect(fetches).toBe(2);
    });
    expect(cachedStarts(queryClient)).toEqual([nine.start, ten.start]);

    answerRefetch({ ...slots, slots: [ten] });

    await expect(booking).rejects.toBe(slotTaken);
    expect(cachedStarts(queryClient)).toEqual([ten.start]);
  });
});
