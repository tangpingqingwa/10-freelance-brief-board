import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
// Keep the extension so scripts/preflight.mjs can invoke this helper with
// Node's native TypeScript stripping in a production install.
// @ts-expect-error TS bundler resolution normally omits source extensions.
import { assertProductionSettings, databasePath as configuredDatabasePath } from "./config.ts";
import type { DatabaseEnv } from "./config.ts";

export type BoardDatabase = Database.Database;

type Migration = {
  version: number;
  sql: string;
};

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS listings (
        id TEXT PRIMARY KEY,
        week_id TEXT NOT NULL,
        buyer TEXT NOT NULL,
        budget_usd INTEGER NOT NULL CHECK (budget_usd >= 1),
        deadline TEXT NOT NULL,
        winner_rule TEXT NOT NULL,
        brief_url TEXT NOT NULL,
        bid_usd INTEGER NOT NULL CHECK (bid_usd >= 0),
        first_paid_at TEXT NOT NULL,
        last_paid_at TEXT NOT NULL,
        clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0)
      );

      CREATE INDEX IF NOT EXISTS listings_week_idx
        ON listings (week_id);
      CREATE INDEX IF NOT EXISTS listings_live_idx
        ON listings (brief_url, last_paid_at);

      CREATE TABLE IF NOT EXISTS unpaid_checkouts (
        session_id TEXT PRIMARY KEY,
        week_id TEXT NOT NULL,
        buyer TEXT NOT NULL,
        budget_usd INTEGER NOT NULL CHECK (budget_usd >= 1),
        deadline TEXT NOT NULL,
        winner_rule TEXT NOT NULL,
        brief_url TEXT NOT NULL,
        bid_usd INTEGER NOT NULL CHECK (bid_usd >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS unpaid_week_idx
        ON unpaid_checkouts (week_id);

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id TEXT REFERENCES listings(id),
        polar_session TEXT NOT NULL UNIQUE,
        amount_usd INTEGER NOT NULL CHECK (amount_usd >= 0),
        kind TEXT NOT NULL CHECK (kind IN ('create', 'raise')),
        paid_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('applied', 'rejected')),
        error_code TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS payments_listing_idx
        ON payments (listing_id);
    `.trim(),
  },
  {
    version: 2,
    sql: `
      ALTER TABLE payments ADD COLUMN provider_checkout_id TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_checkout_idx
        ON payments (provider_checkout_id)
       WHERE provider_checkout_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS checkout_intents (
        intent_id TEXT PRIMARY KEY,
        week_id TEXT NOT NULL,
        buyer TEXT NOT NULL,
        budget_usd INTEGER NOT NULL CHECK (budget_usd >= 1),
        deadline TEXT NOT NULL,
        winner_rule TEXT NOT NULL,
        brief_url TEXT NOT NULL,
        bid_usd INTEGER NOT NULL CHECK (bid_usd >= 0),
        expected_amount_usd INTEGER NOT NULL CHECK (expected_amount_usd >= 0),
        expected_amount_cents INTEGER NOT NULL CHECK (
          expected_amount_cents = expected_amount_usd * 100
        ),
        currency TEXT NOT NULL,
        product_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('create', 'raise')),
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'open', 'failed', 'expired', 'paid')
        ),
        provider_checkout_id TEXT UNIQUE,
        checkout_url TEXT,
        provider_order_id TEXT UNIQUE,
        metadata_json TEXT NOT NULL,
        metadata_hash TEXT NOT NULL,
        paid_at TEXT,
        failure_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS checkout_intents_status_idx
        ON checkout_intents (status, updated_at);
      CREATE INDEX IF NOT EXISTS checkout_intents_brief_idx
        ON checkout_intents (brief_url, status);

      CREATE TABLE IF NOT EXISTS webhook_events (
        webhook_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        checkout_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('applied', 'rejected')),
        error_code TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS webhook_events_checkout_idx
        ON webhook_events (checkout_id);
    `.trim(),
  },
  {
    version: 3,
    sql: `
      ALTER TABLE checkout_intents ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'creating'
        CHECK (lifecycle IN (
          'creating', 'open', 'unknown', 'paid', 'rejected',
          'needs_reconciliation'
        ));
      ALTER TABLE checkout_intents ADD COLUMN intent_fingerprint TEXT NOT NULL DEFAULT '';
      ALTER TABLE checkout_intents ADD COLUMN quote_base_bid_usd INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE checkout_intents ADD COLUMN quote_base_bid_cents INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE checkout_intents ADD COLUMN target_bid_cents INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE checkout_intents ADD COLUMN store_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE checkout_intents ADD COLUMN provider_mode TEXT NOT NULL DEFAULT 'fixture';
      ALTER TABLE checkout_intents ADD COLUMN tax_category TEXT NOT NULL DEFAULT 'digital_goods';
      ALTER TABLE checkout_intents ADD COLUMN provider_payment_id TEXT;
      ALTER TABLE checkout_intents ADD COLUMN expires_at TEXT;

      UPDATE checkout_intents SET lifecycle = CASE status
        WHEN 'open' THEN 'open'
        WHEN 'paid' THEN 'paid'
        WHEN 'failed' THEN 'rejected'
        ELSE 'creating'
      END;

      CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_fingerprint_idx
        ON checkout_intents (intent_fingerprint)
       WHERE intent_fingerprint <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_payment_idx
        ON checkout_intents (provider_payment_id)
       WHERE provider_payment_id IS NOT NULL;

      ALTER TABLE payments ADD COLUMN provider_payment_id TEXT;
      ALTER TABLE payments ADD COLUMN provider_order_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_idx
        ON payments (provider_payment_id)
       WHERE provider_payment_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_order_idx
        ON payments (provider_order_id)
       WHERE provider_order_id IS NOT NULL;

      ALTER TABLE webhook_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'legacy';
      ALTER TABLE webhook_events ADD COLUMN event_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE webhook_events ADD COLUMN payment_id TEXT;
      ALTER TABLE webhook_events ADD COLUMN intent_id TEXT;
      ALTER TABLE webhook_events ADD COLUMN raw_body_hash TEXT NOT NULL DEFAULT '';
      UPDATE webhook_events SET event_id = webhook_id WHERE event_id = '';
      CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_business_idx
        ON webhook_events (event_type, event_id);
      CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_payment_idx
        ON webhook_events (payment_id)
       WHERE payment_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS checkout_events (
        event_key TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL,
        checkout_id TEXT,
        provider_state TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS checkout_events_intent_idx
        ON checkout_events (intent_id);
    `.trim(),
  },
  {
    version: 4,
    sql: `
      /* Signed provider attempts are intentionally append-only. There are no
         uniqueness constraints here: a changed replay is a second audit row,
         even when it reuses a delivery/business/payment identifier. */
      CREATE TABLE IF NOT EXISTS payment_audit_events (
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (
          outcome IN ('verified', 'accepted', 'rejected', 'duplicate',
                      'conflict', 'reconciliation')
        ),
        reason TEXT,
        webhook_id TEXT,
        event_type TEXT,
        event_id TEXT,
        payment_id TEXT,
        order_id TEXT,
        intent_id TEXT,
        checkout_id TEXT,
        mode TEXT,
        store_id TEXT,
        payload_hash TEXT NOT NULL,
        raw_body_hash TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS payment_audit_events_received_idx
        ON payment_audit_events (received_at, audit_id);
      CREATE INDEX IF NOT EXISTS payment_audit_events_identity_idx
        ON payment_audit_events (event_id, payment_id, order_id);

      CREATE TRIGGER IF NOT EXISTS payment_audit_events_no_update
      BEFORE UPDATE ON payment_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'payment audit ledger is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS payment_audit_events_no_delete
      BEFORE DELETE ON payment_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'payment audit ledger is append-only');
      END;
      `.trim(),
  },
  {
    version: 5,
    sql: `
      /* A Waffo order.completed payload may legitimately omit checkoutId.
         Keep that provider fact NULL instead of inventing a local ID. */
      DROP INDEX IF EXISTS webhook_events_checkout_idx;
      DROP INDEX IF EXISTS webhook_events_business_idx;
      DROP INDEX IF EXISTS webhook_events_payment_idx;

      ALTER TABLE webhook_events RENAME TO webhook_events_v4;

      CREATE TABLE webhook_events (
        webhook_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        checkout_id TEXT,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('applied', 'rejected')),
        error_code TEXT,
        created_at TEXT NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'legacy',
        event_id TEXT NOT NULL DEFAULT '',
        payment_id TEXT,
        intent_id TEXT,
        raw_body_hash TEXT NOT NULL DEFAULT ''
      );

      INSERT INTO webhook_events (
        webhook_id, order_id, checkout_id, payload_hash, status,
        error_code, created_at, event_type, event_id, payment_id,
        intent_id, raw_body_hash
      )
      SELECT webhook_id, order_id, checkout_id, payload_hash, status,
             error_code, created_at, event_type, event_id, payment_id,
             intent_id, raw_body_hash
        FROM webhook_events_v4;

      DROP TABLE webhook_events_v4;

      CREATE INDEX IF NOT EXISTS webhook_events_checkout_idx
        ON webhook_events (checkout_id);
      CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_business_idx
        ON webhook_events (event_type, event_id);
      CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_payment_idx
        ON webhook_events (payment_id)
       WHERE payment_id IS NOT NULL;
    `.trim(),
  },
];

function isMemoryDatabase(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

function ensureDatabaseDirectory(path: string): void {
  if (isMemoryDatabase(path) || path.startsWith("file:")) return;
  mkdirSync(dirname(path), { recursive: true });
}

function applyMigrations(db: BoardDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  for (const migration of MIGRATIONS) {
    const apply = db.transaction((item: Migration) => {
      const existing = db
        .prepare<[number], { version: number }>(
          "SELECT version FROM schema_migrations WHERE version = ?",
        )
        .get(item.version);
      if (existing) return;

      db.exec(item.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(item.version, new Date().toISOString());
    });
    apply.immediate(migration);
  }
}

export function resolveDatabasePath(
  explicitPath?: string,
  env: DatabaseEnv = process.env,
): string {
  return explicitPath?.trim() || configuredDatabasePath(env);
}

/** Open the shared board database and apply all checked-in migrations. */
export function openBoardDatabase(
  explicitPath?: string,
  env: DatabaseEnv = process.env,
): BoardDatabase {
  assertProductionSettings(env);
  const path = resolveDatabasePath(explicitPath, env);
  ensureDatabaseDirectory(path);
  const db = new Database(path, { timeout: 5_000 });
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Verify the configured durable store is usable by the running process.
 * Opening the database reuses the production migration path; the trivial
 * query catches an unreadable or otherwise unusable store before readiness.
 * Callers intentionally receive only success/failure and must not expose the
 * configured path or any provider secret in their response.
 */
export function assertDatabaseReady(env: DatabaseEnv = process.env): void {
  const db = openBoardDatabase(undefined, env);
  try {
    const row = db.prepare<[], { ok: number }>("SELECT 1 AS ok").get();
    if (row?.ok !== 1) throw new Error("database readiness query failed");
  } finally {
    db.close();
  }
}
