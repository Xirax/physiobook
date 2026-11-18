import type { SlotsResponse } from '@physiobook/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SlotPicker, type SlotPickerProps, type SlotPickerState } from './SlotPicker';

const mondayNine = { start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T09:00:00.000Z' };
const mondayTen = { start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z' };
const tuesdayNine = { start: '2026-11-03T08:00:00.000Z', end: '2026-11-03T09:00:00.000Z' };

const week: SlotsResponse = {
  timezone: 'Europe/Warsaw',
  slots: [mondayNine, mondayTen, tuesdayNine],
};

const renderPicker = (state: SlotPickerState, overrides: Partial<SlotPickerProps> = {}) => {
  const props: SlotPickerProps = {
    state,
    week: { from: '2026-11-02', to: '2026-11-08' },
    canGoBack: true,
    canGoForward: true,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onPick: vi.fn(),
    ...overrides,
  };

  render(<SlotPicker {...props} />);

  return props;
};

describe('SlotPicker', () => {
  it('Offers each open slot as a button under its day, in the practice timezone', () => {
    renderPicker({ status: 'success', data: week });

    const monday = within(screen.getByRole('list', { name: 'Monday 2 November' }));

    expect(monday.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '09:00',
      '10:00',
    ]);
    expect(screen.getByRole('button', { name: 'Tuesday 3 November, 09:00' })).toBeInTheDocument();
    expect(screen.getByText('Times are shown in Europe/Warsaw.')).toBeInTheDocument();
  });

  it('Offers only the slots the API answered with, so a taken hour has no button', () => {
    renderPicker({ status: 'success', data: { ...week, slots: [mondayNine, tuesdayNine] } });

    const monday = within(screen.getByRole('list', { name: 'Monday 2 November' }));

    expect(monday.getAllByRole('button').map((button) => button.textContent)).toEqual(['09:00']);
    expect(screen.queryByRole('button', { name: 'Monday 2 November, 10:00' })).toBeNull();
  });

  it('Hands the picked slot to its parent', async () => {
    const { onPick } = renderPicker({ status: 'success', data: week });

    await userEvent.click(screen.getByRole('button', { name: 'Monday 2 November, 10:00' }));

    expect(onPick).toHaveBeenCalledWith(mondayTen);
  });

  it('Names the week it shows and steps between weeks', async () => {
    const { onPrevious, onNext } = renderPicker({ status: 'success', data: week });

    expect(
      screen.getByRole('heading', { name: '2 November – 8 November 2026' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));

    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('Disables the steps past either end of the bookable range', () => {
    renderPicker({ status: 'success', data: week }, { canGoBack: false, canGoForward: false });

    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
  });

  it('Says it is loading while the slots are on their way', () => {
    renderPicker({ status: 'pending' });

    expect(screen.getByRole('status')).toHaveTextContent('Loading the open slots');
  });

  it('Explains a week with no open slots rather than showing nothing', () => {
    renderPicker({ status: 'success', data: { timezone: 'UTC', slots: [] } });

    expect(screen.getByText('No open slots this week.')).toBeInTheDocument();
  });

  it('Offers a retry when the slots could not be loaded', async () => {
    const onRetry = vi.fn();
    renderPicker({ status: 'error', onRetry });

    expect(screen.getByRole('alert')).toHaveTextContent('The open slots could not be loaded.');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('Keeps the earlier slots after a failed refresh, and says so', () => {
    renderPicker({ status: 'stale', data: week, onRetry: vi.fn() });

    expect(screen.getByRole('alert')).toHaveTextContent('These are the ones loaded earlier.');
    expect(screen.getByRole('button', { name: 'Monday 2 November, 09:00' })).toBeInTheDocument();
  });
});
