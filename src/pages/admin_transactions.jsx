import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { requestJson, apiErrorMessage } from '../lib/api-client';

const STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];
const money = (value, currency = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
  } catch {
    return `USD ${Number(value || 0).toFixed(2)}`;
  }
};
const dateTime = value => (value ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

// Resolving a deposit credits the customer's wallet; rejecting a withdrawal
// returns the reserved funds. Both are executed server-side under a serializable
// transaction and produce an audit entry and a customer notification, so this
// screen is only a trigger — it never computes a balance.
export default function AdminTransactions() {
  const router = useRouter();
  const [kind, setKind] = useState('deposits');
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [rejectingId, setRejectingId] = useState('');
  const [reasons, setReasons] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const result = await requestJson(`/api/admin/${kind}?status=${status}`);
    if ([401, 403].includes(result.status)) {
      router.replace('/signin_admin');
      return;
    }
    if (!result.ok) {
      setRows([]);
      setError(apiErrorMessage(result, 'Unable to load the review queue.'));
      setLoading(false);
      return;
    }
    setRows(result.data?.[kind] || []);
    setLoading(false);
  }, [kind, status, router]);

  useEffect(() => { load(); }, [load]);

  const act = async (row, action) => {
    const reason = (reasons[row.id] || '').trim();
    if (action === 'reject' && reason.length < 3) {
      setError('Give a short reason before rejecting.');
      return;
    }
    setBusy(`${row.id}:${action}`);
    setError('');
    setNotice('');
    try {
      const result = await requestJson(`/api/admin/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, action, reason: reason || undefined }),
      });
      if (!result.ok) throw new Error(apiErrorMessage(result, 'That action could not be completed.'));
      const label = kind === 'deposits'
        ? (action === 'verify' ? 'verified and credited' : 'rejected')
        : (action === 'approve' ? 'approved' : 'rejected and refunded');
      setNotice(`${row.reference || row.id} ${label}. The customer was notified in-app and the action was audited.`);
      setRejectingId('');
      setReasons(current => ({ ...current, [row.id]: '' }));
      await load();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy('');
    }
  };

  const isDeposit = kind === 'deposits';
  const approveAction = isDeposit ? 'verify' : 'approve';
  const approveLabel = isDeposit ? 'Verify & credit' : 'Approve payout';

  return (
    <>
      <Head>
        <title>Pending reviews | TopMint Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main style={s.page}>
        <header style={s.header}>
          <div>
            <p style={s.eyebrow}>ADMINISTRATION</p>
            <h1 style={s.title}>Pending reviews</h1>
            <p style={s.sub}>
              Verify deposits to credit wallets and resolve withdrawals. Rejecting a withdrawal returns the reserved funds to the
              customer&apos;s wallet.
            </p>
          </div>
          <div style={s.headerActions}>
            <button type="button" style={s.secondary} onClick={() => router.push('/admin_notifications')}>Announcements</button>
            <button type="button" style={s.secondary} onClick={() => router.push('/dashboard_admin')}>Dashboard</button>
          </div>
        </header>

        {error && (
          <div role="alert" style={s.error}>
            <span>{error}</span>
            <button type="button" style={s.errorButton} onClick={load}>Try again</button>
          </div>
        )}
        {notice && <p role="status" style={s.notice}>{notice}</p>}

        <section style={s.card}>
          <div style={s.controls}>
            <div style={s.tabs} role="tablist" aria-label="Review queue">
              <button
                type="button"
                role="tab"
                aria-selected={isDeposit}
                style={isDeposit ? { ...s.tab, ...s.tabActive } : s.tab}
                onClick={() => { setKind('deposits'); setRejectingId(''); }}
              >
                Deposits
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!isDeposit}
                style={!isDeposit ? { ...s.tab, ...s.tabActive } : s.tab}
                onClick={() => { setKind('withdrawals'); setRejectingId(''); }}
              >
                Withdrawals
              </button>
            </div>
            <label style={s.field}>
              <span style={s.label}>Status</span>
              <select style={s.input} value={status} onChange={event => { setStatus(event.target.value); setRejectingId(''); }}>
                {STATUSES.map(value => <option key={value} value={value}>{value.charAt(0) + value.slice(1).toLowerCase()}</option>)}
              </select>
            </label>
          </div>

          {loading && <p style={s.muted} aria-busy="true">Loading the review queue…</p>}

          {!loading && !rows.length && (
            <div style={s.empty}>
              <strong style={s.emptyTitle}>Nothing {status.toLowerCase()} in {isDeposit ? 'deposits' : 'withdrawals'}</strong>
              <p style={s.muted}>Requests appear here as customers submit them.</p>
            </div>
          )}

          {!loading && rows.map(row => (
            <article key={row.id} style={s.row}>
              <div style={s.rowMain}>
                <div style={s.rowHead}>
                  <strong style={s.reference}>{row.reference || row.id}</strong>
                  <span style={s.amount}>{money(row.amount, row.currency)}</span>
                  <span style={{ ...s.pill, ...(row.status === 'PENDING' ? s.pillPending : row.status === 'COMPLETED' ? s.pillOk : s.pillOff) }}>
                    {row.status}
                  </span>
                </div>
                <p style={s.detail}>
                  {row.customer?.name ? `${row.customer.name} · ` : ''}{row.customer?.email || 'Unknown customer'}
                </p>
                <p style={s.detail}>
                  Submitted {dateTime(row.createdAt)}
                  {isDeposit
                    ? ` · ${row.provider || 'MANUAL'}${row.providerRef ? ` · ref ${row.providerRef}` : ''}`
                    : ` · ${row.bankName || 'Bank'} · ${row.accountName || '—'} · ${row.accountNumber || '—'} · fee ${money(row.fee, row.currency)}`}
                </p>

                {rejectingId === row.id && (
                  <label style={{ ...s.field, marginTop: 10 }}>
                    <span style={s.label}>Reason for rejection (shown to the customer)</span>
                    <input
                      style={s.input}
                      value={reasons[row.id] || ''}
                      onChange={event => setReasons(current => ({ ...current, [row.id]: event.target.value }))}
                      maxLength={300}
                      placeholder="e.g. payment not received"
                    />
                  </label>
                )}
              </div>

              {row.status === 'PENDING' && (
                <div style={s.rowActions}>
                  <button
                    type="button"
                    style={s.primary}
                    disabled={busy.startsWith(row.id)}
                    onClick={() => act(row, approveAction)}
                  >
                    {busy === `${row.id}:${approveAction}` ? 'Working…' : approveLabel}
                  </button>
                  {rejectingId === row.id ? (
                    <>
                      <button type="button" style={s.danger} disabled={busy.startsWith(row.id)} onClick={() => act(row, 'reject')}>
                        {busy === `${row.id}:reject` ? 'Working…' : 'Confirm rejection'}
                      </button>
                      <button type="button" style={s.secondary} onClick={() => setRejectingId('')}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" style={s.secondary} onClick={() => { setRejectingId(row.id); setError(''); }}>Reject…</button>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>

        <p style={s.legal}>
          Every resolution records an audit entry, writes the matching ledger entry and notifies the customer in-app. A request
          that has already been reviewed cannot be applied twice.
        </p>
      </main>
    </>
  );
}

const s = {
  page: { maxWidth: 1080, margin: '0 auto', padding: '28px clamp(16px, 4vw, 36px) 56px', fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif', color: '#14211d', background: '#f5f7f6', minHeight: '100vh', boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 22 },
  headerActions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  eyebrow: { fontSize: 10, fontWeight: 800, letterSpacing: 1.6, color: '#38815c', margin: '0 0 8px' },
  title: { fontSize: 'clamp(26px, 4vw, 36px)', letterSpacing: -1.2, margin: 0, fontWeight: 850 },
  sub: { fontSize: 13, color: '#718078', margin: '8px 0 0', maxWidth: 660, lineHeight: 1.6 },
  card: { background: '#fff', border: '1px solid #e5ece7', borderRadius: 18, padding: '20px 22px', marginBottom: 18 },
  controls: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 6 },
  tabs: { display: 'inline-flex', gap: 4, background: '#f1f5f2', padding: 4, borderRadius: 12 },
  tab: { border: 0, background: 'transparent', borderRadius: 9, padding: '9px 14px', fontSize: 12, fontWeight: 750, color: '#4b6157', cursor: 'pointer' },
  tabActive: { background: '#fff', color: '#1c5c40', boxShadow: '0 1px 3px rgba(20,33,29,.12)' },
  field: { display: 'flex', flexDirection: 'column', gap: 7 },
  label: { fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#7d8c84' },
  input: { boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #dce5df', borderRadius: 10, background: '#fbfcfb', fontSize: 13, color: '#172c21', minWidth: 180 },
  row: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '16px 0', borderBottom: '1px solid #f0f3f1' },
  rowMain: { flex: 1, minWidth: 260 },
  rowHead: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  reference: { fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' },
  amount: { fontSize: 14, fontWeight: 800 },
  pill: { fontSize: 9, fontWeight: 800, letterSpacing: 0.6, borderRadius: 20, padding: '3px 8px' },
  pillPending: { background: '#fff3d9', color: '#8a5a10' },
  pillOk: { background: '#e2f4e7', color: '#1c6b46' },
  pillOff: { background: '#eef1f0', color: '#5d6b64' },
  detail: { fontSize: 11, color: '#7b8981', margin: '6px 0 0', lineHeight: 1.6, wordBreak: 'break-word' },
  rowActions: { display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' },
  primary: { border: 0, borderRadius: 10, background: '#174f39', color: '#fff', fontWeight: 750, fontSize: 12, padding: '11px 15px', cursor: 'pointer' },
  danger: { border: 0, borderRadius: 10, background: '#a52020', color: '#fff', fontWeight: 750, fontSize: 12, padding: '11px 15px', cursor: 'pointer' },
  secondary: { border: '1px solid #dce5df', borderRadius: 10, background: '#fff', color: '#1f4a38', fontWeight: 700, fontSize: 12, padding: '10px 14px', cursor: 'pointer' },
  empty: { padding: '28px 6px', textAlign: 'center' },
  emptyTitle: { display: 'block', fontSize: 14, color: '#20352b', marginBottom: 6 },
  muted: { fontSize: 12, color: '#7b8981', lineHeight: 1.7, margin: 0 },
  error: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: '#fff4df', color: '#855d16', padding: 13, borderRadius: 12, marginBottom: 14, fontSize: 12 },
  errorButton: { border: 0, background: 'transparent', textDecoration: 'underline', color: 'inherit', fontWeight: 700, cursor: 'pointer' },
  notice: { background: '#e9f6ee', color: '#1f5f43', padding: 13, borderRadius: 12, fontSize: 12, lineHeight: 1.7, margin: '0 0 16px' },
  legal: { fontSize: 10, lineHeight: 1.7, color: '#8b9891', margin: 0 },
};
