import Database from 'better-sqlite3';
import type { ReconciliationRow, ReconciliationStatus } from './types.js';

export type StoredEvent = {
  event_id: string;
  received_at: string;
  event_type: string;
  trans_id: string;
  event_time: string | null;
  raw_body: string;
};

export class ReconcilerStore {
  private db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS raw_events (
        event_id TEXT PRIMARY KEY,
        received_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        trans_id TEXT NOT NULL,
        event_time TEXT,
        raw_body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS raw_events_trans_id ON raw_events(trans_id);

      CREATE TABLE IF NOT EXISTS ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trans_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'mock'
      );
      CREATE INDEX IF NOT EXISTS ledger_entries_trans_id ON ledger_entries(trans_id);

      CREATE TABLE IF NOT EXISTS reconciliation (
        trans_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        detail TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  insertRawEvent(input: {
    eventId: string;
    eventType: string;
    transId: string;
    eventTime: string | null;
    rawBody: string;
  }): 'inserted' | 'duplicate' {
    try {
      this.db
        .prepare(
          `INSERT INTO raw_events (event_id, received_at, event_type, trans_id, event_time, raw_body)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(input.eventId, new Date().toISOString(), input.eventType, input.transId, input.eventTime, input.rawBody);
      return 'inserted';
    } catch (error) {
      if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return 'duplicate';
      throw error;
    }
  }

  rawEvents(): StoredEvent[] {
    return this.db.prepare('SELECT * FROM raw_events ORDER BY received_at, event_id').all() as StoredEvent[];
  }

  eventsForTransaction(transId: string): StoredEvent[] {
    return this.db.prepare('SELECT * FROM raw_events WHERE trans_id = ?').all(transId) as StoredEvent[];
  }

  seedLedger(entries: Array<{ transId: string; amountCents: number }>): void {
    const insert = this.db.prepare('INSERT INTO ledger_entries (trans_id, amount_cents) VALUES (?, ?)');
    const transaction = this.db.transaction((rows: Array<{ transId: string; amountCents: number }>) => {
      for (const row of rows) insert.run(row.transId, row.amountCents);
    });
    transaction(entries);
  }

  ledgerForTransaction(transId: string): Array<{ id: number; trans_id: string; amount_cents: number }> {
    return this.db.prepare('SELECT * FROM ledger_entries WHERE trans_id = ?').all(transId) as Array<{
      id: number;
      trans_id: string;
      amount_cents: number;
    }>;
  }

  saveReconciliation(transId: string, status: ReconciliationStatus, detail: string): void {
    this.db
      .prepare(
        `INSERT INTO reconciliation (trans_id, status, detail, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(trans_id) DO UPDATE SET
           status = excluded.status,
           detail = excluded.detail,
           updated_at = excluded.updated_at`
      )
      .run(transId, status, detail, new Date().toISOString());
  }

  reconciliationReport(): ReconciliationRow[] {
    return this.db.prepare('SELECT * FROM reconciliation ORDER BY trans_id').all() as ReconciliationRow[];
  }

  close(): void {
    this.db.close();
  }
}
