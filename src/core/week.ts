/** Rolling last-7-days desk window. `weekId` is an ISO week label, not rank expiry. */

export type UtcWeek = {
  weekId: string;
  startsAt: string;
  endsAt: string;
};

const DAY_MS = 86_400_000;

/** Inclusive length of the public week window. Not a Monday midnight bucket. */
export const ROLLING_WEEK_MS = 7 * DAY_MS;

function utcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Inclusive start of the rolling last-7-days window. Not civil midnight. */
export function rollingWeekStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - ROLLING_WEEK_MS);
}

/** Exclusive end of the rolling last-7-days window (`now`). */
export function nextResetUtc(now: Date = new Date()): Date {
  return new Date(now.getTime());
}

/**
 * Paid bid is live if `paidAt` is inside `[now - 7d, now]`.
 * Monday 00:00 UTC is not the drop.
 */
export function bidInRollingWeek(
  paidAt: string,
  now: Date = new Date(),
): boolean {
  const paid = Date.parse(paidAt);
  if (Number.isNaN(paid)) {
    return false;
  }
  const t = now.getTime();
  return paid >= t - ROLLING_WEEK_MS && paid <= t;
}

/** Monday 00:00:00.000 UTC of the ISO week that contains `now` (label only). */
export function weekStartUtc(now: Date = new Date()): Date {
  const start = utcMidnight(now);
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - (day - 1));
  return start;
}

/** ISO week id in UTC, e.g. `2026-W34`. Rank does not expire on this label. */
export function weekIdUtc(now: Date = new Date()): string {
  const thursday = utcMidnight(now);
  const day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  );
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function currentWeekUtc(now: Date = new Date()): UtcWeek {
  const starts = rollingWeekStart(now);
  const ends = nextResetUtc(now);
  return {
    weekId: weekIdUtc(now),
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
  };
}
