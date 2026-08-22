/** ISO week in UTC (`YYYY-Www`). Boundary is Monday 00:00:00.000 UTC. */

export type UtcWeek = {
  weekId: string;
  startsAt: string;
  endsAt: string;
};

const DAY_MS = 86_400_000;

function utcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Monday 00:00:00.000 UTC of the ISO week that contains `now`. */
export function weekStartUtc(now: Date = new Date()): Date {
  const start = utcMidnight(now);
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - (day - 1));
  return start;
}

/** Next Monday 00:00:00.000 UTC (exclusive end of the current week). */
export function nextResetUtc(now: Date = new Date()): Date {
  return new Date(weekStartUtc(now).getTime() + 7 * DAY_MS);
}

/** ISO week id in UTC, e.g. `2026-W34`. */
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
  const starts = weekStartUtc(now);
  const ends = nextResetUtc(now);
  return {
    weekId: weekIdUtc(now),
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
  };
}
