import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { requestJson, apiErrorMessage } from '../../lib/api-client';

const money = (value, currency = 'USD') => {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
    : `${currency} ${value}`;
};

export default function AdminWithdrawals() {
  const router = useRouter();
  const [status, setStatus] = useState('PENDING');
  const [withdrawals, setWithdrawals] = useState([]);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(true);
  const [activeId, setActiveId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await requestJson('/api/admin/withdrawals?status=' + encodeURIComponent(status));
      if (!response.ok) throw new Error(apiErrorMessage(response, 'Unable to load withdrawals'));
      setWithdrawals(response.data.withdrawals || []);
    } catch (e) {
      setError(e.message || 'Unable to load withdrawals');
      if (/unauthorized|forbidden/i.test(e.message || '')) router.replace('/signin_admin');
    } finally {
      setBusy(false);
    }
  }, [status, router]);

  useEffect(() => { load(); }, [load]);

  const review = async (row, action) => {
    const note = (notes[row.id] || '').trim();
    if (note.length < 5) return setError('Enter a review note of at least 5 characters.');
    const question = action === 'approve'
      ? 'Approve this withdrawal for payout? This does not itself transfer money to the bank.'
      : 'Reject this withdrawal and return the reserved amount to the customer wallet?';
    if (!window.confirm(question)) return;
    setActiveId(row.id);
    setError('');
    setMessage('');
    try {
      const response = await requestJson('/api/admin/withdrawals/' + encodeURIComponent(row.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      });
      if (!response.ok) throw new Error(apiErrorMessage(response, 'Withdrawal review failed'));
      setMessage(response.data.message || 'Withdrawal review saved.');
      setNotes(current => ({ ...current, [row.id]: '' }));
      await load();
    } catch (e) {
      setError(e.message || 'Withdrawal review failed');
    } finally {
      setActiveId('');
    }
  };

  const logout = async () => {
    await fetch('/api/admin/signout', { method: 'POST' });
    if (typeof window !== 'undefined') localStorage.removeItem('activeAdmin');
    router.push('/signin_admin');
  };

  return <>
    <Head><title>Withdrawal operations | TopMint Admin</title><meta name="viewport" content="width=device-width, initial-scale=1" /></Head>
    <main style={s.page}>
      <header style={s.header}>
        <div><Link href="/dashboard_admin" style={s.back}>← Dashboard</Link><p style={s.eyebrow}>TOPMINT OPERATIONS</p><h1 style={s.title}>Withdrawal operations</h1><p style={s.subtitle}>Review withdrawal requests, record decisions, and keep customer wallet balances consistent.</p></div>
        <button style={s.button} onClick={logout}>Sign out</button>
      </header>
      <section style={s.notice}><strong>Important payout control</strong><span>Approval records that a request is approved for payout; it does not transfer funds automatically. Complete the bank transfer separately. Rejection returns the reserved withdrawal amount to the customer&apos;s wallet and is recorded in the audit log.</span></section>
      <div style={s.toolbar}><label style={s.filter}>Show requests<select style={s.select} value={status} onChange={e => setStatus(e.target.value)}><option value="PENDING">Pending review</option><option value="COMPLETED">Approved</option><option value="FAILED">Rejected</option><option value="ALL">All statuses</option></select></label><button style={s.button} disabled={busy} onClick={load}>{busy ? 'Loading…' : 'Refresh'}</button></div>
      {message && <p role="status" style={s.success}>{message}</p>}
      {error && <p role="alert" style={s.error}>{error}</p>}
      {busy ? <div style={s.empty}>Loading withdrawal requests…</div> : withdrawals.length === 0 ? <div style={s.empty}><strong>No withdrawals found</strong><p>No requests match this status filter.</p></div> : <section style={s.list}>
        {withdrawals.map(row => {
          const pending = row.status === 'PENDING' && row.transaction?.status === 'PROCESSING';
          const customer = [row.user?.firstName, row.user?.lastName].filter(Boolean).join(' ');
          return <article key={row.id} style={s.card}>
            <div style={s.row}><div><small style={s.eyebrow}>TRANSACTION REFERENCE</small><h2 style={s.ref}>{row.transaction?.reference || row.id}</h2><p style={s.date}>{new Date(row.createdAt).toLocaleString()}</p></div><span style={{...s.badge, ...(row.status === 'COMPLETED' ? s.done : row.status === 'PENDING' ? s.pending : s.failed)}}>{row.status}</span></div>
            <div style={s.amount}>{money(row.amount, row.transaction?.currency || 'USD')}</div>
            <div style={s.details}><div><span>Customer</span><strong>{customer || 'TopMint customer'}</strong><small>{row.user?.email || '—'}</small></div><div><span>Bank</span><strong>{row.bankName || '—'}</strong></div><div><span>Account name</span><strong>{row.accountName || '—'}</strong></div><div><span>Account number</span><strong>{row.accountNumber || '—'}</strong></div><div><span>Fee</span><strong>{money(row.fee, row.transaction?.currency || 'USD')}</strong></div></div>
            {pending ? <div style={s.review}><label style={s.label}>Review note (required)<textarea style={s.textarea} value={notes[row.id] || ''} onChange={e => setNotes(v => ({...v, [row.id]: e.target.value}))} placeholder="Record payout confirmation or the reason for rejection." minLength={5} maxLength={500}/></label><div style={s.actions}><button style={s.approve} disabled={activeId === row.id} onClick={() => review(row, 'approve')}>{activeId === row.id ? 'Saving…' : 'Approve for payout'}</button><button style={s.reject} disabled={activeId === row.id} onClick={() => review(row, 'reject')}>Reject & refund</button></div></div> : <p style={s.closed}>This request has already been reviewed and cannot be processed again.</p>}
          </article>;
        })}
      </section>}
      <footer style={s.footer}>TopMint · Withdrawal controls · Decisions are recorded in the audit log.</footer>
    </main>
  </>;
}

