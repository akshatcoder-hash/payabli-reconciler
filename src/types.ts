export type PayabliPayload = Record<string, unknown> & {
  Event?: unknown;
  transId?: unknown;
  TotalAmount?: unknown;
  transTime?: unknown;
  chargebackTime?: unknown;
};

export type ReconciliationStatus =
  | 'matched'
  | 'missing'
  | 'duplicate'
  | 'amount_mismatch'
  | 'refund'
  | 'chargeback';

export type ReconciliationRow = {
  trans_id: string;
  status: ReconciliationStatus;
  detail: string;
  updated_at: string;
};
