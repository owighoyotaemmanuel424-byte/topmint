import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/db/prisma';
import { withTransaction, formatUsd } from '../../../lib/ledger';
import { notify } from '../../../lib/notifications';
import { respondWithError } from '../../../lib/db-error';

function validSecret(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected || typeof expected !== 'string') return false;
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const supplied = bearer || (typeof req.headers['x-cron-secret'] === 'string' ? req.headers['x-cron-secret'] : '');
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  if (!validSecret(req)) return res.status(401).json({ error: 'Unauthorized.' });

  const now = new Date();
  try {
    const due = await prisma.investment.findMany({
      where: { status: 'ACTIVE', maturityAt: { lte: now } },
      select: { id: true },
      orderBy: { maturityAt: 'asc' },
      take: 100,
    });

    let completed = 0;
    let skipped = 0;
    const failures = [];

    for (const candidate of due) {
      try {
        const settled = await withTransaction(async tx => {
          const investment = await tx.investment.findUnique({
            where: { id: candidate.id },
            include: { plan: true },
          });
          if (!investment || investment.status !== 'ACTIVE' || investment.maturityAt > now) return null;

          // Claim the investment before moving money. This guarded transition and
          // all wallet/ledger writes share one serializable transaction.
          const claim = await tx.investment.updateMany({
            where: { id: investment.id, status: 'ACTIVE', maturityAt: { lte: now } },
            data: { status: 'COMPLETED', completedAt: now, actualReturn: investment.expectedReturn },
          });
          if (claim.count !== 1) return null;

          const wallet = await tx.wallet.findUnique({ where: { userId: investment.userId } });
          if (!wallet) throw new Error('Wallet not found for matured investment');
          const fundingTransaction = await tx.transaction.findFirst({
            where: { investmentId: investment.id, type: 'INVESTMENT' },
            select: { currency: true },
          });
          if (fundingTransaction && fundingTransaction.currency !== wallet.currency) {
            throw new Error('Investment currency does not match wallet currency');
          }

          const principal = new Prisma.Decimal(investment.principal);
          const earnings = new Prisma.Decimal(investment.expectedReturn);
          const payout = principal.add(earnings);
          const balance = new Prisma.Decimal(wallet.balance).add(payout);
          const reference = 'MAT-' + crypto.randomBytes(12).toString('hex').toUpperCase();
          const transaction = await tx.transaction.create({
            data: {
              userId: investment.userId,
              investmentId: investment.id,
              reference,
              type: 'RETURN',
              status: 'COMPLETED',
              amount: payout,
              currency: wallet.currency,
              description: 'Matured investment payout: principal and return',
              metadata: {
                investmentId: investment.id,
                planName: investment.plan.name,
                principal: principal.toString(),
                return: earnings.toString(),
                maturityAt: investment.maturityAt.toISOString(),
              },
            },
          });
          await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
          await tx.ledgerEntry.create({
            data: {
              walletId: wallet.id,
              transactionId: transaction.id,
              amount: payout,
              balanceAfter: balance,
              description: `Matured investment payout for ${investment.plan.name}`,
            },
          });
          return {
            id: investment.id,
            userId: investment.userId,
            planName: investment.plan.name,
            principal: principal.toString(),
            earnings: earnings.toString(),
            payout: payout.toString(),
            currency: wallet.currency,
            reference,
          };
        });

        if (!settled) {
          skipped += 1;
          continue;
        }
        completed += 1;
        await notify(prisma, {
          userId: settled.userId,
          type: 'INVESTMENT_MATURITY',
          title: 'Investment matured',
          message: `Your ${settled.planName} investment matured. ${settled.currency} ${settled.payout} (principal ${settled.principal} plus return ${settled.earnings}) has been credited to your wallet.`,
          resourceType: 'Investment',
          resourceId: settled.id,
          link: '/investments',
          eventKey: `investment:maturity:${settled.id}`,
        });
      } catch (error) {
        failures.push({ investmentId: candidate.id, code: error?.code || 'SETTLEMENT_FAILED' });
        console.error('investment maturity settlement failed', {
          investmentId: candidate.id,
          code: error?.code,
          name: error?.name,
        });
      }
    }

    return res.status(200).json({
      processed: due.length,
      completed,
      skipped,
      failed: failures.length,
      failures,
      hasMore: due.length === 100,
    });
  } catch (error) {
    return respondWithError(res, error, {
      fallback: 'INVESTMENT_MATURITY_FAILED',
      message: 'Unable to process matured investments right now.',
    });
  }
}
