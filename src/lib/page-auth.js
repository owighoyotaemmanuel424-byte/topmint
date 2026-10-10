import { verifyAuthToken } from './auth';

function readCookie(header, name) {
  if (!header) return null;
  const match = header.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// Server-side guard for customer pages (getServerSideProps). Without it the
// pages were public static HTML that only bounced after a client-side fetch,
// so an unauthenticated request still received the whole protected markup.
//
// Scope: this verifies the session cookie before rendering. Account status and
// object-level authorization stay in the API layer (src/lib/api-auth.js), which
// re-checks every data request, so a page render can never leak data on its own.
export async function requireCustomerAuth({ req }) {
  const token = readCookie(req?.headers?.cookie, 'token');
  const userId = token ? await verifyAuthToken(token) : null;
  if (!userId) {
    return { redirect: { destination: '/signin', permanent: false } };
  }
  return { props: {} };
}
