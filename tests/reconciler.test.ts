import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ReconcilerStore } from '../src/db.js';
import { approved, chargeback, ledgerFixture, refunded } from '../src/fixtures.js';
import type { PayabliPayload } from '../src/types.js';

const auth = 'Basic test-webhook-key';

type Context = {
  store: ReconcilerStore;
  post: (payload: PayabliPayload, options?: { authorization?: string; body?: string }) => Promise<Response>;
};

async function withServer(run: (context: Context) => Promise<void>): Promise<void> {
  const store = new ReconcilerStore(':memory:');
  store.seedLedger(ledgerFixture);
  const server: Server = createApp(store, auth).listen(0);
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/webhooks/payabli`;

  try {
    await run({
      store,
      post: (payload, options = {}) =>
        fetch(url, {
          method: 'POST',
          headers: {
            authorization: options.authorization ?? auth,
            'content-type': 'application/json',
            connection: 'close'
          },
          body: options.body ?? JSON.stringify(payload)
        })
    });
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, 'close');
    store.close();
  }
}

function rowFor(store: ReconcilerStore, transId: string) {
  return store.reconciliationReport().find((row) => row.trans_id === transId);
}

describe('Payabli webhook receiver', () => {
  it('accepts only the exact Authorization value configured as a Payabli custom webhook header', async () => {
    await withServer(async ({ post, store }) => {
      const payload = approved('tx-matched', '125.00', '2025-01-01T10:00:00Z');
      expect((await post(payload)).status).toBe(200);
      expect((await post(payload, { authorization: 'Basic wrong' })).status).toBe(401);
      expect((await post(payload, { authorization: '' })).status).toBe(401);
      expect(store.rawEvents()).toHaveLength(1);
    });
  });

  it('stores the exact raw body and dedupes exact retries into one raw event', async () => {
    await withServer(async ({ post, store }) => {
      const payload = approved('tx-matched', '125.00', '2025-01-01T10:00:00Z');
      const body = JSON.stringify(payload, null, 2);

      const first = await post(payload, { body });
      const second = await post(payload, { body });

      expect(first.status).toBe(200);
      expect((await first.json()).status).toBe('received');
      expect(second.status).toBe(200);
      expect((await second.json()).status).toBe('duplicate');
      expect(store.rawEvents()).toHaveLength(1);
      expect(store.rawEvents()[0].raw_body).toBe(body);
      expect(rowFor(store, 'tx-matched')?.status).toBe('matched');
    });
  });

  it('dedupes fallback event ids even when JSON key order changes', async () => {
    await withServer(async ({ post, store }) => {
      const payload = approved('tx-matched', '125.00', '2025-01-01T10:00:00Z');
      const reordered = Object.fromEntries(Object.entries(payload).reverse()) as PayabliPayload;

      await post(payload);
      const retry = await post(reordered);

      expect((await retry.json()).status).toBe('duplicate');
      expect(store.rawEvents()).toHaveLength(1);
    });
  });

  it('uses a documented-style event id field when one is present, even if retry whitespace or fields differ', async () => {
    await withServer(async ({ post, store }) => {
      const firstPayload = { ...approved('tx-matched', '125.00', '2025-01-01T10:00:00Z'), eventId: 'evt-1' };
      const retryPayload = { ...firstPayload, Text: 'same event, mutable text changed' };

      expect((await post(firstPayload)).status).toBe(200);
      const retry = await post(retryPayload);
      expect((await retry.json()).status).toBe('duplicate');
      expect(store.rawEvents()).toHaveLength(1);
      expect(store.rawEvents()[0].event_id).toBe('evt-1');
    });
  });

  it('rejects malformed payloads and invalid JSON without storing them', async () => {
    await withServer(async ({ post, store }) => {
      expect((await post({ Event: 'ApprovedPayment' })).status).toBe(400);
      const invalidJson = await post(approved('tx-matched', '125.00', '2025-01-01T10:00:00Z'), { body: '{' });
      expect(invalidJson.status).toBe(400);
      expect(store.rawEvents()).toHaveLength(0);
    });
  });
});

describe('reconciliation', () => {
  it('marks an approved payment missing when the ledger has no entry', async () => {
    await withServer(async ({ post, store }) => {
      await post(approved('tx-missing', '25.00', '2025-01-01T10:03:00Z'));
      expect(rowFor(store, 'tx-missing')?.status).toBe('missing');
    });
  });

  it('marks amount mismatches using integer cents', async () => {
    await withServer(async ({ post, store }) => {
      await post(approved('tx-mismatch', '100.00', '2025-01-01T10:01:00Z'));
      const row = rowFor(store, 'tx-mismatch');
      expect(row?.status).toBe('amount_mismatch');
      expect(row?.detail).toContain('10000');
      expect(row?.detail).toContain('9900');
    });
  });

  it('marks duplicate ledger entries as duplicate', async () => {
    await withServer(async ({ post, store }) => {
      await post(approved('tx-duplicate', '42.00', '2025-01-01T10:02:00Z'));
      expect(rowFor(store, 'tx-duplicate')?.status).toBe('duplicate');
    });
  });

  it('marks repeated distinct approvals for one transaction as duplicate', async () => {
    await withServer(async ({ post, store }) => {
      store.seedLedger([{ transId: 'tx-reapproved', amountCents: 1000 }]);
      await post(approved('tx-reapproved', '10.00', '2025-01-01T10:00:00Z'));
      await post(approved('tx-reapproved', '10.00', '2025-01-01T10:01:00Z'));
      expect(rowFor(store, 'tx-reapproved')?.status).toBe('duplicate');
    });
  });

  it('handles a refund delivered before its original approval', async () => {
    await withServer(async ({ post, store }) => {
      await post(refunded('tx-refund', '70.00', '2025-01-01T10:05:00Z'));
      await post(approved('tx-refund', '70.00', '2025-01-01T10:00:00Z'));

      expect(store.rawEvents()).toHaveLength(2);
      expect(rowFor(store, 'tx-refund')?.status).toBe('refund');
    });
  });

  it('handles a chargeback delivered before its original approval', async () => {
    await withServer(async ({ post, store }) => {
      await post(chargeback('tx-chargeback', '55.00', '2025-01-01T10:10:00Z'));
      await post(approved('tx-chargeback', '55.00', '2025-01-01T10:00:00Z'));

      expect(store.rawEvents()).toHaveLength(2);
      expect(rowFor(store, 'tx-chargeback')?.status).toBe('chargeback');
    });
  });
});
