import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ROLLING_WEEK_MS,
  bidInRollingWeek,
  currentWeekUtc,
  nextResetUtc,
  rollingWeekStart,
  weekIdUtc,
  weekStartUtc,
} from "../src/core/week";

test("ISO weekId is a label; Monday 00:00 UTC is not the house window", () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  assert.equal(weekIdUtc(monday), "2026-W34");
  assert.equal(weekStartUtc(monday).toISOString(), "2026-08-17T00:00:00.000Z");
  assert.equal(nextResetUtc(monday).toISOString(), "2026-08-17T00:00:00.000Z");
  assert.deepEqual(currentWeekUtc(monday), {
    weekId: "2026-W34",
    startsAt: "2026-08-10T00:00:00.000Z",
    endsAt: "2026-08-17T00:00:00.000Z",
  });
});

test("Sunday still belongs to the previous ISO week label", () => {
  const sunday = new Date("2026-08-16T23:59:59.999Z");
  assert.equal(weekIdUtc(sunday), "2026-W33");
  assert.equal(weekStartUtc(sunday).toISOString(), "2026-08-10T00:00:00.000Z");
});

test("one millisecond before Monday 00:00 UTC stays on the previous ISO week label", () => {
  const justBefore = new Date("2026-08-16T23:59:59.999Z");
  const monday = new Date("2026-08-17T00:00:00.000Z");
  assert.notEqual(weekIdUtc(justBefore), weekIdUtc(monday));
  assert.equal(weekIdUtc(justBefore), "2026-W33");
  assert.equal(weekIdUtc(monday), "2026-W34");
});

test("ISO year can differ from the calendar year near 1 January", () => {
  const lateDecember = new Date("2026-12-31T12:00:00.000Z");
  assert.equal(weekIdUtc(lateDecember), "2026-W53");
  const earlyJanuary = new Date("2027-01-01T00:00:00.000Z");
  assert.equal(weekIdUtc(earlyJanuary), "2026-W53");
  const firstMonday = new Date("2027-01-04T00:00:00.000Z");
  assert.equal(weekIdUtc(firstMonday), "2027-W01");
});

test("rolling last-7-days window is 7 * 24h, not Monday 00:00 UTC", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  assert.equal(ROLLING_WEEK_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(
    rollingWeekStart(now).toISOString(),
    "2026-08-17T00:00:00.000Z",
  );
  assert.equal(bidInRollingWeek("2026-08-17T00:00:00.000Z", now), true);
  assert.equal(bidInRollingWeek("2026-08-16T23:59:59.000Z", now), false);
  assert.equal(bidInRollingWeek("2026-08-23T23:59:59.000Z", now), true);
  assert.equal(bidInRollingWeek("2026-08-24T00:00:01.000Z", now), false);
});

test("Monday 00:00 UTC does not drop a bid still inside the rolling week", () => {
  const sundayPay = "2026-08-16T12:00:00.000Z";
  const mondayMidnight = new Date("2026-08-17T00:00:00.000Z");
  assert.equal(bidInRollingWeek(sundayPay, mondayMidnight), true);
  assert.equal(
    bidInRollingWeek(sundayPay, new Date("2026-08-23T12:00:00.000Z")),
    true,
  );
  assert.equal(
    bidInRollingWeek(sundayPay, new Date("2026-08-23T12:00:01.000Z")),
    false,
  );
});
