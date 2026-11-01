import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SlotPreview } from './SlotPreview';

describe('SlotPreview', () => {
  it('Says it is loading while the slots are on their way', () => {
    render(<SlotPreview state={{ status: 'pending' }} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the bookable slots');
  });

  it('Lists the bookable hours per day, in the practice timezone', () => {
    render(
      <SlotPreview
        state={{
          status: 'success',
          data: {
            timezone: 'Europe/Warsaw',
            slots: [
              { start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T09:00:00.000Z' },
              { start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z' },
              { start: '2026-11-03T08:00:00.000Z', end: '2026-11-03T09:00:00.000Z' },
            ],
          },
        }}
      />,
    );

    const monday = within(screen.getByRole('list', { name: 'Monday 2 November' }));

    expect(monday.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '09:00',
      '10:00',
    ]);
    expect(screen.getByRole('list', { name: 'Tuesday 3 November' })).toBeInTheDocument();
    expect(screen.getByText(/Times are shown in Europe\/Warsaw/)).toBeInTheDocument();
  });

  it('Explains an empty preview rather than showing nothing', () => {
    render(<SlotPreview state={{ status: 'success', data: { timezone: 'UTC', slots: [] } }} />);

    expect(screen.getByText(/No bookable slots in the next 7 days/)).toBeInTheDocument();
  });

  it('Keeps the earlier slots after a failed refresh, and says so', async () => {
    const onRetry = vi.fn();

    render(
      <SlotPreview
        state={{
          status: 'stale',
          onRetry,
          data: {
            timezone: 'Europe/Warsaw',
            slots: [{ start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T09:00:00.000Z' }],
          },
        }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The latest slots could not be fetched');
    expect(screen.getByRole('list', { name: 'Monday 2 November' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('Offers a retry when the slots could not be loaded', async () => {
    const onRetry = vi.fn();

    render(<SlotPreview state={{ status: 'error', onRetry }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
