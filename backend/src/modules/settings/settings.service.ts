import { practiceSettings, type Database } from '@physiobook/db';
import type { PracticeSettings, UpdatePracticeSettingsRequest } from '@physiobook/shared';
import { eq } from 'drizzle-orm';

export interface SettingsDependencies {
  db: Database;
}

// The CHECK (id = 1) constraint (SCHEMA.md §2.3) and the seed migration
// together mean this row always exists and there is never a second one.
const SINGLETON_ID = 1;

const settingsColumns = {
  timezone: practiceSettings.timezone,
  slotDurationMinutes: practiceSettings.slotDurationMinutes,
  reminderLeadHours: practiceSettings.reminderLeadHours,
  cancellationCutoffHours: practiceSettings.cancellationCutoffHours,
  updatedAt: practiceSettings.updatedAt,
} as const;

interface SettingsRow {
  timezone: string;
  slotDurationMinutes: number;
  reminderLeadHours: number;
  cancellationCutoffHours: number;
  updatedAt: Date;
}

function toPracticeSettings(row: SettingsRow): PracticeSettings {
  return {
    timezone: row.timezone,
    slot_duration_minutes: row.slotDurationMinutes,
    reminder_lead_hours: row.reminderLeadHours,
    cancellation_cutoff_hours: row.cancellationCutoffHours,
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function getSettings({ db }: SettingsDependencies): Promise<PracticeSettings> {
  const [row] = await db
    .select(settingsColumns)
    .from(practiceSettings)
    .where(eq(practiceSettings.id, SINGLETON_ID))
    .limit(1);

  if (row === undefined) throw new Error('practice_settings singleton row is missing');

  return toPracticeSettings(row);
}

export async function updateSettings(
  input: UpdatePracticeSettingsRequest,
  { db }: SettingsDependencies,
): Promise<PracticeSettings> {
  const [row] = await db
    .update(practiceSettings)
    .set({
      timezone: input.timezone,
      reminderLeadHours: input.reminder_lead_hours,
      cancellationCutoffHours: input.cancellation_cutoff_hours,
    })
    .where(eq(practiceSettings.id, SINGLETON_ID))
    .returning(settingsColumns);

  if (row === undefined) throw new Error('practice_settings singleton row is missing');

  return toPracticeSettings(row);
}
