import type { UpdatePracticeSettingsRequest, WeeklyBusinessHours } from '@physiobook/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

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
import { useNow } from '../../lib/useNow';
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard';
import pageStyles from '../Page.module.scss';
import styles from './AdminAvailability.module.scss';

// The preview's "today" has to roll over at the practice's midnight while the
// page is open; a minute late is close enough for a preview.
const PREVIEW_CLOCK_MS = 60_000;

interface LoadedProps<Data> {
  what: string;
  query: UseQueryResult<Data>;
  children: (data: Data) => ReactNode;
}

/**
 * Keyed on whether data is cached, not on the query's status: a failed
 * background refetch flips the status to `error` while the data is still
 * there, and unmounting the form at that point would throw away its edits.
 */
const Loaded = <Data,>({ what, query, children }: LoadedProps<Data>) => {
  const retry = () => {
    void query.refetch();
  };

  if (query.data === undefined) {
    if (!query.isError) return <p role="status">{`Loading the ${what}…`}</p>;

    return (
      <div className={styles.failed} role="alert">
        <p>{`The ${what} could not be loaded.`}</p>
        <button type="button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      {query.isError && (
        <div className={styles.failed} role="alert">
          <p>{`The latest ${what} could not be fetched. You are editing the copy loaded earlier.`}</p>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {children(query.data)}
    </>
  );
};

const PracticePreview = ({ timezone }: { timezone: string }) => {
  const now = useNow(PREVIEW_CLOCK_MS);
  const slots = useBookableSlots(previewRange(now, timezone));

  const onRetry = () => {
    void slots.refetch();
  };

  if (slots.data === undefined) {
    return (
      <SlotPreview state={slots.isError ? { status: 'error', onRetry } : { status: 'pending' }} />
    );
  }

  return (
    <SlotPreview
      state={
        slots.isError
          ? { status: 'stale', data: slots.data, onRetry }
          : { status: 'success', data: slots.data }
      }
    />
  );
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
          <Loaded what="business hours" query={hours}>
            {(week) => (
              <BusinessHoursEditor
                initial={week}
                onSave={onSaveHours}
                onDirtyChange={setHoursDirty}
              />
            )}
          </Loaded>

          <Loaded what="practice settings" query={settings}>
            {(saved) => (
              <PracticeSettingsForm
                initial={saved}
                onSave={onSaveSettings}
                onDirtyChange={setSettingsDirty}
              />
            )}
          </Loaded>
        </div>

        {settings.data !== undefined && <PracticePreview timezone={settings.data.timezone} />}
      </div>
    </main>
  );
};
