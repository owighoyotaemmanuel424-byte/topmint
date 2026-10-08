import { prisma } from './db/prisma';
import { verifyAuthToken, verifyAdminToken } from './auth';

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export async function getAuthenticatedUser(req) {
  const token = getCookie(req, 'token');
  const id = await verifyAuthToken(token);
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
}

export async function getAuthenticatedAdmin(req) {
  const token = getCookie(req, 'admin_token');
  const id = await verifyAdminToken(token);
  if (!id) return null;
  return prisma.admin.findFirst({ where: { id, active: true } });
}
