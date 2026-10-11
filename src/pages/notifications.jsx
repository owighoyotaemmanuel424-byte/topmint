import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { requireCustomerAuth } from '../lib/page-auth';
import { requestJson, apiErrorMessage } from '../lib/api-client';
import PortalHeader from '../components/dashboard/PortalHeader';

// Server-side guard: a request without a valid session cookie is redirected
// before any of this page's markup is rendered.
export async function getServerSideProps(context) {
  return requireCustomerAuth(context);
}

const PAGE_SIZE = 15;

const TYPES = [
  { value: 'ACCOUNT', label: 'Account' },
  { value: 'DEPOSIT', label: 'Deposits' },
  { value: 'WITHDRAWAL', label: 'Withdrawals' },
  { value: 'INVESTMENT', label: 'Investments' },
  { value: 'INVESTMENT_MATURITY', label: 'Investment maturity' },
  { value: 'INVESTMENT_EARNING', label: 'Investment earnings' },
  { value: 'PAYMENT', label: 'Payments' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'ACCOUNT_UPDATE', label: 'Account updates' },
  { value: 'ANNOUNCEMENT', label: 'Announcements' },
];

const TYPE_LABELS = Object.fromEntries(TYPES.map(option => [option.value, option.label]));

const READ_FILTERS = [
  { value: '', label: 'All notifications' },
  { value: 'true', label: 'Unread only' },
  { value: 'false', label: 'Read only' },
];

const dateTime = value => (value ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

const EMPTY_FILTERS = { type: '', unread: '', page: 1 };

function readFilters(query = {}) {
  const value = key => (typeof query[key] === 'string' ? query[key] : '');
  return {
    type: TYPES.some(option => option.value === value('type')) ? value('type') : '',
    unread: ['true', 'false'].includes(value('unread')) ? value('unread') : '',
    page: /^\d+$/.test(value('page')) ? Math.max(1, Number(value('page'))) : 1,
  };
}

function toQueryString(filters) {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.unread) params.set('unread', filters.unread);
  params.set('page', String(filters.page));
  params.set('pageSize', String(PAGE_SIZE));
  return params.toString();
}

