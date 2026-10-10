import { getAuthenticatedUser } from '../../../lib/api-auth';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';
import { parseTransactionQuery, serializeTransaction, TRANSACTION_INCLUDE } from '../../../lib/transaction-query';

// GET /api/transactions
//
// Search, filtering, sorting and pagination all happen in the database. The
// customer's own `userId` is always part of the `where` clause, so a query
// parameter can never widen the result beyond the authenticated account.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const query = parseTransactionQuery(req.query);
    if (!query.ok) return res.status(400).json({ error: query.error, code: query.code });

    const { where, orderBy, skip, take, page, pageSize } = query.value;
    // Ownership is applied here, not by the caller, so no route can forget it.
    const scope = { userId: user.id, ...where };

    // Fetched together so the total and the page describe the same moment.
    const [total, rows] = await prisma.$transaction([
      prisma.transaction.count({ where: scope }),
      prisma.transaction.findMany({ where: scope, orderBy, skip, take, include: TRANSACTION_INCLUDE }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return res.status(200).json({
      transactions: rows.map(serializeTransaction),
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'TRANSACTIONS_UNAVAILABLE',
      message: 'Unable to load your transactions right now. Please try again shortly.',
    });
  }
}
