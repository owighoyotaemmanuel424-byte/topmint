import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { requestJson, apiErrorMessage } from '../../lib/api-client';

const money = (value, currency = 'USD') => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${currency} ${value}`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
};

export default function AdminDeposits() {
  const router = useRouter();
  const [status, setStatus] = useState('PENDING');
  const [deposits, setDeposits] = useState([]);
  const [busy, setBusy] = useState(true);
  const [activeId, setActiveId] = useState('');
  const [notes, setNotes] = useState({});
  const [refs, setRefs] = useState({});
  const [verified, setVerified] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await requestJson('/api/admin/deposits?status=' + encodeURIComponent(status));
      if (!response.ok) throw new Error(apiErrorMessage(response, 'Unable to load deposit requests'));
      setDeposits(response.data.deposits || []);
    } catch (e) {
      setError(e.message || 'Unable to load deposit requests');
      if (/unauthorized|forbidden/i.test(e.message || '')) router.replace('/signin_admin');
    } finally {
      setBusy(false);
    }
  }, [status, router]);

  useEffect(() => { load(); }, [load]);

  const review = async (deposit, action) => {
    const note = (notes[deposit.id] || '').trim();
    if (note.length < 5) {
      setError('Enter a review note of at least 5 characters.');
      return;
    }
    if (action === 'approve' && !verified[deposit.id]) {
      setError('Confirm independent verification of the payment before approving.');
      return;
    }
    const prompt = action === 'approve'
      ? 'Approve this deposit and credit the customer wallet? Only proceed after independently confirming receipt.'
      : 'Reject this deposit request? No wallet credit will be made.';
    if (!window.confirm(prompt)) return;

    setActiveId(deposit.id);
    setError('');
    setMessage('');
    try {
      const response = await requestJson('/api/admin/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depositId: deposit.id,
          action,
          note,
          verifiedReceipt: action === 'approve' ? true : undefined,
          providerRef: (refs[deposit.id] || '').trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error(apiErrorMessage(response, 'Deposit review failed'));
      setMessage(response.data.message || 'Deposit review saved.');
      setNotes(current => ({ ...current, [deposit.id]: '' }));
      await load();
    } catch (e) {
      setError(e.message || 'Deposit review failed');
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
    <Head><title>Deposit review | TopMint Admin</title><meta name="viewport" content="width=device-width, initial-scale=1" /></Head>
    <main style={s.page}>
      <header style={s.header}>
        <div><Link href="/dashboard_admin" style={s.back}>← Dashboard</Link><p style={s.eyebrow}>TOPMINT OPERATIONS</p><h1 style={s.title}>Deposit review</h1><p style={s.subtitle}>Review manual deposit requests and keep a traceable decision record.</p></div>
        <button style={s.logout} onClick={logout}>Sign out</button>
      </header>
      <section style={s.notice}><strong>Financial control</strong><span>Approve only after independently verifying that the funds were received. Approval credits the wallet immediately. Rejection records a failed request and does not credit funds.</span></section>
      <div style={s.toolbar}>
        <label style={s.filterLabel}>Show requests
          <select style={s.select} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="PENDING">Pending review</option><option value="COMPLETED">Approved</option><option value="FAILED">Rejected</option><option value="ALL">All statuses</option>
          </select>
        </label>
        <button style={s.refresh} onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>
      </div>
      {message && <p role="status" style={s.success}>{message}</p>}
      {error && <p role="alert" style={s.error}>{error}</p>}
      {busy ? <div style={s.empty}>Loading deposit requests…</div> : deposits.length === 0 ? <div style={s.empty}><strong>No deposits found</strong><p>There are no requests matching this status.</p></div> : <section style={s.list}>
        {deposits.map(deposit => {
          const pending = deposit.status === 'PENDING' && deposit.transaction?.status === 'PENDING';
          const customer = [deposit.user?.firstName, deposit.user?.lastName].filter(Boolean).join(' ');
          return <article key={deposit.id} style={s.card}>
            <div style={s.cardTop}>
              <div><p style={s.refLabel}>TRANSACTION REFERENCE</p><h2 style={s.ref}>{deposit.transaction?.reference || deposit.id}</h2><p style={s.date}>{new Date(deposit.createdAt).toLocaleString()}</p></div>
              <div style={{...s.badge, ...(deposit.status === 'COMPLETED' ? s.badgeDone : deposit.status === 'PENDING' ? s.badgePending : s.badgeFailed)}}>{deposit.status}</div>
            </div>
            <div style={s.amount}>{money(deposit.amount, deposit.transaction?.currency || 'USD')}</div>
            <div style={s.details}><div><span>Customer</span><strong>{customer || 'TopMint customer'}</strong><small>{deposit.user?.email || '—'}</small></div><div><span>Method</span><strong>{deposit.provider || 'Manual'}</strong></div><div><span>Provider reference</span><strong>{deposit.providerRef || 'Not supplied'}</strong></div></div>
            {pending && <div style={s.reviewBox}>
              <label style={s.label}>Payment / provider reference (optional)<input style={s.input} value={refs[deposit.id] || ''} onChange={e => setRefs(v => ({...v, [deposit.id]: e.target.value}))} placeholder="Bank transfer reference" maxLength={160} /></label>
              <label style={s.label}>Review note (required)<textarea style={s.textarea} value={notes[deposit.id] || ''} onChange={e => setNotes(v => ({...v, [deposit.id]: e.target.value}))} placeholder="Record how receipt was verified, or the reason for rejection." minLength={5} maxLength={500} /></label>
              <label style={s.check}><input type="checkbox" checked={Boolean(verified[deposit.id])} onChange={e => setVerified(v => ({...v, [deposit.id]: e.target.checked}))} /><span>I independently verified that the payment was received in the destination account.</span></label>
              <div style={s.actions}><button disabled={activeId === deposit.id} style={s.approve} onClick={() => review(deposit, 'approve')}>{activeId === deposit.id ? 'Saving…' : 'Verify & credit wallet'}</button><button disabled={activeId === deposit.id} style={s.reject} onClick={() => review(deposit, 'reject')}>Reject request</button></div>
            </div>}
            {!pending && <p style={s.closed}>This request has already been reviewed and cannot be processed again.</p>}
          </article>;
        })}
      </section>}
      <footer style={s.footer}>TopMint · Manual deposits · Every decision is recorded in the audit log.</footer>
    </main>
  </>;
}

const s = {
  page: { minHeight: '100vh', background: '#f4f7f5', color: '#15271e', padding: 'clamp(18px, 4vw, 42px)', fontFamily: 'Inter, system-ui, sans-serif' },
  header: { maxWidth: 1040, margin: '0 auto 26px', display: 'flex', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start' },
  back: { display: 'inline-block', color: '#286342', textDecoration: 'none', fontWeight: 750, fontSize: 13, marginBottom: 22 },
  eyebrow: { fontSize: 10, fontWeight: 850, letterSpacing: 1.8, color: '#45825e', margin: 0 },
  title: { fontSize: 'clamp(30px, 6vw, 44px)', letterSpacing: -1.5, margin: '8px 0' },
  subtitle: { color: '#728078', fontSize: 14, margin: 0, lineHeight: 1.6 },
  logout: { border: '1px solid #dce6df', background: '#fff', color: '#264634', padding: '11px 15px', borderRadius: 11, fontWeight: 750, flexShrink: 0 },
  notice: { maxWidth: 1040, margin: '0 auto 22px', display: 'flex', gap: 12, flexDirection: 'column', padding: 17, background: '#fff8e9', border: '1px solid #f0dfb6', borderRadius: 14, fontSize: 13, lineHeight: 1.6, color: '#755523' },
  toolbar: { maxWidth: 1040, margin: '0 auto 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 12 },
  filterLabel: { display: 'flex', flexDirection: 'column', gap: 7, color: '#63736a', fontSize: 12, fontWeight: 750 },
  select: { background: '#fff', border: '1px solid #dce6df', borderRadius: 10, padding: '11px 12px', color: '#183426', minWidth: 170 },
  refresh: { border: '1px solid #dce6df', background: '#fff', color: '#245a3d', padding: '11px 15px', borderRadius: 10, fontWeight: 750 },
  list: { maxWidth: 1040, margin: '0 auto', display: 'grid', gap: 16 },
  card: { background: '#fff', border: '1px solid #e1e9e3', borderRadius: 18, padding: 'clamp(17px, 3vw, 26px)', boxShadow: '0 12px 34px #163c2608', minWidth: 0 },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  refLabel: { fontSize: 9, letterSpacing: 1.3, fontWeight: 850, color: '#85928a', margin: '0 0 6px' },
  ref: { fontSize: 15, overflowWrap: 'anywhere', margin: 0 },
  date: { color: '#89958d', fontSize: 11, margin: '7px 0 0' },
  badge: { fontSize: 9, fontWeight: 850, letterSpacing: 0.7, padding: '7px 9px', borderRadius: 99, flexShrink: 0 },
  badgePending: { color: '#865a10', background: '#fff1cd' },
  badgeDone: { color: '#21633d', background: '#e4f6e9' },
  badgeFailed: { color: '#973c35', background: '#ffebe8' },
  amount: { fontSize: 28, fontWeight: 850, letterSpacing: -0.7, margin: '18px 0' },
  details: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, padding: '16px 0', borderTop: '1px solid #edf1ed', borderBottom: '1px solid #edf1ed' },
  detailsDiv: {},
  detailsLabel: {},
  reviewBox: { marginTop: 20, display: 'grid', gap: 14 },
  label: { display: 'grid', gap: 7, fontSize: 12, fontWeight: 750, color: '#52645a' },
  input: { width: '100%', boxSizing: 'border-box', padding: 12, border: '1px solid #dce6df', borderRadius: 10, font: 'inherit', color: '#183426', background: '#fcfdfc' },
  textarea: { width: '100%', minHeight: 86, boxSizing: 'border-box', padding: 12, border: '1px solid #dce6df', borderRadius: 10, font: 'inherit', fontSize: 13, color: '#183426', background: '#fcfdfc', resize: 'vertical' },
  check: { display: 'flex', alignItems: 'flex-start', gap: 9, color: '#53665a', fontSize: 12, lineHeight: 1.5 },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  approve: { background: '#175437', color: '#fff', border: 0, borderRadius: 10, padding: '12px 15px', fontWeight: 800, flex: '1 1 190px' },
  reject: { background: '#fff', color: '#a13d36', border: '1px solid #f0cbc7', borderRadius: 10, padding: '12px 15px', fontWeight: 800, flex: '1 1 130px' },
  closed: { fontSize: 12, color: '#839087', marginBottom: 0 },
  empty: { maxWidth: 1040, margin: '0 auto', background: '#fff', border: '1px dashed #dce6df', borderRadius: 16, padding: 32, textAlign: 'center', color: '#718078' },
  success: { maxWidth: 1040, margin: '0 auto 14px', background: '#e8f7ec', color: '#24633d', padding: 13, borderRadius: 10, fontSize: 13 },
  error: { maxWidth: 1040, margin: '0 auto 14px', background: '#fff0ed', color: '#9c3e36', padding: 13, borderRadius: 10, fontSize: 13 },
  footer: { maxWidth: 1040, margin: '26px auto 0', color: '#87948c', fontSize: 11, textAlign: 'center' },
};
