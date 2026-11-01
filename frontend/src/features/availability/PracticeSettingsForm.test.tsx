import { errorCodes } from '@physiobook/shared';
import type { PracticeSettings, UpdatePracticeSettingsRequest } from '@physiobook/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { PracticeSettingsForm } from './PracticeSettingsForm';

const settings: PracticeSettings = {
  timezone: 'Europe/Warsaw',
  slot_duration_minutes: 60,
  reminder_lead_hours: 24,
  cancellation_cutoff_hours: 24,
  updated_at: '2026-11-01T10:00:00.000Z',
};

const renderForm = (
  onSave: (update: UpdatePracticeSettingsRequest) => Promise<void> = () => Promise.resolve(),
) => {
  const saved = vi.fn(onSave);
  const onDirtyChange = vi.fn();

  render(<PracticeSettingsForm initial={settings} onSave={saved} onDirtyChange={onDirtyChange} />);

  return {
    saved,
    onDirtyChange,
    timezone: screen.getByLabelText('Timezone'),
    reminder: screen.getByLabelText('Reminder lead time (hours)'),
    cutoff: screen.getByLabelText('Cancellation cutoff (hours)'),
    button: screen.getByRole('button', { name: 'Save settings' }),
  };
};

const replace = async (input: HTMLElement, value: string) => {
  await userEvent.clear(input);
  await userEvent.type(input, value);
};

describe('PracticeSettingsForm', () => {
  it('Starts from the saved settings, with nothing to save yet', () => {
    const { timezone, reminder, cutoff, button } = renderForm();

    expect(timezone).toHaveValue('Europe/Warsaw');
    expect(reminder).toHaveValue('24');
    expect(cutoff).toHaveValue('24');
    expect(button).toBeDisabled();
  });

  it('Suggests IANA timezones without limiting the field to them', () => {
    const { timezone } = renderForm();
    const list = document.getElementById(timezone.getAttribute('list') ?? '');

    expect(list?.querySelector('option[value="Europe/London"]')).not.toBeNull();
    expect(list?.querySelector('option[value="UTC"]')).not.toBeNull();
  });

  it('Rejects a timezone that is not an IANA name, and does not save it', async () => {
    const { saved, timezone, button } = renderForm();

    await replace(timezone, 'Mars/Olympus');
    await userEvent.click(button);

    expect(saved).not.toHaveBeenCalled();
    expect(timezone).toHaveAttribute('aria-invalid', 'true');
    expect(timezone).toHaveAccessibleDescription(
      expect.stringContaining('Enter a valid IANA timezone, e.g. Europe/Warsaw'),
    );
  });

  it('Asks for a whole number of hours', async () => {
    const { reminder } = renderForm();

    await replace(reminder, '1.5');
    await userEvent.tab();

    expect(reminder).toHaveAccessibleDescription(
      expect.stringContaining('Enter a whole number of hours'),
    );
  });

  it('Holds the reminder lead time to the shared rule of at least an hour', async () => {
    const { reminder } = renderForm();

    await replace(reminder, '0');
    await userEvent.tab();

    expect(reminder).toHaveAccessibleDescription(
      expect.stringContaining('Reminder lead time must be at least 1 hour'),
    );
  });

  it('Lets the cancellation cutoff be zero but not negative', async () => {
    const { cutoff, saved, button } = renderForm();

    await replace(cutoff, '-1');
    await userEvent.tab();

    expect(cutoff).toHaveAccessibleDescription(
      expect.stringContaining('Cancellation cutoff cannot be negative'),
    );

    await replace(cutoff, '0');
    await userEvent.click(button);

    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ cancellation_cutoff_hours: 0 }));
  });

  it('Sends the editable fields as numbers, and never the slot length', async () => {
    const { saved, timezone, reminder, button } = renderForm();

    await replace(timezone, 'Europe/London');
    await replace(reminder, '48');
    await userEvent.click(button);

    expect(saved).toHaveBeenCalledWith({
      timezone: 'Europe/London',
      reminder_lead_hours: 48,
      cancellation_cutoff_hours: 24,
    });
  });

  it('Confirms the save and settles back to clean', async () => {
    const { onDirtyChange, reminder, button } = renderForm();

    await replace(reminder, '48');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(button);

    expect(await screen.findByRole('status')).toHaveTextContent('Practice settings saved.');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(button).toBeDisabled();
  });

  it('Names a refused save by its code and keeps the edit', async () => {
    const { reminder, button } = renderForm(() =>
      Promise.reject(new ApiError(403, { code: errorCodes.FORBIDDEN, message: 'Forbidden' })),
    );

    await replace(reminder, '48');
    await userEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the practice admin can change this.',
    );
    expect(reminder).toHaveValue('48');
  });
});
