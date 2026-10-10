import { getAuthenticatedUser } from '../../../lib/api-auth';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';
import { serializeTransaction, TRANSACTION_INCLUDE } from '../../../lib/transaction-query';

// Human labels for the audit actions that touch a transaction. Anything not
// listed is still shown, with the raw action name prettified, so a new
// administrative event is never silently hidden from the customer.
const ACTION_LABELS = {
  'deposit.verified': 'Deposit verified',
  'deposit.rejected': 'Deposit rejected',
  'withdrawal.approved': 'Withdrawal approved',
  'withdrawal.rejected': 'Withdrawal rejected',
  'investment.created': 'Investment created',
};

function actionLabel(action) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  return String(action || 'Update')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function asDate(value) {
  return value instanceof Date ? value : new Date(value);
}

// GET /api/transactions/[id]
//
// Read-only. Customers can never edit a financial record, so this route exposes
// GET only — there is no PATCH or DELETE. Ownership is enforced in the query
// itself, which also means another customer's reference returns 404 rather than
// revealing that the record exists.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id || id.length > 64) return res.status(400).json({ error: 'A transaction id is required.' });

    const row = await prisma.transaction.findFirst({
      where: { id, userId: user.id },
      include: TRANSACTION_INCLUDE,
    });
    if (!row) return res.status(404).json({ error: 'That transaction could not be found.' });

    // Status history: the audit entries recorded for this transaction by the
    // server-side operations that resolved it (deposit verification, withdrawal
    // approval or rejection, investment creation). The transaction's own
    // timestamps always bracket the list so it is never empty.
    const auditEntries = await prisma.auditLog.findMany({
      where: { entity: 'Transaction', entityId: id },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { action: true, metadata: true, createdAt: true, adminId: true },
    });

    // Ledger movements for this transaction, restricted to the customer's own
    // wallet entries.
    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: id, wallet: { userId: user.id } },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { amount: true, balanceAfter: true, description: true, createdAt: true },
    });

    const createdAt = asDate(row.createdAt);
    const updatedAt = asDate(row.updatedAt);

    const history = [
      { label: 'Transaction created', at: createdAt.toISOString(), by: 'TopMint' },
      ...auditEntries.map(entry => ({
        label: actionLabel(entry.action),
        at: asDate(entry.createdAt).toISOString(),
        by: entry.adminId ? 'TopMint operations' : 'TopMint',
        detail: typeof entry.metadata?.reason === 'string' ? entry.metadata.reason : null,
      })),
    ];
    if (updatedAt.getTime() > createdAt.getTime()) {
      history.push({ label: 'Last updated', at: updatedAt.toISOString(), by: 'TopMint' });
    }

    return res.status(200).json({
      transaction: {
        ...serializeTransaction(row),
        ledger: ledgerEntries.map(entry => ({
          amount: entry.amount.toString(),
          balanceAfter: entry.balanceAfter.toString(),
          description: entry.description || null,
          createdAt: asDate(entry.createdAt).toISOString(),
        })),
        history,
      },
    });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'TRANSACTION_UNAVAILABLE',
      message: 'Unable to load that transaction right now. Please try again shortly.',
    });
  }
}
