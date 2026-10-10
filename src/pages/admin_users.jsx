import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { requestJson, apiErrorMessage } from '../lib/api-client';

export default function AdminUsers() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const r = await requestJson('/api/admin/users');
      if (!r.ok) throw new Error(apiErrorMessage(r, 'Unable to load users'));
      setUsers(r.data?.users || []);
    } catch (e) {
      if (/unauthorized|forbidden/i.test(e.message)) router.replace('/signin_admin');
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <main style={s.page}>Loading customers...</main>;

  return <><Head><title>Customers | TopMint Admin</title></Head>
    <main style={s.page}>
      <header style={s.header}><div><h1>Customers</h1><p>Neon-backed customer accounts and wallet status.</p></div><button onClick={() => router.push('/dashboard_admin')} style={s.button}>Dashboard</button></header>
      {error && <div style={s.error}>{error}</div>}
      <section style={s.card}>
        <div style={s.tableHead}><b>Customer</b><b>Status</b><b>Wallet</b><b>Investments</b></div>
        {users.map(user => <div key={user.id} style={s.row}>
          <div><strong>{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unnamed'}</strong><small>{user.email}</small></div>
          <span>{user.status}</span>
          <span>{user.wallet?.currency || 'NGN'} {Number(user.wallet?.balance || 0).toLocaleString()}</span>
          <span>{user._count?.investments || 0}</span>
        </div>)}
        {!users.length && <p>No customers found.</p>}
      </section>
    </main>
  </>;
}

const s={page:{maxWidth:1200,margin:'0 auto',padding:24,fontFamily:'Arial'},header:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24},card:{border:'1px solid #e5e7eb',borderRadius:16,padding:18},tableHead:{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:12,padding:'12px 0',borderBottom:'1px solid #eee'},row:{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:12,padding:'14px 0',borderBottom:'1px solid #f1f1f1'},button:{padding:'10px 16px',borderRadius:10,border:'1px solid #ddd',background:'#fff'},error:{padding:12,background:'#fee2e2',borderRadius:10,marginBottom:16}};
