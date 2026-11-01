import type { PracticeSettings, UpdatePracticeSettingsRequest } from '@physiobook/shared';
import { useEffect, useId, useState } from 'react';

import { TextField } from '../../components/TextField';
import { useZodForm } from '../../lib/useZodForm';
import styles from './AvailabilityForm.module.scss';
import { describeSaveError } from './save-errors';
import {
  settingsFormSchema,
  TIMEZONE_SUGGESTIONS,
  toFormValues,
  toUpdateRequest,
} from './settings-form';

export interface PracticeSettingsFormProps {
  initial: PracticeSettings;
  onSave: (settings: UpdatePracticeSettingsRequest) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

export const PracticeSettingsForm = ({
  initial,
  onSave,
  onDirtyChange,
}: PracticeSettingsFormProps) => {
  const headingId = useId();
  const timezonesId = useId();
  const [saved, setSaved] = useState(false);

  const { fieldProps, formError, pending, dirty, handleSubmit } = useZodForm({
    schema: settingsFormSchema,
    initialValues: toFormValues(initial),
    onSubmit: async (values) => {
      await onSave(toUpdateRequest(values));
      setSaved(true);
    },
    describeError: describeSaveError,
  });

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  return (
    <form className={styles.form} noValidate onSubmit={handleSubmit} aria-labelledby={headingId}>
      <h2 className={styles.heading} id={headingId}>
        Practice settings
      </h2>

      {formError !== null && (
        <p className={styles.alert} role="alert">
          {formError}
        </p>
      )}

      <TextField
        label="Timezone"
        list={timezonesId}
        autoComplete="off"
        hint="An IANA name such as Europe/Warsaw. Business hours are read in this timezone."
        {...fieldProps('timezone')}
      />
      <datalist id={timezonesId}>
        {TIMEZONE_SUGGESTIONS.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>

      <TextField
        label="Reminder lead time (hours)"
        inputMode="numeric"
        hint="How long before an appointment the reminder email goes out."
        {...fieldProps('reminder_lead_hours')}
      />

      <TextField
        label="Cancellation cutoff (hours)"
        inputMode="numeric"
        hint="Patients cannot cancel later than this before their appointment."
        {...fieldProps('cancellation_cutoff_hours')}
      />

      <div className={styles.actions}>
        <button className={styles.primary} type="submit" disabled={!dirty || pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </button>
        {saved && !dirty && (
          <p className={styles.success} role="status">
            Practice settings saved.
          </p>
        )}
      </div>
    </form>
  );
};
