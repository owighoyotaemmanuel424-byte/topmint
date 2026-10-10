import Link from 'next/link';
import { useRouter } from 'next/router';

// Shared header for the customer portal pages outside /dashboard. Adding the
// notification nav item here means the unread indicator follows the customer
// across the transaction history and notification centre too, not just the
// overview page.
const LINKS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/profile', label: 'Profile' },
];

export default function PortalHeader({ user = null, unread = 0 }) {
  const router = useRouter();

  return (
    <header style={s.head} className="tm-portal-head">
      <Link href="/dashboard" style={s.brand}>
        <b style={s.mark}>T</b> topmint
      </Link>
      <nav style={s.nav} className="tm-portal-nav" aria-label="Customer portal">
        {LINKS.map(link => (
          <Link
            key={link.href}
            href={link.href}
            style={router.pathname === link.href ? { ...s.link, ...s.linkActive } : s.link}
            aria-current={router.pathname === link.href ? 'page' : undefined}
          >
            {link.label}
            {link.href === '/notifications' && unread > 0 && (
              <b style={s.badge} aria-label={`${unread} unread notifications`}>
                {unread > 99 ? '99+' : unread}
              </b>
            )}
          </Link>
        ))}
      </nav>
      {user && <span style={s.user}>{user.name || user.email}</span>}
    </header>
  );
}

const s = {
  head: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', paddingBottom: 14 },
  brand: { display: 'inline-flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: '#153d2c', fontSize: 20, fontWeight: 850 },
  mark: { width: 32, height: 32, borderRadius: 10, background: '#b8f36b', color: '#10291f', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 17 },
  nav: { display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' },
  link: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 10, textDecoration: 'none', color: '#4b6157', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' },
  linkActive: { background: '#e7f4ec', color: '#1c5c40' },
  badge: { fontSize: 10, background: '#174f39', color: '#fff', borderRadius: 20, padding: '2px 7px', lineHeight: 1.5 },
  user: { fontSize: 11, color: '#74847d' },
};
