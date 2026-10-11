import { prisma } from './db/prisma';
import { verifyAuthClaims, verifyAdminToken } from './auth';

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export async function getAuthenticatedUser(req) {
  const token = getCookie(req, 'token');
  const claims = await verifyAuthClaims(token);
  if (!claims) return null;
  // Session-version checks revoke all older customer JWTs after password reset/change.
  const user = await prisma.user.findFirst({ where: { id: claims.sub, status: 'ACTIVE' } });
  if (!user || Number(claims.sv || 0) !== user.sessionVersion) return null;
  return user;
}

export async function getAuthenticatedAdmin(req) {
  const token = getCookie(req, 'admin_token');
  const id = await verifyAdminToken(token);
  if (!id) return null;
  return prisma.admin.findFirst({ where: { id, active: true } });
}
