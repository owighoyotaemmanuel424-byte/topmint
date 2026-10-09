import { Prisma } from '@prisma/client';
import { prisma } from './db/prisma';

// Only hand back messages that were deliberately raised for the user. This keeps
// raw Prisma/connection/programming errors from leaking through API responses.
const PUBLIC_ERRORS = new Set([
  'Insufficient wallet balance',
  'Wallet not found',
  'Invalid amount',
  'Investment plan unavailable',
  'Amount is outside this plan range',
]);

export function publicErrorMessage(error, fallback) {
  const message = error?.message;
  return typeof message === 'string' && PUBLIC_ERRORS.has(message) ? message : fallback;
}

export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid amount');
  return new Prisma.Decimal(n.toFixed(2));
}

export async function creditWallet(tx, { userId, amount, type, description, reference, metadata }) {
  const value = money(amount);
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new Error('Wallet not found');
  const balance = new Prisma.Decimal(wallet.balance).add(value);
  const transaction = await tx.transaction.create({ data: { userId, reference, type, status: 'COMPLETED', amount: value, description, metadata } });
  await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
  await tx.ledgerEntry.create({ data: { walletId: wallet.id, transactionId: transaction.id, amount: value, balanceAfter: balance, description } });
  return transaction;
}

export async function debitWallet(tx, { userId, amount, type, description, reference, metadata }) {
  const value = money(amount);
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new Error('Wallet not found');
  const current = new Prisma.Decimal(wallet.balance);
  if (current.lessThan(value)) throw new Error('Insufficient wallet balance');
  const balance = current.sub(value);
  const transaction = await tx.transaction.create({ data: { userId, reference, type, status: 'COMPLETED', amount: value, description, metadata } });
  await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
  await tx.ledgerEntry.create({ data: { walletId: wallet.id, transactionId: transaction.id, amount: value.neg(), balanceAfter: balance, description } });
  return transaction;
}

export async function withTransaction(fn) {
  return prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
