import { createApp } from './app.js';
import { ReconcilerStore } from './db.js';

const authorization = process.env.PAYABLI_WEBHOOK_AUTH;
if (!authorization) {
  throw new Error('PAYABLI_WEBHOOK_AUTH is required; set it to the exact Authorization header configured in Payabli webHeaderParameters');
}

const port = Number(process.env.PORT ?? 3000);
const databasePath = process.env.DATABASE_PATH ?? 'reconciler.db';
const store = new ReconcilerStore(databasePath);
const app = createApp(store, authorization);

app.listen(port, () => {
  console.log(`payabli reconciler listening on http://localhost:${port}`);
});
