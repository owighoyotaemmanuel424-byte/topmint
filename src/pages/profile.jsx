import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Profile() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Session expired');
        setUser(d.user);
      })
      .catch(() => router.replace('/signin'))
      .finally(() => setLoading(false));
  }, [router]);

  const signout = async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    sessionStorage.removeItem('activeUser');
    router.push('/signin');
  };

  if (loading) return <main style={styles.page}><h2>Loading your account...</h2></main>;
  if (!user) return null;

  const balance = Number(user.wallet?.balance || 0);

  return (
    <>
      <Head><title>TopMint Account</title><meta name="viewport" content="width=device-width, initial-scale=1" /></Head>
      <main style={styles.page}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>Welcome back, {user.name}</h1>
            <p style={styles.email}>{user.email}</p>
          </div>
          <button onClick={signout} style={styles.signout}>Sign out</button>
        </header>
        <section style={styles.wallet}>
          <p style={styles.eyebrow}>WALLET BALANCE</p>
          <h2 style={styles.balance}>{user.wallet?.currency || 'NGN'} {balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
          <p style={styles.caption}>Available wallet balance</p>
        </section>
        <section style={styles.account}>
          <h2 style={styles.sectionTitle}>Account</h2>
          <p style={styles.detail}><span>Status</span><strong>{user.status}</strong></p>
          <p style={styles.detail}><span>Member since</span><strong>{new Date(user.createdAt).toLocaleDateString()}</strong></p>
        </section>
      </main>
    </>
  );
}

const styles = {
  page: { minHeight: '100vh', boxSizing: 'border-box', padding: 'clamp(20px, 5vw, 48px)', maxWidth: 980, margin: '0 auto', background: '#050816', color: '#f8fafc', fontFamily: 'Inter, Arial, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18, flexWrap: 'wrap' },
  title: { fontSize: 'clamp(26px, 5vw, 38px)', lineHeight: 1.2, margin: '0 0 10px', color: '#f8fafc' },
  email: { color: '#cbd5e1', margin: 0, overflowWrap: 'anywhere' },
  signout: { border: '1px solid #334155', borderRadius: 10, padding: '11px 16px', background: '#111827', color: '#f8fafc', cursor: 'pointer', fontWeight: 600 },
  wallet: { marginTop: 32, padding: '28px', borderRadius: 20, background: 'linear-gradient(135deg, #123b35, #166534)', color: '#ffffff', boxShadow: '0 12px 35px rgba(0,0,0,.2)' },
  eyebrow: { margin: '0 0 12px', color: '#bbf7d0', fontSize: 12, fontWeight: 700, letterSpacing: '0.12em' },
  balance: { margin: '0 0 10px', fontSize: 'clamp(28px, 6vw, 40px)', lineHeight: 1.2, color: '#ffffff', overflowWrap: 'anywhere' },
  caption: { margin: 0, color: '#dcfce7' },
  account: { marginTop: 28, padding: '4px 0' },
  sectionTitle: { fontSize: 24, marginBottom: 14, color: '#f8fafc' },
  detail: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '13px 0', borderBottom: '1px solid #1e293b', color: '#cbd5e1', flexWrap: 'wrap' },
};
