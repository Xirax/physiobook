import { errorCodes } from '@physiobook/shared';
import type { WeeklyBusinessHours } from '@physiobook/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { BusinessHoursEditor } from './BusinessHoursEditor';

const mondayOnly: WeeklyBusinessHours = {
  windows: [{ day_of_week: 1, opens_at: '09:00', closes_at: '17:00' }],
};

const renderEditor = (
  onSave: (week: WeeklyBusinessHours) => Promise<void> = () => Promise.resolve(),
  initial = mondayOnly,
) => {
  const saved = vi.fn(onSave);
  const onDirtyChange = vi.fn();

  render(<BusinessHoursEditor initial={initial} onSave={saved} onDirtyChange={onDirtyChange} />);

  return { saved, onDirtyChange };
};

const day = (name: string) => within(screen.getByRole('group', { name }));
const windowOf = (name: string) => within(screen.getByRole('group', { name }));

const setTime = async (input: HTMLElement, value: string) => {
  await userEvent.clear(input);
  await userEvent.type(input, value);
};

const saveButton = () => screen.getByRole('button', { name: 'Save hours' });

describe('BusinessHoursEditor layout', () => {
  it('Lists every day of the week, Monday first', () => {
    renderEditor();

    const legends = screen.getAllByRole('group').filter((group) => group.tagName === 'FIELDSET');

    expect(legends.map((group) => group.querySelector('legend')?.textContent)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
  });

  it('Shows the saved window and marks a day with none as closed', () => {
    renderEditor();

    expect(windowOf('Monday window 1').getByLabelText('Opens')).toHaveValue('09:00');
    expect(windowOf('Monday window 1').getByLabelText('Closes')).toHaveValue('17:00');
    expect(day('Tuesday').getByText('Closed')).toBeInTheDocument();
  });

  it('Steps the time inputs in quarter hours', () => {
    renderEditor();

    expect(windowOf('Monday window 1').getByLabelText('Opens')).toHaveAttribute('step', '900');
  });

  it('Offers nothing to save before anything has changed', () => {
    renderEditor();

    expect(saveButton()).toBeDisabled();
  });
});

describe('Adding and removing windows', () => {
  it('Opens a closed day with a window', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Tuesday' }));

    expect(windowOf('Tuesday window 1').getByLabelText('Opens')).toHaveValue('09:00');
    expect(day('Tuesday').queryByText('Closed')).not.toBeInTheDocument();
  });

  it('Adds a split shift that does not overlap the window before it', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Monday' }));

    expect(windowOf('Monday window 2').getByLabelText('Opens')).toHaveValue('17:00');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Removes a window, closing the day it was the last of', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Monday window 1' }));

    expect(screen.queryByRole('group', { name: 'Monday window 1' })).not.toBeInTheDocument();
    expect(day('Monday').getByText('Closed')).toBeInTheDocument();
  });
});

describe('Inline validation', () => {
  it('Flags a closing time at or before the opening time on that input', async () => {
    renderEditor();

    const closes = windowOf('Monday window 1').getByLabelText('Closes');
    await setTime(closes, '08:00');

    expect(closes).toHaveAttribute('aria-invalid', 'true');
    expect(closes).toHaveAccessibleDescription('Closing time must be after opening time');
  });

  it('Flags a same-day overlap inline and above the form', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Monday' }));
    await setTime(windowOf('Monday window 2').getByLabelText('Opens'), '16:00');

    expect(screen.getByRole('alert')).toHaveTextContent('Windows overlap on Monday');
    expect(windowOf('Monday window 2').getByLabelText('Opens')).toHaveAccessibleDescription(
      'Overlaps another window on the same day',
    );
  });

  it('Does not call windows on different days an overlap', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Tuesday' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Blocks the save while a window is invalid', async () => {
    const { saved } = renderEditor();

    await setTime(windowOf('Monday window 1').getByLabelText('Closes'), '08:00');
    await userEvent.click(saveButton());

    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Fix the highlighted windows');
  });
});

describe('Saving', () => {
  it('Sends the whole week, sorted the way the API keeps it', async () => {
    const { saved } = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Sunday' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Monday' }));
    await userEvent.click(saveButton());

    expect(saved).toHaveBeenCalledWith({
      windows: [
        { day_of_week: 0, opens_at: '09:00', closes_at: '17:00' },
        { day_of_week: 1, opens_at: '09:00', closes_at: '17:00' },
        { day_of_week: 1, opens_at: '17:00', closes_at: '18:00' },
      ],
    });
  });

  it('Saves an empty week, which closes the practice', async () => {
    const { saved } = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Monday window 1' }));
    await userEvent.click(saveButton());

    expect(saved).toHaveBeenCalledWith({ windows: [] });
  });

  it('Confirms the save and treats the saved week as the new starting point', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Tuesday' }));
    await userEvent.click(saveButton());

    expect(await screen.findByRole('status')).toHaveTextContent('Business hours saved.');
    expect(saveButton()).toBeDisabled();
  });

  it('Keeps the edits and names the refusal when the save fails', async () => {
    renderEditor(() =>
      Promise.reject(new ApiError(403, { code: errorCodes.FORBIDDEN, message: 'Forbidden' })),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Tuesday' }));
    await userEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the practice admin can change this.',
    );
    expect(screen.getByRole('group', { name: 'Tuesday window 1' })).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });
});

describe('Unsaved changes', () => {
  it('Reports the form dirty after an edit and clean once it is undone', async () => {
    const { onDirtyChange } = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Tuesday' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole('button', { name: 'Remove Tuesday window 1' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('Discards the edits back to the saved week', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Monday window 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(windowOf('Monday window 1').getByLabelText('Opens')).toHaveValue('09:00');
    expect(saveButton()).toBeDisabled();
  });

  it('Reports the form clean once the save has landed', async () => {
    const { onDirtyChange } = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Add a window on Tuesday' }));
    await userEvent.click(saveButton());
    await screen.findByRole('status');

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