const s = {
  page: { minHeight: '100vh', background: '#f4f7f5', color: '#15271e', padding: 'clamp(18px, 4vw, 42px)', fontFamily: 'Inter, system-ui, sans-serif' },
  header: { maxWidth: 1040, margin: '0 auto 26px', display: 'flex', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start' },
  back: { display: 'inline-block', color: '#286342', textDecoration: 'none', fontWeight: 750, fontSize: 13, marginBottom: 22 },
  eyebrow: { fontSize: 10, fontWeight: 850, letterSpacing: 1.5, color: '#45825e', margin: 0 },
  title: { fontSize: 'clamp(30px, 6vw, 44px)', letterSpacing: -1.5, margin: '8px 0' },
  subtitle: { color: '#728078', fontSize: 14, margin: 0, lineHeight: 1.6, maxWidth: 650 },
  button: { border: '1px solid #dce6df', background: '#fff', color: '#264634', padding: '11px 15px', borderRadius: 11, fontWeight: 750, flexShrink: 0 },
  notice: { maxWidth: 1040, margin: '0 auto 22px', display: 'flex', gap: 8, flexDirection: 'column', padding: 17, background: '#fff8e9', border: '1px solid #f0dfb6', borderRadius: 14, fontSize: 13, lineHeight: 1.6, color: '#755523' },
  toolbar: { maxWidth: 1040, margin: '0 auto 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 12 },
  filter: { display: 'flex', flexDirection: 'column', gap: 7, color: '#63736a', fontSize: 12, fontWeight: 750 },
  select: { background: '#fff', border: '1px solid #dce6df', borderRadius: 10, padding: '11px 12px', color: '#183426', minWidth: 170 },
  list: { maxWidth: 1040, margin: '0 auto', display: 'grid', gap: 16 },
  card: { background: '#fff', border: '1px solid #e1e9e3', borderRadius: 18, padding: 'clamp(17px, 3vw, 26px)', boxShadow: '0 12px 34px #163c2608', minWidth: 0 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  ref: { fontSize: 15, overflowWrap: 'anywhere', margin: '6px 0 0' },
  date: { color: '#89958d', fontSize: 11, margin: '7px 0 0' },
  badge: { fontSize: 9, fontWeight: 850, letterSpacing: 0.7, padding: '7px 9px', borderRadius: 99, flexShrink: 0 },
  pending: { color: '#865a10', background: '#fff1cd' },
  done: { color: '#21633d', background: '#e4f6e9' },
  failed: { color: '#973c35', background: '#ffebe8' },
  amount: { fontSize: 28, fontWeight: 850, letterSpacing: -0.7, margin: '18px 0' },
  details: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, padding: '16px 0', borderTop: '1px solid #edf1ed', borderBottom: '1px solid #edf1ed' },
  review: { marginTop: 20, display: 'grid', gap: 14 },
  label: { display: 'grid', gap: 7, fontSize: 12, fontWeight: 750, color: '#52645a' },
  textarea: { width: '100%', minHeight: 86, boxSizing: 'border-box', padding: 12, border: '1px solid #dce6df', borderRadius: 10, font: 'inherit', fontSize: 13, color: '#183426', background: '#fcfdfc', resize: 'vertical' },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  approve: { background: '#175437', color: '#fff', border: 0, borderRadius: 10, padding: '12px 15px', fontWeight: 800, flex: '1 1 190px' },
  reject: { background: '#fff', color: '#a13d36', border: '1px solid #f0cbc7', borderRadius: 10, padding: '12px 15px', fontWeight: 800, flex: '1 1 130px' },
  closed: { fontSize: 12, color: '#839087', marginBottom: 0 },
  empty: { maxWidth: 1040, margin: '0 auto', background: '#fff', border: '1px dashed #dce6df', borderRadius: 16, padding: 32, textAlign: 'center', color: '#718078' },
  success: { maxWidth: 1040, margin: '0 auto 14px', background: '#e8f7ec', color: '#24633d', padding: 13, borderRadius: 10, fontSize: 13 },
  error: { maxWidth: 1040, margin: '0 auto 14px', background: '#fff0ed', color: '#9c3e36', padding: 13, borderRadius: 10, fontSize: 13 },
  footer: { maxWidth: 1040, margin: '26px auto 0', color: '#87948c', fontSize: 11, textAlign: 'center' },
};
