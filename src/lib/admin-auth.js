import { getAuthenticatedAdmin } from './api-auth';

export async function requireAdmin(req, res, roles = []) {
  const admin = await getAuthenticatedAdmin(req);
  if (!admin) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  if (roles.length && !roles.includes(admin.role)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return admin;
}
