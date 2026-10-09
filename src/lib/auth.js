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

// HTTP-only, SameSite=Lax session cookie for the customer auth flow.
// `Secure` is always set in production and whenever the request arrived over
// HTTPS. It is dropped only on a plain-HTTP dev/preview origin, where a browser
// refuses to store a Secure cookie and sign-in would silently fail.
export function customerSessionCookie(req, token, maxAge = 604800) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = process.env.NODE_ENV === 'production' || proto === 'https';
  return `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
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
