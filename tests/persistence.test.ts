import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { openBoardDatabase } from "../src/db";
import {
  ListingStore,
  createListingStore,
  type UnpaidTicket,
} from "../src/core/listings";
import { ListingError } from "../src/core/listing";
import type { ListingDraft, PaidEvent } from "../src/billing/port";
import { rankListings } from "../src/core/rank";
import { settleFixtureEventInStore } from "./fixture-settlement";

const NOW = new Date();
const PAID_AT = new Date(NOW.getTime() - 60_000).toISOString();
const WEEK = "2026-W34";

function draft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  return {
    buyer: "Acme Studio",
    budgetUsd: 3200,
    deadline: "2026-09-15",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/acme",
    bidUsd: 5,
    weekId: WEEK,
    ...overrides,
  };
}

function paidEvent(
  sessionId: string,
  overrides: Partial<PaidEvent> = {},
): PaidEvent {
  return {
    sessionId,
    listingDraft: draft(),
    amountUsd: 5,
    kind: "create",
    paidAt: PAID_AT,
    ...overrides,
  };
}

function tempDatabasePath(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "freelance-brief-board-n1-"));
  return { directory, path: join(directory, "board.sqlite") };
}

function closeAndRemove(
  directory: string,
  ...stores: Array<ListingStore | undefined>
): void {
  for (const store of stores) store?.close();
  rmSync(directory, { recursive: true, force: true });
}

type ChildResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

