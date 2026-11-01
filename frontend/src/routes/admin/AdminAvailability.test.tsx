import { errorCodes } from '@physiobook/shared';
import type { PracticeSettings, SlotsResponse, WeeklyBusinessHours } from '@physiobook/shared';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  availabilityKeys,
  BUSINESS_HOURS_PATH,
  SETTINGS_PATH,
  SLOTS_PATH,
} from '../../features/availability/availability-api';
import { ApiError } from '../../lib/api-client';
import { currentPath, renderAppAt, testAdmin, testUser } from '../../../tests/render-app';

const savedSettings: PracticeSettings = {
  timezone: 'Europe/Warsaw',
  slot_duration_minutes: 60,
  reminder_lead_hours: 24,
  cancellation_cutoff_hours: 24,
  updated_at: '2026-11-01T10:00:00.000Z',
};

/**
 * A stand-in practice whose /slots answer follows whatever was last saved, so a
 * test can watch the preview move after a save the way the real grid would.
 */
const practice = () => {
  let week: WeeklyBusinessHours = { windows: [] };
  let settings = savedSettings;

  const slots = (): SlotsResponse => ({
    timezone: settings.timezone,
    slots:
      week.windows.length === 0
        ? []
        : [{ start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T09:00:00.000Z' }],
  });

  return (path: string, options?: { method?: string; body?: unknown }): unknown => {
    if (path === BUSINESS_HOURS_PATH) {
      if (options?.method === 'PUT') week = options.body as WeeklyBusinessHours;

      return week;
    }

    if (path === SETTINGS_PATH) {
      if (options?.method === 'PUT') settings = { ...settings, ...(options.body as object) };

      return settings;
    }

    if (path.startsWith(SLOTS_PATH)) return slots();

    return undefined;
  };
};

const openPage = async (answer: ReturnType<typeof practice> = practice()) => {
  const rendered = renderAppAt('/admin/availability', { session: testAdmin, answer });

  await screen.findByRole('form', { name: 'Business hours' });
  await screen.findByRole('form', { name: 'Practice settings' });

  return rendered;
};

const preview = () => within(screen.getByRole('region', { name: 'Bookable slots' }));

const unloadIsHeld = () => {
  const event = new Event('beforeunload', { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
};

describe('Reaching the availability screen', () => {
  it('Is in the admin’s nav', async () => {
    renderAppAt('/admin', { session: testAdmin, answer: practice() });

    await userEvent.click(await screen.findByRole('link', { name: 'Availability' }));

    expect(await screen.findByRole('heading', { name: 'Availability', level: 1 })).toBeVisible();
    expect(currentPath()).toBe('/admin/availability');
  });

  it('Marks only the availability link as current, not the dashboard above it', async () => {
    await openPage();

    expect(screen.getByRole('link', { name: 'Availability' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('Turns a patient away to their own area', async () => {
    renderAppAt('/admin/availability', { session: testUser, answer: practice() });

    expect(await screen.findByRole('heading', { name: 'Your appointments' })).toBeInTheDocument();
    expect(currentPath()).toBe('/appointments');
  });

  it('Says when the hours could not be loaded, and loads them on retry', async () => {
    let failing = true;
    const healthy = practice();

    renderAppAt('/admin/availability', {
      session: testAdmin,
      answer: (path, options) => {
        if (path === BUSINESS_HOURS_PATH && failing) {
          throw new ApiError(500, { code: errorCodes.INTERNAL_ERROR, message: 'boom' });
        }

        return healthy(path, options);
      },
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The business hours could not be loaded.');

    failing = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('form', { name: 'Business hours' })).toBeInTheDocument();
  });
});

describe('When a background refresh fails mid-edit', () => {
  const flaky = () => {
    const healthy = practice();
    const failing = new Set<string>();

    const answer = (path: string, options?: { method?: string; body?: unknown }) => {
      if (failing.has(path)) {
        throw new ApiError(503, { code: errorCodes.INTERNAL_ERROR, message: 'unavailable' });
      }

      return healthy(path, options);
    };

    return { answer, failing };
  };

  it('Keeps the hours edits on screen and says the refresh failed', async () => {
    const { answer, failing } = flaky();
    const { queryClient } = await openPage(answer);

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Tuesday' }));

    failing.add(BUSINESS_HOURS_PATH);
    await act(() => queryClient.refetchQueries({ queryKey: availabilityKeys.businessHours }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The latest business hours could not be fetched',
    );
    expect(screen.getByRole('group', { name: 'Tuesday window 1' })).toBeInTheDocument();
    expect(unloadIsHeld()).toBe(true);
  });

  it('Keeps the settings edits on screen too', async () => {
    const { answer, failing } = flaky();
    const { queryClient } = await openPage(answer);

    const reminder = screen.getByLabelText('Reminder lead time (hours)');
    await userEvent.type(reminder, '0');

    failing.add(SETTINGS_PATH);
    await act(() => queryClient.refetchQueries({ queryKey: availabilityKeys.settings }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The latest practice settings could not be fetched',
    );
    expect(screen.getByLabelText('Reminder lead time (hours)')).toHaveValue('240');
  });
});

describe('The slot preview after a save', () => {
  it('Shows the slots the newly saved hours open', async () => {
    await openPage();

    expect(await preview().findByText(/No bookable slots/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Monday' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save hours' }));

    expect(await preview().findByRole('list', { name: 'Monday 2 November' })).toBeInTheDocument();
  });

  it('Moves to the newly saved timezone', async () => {
    await openPage();

    await preview().findByText(/Times are shown in Europe\/Warsaw/);

    const timezone = screen.getByLabelText('Timezone');
    await userEvent.clear(timezone);
    await userEvent.type(timezone, 'Europe/London');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await preview().findByText(/Times are shown in Europe\/London/)).toBeInTheDocument();
  });
});

describe('Guarding unsaved edits', () => {
  it('Lets the page unload freely while nothing has changed', async () => {
    await openPage();

    expect(unloadIsHeld()).toBe(false);
  });

  it('Holds the unload while the hours have unsaved edits, and lets go once saved', async () => {
    await openPage();

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Monday' }));
    expect(unloadIsHeld()).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    await screen.findByText('Business hours saved.');

    expect(unloadIsHeld()).toBe(false);
  });

  it('Holds the unload while the settings have unsaved edits, and lets go once undone', async () => {
    await openPage();

    const reminder = screen.getByLabelText('Reminder lead time (hours)');
    await userEvent.type(reminder, '0');
    expect(unloadIsHeld()).toBe(true);

    await userEvent.type(reminder, '{Backspace}');
    expect(unloadIsHeld()).toBe(false);
  });
});
