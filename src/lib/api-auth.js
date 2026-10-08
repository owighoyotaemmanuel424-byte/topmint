import { parse } from 'cookie';
import { prisma } from './db/prisma';
import { verifyAuthToken, verifyAdminToken } from './auth';

export async function getAuthenticatedUser(req) {
  const token = parse(req.headers.cookie || '').token;
  const id = await verifyAuthToken(token);
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
}

export async function getAuthenticatedAdmin(req) {
  const token = parse(req.headers.cookie || '').admin_token;
  const id = await verifyAdminToken(token);
  if (!id) return null;
  return prisma.admin.findFirst({ where: { id, active: true } });
}
