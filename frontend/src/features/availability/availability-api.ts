import {
  practiceSettingsSchema,
  slotsResponseSchema,
  weeklyBusinessHoursSchema,
} from '@physiobook/shared';
import type {
  PracticeSettings,
  SlotsQuery,
  UpdatePracticeSettingsRequest,
  WeeklyBusinessHours,
} from '@physiobook/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '../auth/useAuth';

export const BUSINESS_HOURS_PATH = '/business-hours';
export const SETTINGS_PATH = '/settings';
export const SLOTS_PATH = '/slots';

export const availabilityKeys = {
  businessHours: ['business-hours'],
  settings: ['settings'],
  allSlots: ['slots'],
  slots: ({ from, to }: SlotsQuery) => ['slots', from, to],
} as const;

export function useBusinessHours() {
  const api = useApi();

  return useQuery({
    queryKey: availabilityKeys.businessHours,
    queryFn: ({ signal }) =>
      api.request(BUSINESS_HOURS_PATH, { schema: weeklyBusinessHoursSchema, signal }),
  });
}

export function usePracticeSettings() {
  const api = useApi();

  return useQuery({
    queryKey: availabilityKeys.settings,
    queryFn: ({ signal }) => api.request(SETTINGS_PATH, { schema: practiceSettingsSchema, signal }),
  });
}

export function useBookableSlots(range: SlotsQuery) {
  const api = useApi();

  return useQuery({
    queryKey: availabilityKeys.slots(range),
    queryFn: ({ signal }) =>
      api.request(`${SLOTS_PATH}?${new URLSearchParams(range).toString()}`, {
        schema: slotsResponseSchema,
        signal,
      }),
  });
}

// Both saves change which slots exist — the hours directly, the timezone by
// moving every wall-clock hour — so each one stales every cached slot range.
export function useSaveBusinessHours() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (week: WeeklyBusinessHours) =>
      api.request(BUSINESS_HOURS_PATH, {
        method: 'PUT',
        body: week,
        schema: weeklyBusinessHoursSchema,
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData<WeeklyBusinessHours>(availabilityKeys.businessHours, saved);
      await queryClient.invalidateQueries({ queryKey: availabilityKeys.allSlots });
    },
  });
}

export function useSavePracticeSettings() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: UpdatePracticeSettingsRequest) =>
      api.request(SETTINGS_PATH, { method: 'PUT', body: settings, schema: practiceSettingsSchema }),
    onSuccess: async (saved) => {
      queryClient.setQueryData<PracticeSettings>(availabilityKeys.settings, saved);
      await queryClient.invalidateQueries({ queryKey: availabilityKeys.allSlots });
    },
  });
}
