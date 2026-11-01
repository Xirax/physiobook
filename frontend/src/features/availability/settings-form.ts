import {
  cancellationCutoffHoursSchema,
  reminderLeadHoursSchema,
  timezoneSchema,
} from '@physiobook/shared';
import type { PracticeSettings, UpdatePracticeSettingsRequest } from '@physiobook/shared';
import { z } from 'zod';

const WHOLE_NUMBER = /^-?\d+$/;

/**
 * An hours input holds text, so it is checked as text: a whole number first,
 * then the shared rule on the number it spells — the API's own range message,
 * not a second copy of it.
 */
const hoursText = (rule: z.ZodType<number>) =>
  z.string().superRefine((text, context) => {
    if (!WHOLE_NUMBER.test(text.trim())) {
      context.addIssue({ code: 'custom', message: 'Enter a whole number of hours' });

      return;
    }

    const verdict = rule.safeParse(Number(text));

    if (!verdict.success) {
      context.addIssue({ code: 'custom', message: verdict.error.issues[0]?.message ?? '' });
    }
  });

export const settingsFormSchema = z.object({
  timezone: timezoneSchema,
  reminder_lead_hours: hoursText(reminderLeadHoursSchema),
  cancellation_cutoff_hours: hoursText(cancellationCutoffHoursSchema),
});

export type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export const toFormValues = (settings: PracticeSettings): SettingsFormValues => ({
  timezone: settings.timezone,
  reminder_lead_hours: String(settings.reminder_lead_hours),
  cancellation_cutoff_hours: String(settings.cancellation_cutoff_hours),
});

export const toUpdateRequest = (values: SettingsFormValues): UpdatePracticeSettingsRequest => ({
  timezone: values.timezone,
  reminder_lead_hours: Number(values.reminder_lead_hours),
  cancellation_cutoff_hours: Number(values.cancellation_cutoff_hours),
});

/** The same registry the shared schema checks against, offered as suggestions. */
export const TIMEZONE_SUGGESTIONS: readonly string[] = [
  'UTC',
  ...Intl.supportedValuesOf('timeZone'),
];
