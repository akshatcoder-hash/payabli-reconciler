import type { PayabliPayload } from './types.js';

export const fixtureAuthorization = 'Basic fixture-webhook-key';

export function approved(transId: string, totalAmount: string, transTime: string): PayabliPayload {
  const netAmount = (Number(totalAmount) - 0.3).toFixed(2);
  return {
    Event: 'ApprovedPayment',
    Paypoint: 'fixture-paypoint',
    Text: `Approved payment ${transId}`,
    transId,
    NetAmount: netAmount,
    Fee: '0.30',
    TotalAmount: totalAmount,
    transTime,
    CustomerId: 'customer-1',
    CustomerNumber: '1001',
    Method: 'card',
    WalletType: null,
    EntryPoint: 'api',
    ExternalPaypointId: 'paypoint-1',
    SerialNumber: '',
    EntryMode: '',
    ResponseCode: '00',
    ResponseCodeText: 'Approved',
    ResultCode: '0',
    ResultCodeText: 'Approved'
  };
}

export function refunded(transId: string, totalAmount: string, transTime: string): PayabliPayload {
  return {
    ...approved(transId, totalAmount, transTime),
    Event: 'RefundedPayment',
    Text: `Refunded payment ${transId}`,
    Notes: 'fixture refund',
    RefundingTransactionId: `refund-${transId}`
  };
}

export function chargeback(transId: string, totalAmount: string, chargebackTime: string): PayabliPayload {
  return {
    Event: 'ReceivedChargeBack',
    Paypoint: 'fixture-paypoint',
    AccountType: 'card',
    Text: `Chargeback received for ${transId}`,
    Method: 'card',
    WalletType: null,
    ReasonCode: '10.4',
    Reason: 'fixture chargeback',
    transId,
    NetAmount: totalAmount,
    chargebackTime,
    CustomerId: 'customer-1',
    CustomerNumber: '1001',
    chargebackID: 9001,
    ExternalPaypointId: 'paypoint-1'
  };
}

export const ledgerFixture = [
  { transId: 'tx-matched', amountCents: 12500 },
  { transId: 'tx-mismatch', amountCents: 9900 },
  { transId: 'tx-duplicate', amountCents: 4200 },
  { transId: 'tx-duplicate', amountCents: 4200 },
  { transId: 'tx-refund', amountCents: 7000 },
  { transId: 'tx-chargeback', amountCents: 5500 }
];

const matchedApproval = approved('tx-matched', '125.00', '2025-01-01T10:00:00Z');

export const fixtureEvents: Array<{ name: string; payload: PayabliPayload }> = [
  { name: 'approved payment that matches the ledger', payload: matchedApproval },
  { name: 'exact retry of the matched approval', payload: structuredClone(matchedApproval) },
  { name: 'approved payment with mismatched ledger amount', payload: approved('tx-mismatch', '100.00', '2025-01-01T10:01:00Z') },
  { name: 'approved payment duplicated in the ledger', payload: approved('tx-duplicate', '42.00', '2025-01-01T10:02:00Z') },
  { name: 'approved payment later refunded', payload: approved('tx-refund', '70.00', '2025-01-01T10:00:00Z') },
  { name: 'chargeback delivered before the original approval', payload: chargeback('tx-chargeback', '55.00', '2025-01-01T10:10:00Z') },
  { name: 'approved payment missing from the ledger', payload: approved('tx-missing', '25.00', '2025-01-01T10:03:00Z') },
  { name: 'chargeback original approval arrives late', payload: approved('tx-chargeback', '55.00', '2025-01-01T10:00:00Z') },
  { name: 'late refund for the earlier approval', payload: refunded('tx-refund', '70.00', '2025-01-01T10:05:00Z') },
  { name: 'second exact retry of the matched approval', payload: structuredClone(matchedApproval) }
];
