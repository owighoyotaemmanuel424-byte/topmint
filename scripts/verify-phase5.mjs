// Phase 5 verification: query validation, pagination maths, row serialisation
// and notification idempotency.
//
// These are the parts of the transaction history and notification system that
// can be checked without a database connection. Ownership enforcement, ledger
// effects and persistence are exercised against Prisma/Neon and are covered in
// the deployment checklist in the pull request.
//
// Run with: npm run verify:phase5

import { parseTransactionQuery, serializeTransaction, maskAccountNumber, TRANSACTION_INCLUDE } from '../src/lib/transaction-query.js';
import { notify, notifyMany, serializeNotification, NOTIFICATION_PUBLIC_SELECT } from '../src/lib/notifications.js';

let passed = 0;
const failures = [];

function check(name, condition) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(name);
  }
}

const rejects = (name, raw, code) => {
  const result = parseTransactionQuery(raw);
  check(`${name}: rejected`, result.ok === false);
  if (code) check(`${name}: code ${code}`, result.code === code);
};

// ---------------------------------------------------------------- pagination
const defaults = parseTransactionQuery({});
check('defaults: accepted', defaults.ok === true);
check('defaults: page 1', defaults.value.page === 1);
check('defaults: page size 10', defaults.value.pageSize === 10);
check('defaults: newest first', defaults.value.orderBy.createdAt === 'desc');
check('defaults: no filters', Object.keys(defaults.value.where).length === 0);

const thirdPage = parseTransactionQuery({ page: '3', pageSize: '25' });
check('page 3 of 25: skip 50', thirdPage.ok && thirdPage.value.skip === 50);
check('page 3 of 25: take 25', thirdPage.ok && thirdPage.value.take === 25);

const limited = parseTransactionQuery({ limit: '8' });
check('limit alias maps to page size', limited.ok && limited.value.pageSize === 8);
check('limit alias keeps page 1', limited.ok && limited.value.skip === 0);

const oldest = parseTransactionQuery({ sort: 'oldest' });
check('oldest sort', oldest.ok && oldest.value.orderBy.createdAt === 'asc');

rejects('page 0', { page: '0' });
rejects('page not a number', { page: 'two' });
rejects('page size over the maximum', { pageSize: '500' });
rejects('page size of 0', { pageSize: '0' });
rejects('negative page', { page: '-1' });

// ------------------------------------------------------------------- filters
const byType = parseTransactionQuery({ type: 'DEPOSIT' });
check('type filter applied', byType.ok && byType.value.where.type === 'DEPOSIT');

const byStatus = parseTransactionQuery({ status: 'COMPLETED' });
check('status filter applied', byStatus.ok && byStatus.value.where.status === 'COMPLETED');

const search = parseTransactionQuery({ q: '  DEP-4F2A9C  ' });
check('reference search trimmed', search.ok && search.value.where.reference.contains === 'DEP-4F2A9C');
check('reference search case-insensitive', search.ok && search.value.where.reference.mode === 'insensitive');

const repeated = parseTransactionQuery({ type: ['DEPOSIT', 'WITHDRAWAL'], status: ['PENDING', 'FAILED'] });
check('repeated query keys use the first value', repeated.ok && repeated.value.where.type === 'DEPOSIT' && repeated.value.where.status === 'PENDING');

rejects('unknown transaction type', { type: 'REVERSAL' });
rejects('unknown status', { status: 'SHIPPED' });
rejects('unknown sort', { sort: 'sideways' });
rejects('over-long search', { q: 'x'.repeat(65) });

// ---------------------------------------------------------------- date range
const range = parseTransactionQuery({ from: '2026-03-01', to: '2026-03-31' });
check('date range accepted', range.ok === true);
check('from is start of day', range.ok && range.value.where.createdAt.gte.toISOString() === '2026-03-01T00:00:00.000Z');
check('to is end of day (inclusive)', range.ok && range.value.where.createdAt.lte.toISOString() === '2026-03-31T23:59:59.999Z');

const openRange = parseTransactionQuery({ from: '2026-03-01' });
check('open-ended range has no upper bound', openRange.ok && openRange.value.where.createdAt.lte === undefined);

const singleDay = parseTransactionQuery({ from: '2026-03-01', to: '2026-03-01' });
check('single-day range accepted', singleDay.ok === true);

rejects('reversed date range', { from: '2026-04-01', to: '2026-03-01' }, 'INVALID_DATE_RANGE');
rejects('impossible calendar date', { from: '2026-02-31' });
rejects('non-ISO date', { from: '01/03/2026' });
const emptyDates = parseTransactionQuery({ from: '', to: '' });
check('empty date filters are ignored, not rejected', emptyDates.ok === true && emptyDates.value.where.createdAt === undefined);

// -------------------------------------------------------------- serialisation
check('account number masked', maskAccountNumber('1234567890') === '••••7890');
check('short account number kept', maskAccountNumber('1234') === '1234');
check('missing account number is null', maskAccountNumber(null) === null);

