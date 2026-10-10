import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../../lib/db/prisma';
import { createAuthToken, customerSessionCookie } from '../../../lib/auth';
import { classifyDatabaseError } from '../../../lib/db-error';

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.', code: 'VALIDATION_ERROR' });

  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    const valid = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
    if (!user || !valid || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = await createAuthToken(user.id);
    res.setHeader('Set-Cookie', customerSessionCookie(req, token));
    return res.status(200).json({ user: { id: user.id, email: user.email, name: [user.firstName, user.lastName].filter(Boolean).join(' ') } });
  } catch (error) {
    const code = classifyDatabaseError(error, 'SIGNIN_FAILED');
    console.error('signin error', { code, name: error?.name, prismaCode: error?.code, message: error?.message });
    return res.status(500).json({ error: 'Unable to sign in right now.', code });
  }
}