export default function Notifications() {
  const router = useRouter();
  const [draft, setDraft] = useState(() => readFilters(router.query));
  const [applied, setApplied] = useState(() => readFilters(router.query));
  const [result, setResult] = useState(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [markingAll, setMarkingAll] = useState(false);

  const queryString = useMemo(() => toQueryString(applied), [applied]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const response = await requestJson(`/api/notifications?${queryString}`);
    if ([401, 403].includes(response.status)) {
      router.replace('/signin');
      return;
    }
    if (!response.ok) {
      setResult(null);
      setError(apiErrorMessage(response, 'Unable to load your notifications right now.'));
      setLoading(false);
      return;
    }
    setResult(response.data);
    // The unread total comes from the database, not from the page of rows the
    // browser is holding, so it stays correct with hundreds of notifications.
    setUnread(response.data?.unread ?? 0);
    setLoading(false);
  }, [queryString, router]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!router.isReady) return;
    router.replace({ pathname: '/notifications', query: Object.fromEntries(new URLSearchParams(queryString)) }, undefined, { shallow: true });
  }, [queryString, router]);

  const apply = event => {
    event.preventDefault();
    setApplied({ ...draft, page: 1 });
  };

  const reset = () => {
    setDraft({ ...EMPTY_FILTERS });
    setApplied({ ...EMPTY_FILTERS });
  };

  const markRead = async id => {
    setBusyId(id);
    setError('');
    try {
      const response = await requestJson(`/api/notifications/${encodeURIComponent(id)}`, { method: 'PATCH' });
      if (!response.ok) throw new Error(apiErrorMessage(response, 'Could not mark that notification as read.'));
      setUnread(response.data?.unread ?? Math.max(0, unread - 1));
      // A read-only filter would no longer show the row it just changed.
      if (applied.unread === 'true') {
        setResult(current => current ? { ...current, notifications: current.notifications.filter(item => item.id !== id) } : current);
      } else {
        setResult(current => current
          ? { ...current, notifications: current.notifications.map(item => (item.id === id ? { ...item, read: true, readAt: new Date().toISOString() } : item)) }
          : current);
      }
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusyId('');
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    setError('');
    setNotice('');
    try {
      const response = await requestJson('/api/notifications/read-all', { method: 'POST' });
      if (!response.ok) throw new Error(apiErrorMessage(response, 'Could not mark your notifications as read.'));
      setNotice(response.data?.updated ? `${response.data.updated} notification${response.data.updated === 1 ? '' : 's'} marked as read.` : 'You have no unread notifications.');
      setUnread(0);
      await load();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setMarkingAll(false);
    }
  };

  const notifications = result?.notifications ?? [];
  const total = result?.total ?? 0;
  const page = result?.page ?? applied.page;
  const totalPages = result?.totalPages ?? 1;
  const filtered = Boolean(applied.type || applied.unread);

  return (
    <>
      <Head>
        <title>Notifications | TopMint</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#071c18" />
      </Head>
      <main style={s.page} className="tm-notifications-page">
        <div className="tm-portal-shell">
          <PortalHeader unread={unread} />

          <p style={s.eyebrow}>ACCOUNT UPDATES</p>
          <div style={s.titleRow}>
            <div>
              <h1 style={s.title}>Notifications</h1>
              <p style={s.sub}>
                <span aria-live="polite">
                  {unread === 0 ? 'You have no unread notifications.' : `${unread} unread notification${unread === 1 ? '' : 's'}.`}
                </span>{' '}
                Deposits, withdrawals, investments and security events appear here.
              </p>
            </div>
            <button
              type="button"
              style={unread > 0 ? s.primary : s.secondaryDisabled}
              onClick={markAllRead}
              disabled={markingAll || unread === 0}
            >
              {markingAll ? 'Marking…' : 'Mark all as read'}
            </button>
          </div>

          {error && (
            <div role="alert" style={s.error}>
              <span>{error}</span>
              <button type="button" style={s.errorButton} onClick={load}>Try again</button>
            </div>
          )}
          {notice && <p role="status" style={s.notice}>{notice}</p>}

          <section style={s.card}>
            <form onSubmit={apply} style={s.form}>
              <div className="tm-filter-grid">
                <label style={s.field}>
                  <span style={s.label}>Type</span>
                  <select style={s.input} value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value })}>
                    <option value="">All types</option>
                    {TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label style={s.field}>
                  <span style={s.label}>Status</span>
                  <select style={s.input} value={draft.unread} onChange={event => setDraft({ ...draft, unread: event.target.value })}>
                    {READ_FILTERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <div style={s.formButtons}>
                  <button type="button" style={s.secondary} onClick={reset}>Reset</button>
                  <button type="submit" style={s.primary}>Apply filters</button>
                </div>
              </div>
            </form>
          </section>

          <section style={s.card}>
            <div style={s.listHead}>
              <h2 style={s.sectionTitle}>Inbox</h2>
              <p style={s.summary} aria-live="polite">
                {loading ? 'Loading…' : total === 0 ? 'No matching notifications' : `${total} notification${total === 1 ? '' : 's'}`}
              </p>
            </div>

            {loading && (
              <div style={s.state} aria-busy="true">
                <div style={s.skeleton} />
                <div style={s.skeleton} />
                <div style={s.skeleton} />
              </div>
            )}

            {!loading && !notifications.length && (
              <div style={s.state}>
                <strong style={s.stateTitle}>{filtered ? 'No notifications match these filters' : 'You are all caught up'}</strong>
                <p style={s.stateText}>
                  {filtered
                    ? 'Try a different type, or switch back to all notifications.'
                    : 'Account, deposit, withdrawal, investment and security updates will appear here.'}
                </p>
                {filtered && <button type="button" style={s.primary} onClick={reset}>Clear filters</button>}
              </div>
            )}

            {!loading && notifications.map(item => (
              <article key={item.id} style={item.read ? s.notifRow : { ...s.notifRow, ...s.notifUnread }}>
                <span style={{ ...s.dot, background: item.read ? '#d6ddd9' : '#2b8b61' }} aria-hidden="true" />
                <div style={s.notifBody}>
                  <div style={s.notifHead}>
                    <strong style={s.notifTitle}>{item.title}</strong>
                    <span style={s.tag}>{TYPE_LABELS[item.type] || item.type}</span>
                    {!item.read && <span style={s.unreadTag}>Unread</span>}
                  </div>
                  <p style={s.message}>{item.message}</p>
                  <div style={s.notifFoot}>
                    <small style={s.timestamp}>{dateTime(item.createdAt)}</small>
                    <div style={s.notifActions}>
                      {item.link && (
                        <button type="button" style={s.textButton} onClick={() => router.push(item.link)}>
                          View details ↗
                        </button>
                      )}
                      {item.read ? (
                        <span style={s.readLabel}>Read</span>
                      ) : (
                        <button type="button" style={s.markButton} onClick={() => markRead(item.id)} disabled={busyId === item.id}>
                          {busyId === item.id ? 'Marking…' : 'Mark as read'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}

            {!loading && notifications.length > 0 && (
              <div className="tm-pager">
                <p style={s.summary}>Page {page} of {totalPages}</p>
                <div style={s.formButtons}>
                  <button type="button" style={s.secondary} onClick={() => setApplied(current => ({ ...current, page: current.page - 1 }))} disabled={page <= 1}>Previous</button>
                  <button type="button" style={s.secondary} onClick={() => setApplied(current => ({ ...current, page: current.page + 1 }))} disabled={page >= totalPages}>Next</button>
                </div>
              </div>
            )}
          </section>

          <p style={s.foot}>Delivery is in-app. TopMint does not currently send notifications by email or SMS.</p>
        </div>
      </main>
    </>
  );
}

const s = {
  page: { minHeight: '100vh', background: '#f5f7f6', color: '#14211d', fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '26px clamp(16px, 4vw, 40px) 56px', boxSizing: 'border-box' },
  eyebrow: { fontSize: 10, fontWeight: 800, letterSpacing: 1.6, color: '#38815c', margin: '22px 0 8px' },
  titleRow: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 },
  title: { fontSize: 'clamp(28px, 5vw, 40px)', letterSpacing: -1.4, margin: 0, fontWeight: 850 },
  sub: { color: '#718078', fontSize: 13, margin: '8px 0 0', lineHeight: 1.6, maxWidth: 620 },
  card: { background: '#fff', border: '1px solid #e5ece7', borderRadius: 18, padding: '18px 20px', marginBottom: 18 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  formButtons: { display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#7d8c84' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #dce5df', borderRadius: 10, background: '#fbfcfb', fontSize: 13, color: '#172c21' },
  primary: { border: 0, borderRadius: 10, background: '#174f39', color: '#fff', fontWeight: 750, fontSize: 12, padding: '11px 16px', cursor: 'pointer' },
  secondary: { border: '1px solid #dce5df', borderRadius: 10, background: '#fff', color: '#1f4a38', fontWeight: 700, fontSize: 12, padding: '10px 14px', cursor: 'pointer' },
  secondaryDisabled: { border: '1px solid #e6ece8', borderRadius: 10, background: '#f4f7f5', color: '#9aa79f', fontWeight: 700, fontSize: 12, padding: '11px 16px', cursor: 'not-allowed' },
  error: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: '#fff4df', color: '#855d16', padding: 13, borderRadius: 12, marginBottom: 14, fontSize: 12 },
  errorButton: { border: 0, background: 'transparent', textDecoration: 'underline', color: 'inherit', fontWeight: 700, cursor: 'pointer' },
  notice: { background: '#e9f6ee', color: '#1f5f43', padding: 12, borderRadius: 12, fontSize: 12, margin: '0 0 14px' },
  listHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 },
  sectionTitle: { fontSize: 17, fontWeight: 800, margin: 0, letterSpacing: -0.3 },
  summary: { fontSize: 11, color: '#7b8981', margin: 0 },
  state: { padding: '30px 10px', textAlign: 'center', color: '#78877f' },
  stateTitle: { display: 'block', fontSize: 14, color: '#20352b', marginBottom: 6 },
  stateText: { fontSize: 12, lineHeight: 1.7, margin: '0 0 14px', color: '#74847d' },
  skeleton: { height: 62, borderRadius: 12, background: 'linear-gradient(90deg, #f2f5f3 25%, #e9efeb 37%, #f2f5f3 63%)', backgroundSize: '400% 100%', marginBottom: 8 },
  notifRow: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 12px', borderBottom: '1px solid #f0f3f1', borderRadius: 12 },
  notifUnread: { background: '#f6fbf7' },
  dot: { width: 8, height: 8, borderRadius: 10, marginTop: 7, flexShrink: 0 },
  notifBody: { flex: 1, minWidth: 0 },
  notifHead: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  notifTitle: { fontSize: 13 },
  tag: { fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: '#4b6157', background: '#eef2ef', borderRadius: 20, padding: '3px 8px' },
  unreadTag: { fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: '#1c6b46', background: '#e2f4e7', borderRadius: 20, padding: '3px 8px' },
  message: { fontSize: 12, lineHeight: 1.7, color: '#55655c', margin: '7px 0' },
  notifFoot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  timestamp: { fontSize: 10, color: '#8a9790' },
  notifActions: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  textButton: { border: 0, background: 'transparent', color: '#247653', fontSize: 11, fontWeight: 800, cursor: 'pointer', padding: 0 },
  markButton: { border: '1px solid #dce5df', background: '#fff', color: '#1f4a38', borderRadius: 9, padding: '7px 11px', fontSize: 11, fontWeight: 750, cursor: 'pointer' },
  readLabel: { fontSize: 10, color: '#8a9790' },
  foot: { fontSize: 10, color: '#8b9891', textAlign: 'center', margin: '6px 0 0' },
};