const row = {
  id: 'tx_1',
  reference: 'DEP-ABC',
  type: 'DEPOSIT',
  status: 'COMPLETED',
  amount: { toString: () => '25.00' },
  currency: null,
  description: 'Wallet deposit',
  createdAt: new Date('2026-03-02T09:30:00.000Z'),
  updatedAt: new Date('2026-03-02T10:00:00.000Z'),
  deposit: { id: 'dep_1', provider: 'MANUAL', providerRef: 'PAY-99', status: 'COMPLETED' },
  withdrawal: null,
  investment: null,
};
const serialised = serializeTransaction(row);
check('amount serialised as a string', serialised.amount === '25.00');
check('currency defaults to USD', serialised.currency === 'USD');
check('type label', serialised.typeLabel === 'Deposit');
check('status label', serialised.statusLabel === 'Completed');
check('payment method from deposit provider', serialised.paymentMethod === 'MANUAL');
check('related reference from provider ref', serialised.relatedReference === 'PAY-99');
check('timestamps are ISO strings', serialised.createdAt === '2026-03-02T09:30:00.000Z');
check('null transaction serialises to null', serializeTransaction(null) === null);

const withdrawalRow = {
  ...row,
  type: 'WITHDRAWAL',
  withdrawal: { id: 'wdr_1', status: 'PENDING', bankName: 'Acme Bank', accountName: 'A Customer', accountNumber: '1234567890' },
  deposit: null,
};
const serialisedWithdrawal = serializeTransaction(withdrawalRow);
check('withdrawal account number masked in the API payload', serialisedWithdrawal.withdrawal.accountNumberMasked === '••••7890');
check('withdrawal never exposes the raw account number', serialisedWithdrawal.withdrawal.accountNumber === undefined);
check('withdrawal related reference is the withdrawal id', serialisedWithdrawal.relatedReference === 'wdr_1');

check('list include selects no investment user relation', TRANSACTION_INCLUDE.investment.select.plan !== undefined);
check('notification select excludes the idempotency key', NOTIFICATION_PUBLIC_SELECT.eventKey === undefined);

const serialisedNotification = serializeNotification({ id: 'n1', readAt: null, createdAt: new Date('2026-03-02T09:30:00.000Z') });
check('notification timestamp serialised', serialisedNotification.createdAt === '2026-03-02T09:30:00.000Z');
check('notification readAt defaults to null', serialisedNotification.readAt === null);

// ------------------------------------------------------ notification creation
function clientWith({ create, createMany }) {
  return { notification: { create, createMany } };
}

const skipped = await notify(clientWith({ create: async () => { throw new Error('should not be called'); } }), { userId: '', title: 'x', message: 'y' });
check('missing user is not notified', skipped === null);

const failed = await notify(clientWith({ create: async () => { throw Object.assign(new Error('db down'), { code: 'P2010' }); } }), { userId: 'u1', title: 'Title', message: 'Message' });
check('notification failure is swallowed, not thrown', failed === null);

const duplicate = await notify(clientWith({ create: async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); } }), { userId: 'u1', title: 'Title', message: 'Message', eventKey: 'deposit:created:d1' });
check('duplicate event is a no-op', duplicate === null);

let captured = null;
const created = await notify(clientWith({ create: async ({ data }) => { captured = data; return { id: 'n1', ...data }; } }), {
  userId: 'u1',
  type: 'DEPOSIT',
  title: '  Deposit received  ',
  message: '  We received it.  ',
  resourceType: 'Transaction',
  resourceId: 'tx_1',
  link: '/transactions',
  eventKey: 'deposit:created:d1',
});
check('notification created', created?.id === 'n1');
check('notification content trimmed', captured.title === 'Deposit received' && captured.message === 'We received it.');
check('event key stored for idempotency', captured.eventKey === 'deposit:created:d1');
check('unknown notification type falls back to ACCOUNT', (await notify(clientWith({ create: async ({ data }) => data }), { userId: 'u1', type: 'NONSENSE', title: 'a', message: 'b' })).type === 'ACCOUNT');

const bulk = await notifyMany(clientWith({ createMany: async ({ data, skipDuplicates }) => { check('bulk insert skips duplicates', skipDuplicates === true); return { count: data.length - 1 }; } }), ['u1', 'u2', 'u3'], {
  title: 'Maintenance',
  message: 'We will be back shortly.',
  eventKey: 'announcement:abc',
});
check('bulk insert reports created count', bulk.created === 2);
check('bulk insert reports skipped recipients', bulk.skipped === 1);

const bulkFailure = await notifyMany(clientWith({ createMany: async () => { throw new Error('db down'); } }), ['u1', 'u2'], { title: 'x', message: 'y' });
check('bulk failure is swallowed', bulkFailure.created === 0 && bulkFailure.skipped === 2);

const bulkEmpty = await notifyMany(clientWith({ createMany: async () => { throw new Error('should not be called'); } }), [], { title: 'x', message: 'y' });
check('empty audience is not inserted', bulkEmpty.created === 0);

// --------------------------------------------------------------------- report
if (failures.length) {
  console.error(`\n✗ ${failures.length} of ${passed + failures.length} phase 5 checks failed:`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ all ${passed} phase 5 checks passed`);
