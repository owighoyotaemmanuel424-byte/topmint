import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../../lib/db/prisma';
import { createAuthToken } from '../../../lib/auth';
import { classifyDatabaseError } from '../../../lib/db-error';

const schema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(128),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Enter a valid name, email and password of at least 8 characters.',
      code: 'VALIDATION_ERROR',
    });
  }

  const { email, name, password } = parsed.data;
  try {
    const normalizedEmail = email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(409).json({ error: 'An account already exists with this email.', code: 'ACCOUNT_EXISTS' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.$transaction(async (tx) => {
      return tx.user.create({
        data: {
          email: normalizedEmail,
          firstName: name.split(/\s+/)[0],
          lastName: name.split(/\s+/).slice(1).join(' ') || null,
          passwordHash,
          wallet: { create: { currency: 'NGN' } },
          notifications: {
            create: {
              title: 'Welcome to TopMint',
              message: 'Your account has been created successfully.',
            },
          },
        },
        select: { id: true, email: true, firstName: true, lastName: true },
      });
    });

    const token = await createAuthToken(user.id);
    res.setHeader(
      'Set-Cookie',
      `token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
    );

    return res.status(201).json({
      user: {
        ...user,
        name: [user.firstName, user.lastName].filter(Boolean).join(' '),
      },
    });
  } catch (error) {
    const code = classifyDatabaseError(error, 'SIGNUP_FAILED');
    console.error('signup error', {
      code,
      name: error?.name,
      prismaCode: error?.code,
      message: error?.message,
    });

    const status = code === 'ACCOUNT_EXISTS' ? 409 : 500;
    return res.status(status).json({
      error: 'Unable to create your account right now.',
      code,
    });
  }
}
