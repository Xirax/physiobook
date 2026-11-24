import { DateTime } from 'luxon';

export interface TimeSpan {
  start: Date;
  end: Date;
}

function local(instant: Date, timezone: string): DateTime {
  return DateTime.fromJSDate(instant, { zone: timezone }).setLocale('en-GB');
}

export const longDate = (instant: Date, timezone: string) =>
  local(instant, timezone).toFormat('cccc d LLLL yyyy');

export const time = (instant: Date, timezone: string) => local(instant, timezone).toFormat('HH:mm');

export const timeRange = ({ start, end }: TimeSpan, timezone: string) =>
  `${time(start, timezone)}–${time(end, timezone)}`;