function runStoreProcess(
  databasePath: string,
  event: PaidEvent,
): Promise<ChildResult> {
  const storeUrl = pathToFileURL(
    join(process.cwd(), "src/core/listings.ts"),
  ).href;
  const helperUrl = pathToFileURL(
    join(process.cwd(), "tests/fixture-settlement.ts"),
  ).href;
  const source = `
    import { ListingStore } from ${JSON.stringify(storeUrl)};
    import { settleFixtureEventInStore } from ${JSON.stringify(helperUrl)};
    const store = new ListingStore({ databasePath: process.env.N1_DATABASE_PATH });
    try {
      const event = JSON.parse(process.env.N1_EVENT ?? "null");
      const listing = settleFixtureEventInStore(store, event).listing;
      process.stdout.write(JSON.stringify({ ok: true, listing }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        ok: false,
        code: error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unknown",
        message: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      store.close();
    }
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", source],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_PATH: ":memory:",
        WAFFO_MODE: "fixture",
        N1_DATABASE_PATH: databasePath,
        N1_EVENT: JSON.stringify(event),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve) => {
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("claim → paid → restart → rank survives in a shared SQLite file", () => {
  const { directory, path } = tempDatabasePath();
  let first: ListingStore | undefined;
  let restarted: ListingStore | undefined;
  try {
    first = createListingStore({ databasePath: path });
    const event = paidEvent("session_restart");
    first.rememberUnpaidCheckout({
      sessionId: event.sessionId,
      listingDraft: event.listingDraft,
    });
    assert.equal(first.listUnpaid(WEEK).length, 1);
    const created = settleFixtureEventInStore(first, event).listing;
    assert.ok(created);
    assert.equal(first.listUnpaid(WEEK).length, 0);
    first.close();
    first = undefined;

    restarted = createListingStore({ databasePath: path });
    const ranked = rankListings(restarted.listPaidRolling(NOW), NOW);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]?.id, created.id);
    assert.equal(ranked[0]?.bidUsd, 5);
    assert.equal(ranked[0]?.firstPaidAt, PAID_AT);
  } finally {
    closeAndRemove(directory, first, restarted);
  }
});

test("click count survives a process restart", () => {
  const { directory, path } = tempDatabasePath();
  let first: ListingStore | undefined;
  let restarted: ListingStore | undefined;
  try {
    first = createListingStore({ databasePath: path });
    const listing = settleFixtureEventInStore(first, paidEvent("session_click")).listing;
    assert.ok(listing);
    assert.equal(first.incrementListingClicks(listing.id)?.clicks, 1);
    first.close();
    first = undefined;

    restarted = createListingStore({ databasePath: path });
    assert.equal(restarted.getListingById(listing.id)?.clicks, 1);
    assert.equal(restarted.incrementListingClicks(listing.id)?.clicks, 2);
  } finally {
    closeAndRemove(directory, first, restarted);
  }
});

test("two independent store instances share unpaid, paid, and duplicate-session state", () => {
  const { directory, path } = tempDatabasePath();
  let first: ListingStore | undefined;
  let second: ListingStore | undefined;
  try {
    first = createListingStore({ databasePath: path });
    second = createListingStore({ databasePath: path });
    const event = paidEvent("session_shared");
    first.rememberUnpaidCheckout({
      sessionId: event.sessionId,
      listingDraft: event.listingDraft,
    });
    assert.equal(second.listUnpaid(WEEK).map((row: UnpaidTicket) => row.sessionId).join(), "session_shared");

    const created = settleFixtureEventInStore(second, event).listing;
    assert.ok(created);
    assert.equal(first.getListingById(created.id)?.buyer, "Acme Studio");
    assert.equal(first.listUnpaid(WEEK).length, 0);

    const replay = settleFixtureEventInStore(first, event).listing;
    assert.deepEqual(replay, created);
    assert.equal(second.listPaid(WEEK).length, 1);
  } finally {
    closeAndRemove(directory, first, second);
  }
});

test("duplicate paid event is a no-op and preserves first-paid tie timestamp", () => {
  const { directory, path } = tempDatabasePath();
  let store: ListingStore | undefined;
  try {
    store = createListingStore({ databasePath: path });
    const event = paidEvent("session_duplicate");
    const first = settleFixtureEventInStore(store, event).listing;
    assert.ok(first);
    assert.equal(store.incrementListingClicks(first.id)?.clicks, 1);
    const replay = settleFixtureEventInStore(store, event).listing;
    assert.deepEqual(replay, {
      ...first,
      clicks: 1,
    });
    assert.equal(store.listPaid(WEEK).length, 1);
    assert.equal(store.listPaid(WEEK)[0]?.firstPaidAt, PAID_AT);

    const db = openBoardDatabase(path);
    try {
      const paymentCount = db
        .prepare<[string], { count: number }>(
          "SELECT COUNT(*) AS count FROM payments WHERE polar_session = ?",
        )
        .get(event.sessionId);
      assert.equal(paymentCount?.count, 1);
    } finally {
      db.close();
    }
  } finally {
    closeAndRemove(directory, store);
  }
});

test("out-of-order independent creates sharing a URL reconcile the second", () => {
  const { directory, path } = tempDatabasePath();
  let store: ListingStore | undefined;
  try {
    store = createListingStore({ databasePath: path });
    const briefUrl = "https://example.com/out-of-order";
    const laterPaidAt = new Date(Date.now() - 10_000).toISOString();
    const earlierPaidAt = new Date(Date.now() - 20_000).toISOString();
    const first = paidEvent("session_out_of_order_first", {
      intentId: "intent_out_of_order_first",
      listingDraft: draft({ briefUrl, buyer: "Later delivery" }),
      paidAt: laterPaidAt,
    });
    const second = paidEvent("session_out_of_order_second", {
      intentId: "intent_out_of_order_second",
      listingDraft: draft({ briefUrl, buyer: "Earlier payment", bidUsd: 12 }),
      amountUsd: 12,
      paidAt: earlierPaidAt,
    });

    const placed = settleFixtureEventInStore(store, first).listing;
    assert.ok(placed);
    assert.equal(placed.firstPaidAt, laterPaidAt);
    assert.throws(
      () => settleFixtureEventInStore(store!, second),
      (error: unknown) =>
        error instanceof ListingError && error.code === "brief_identity_conflict",
    );

    assert.equal(store.getCheckoutIntent(second.intentId!)?.status, "needs_reconciliation");
    assert.equal(store.listPaid(WEEK).length, 1);
    assert.deepEqual(store.findPaidByIdentity(briefUrl, new Date()), placed);
    const audit = store.listPaymentAuditEvents().at(-1);
    assert.equal(audit?.outcome, "conflict");
    assert.equal(audit?.reason, "brief_identity_conflict");
  } finally {
    closeAndRemove(directory, store);
  }
});

test("two-process stale raises serialize: one applies and one is explicitly rejected", async () => {
  const { directory, path } = tempDatabasePath();
  let seed: ListingStore | undefined;
  let reader: ListingStore | undefined;
  try {
    seed = createListingStore({ databasePath: path });
    const initial = paidEvent("session_seed", {
      listingDraft: draft({ briefUrl: "https://example.com/race" }),
    });
    const seeded = settleFixtureEventInStore(seed, initial).listing;
    assert.ok(seeded);
    seed.close();
    seed = undefined;

    const raise = (sessionId: string): PaidEvent =>
      paidEvent(sessionId, {
        listingDraft: draft({
          buyer: "Competing Studio",
          briefUrl: "https://example.com/race",
          bidUsd: 12,
        }),
        amountUsd: 7,
        kind: "raise",
      });
    const outcomes = await Promise.all([
      runStoreProcess(path, raise("session_raise_a")),
      runStoreProcess(path, raise("session_raise_b")),
    ]);
    assert.equal(outcomes[0]?.code, 0);
    assert.equal(outcomes[1]?.code, 0);
    const parsed = outcomes.map((result) => JSON.parse(result.stdout) as { ok: boolean; code?: string });
    assert.equal(parsed.filter((result) => result.ok).length, 1);
    assert.equal(parsed.filter((result) => result.code === "bid_not_higher").length, 1);

    reader = createListingStore({ databasePath: path });
    const finalListing = reader.findPaidByIdentity(
      "https://example.com/race",
      NOW,
    );
    assert.ok(finalListing);
    assert.equal(finalListing.bidUsd, 12);
    assert.equal(finalListing.firstPaidAt, PAID_AT);

    const db = openBoardDatabase(path);
    try {
      const payments = db
        .prepare<[], { status: string; error_code: string | null }>(
          "SELECT status, error_code FROM payments ORDER BY id ASC",
        )
        .all();
      assert.equal(payments.length, 3);
      assert.equal(payments.filter((row) => row.status === "applied").length, 2);
      assert.deepEqual(
        payments.filter((row) => row.status === "rejected").map((row) => row.error_code),
        ["bid_not_higher"],
      );
    } finally {
      db.close();
    }
  } finally {
    closeAndRemove(directory, seed, reader);
  }
});
