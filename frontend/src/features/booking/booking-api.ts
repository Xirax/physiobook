import { appointmentSchema } from '@physiobook/shared';
import type { BookAppointmentRequest, SlotsResponse } from '@physiobook/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { availabilityKeys } from '../availability/availability-api';
import { useApi } from '../auth/useAuth';

export const APPOINTMENTS_PATH = '/appointments';

/**
 * Books a slot optimistically: it leaves every cached slot range at once, comes
 * back if the API refuses, and the ranges are refetched either way — a slot
 * list is stale by nature, so the server's answer is what the picker shows.
 */
export function useBookAppointment() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (booking: BookAppointmentRequest) =>
      api.request(APPOINTMENTS_PATH, { method: 'POST', body: booking, schema: appointmentSchema }),
    onMutate: async ({ start }) => {
      await queryClient.cancelQueries({ queryKey: availabilityKeys.allSlots });

      const previous = queryClient.getQueriesData<SlotsResponse>({
        queryKey: availabilityKeys.allSlots,
      });

      queryClient.setQueriesData<SlotsResponse>({ queryKey: availabilityKeys.allSlots }, (data) =>
        data === undefined
          ? undefined
          : { ...data, slots: data.slots.filter((slot) => slot.start !== start) },
      );

      return { previous };
    },
    onError: (_error, _booking, context) => {
      for (const [queryKey, data] of context?.previous ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: availabilityKeys.allSlots }),
  });
}
