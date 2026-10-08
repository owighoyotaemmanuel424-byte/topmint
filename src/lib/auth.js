import { SignJWT, jwtVerify } from 'jose';

const getSecret = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return new TextEncoder().encode(value);
};

export async function createAuthToken(userId) {
  return new SignJWT({ sub: userId, type: 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret('JWT_SECRET'));
}

export async function verifyAuthToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret('JWT_SECRET'));
    return payload.type === 'user' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function createAdminToken(adminId) {
  return new SignJWT({ sub: adminId, type: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(getSecret('ADMIN_JWT_SECRET'));
}

export async function verifyAdminToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret('ADMIN_JWT_SECRET'));
    return payload.type === 'admin' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
