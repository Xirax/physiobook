import type { BusinessHoursWindow, WorkloadGranularity, WorkloadPeriod } from '@physiobook/shared';
import { DateTime } from 'luxon';

import { generateSlots, type TimeRange } from '../availability/slot-grid.js';

export interface WorkloadInput {
  timezone: string;
  windows: readonly BusinessHoursWindow[];
  /** Practice-tz calendar dates, both inclusive. */
  from: string;
  to: string;
  granularity: WorkloadGranularity;
  timeOff: readonly TimeRange[];
  appointments: readonly TimeRange[];
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const last = DateTime.fromISO(to, { zone: 'utc' });
  for (
    let day = DateTime.fromISO(from, { zone: 'utc' });
    day <= last;
    day = day.plus({ days: 1 })
  ) {
    dates.push(day.toISODate()!);
  }
  return dates;
}

const periodOf = (date: string, granularity: WorkloadGranularity): string =>
  granularity === 'day'
    ? date
    : DateTime.fromISO(date, { zone: 'utc' }).startOf('week').toISODate()!;

/**
 * Capacity is the business-hours grid minus time-off, past included; open is
 * that capacity minus appointments. Booked counts every active appointment
 * starting in the period — including one left outside business hours after
 * they changed (ticket 2.2) — so booked can exceed capacity - open.
 */
export function aggregateWorkload({
  timezone,
  windows,
  from,
  to,
  granularity,
  timeOff,
  appointments,
}: WorkloadInput): WorkloadPeriod[] {
  const periods = new Map<string, WorkloadPeriod>();
  for (const date of datesBetween(from, to)) {
    const period = periodOf(date, granularity);
    if (!periods.has(period)) periods.set(period, { period, capacity: 0, booked: 0, open: 0 });
  }

  const periodOfInstant = (instant: Date): WorkloadPeriod | undefined => {
    const date = DateTime.fromJSDate(instant, { zone: timezone }).toISODate()!;
    if (date < from || date > to) return undefined;
    return periods.get(periodOf(date, granularity));
  };

  const grid = { timezone, windows, from, to };
  for (const slot of generateSlots({ ...grid, blocks: timeOff })) {
    periodOfInstant(slot.start)!.capacity += 1;
  }
  for (const slot of generateSlots({ ...grid, blocks: [...timeOff, ...appointments] })) {
    periodOfInstant(slot.start)!.open += 1;
  }
  for (const appointment of appointments) {
    const period = periodOfInstant(appointment.start);
    if (period !== undefined) period.booked += 1;
  }

  return [...periods.values()];
}
