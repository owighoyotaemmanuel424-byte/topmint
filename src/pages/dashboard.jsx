import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

const money = (value) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [plans, setPlans] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const responses = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/wallet'),
        fetch('/api/transactions?limit=10'),
        fetch('/api/investments'),
        fetch('/api/investments/plans'),
        fetch('/api/notifications')
      ]);
      const data = await Promise.all(responses.map(async r => ({ ok: r.ok, data: await r.json() })));
      const auth = data[0];
      if (!auth.ok) { router.replace('/signin'); return; }
      if (!data.every(item => item.ok)) throw new Error('Some account data could not be loaded.');
      setUser(auth.data.user);
      setWallet(data[1].data.wallet);
      setTransactions(data[2].data.transactions || []);
      setInvestments(data[3].data.investments || []);
      setPlans(data[4].data.plans || []);
      setNotifications(data[5].data.notifications || []);
    } catch (e) {
      setError(e.message || 'Unable to load your dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const logout = async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    sessionStorage.removeItem('activeUser');
    router.replace('/signin');
  };

  const markRead = async (id) => {
    await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setNotifications(items => items.map(item => item.id === id ? { ...item, read: true } : item));
  };

  if (loading) return <main style={styles.page}><p>Loading your TopMint dashboard...</p></main>;
  if (error && !user) return <main style={styles.page}><h2>Unable to load dashboard</h2><p>{error}</p><button onClick={load} style={styles.button}>Retry</button></main>;

  const unread = notifications.filter(n => !n.read).length;

  return (
    <>
      <Head><title>TopMint Dashboard</title></Head>
      <main style={styles.page}>
        <header style={styles.header}>
          <div><strong style={styles.logo}>TopMint</strong><p style={styles.muted}>Welcome back, {user?.name || 'Investor'}</p></div>
          <div style={styles.actions}><button onClick={() => router.push('/profile')} style={styles.secondary}>Profile</button><button onClick={logout} style={styles.secondary}>Sign out</button></div>
        </header>

        {error && <div style={styles.alert}>{error}</div>}

        <section style={styles.hero}>
          <div><p style={styles.muted}>Available balance</p><h1>₦{money(wallet?.balance)}</h1><p style={styles.muted}>{wallet?.currency || 'NGN'} wallet</p></div>
          <div style={styles.quick}><button onClick={() => router.push('/deposit')} style={styles.button}>Deposit</button><button onClick={() => router.push('/withdraw')} style={styles.secondary}>Withdraw</button></div>
        </section>

        <div style={styles.grid}>
          <section style={styles.card}><h2>Active investments</h2>{investments.length ? investments.map(item => <div key={item.id} style={styles.row}><div><strong>{item.plan?.name}</strong><p style={styles.muted}>Matures {new Date(item.maturityAt).toLocaleDateString()}</p></div><strong>₦{money(item.principal)}</strong></div>) : <p style={styles.muted}>No active investments yet.</p>}</section>

          <section style={styles.card}><h2>Investment plans</h2>{plans.length ? plans.slice(0, 4).map(plan => <div key={plan.id} style={styles.row}><div><strong>{plan.name}</strong><p style={styles.muted}>{plan.durationDays} days · {plan.returnRate}% target return</p></div><span>₦{money(plan.minimumAmount)}+</span></div>) : <p style={styles.muted}>No active plans are available.</p>}</section>

          <section style={styles.card}><h2>Recent transactions</h2>{transactions.length ? transactions.map(item => <div key={item.id} style={styles.row}><div><strong>{item.type}</strong><p style={styles.muted}>{item.description || item.reference} · {new Date(item.createdAt).toLocaleDateString()}</p></div><strong>₦{money(item.amount)}</strong></div>) : <p style={styles.muted}>No transactions yet.</p>}</section>

          <section style={styles.card}><h2>Notifications {unread ? <small>({unread} unread)</small> : null}</h2>{notifications.length ? notifications.slice(0, 5).map(item => <div key={item.id} style={styles.notice}><div><strong>{item.title}</strong><p>{item.message}</p></div>{!item.read && <button onClick={() => markRead(item.id)} style={styles.link}>Mark read</button>}</div>) : <p style={styles.muted}>You&apos;re all caught up.</p>}</section>
        </div>
      </main>
    </>
  );
}

const styles = {
  page: { minHeight: '100vh', padding: '24px', maxWidth: 1180, margin: '0 auto', fontFamily: 'Inter, Arial, sans-serif', color: '#171717' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 24 },
  logo: { fontSize: 24 }, muted: { color: '#6b7280', margin: '6px 0' },
  actions: { display: 'flex', gap: 8 }, hero: { padding: 28, borderRadius: 20, background: '#111827', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginBottom: 20 },
  'hero h1': { fontSize: 38, margin: '4px 0' }, quick: { display: 'flex', gap: 10 }, grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 18 },
  card: { border: '1px solid #e5e7eb', borderRadius: 18, padding: 20, background: '#fff' }, row: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '14px 0', borderBottom: '1px solid #f0f0f0' },
  notice: { padding: '12px 0', borderBottom: '1px solid #f0f0f0' }, 'notice p': { margin: '5px 0', color: '#555' },
  button: { border: 0, borderRadius: 10, padding: '11px 16px', background: '#fff', color: '#111827', fontWeight: 700, cursor: 'pointer' },
  secondary: { border: '1px solid #d1d5db', borderRadius: 10, padding: '10px 14px', background: '#fff', cursor: 'pointer' },
  link: { border: 0, background: 'transparent', textDecoration: 'underline', cursor: 'pointer' }, alert: { padding: 14, background: '#fff3cd', borderRadius: 12, marginBottom: 18 }
};
