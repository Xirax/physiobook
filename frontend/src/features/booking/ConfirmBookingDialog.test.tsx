import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmBookingDialog, type ConfirmBookingDialogProps } from './ConfirmBookingDialog';

const slot = { start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T09:00:00.000Z' };

const renderDialog = (overrides: Partial<ConfirmBookingDialogProps> = {}) => {
  const props: ConfirmBookingDialogProps = {
    slot,
    timezone: 'Europe/Warsaw',
    booking: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };

  render(<ConfirmBookingDialog {...props} />);

  return props;
};

const Opener = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <ConfirmBookingDialog
          slot={slot}
          timezone="UTC"
          booking={false}
          onConfirm={vi.fn()}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
};

describe('ConfirmBookingDialog', () => {
  it('Asks to confirm the slot, spelled out in the practice timezone', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'Book this appointment?' });

    expect(dialog).toHaveAccessibleDescription(
      'Monday, 2 November 2026, 09:00–10:00 Times are shown in Europe/Warsaw.',
    );
  });

  it('Starts with focus on the confirm button', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Book appointment' })).toHaveFocus();
  });

  it('Confirms or cancels on the matching button', async () => {
    const { onConfirm, onCancel } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Book appointment' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('Cancels on Escape', async () => {
    const { onCancel } = renderDialog();

    await userEvent.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('Keeps Tab cycling inside the dialog', async () => {
    renderDialog();

    const confirm = screen.getByRole('button', { name: 'Book appointment' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    await userEvent.tab();
    expect(cancel).toHaveFocus();

    await userEvent.tab();
    expect(confirm).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(cancel).toHaveFocus();
  });

  it('Locks both choices while the booking is in flight, Escape included', async () => {
    const { onCancel } = renderDialog({ booking: true });

    expect(screen.getByRole('button', { name: 'Booking…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await userEvent.keyboard('{Escape}');

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Hands focus back to what opened it once closed', async () => {
    render(<Opener />);

    const opener = screen.getByRole('button', { name: 'Open' });

    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});
