import { createHash } from 'node:crypto';
import type { ReconcilerStore, StoredEvent } from './db.js';
import type { PayabliPayload, ReconciliationStatus } from './types.js';

const trackedEvents = new Set(['ApprovedPayment', 'RefundedPayment', 'ReceivedChargeBack']);

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) as string;
}

export function eventIdFor(payload: PayabliPayload): string {
  for (const key of ['eventId', 'EventId', 'notificationId', 'NotificationId']) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

export function eventTimeFor(payload: PayabliPayload): string | null {
  const value = payload.transTime ?? payload.chargebackTime;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function validatePayload(payload: PayabliPayload): string | null {
  if (typeof payload.Event !== 'string' || payload.Event.length === 0) return 'Event must be a non-empty string';
  if (typeof payload.transId !== 'string' || payload.transId.length === 0) return 'transId must be a non-empty string';
  return null;
}

export function amountCents(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).replace(/,/g, '').trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0') || 0);
  return match[1] === '-' ? -cents : cents;
}

function timeSortKey(event: StoredEvent): number {
  const value = Date.parse(event.event_time ?? event.received_at);
  return Number.isNaN(value) ? 0 : value;
}

function sortedEvents(events: StoredEvent[]): StoredEvent[] {
  return [...events].sort((left, right) => {
    const byEventTime = timeSortKey(left) - timeSortKey(right);
    if (byEventTime !== 0) return byEventTime;
    const byReceipt = left.received_at.localeCompare(right.received_at);
    if (byReceipt !== 0) return byReceipt;
    return left.event_id.localeCompare(right.event_id);
  });
}

export function reconcileTransaction(
  store: ReconcilerStore,
  transId: string
): { status: ReconciliationStatus; detail: string } | null {
  const events = sortedEvents(store.eventsForTransaction(transId)).filter((event) => trackedEvents.has(event.event_type));
  if (events.length === 0) return null;

  const approvals = events.filter((event) => event.event_type === 'ApprovedPayment');
  const refunds = events.filter((event) => event.event_type === 'RefundedPayment');
  const chargebacks = events.filter((event) => event.event_type === 'ReceivedChargeBack');
  const ledger = store.ledgerForTransaction(transId);
  const latestApproval = approvals.at(-1);

  let status: ReconciliationStatus;
  let detail: string;

  if (chargebacks.length > 0) {
    status = 'chargeback';
    detail = `${chargebacks.length} chargeback event(s); ${ledger.length} ledger entr${ledger.length === 1 ? 'y' : 'ies'}`;
  } else if (refunds.length > 0) {
    status = 'refund';
    detail = `${refunds.length} refund event(s); ${ledger.length} ledger entr${ledger.length === 1 ? 'y' : 'ies'}`;
  } else if (ledger.length === 0) {
    status = 'missing';
    detail = 'approved payment has no ledger entry';
  } else if (ledger.length > 1 || approvals.length > 1) {
    status = 'duplicate';
    detail = `${approvals.length} distinct approval event(s), ${ledger.length} ledger entries`;
  } else {
    const webhookAmount = amountCents(JSON.parse(latestApproval?.raw_body ?? '{}').TotalAmount);
    if (webhookAmount === null) {
      status = 'amount_mismatch';
      detail = 'approved payment has no parseable TotalAmount';
    } else if (webhookAmount !== ledger[0].amount_cents) {
      status = 'amount_mismatch';
      detail = `webhook ${webhookAmount} cents vs ledger ${ledger[0].amount_cents} cents`;
    } else {
      status = 'matched';
      detail = `approved payment matches ledger amount ${ledger[0].amount_cents} cents`;
    }
  }

  store.saveReconciliation(transId, status, detail);
  return { status, detail };
}
