import type { UpdatePracticeSettingsRequest, WeeklyBusinessHours } from '@physiobook/shared';
import { useState } from 'react';

import {
  useBookableSlots,
  useBusinessHours,
  usePracticeSettings,
  useSaveBusinessHours,
  useSavePracticeSettings,
} from '../../features/availability/availability-api';
import { BusinessHoursEditor } from '../../features/availability/BusinessHoursEditor';
import { PracticeSettingsForm } from '../../features/availability/PracticeSettingsForm';
import { previewRange } from '../../features/availability/slot-preview';
import { SlotPreview } from '../../features/availability/SlotPreview';
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard';
import pageStyles from '../Page.module.scss';
import styles from './AdminAvailability.module.scss';

interface LoadFailedProps {
  what: string;
  onRetry: () => void;
}

const LoadFailed = ({ what, onRetry }: LoadFailedProps) => (
  <div className={styles.failed} role="alert">
    <p>{`The ${what} could not be loaded.`}</p>
    <button type="button" onClick={onRetry}>
      Try again
    </button>
  </div>
);

const PracticePreview = ({ timezone }: { timezone: string }) => {
  const [openedAt] = useState(() => new Date());
  const slots = useBookableSlots(previewRange(openedAt, timezone));

  if (slots.isPending) return <SlotPreview state={{ status: 'pending' }} />;

  if (slots.isError) {
    return (
      <SlotPreview
        state={{
          status: 'error',
          onRetry: () => {
            void slots.refetch();
          },
        }}
      />
    );
  }

  return <SlotPreview state={{ status: 'success', data: slots.data }} />;
};

export const AdminAvailability = () => {
  const hours = useBusinessHours();
  const settings = usePracticeSettings();
  const saveHours = useSaveBusinessHours();
  const saveSettings = useSavePracticeSettings();

  const [hoursDirty, setHoursDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  useUnsavedChangesGuard(hoursDirty || settingsDirty);

  const onSaveHours = async (week: WeeklyBusinessHours) => {
    await saveHours.mutateAsync(week);
  };

  const onSaveSettings = async (update: UpdatePracticeSettingsRequest) => {
    await saveSettings.mutateAsync(update);
  };

  return (
    <main className={pageStyles.page}>
      <h1>Availability</h1>
      <p className={pageStyles.lead}>
        Set when the practice is open. Patients can only book the hourly slots these hours create.
      </p>

      <div className={styles.layout}>
        <div className={styles.editors}>
          {hours.isPending && <p role="status">Loading the business hours…</p>}
          {hours.isError && (
            <LoadFailed
              what="business hours"
              onRetry={() => {
                void hours.refetch();
              }}
            />
          )}
          {hours.isSuccess && (
            <BusinessHoursEditor
              initial={hours.data}
              onSave={onSaveHours}
              onDirtyChange={setHoursDirty}
            />
          )}

          {settings.isPending && <p role="status">Loading the practice settings…</p>}
          {settings.isError && (
            <LoadFailed
              what="practice settings"
              onRetry={() => {
                void settings.refetch();
              }}
            />
          )}
          {settings.isSuccess && (
            <PracticeSettingsForm
              initial={settings.data}
              onSave={onSaveSettings}
              onDirtyChange={setSettingsDirty}
            />
          )}
        </div>

        {settings.isSuccess && <PracticePreview timezone={settings.data.timezone} />}
      </div>
    </main>
  );
};
