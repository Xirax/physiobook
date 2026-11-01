import type { PracticeSettings, SlotsResponse, WeeklyBusinessHours } from '@physiobook/shared';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { providersWith, type RequestStub } from '../../../tests/with-api';
import {
  availabilityKeys,
  BUSINESS_HOURS_PATH,
  SETTINGS_PATH,
  SLOTS_PATH,
  useBookableSlots,
  useBusinessHours,
  usePracticeSettings,
  useSaveBusinessHours,
  useSavePracticeSettings,
} from './availability-api';

const week: WeeklyBusinessHours = {
  windows: [{ day_of_week: 1, opens_at: '09:00', closes_at: '17:00' }],
};

const settings: PracticeSettings = {
  timezone: 'Europe/Warsaw',
  slot_duration_minutes: 60,
  reminder_lead_hours: 24,
  cancellation_cutoff_hours: 24,
  updated_at: '2026-11-01T10:00:00.000Z',
};

const slots: SlotsResponse = {
  timezone: 'Europe/Warsaw',
  slots: [{ start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T09:00:00.000Z' }],
};

const range = { from: '2026-11-02', to: '2026-11-08' };

const api: RequestStub = (path, options) => {
  if (path === BUSINESS_HOURS_PATH) return options?.method === 'PUT' ? options.body : week;
  if (path === SETTINGS_PATH) {
    return options?.method === 'PUT' ? { ...settings, ...(options.body as object) } : settings;
  }
  if (path.startsWith(SLOTS_PATH)) return slots;

  throw new Error(`Unexpected request to ${path}`);
};

const slotFetches = (request: ReturnType<typeof providersWith>['request']) =>
  request.mock.calls.filter(([path]) => path.startsWith(SLOTS_PATH)).length;

describe('Reading availability', () => {
  it('Reads the weekly hours', async () => {
    const { wrapper } = providersWith(api);
    const { result } = renderHook(() => useBusinessHours(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(week);
    });
  });

  it('Reads the practice settings', async () => {
    const { wrapper } = providersWith(api);
    const { result } = renderHook(() => usePracticeSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(settings);
    });
  });

  it('Asks for the slots of exactly the range it was given', async () => {
    const { request, wrapper } = providersWith(api);
    const { result } = renderHook(() => useBookableSlots(range), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(slots);
    });
    expect(request.mock.calls[0]?.[0]).toBe('/slots?from=2026-11-02&to=2026-11-08');
  });
});

describe('Saving the weekly hours', () => {
  const replacement: WeeklyBusinessHours = {
    windows: [{ day_of_week: 2, opens_at: '10:00', closes_at: '14:00' }],
  };

  it('Replaces the whole week with one PUT', async () => {
    const { request, wrapper } = providersWith(api);
    const { result } = renderHook(() => useSaveBusinessHours(), { wrapper });

    await result.current.mutateAsync(replacement);

    expect(request).toHaveBeenCalledWith(
      BUSINESS_HOURS_PATH,
      expect.objectContaining({ method: 'PUT', body: replacement }),
    );
  });

  it('Keeps the week the API saved as the cached one', async () => {
    const { queryClient, wrapper } = providersWith(api);
    const { result } = renderHook(() => useSaveBusinessHours(), { wrapper });

    await result.current.mutateAsync(replacement);

    expect(queryClient.getQueryData(availabilityKeys.businessHours)).toEqual(replacement);
  });

  it('Fetches the slot preview again, since the hours decide which slots exist', async () => {
    const { request, wrapper } = providersWith(api);
    const { result } = renderHook(
      () => ({ preview: useBookableSlots(range), save: useSaveBusinessHours() }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.preview.data).toBeDefined();
    });
    await result.current.save.mutateAsync(replacement);

    await waitFor(() => {
      expect(slotFetches(request)).toBe(2);
    });
  });
});

describe('Saving the practice settings', () => {
  const update = {
    timezone: 'Europe/London',
    reminder_lead_hours: 48,
    cancellation_cutoff_hours: 12,
  };

  it('Sends only the editable fields with one PUT', async () => {
    const { request, wrapper } = providersWith(api);
    const { result } = renderHook(() => useSavePracticeSettings(), { wrapper });

    await result.current.mutateAsync(update);

    expect(request).toHaveBeenCalledWith(
      SETTINGS_PATH,
      expect.objectContaining({ method: 'PUT', body: update }),
    );
  });

  it('Fetches the slot preview again, since the timezone moves every slot', async () => {
    const { request, wrapper } = providersWith(api);
    const { result } = renderHook(
      () => ({ preview: useBookableSlots(range), save: useSavePracticeSettings() }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.preview.data).toBeDefined();
    });
    await result.current.save.mutateAsync(update);

    await waitFor(() => {
      expect(slotFetches(request)).toBe(2);
    });
  });
});
