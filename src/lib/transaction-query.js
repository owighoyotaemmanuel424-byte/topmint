// The explicit .js extension keeps this module loadable by plain Node (the
// Phase 5 verification script) as well as by Next.js.
import { flattenQuery, positiveInt, parseDay } from './query-params.js';

// Transaction history filters. Only the transaction types the ledger can
// actually produce today are offered — adding a type to this list without a
// business operation that creates it would show customers an empty filter.
export const TRANSACTION_TYPES = ['DEPOSIT', 'WITHDRAWAL', 'INVESTMENT', 'RETURN', 'REFUND', 'FEE', 'ADJUSTMENT'];
export const TRANSACTION_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];
export const TRANSACTION_SORTS = ['newest', 'oldest'];

export const TRANSACTION_TYPE_LABELS = {
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
  INVESTMENT: 'Investment purchase',
  RETURN: 'Investment earnings',
  REFUND: 'Refund',
  FEE: 'Fee',
  ADJUSTMENT: 'Wallet adjustment',
};

export const TRANSACTION_STATUS_LABELS = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 100000;

const invalid = (error, code = 'VALIDATION_ERROR') => ({ ok: false, code, error });

/**
 * Validate and normalise the query string of `GET /api/transactions`.
 *
 * Filtering, ordering and paging are all expressed as Prisma arguments, so the
 * database does the work: the page object returned here is the only rows the
 * browser will ever receive.
 *
 * @param {object} raw  `req.query`
 * @returns {{ok: true, value: object}|{ok: false, error: string, code: string}}
 */
export function parseTransactionQuery(raw) {
  const flat = flattenQuery(raw);

  if (flat.q !== undefined && (typeof flat.q !== 'string' || flat.q.trim().length > 64)) {
    return invalid('A transaction search cannot be longer than 64 characters.');
  }
  if (flat.type !== undefined && !TRANSACTION_TYPES.includes(flat.type)) {
    return invalid('That transaction type is not one TopMint records.');
  }
  if (flat.status !== undefined && !TRANSACTION_STATUSES.includes(flat.status)) {
    return invalid('That transaction status is not one TopMint records.');
  }
  if (flat.sort !== undefined && !TRANSACTION_SORTS.includes(flat.sort)) {
    return invalid('Sort by newest or oldest only.');
  }

  const page = positiveInt(flat.page, { fallback: 1, max: MAX_PAGE });
  if (page === null) return invalid(`The page number must be a whole number between 1 and ${MAX_PAGE}.`);

  // `limit` is accepted as an alias because the dashboard asks for a small
  // recent-activity slice rather than a page.
  const pageSize = positiveInt(flat.pageSize ?? flat.limit, { fallback: DEFAULT_PAGE_SIZE, max: MAX_PAGE_SIZE });
  if (pageSize === null) return invalid(`Page size must be a whole number between 1 and ${MAX_PAGE_SIZE}.`);

  let from = null;
  if (flat.from !== undefined && flat.from !== '') {
    from = parseDay(flat.from);
    if (!from) return invalid('Enter a start date as YYYY-MM-DD using a real calendar date.');
  }

  let to = null;
  if (flat.to !== undefined && flat.to !== '') {
    to = parseDay(flat.to, { end: true });
    if (!to) return invalid('Enter an end date as YYYY-MM-DD using a real calendar date.');
  }

  if (from && to && from.getTime() > to.getTime()) {
    return invalid('The start date must be on or before the end date.', 'INVALID_DATE_RANGE');
  }

  const search = typeof flat.q === 'string' ? flat.q.trim() : '';

  const where = {};
  if (flat.type) where.type = flat.type;
  if (flat.status) where.status = flat.status;
  if (search) where.reference = { contains: search, mode: 'insensitive' };
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  return {
    ok: true,
    value: {
      search,
      type: flat.type ?? null,
      status: flat.status ?? null,
      from,
      to,
      sort: flat.sort ?? 'newest',
      page,
      pageSize,
      skip: (page - 1) * pageSize,
      take: pageSize,
      where,
      orderBy: { createdAt: flat.sort === 'oldest' ? 'asc' : 'desc' },
    },
  };
}

export function maskAccountNumber(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\s+/g, '');
  if (digits.length <= 4) return digits;
  return `••••${digits.slice(-4)}`;
}

/**
 * Shape a transaction row for the API. The Prisma row is never returned as-is:
 * only the fields the customer interface needs cross the wire, and every
 * Decimal is a string so no precision is lost in JSON.
 */
export function serializeTransaction(row) {
  if (!row) return null;
  const deposit = row.deposit || null;
  const withdrawal = row.withdrawal || null;
  const investment = row.investment || null;

  let relatedReference = null;
  if (deposit) relatedReference = deposit.providerRef || deposit.id;
  else if (withdrawal) relatedReference = withdrawal.id;
  else if (investment) relatedReference = investment.id;

  return {
    id: row.id,
    reference: row.reference,
    type: row.type,
    typeLabel: TRANSACTION_TYPE_LABELS[row.type] || row.type,
    status: row.status,
    statusLabel: TRANSACTION_STATUS_LABELS[row.status] || row.status,
    amount: String(row.amount),
    currency: row.currency || 'USD',
    description: row.description || null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    paymentMethod: deposit?.provider || withdrawal?.bankName || null,
    relatedReference,
    deposit: deposit ? { id: deposit.id, provider: deposit.provider, providerRef: deposit.providerRef, status: deposit.status } : null,
    withdrawal: withdrawal
      ? {
          id: withdrawal.id,
          status: withdrawal.status,
          bankName: withdrawal.bankName,
          accountName: withdrawal.accountName,
          accountNumberMasked: maskAccountNumber(withdrawal.accountNumber),
        }
      : null,
    investment: investment
      ? { id: investment.id, status: investment.status, planName: investment.plan?.name ?? null }
      : null,
  };
}

// Prisma `include` shared by the list and detail endpoints so both return the
// same related-resource shape. Only non-sensitive columns are selected.
export const TRANSACTION_INCLUDE = {
  deposit: { select: { id: true, provider: true, providerRef: true, status: true } },
  withdrawal: { select: { id: true, status: true, bankName: true, accountName: true, accountNumber: true } },
  investment: { select: { id: true, status: true, plan: { select: { name: true } } } },
};
