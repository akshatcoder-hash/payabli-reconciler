import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { rmSync } from 'node:fs';
import { createApp } from './app.js';
import { ReconcilerStore } from './db.js';
import { fixtureAuthorization, fixtureEvents, ledgerFixture } from './fixtures.js';

const databasePath = process.env.REPLAY_DATABASE_PATH ?? 'reconciler.replay.db';
for (const suffix of ['', '-wal', '-shm']) rmSync(`${databasePath}${suffix}`, { force: true });

const store = new ReconcilerStore(databasePath);
store.seedLedger(ledgerFixture);

const server = createApp(store, fixtureAuthorization).listen(0);
await once(server, 'listening');
const port = (server.address() as AddressInfo).port;
const url = `http://127.0.0.1:${port}/webhooks/payabli`;

console.log(`replaying ${fixtureEvents.length} documented-shape fixture webhooks`);
for (const fixture of fixtureEvents) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: fixtureAuthorization,
      'content-type': 'application/json'
    },
    body: JSON.stringify(fixture.payload)
  });
  const result = (await response.json()) as { status?: string; error?: string };
  console.log(`${response.status} ${(result.status ?? result.error ?? 'unknown').padEnd(10)} ${fixture.name}`);
}

const rows = store.reconciliationReport();
console.log('\nreconciliation report');
console.log(`${'status'.padEnd(16)} ${'transaction'.padEnd(15)} detail`);
for (const row of rows) {
  console.log(`${row.status.padEnd(16)} ${row.trans_id.padEnd(15)} ${row.detail}`);
}

const counts = new Map<string, number>();
for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
console.log('\nsummary');
for (const [status, count] of [...counts.entries()].sort()) console.log(`${status}: ${count}`);
console.log(`raw events stored: ${store.rawEvents().length}; duplicate deliveries ignored: ${fixtureEvents.length - store.rawEvents().length}`);

server.close();
await once(server, 'close');
store.close();
