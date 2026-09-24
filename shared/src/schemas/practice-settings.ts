import { z } from 'zod';

// `Intl.supportedValuesOf('timeZone')` is the runtime's own canonical IANA
// registry, so this stays correct as the registry changes instead of shipping
// a copy of it. `UTC` is valid but deliberately excluded from that list by the
// ECMA-402 spec, so it is allowed alongside it rather than being folded in —
// merging it into the set would hide that it is a spec carve-out, not scope
// creep on the seed default.
const IANA_TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

export const timezoneSchema = z
  .string()
  .refine((value) => value === 'UTC' || IANA_TIME_ZONES.has(value), {
    message: 'Enter a valid IANA timezone, e.g. Europe/Warsaw',
  });

export const reminderLeadHoursSchema = z
  .int()
  .positive({ message: 'Reminder lead time must be at least 1 hour' });

export const cancellationCutoffHoursSchema = z
  .int()
  .nonnegative({ message: 'Cancellation cutoff cannot be negative' });

export const practiceSettingsSchema = z.strictObject({
  timezone: timezoneSchema,
  slot_duration_minutes: z.int().positive(),
  reminder_lead_hours: reminderLeadHoursSchema,
  cancellation_cutoff_hours: cancellationCutoffHoursSchema,
  updated_at: z.iso.datetime(),
});

// slot_duration_minutes is deliberately absent: slots stay fixed 1h per domain
// rule (CLAUDE.md §4), so it is not part of the editable shape. `strictObject`
// then rejects an attempt to send it with the same 400 it gives any other
// unknown field (the same deliberate call as `registerRequestSchema` — see
// PROJECT_STRUCTURE.md §6 — rather than silently dropping it).
export const updatePracticeSettingsSchema = z.strictObject({
  timezone: timezoneSchema,
  reminder_lead_hours: reminderLeadHoursSchema,
  cancellation_cutoff_hours: cancellationCutoffHoursSchema,
});
