import assert from "node:assert/strict";
import { test } from "node:test";
import {
  currentWeekUtc,
  nextResetUtc,
  weekIdUtc,
  weekStartUtc,
} from "../src/core/week";

test("Monday 00:00 UTC is included in the new week", () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  assert.equal(weekIdUtc(monday), "2026-W34");
  assert.equal(weekStartUtc(monday).toISOString(), "2026-08-17T00:00:00.000Z");
  assert.equal(nextResetUtc(monday).toISOString(), "2026-08-24T00:00:00.000Z");
  assert.deepEqual(currentWeekUtc(monday), {
    weekId: "2026-W34",
    startsAt: "2026-08-17T00:00:00.000Z",
    endsAt: "2026-08-24T00:00:00.000Z",
  });
});

test("Sunday still belongs to the previous ISO week", () => {
  const sunday = new Date("2026-08-16T23:59:59.999Z");
  assert.equal(weekIdUtc(sunday), "2026-W33");
  assert.equal(weekStartUtc(sunday).toISOString(), "2026-08-10T00:00:00.000Z");
  assert.equal(nextResetUtc(sunday).toISOString(), "2026-08-17T00:00:00.000Z");
});

test("one millisecond before Monday 00:00 UTC stays on the previous week", () => {
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
