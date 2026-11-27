import express, { type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { ReconcilerStore } from './db.js';
import { eventIdFor, eventTimeFor, reconcileTransaction, validatePayload } from './reconcile.js';
import type { PayabliPayload } from './types.js';

function exactSecretEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createApp(store: ReconcilerStore, webhookAuthorization: string) {
  const app = express();

  app.use(
    express.json({
      type: 'application/json',
      verify: (req, _res, body) => {
        (req as Request & { rawBody?: string }).rawBody = body.toString('utf8');
      }
    })
  );

  app.post('/webhooks/payabli', (req, res) => {
    if (!exactSecretEqual(req.header('authorization') ?? '', webhookAuthorization)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const payload = req.body as PayabliPayload;
    const validationError = validatePayload(payload);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(payload);
    const eventId = eventIdFor(payload);
    const inserted = store.insertRawEvent({
      eventId,
      eventType: payload.Event as string,
      transId: payload.transId as string,
      eventTime: eventTimeFor(payload),
      rawBody
    });

    if (inserted === 'duplicate') {
      res.status(200).json({ status: 'duplicate', eventId });
      return;
    }

    reconcileTransaction(store, payload.transId as string);
    res.status(200).json({ status: 'received', eventId });
  });


  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (error as { status?: number }).status === 400 ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'invalid JSON body' : 'internal error' });
  });

  return app;
}
