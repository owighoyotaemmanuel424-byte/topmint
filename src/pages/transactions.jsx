import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const PAGE_SIZE = 10;

// Only the transaction types the ledger can actually produce are offered, so no
// filter can lead to an empty list by design.
const TYPES = [
  { value: 'DEPOSIT', label: 'Deposits' },
  { value: 'WITHDRAWAL', label: 'Withdrawals' },
  { value: 'INVESTMENT', label: 'Investment purchases' },
  { value: 'RETURN', label: 'Investment earnings' },
  { value: 'REFUND', label: 'Refunds' },
  { value: 'FEE', label: 'Fees' },
  { value: 'ADJUSTMENT', label: 'Wallet adjustments' },
];

const STATUSES = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const TYPE_LABELS = Object.fromEntries(TYPES.map(option => [option.value, option.label]));
const STATUS_LABELS = Object.fromEntries(STATUSES.map(option => [option.value, option.label]));

const STATUS_TONE = {
  COMPLETED: { background: '#e2f4e7', color: '#1c6b46' },
  PENDING: { background: '#fff3d9', color: '#8a5a10' },
  PROCESSING: { background: '#e6f0fd', color: '#1d4f8a' },
  FAILED: { background: '#fdeaea', color: '#a52020' },
  CANCELLED: { background: '#eef1f0', color: '#5d6b64' },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const money = (value, currency = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
  } catch {
    return `USD ${Number(value || 0).toFixed(2)}`;
  }
};
const dateTime = value => (value ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const dateOnly = value => (value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

const EMPTY_FILTERS = { q: '', type: '', status: '', from: '', to: '', sort: 'newest', page: 1 };
const isFiltered = filters => Boolean(filters.q || filters.type || filters.status || filters.from || filters.to);

// The filters live in the URL, so a filtered view can be shared, bookmarked and
// reloaded. Values are re-validated here as well as on the server.
function readFilters(query = {}) {
  const value = key => (typeof query[key] === 'string' ? query[key] : '');
  return {
    q: value('q').slice(0, 64),
    type: TYPES.some(option => option.value === value('type')) ? value('type') : '',
    status: STATUSES.some(option => option.value === value('status')) ? value('status') : '',
    from: DATE_RE.test(value('from')) ? value('from') : '',
    to: DATE_RE.test(value('to')) ? value('to') : '',
    sort: value('sort') === 'oldest' ? 'oldest' : 'newest',
    page: /^\d+$/.test(value('page')) ? Math.max(1, Number(value('page'))) : 1,
  };
}

function toQueryString(filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('sort', filters.sort);
  params.set('page', String(filters.page));
  params.set('pageSize', String(PAGE_SIZE));
  return params.toString();
}

export default function Transactions() {
  const router = useRouter();
  const [draft, setDraft] = useState(() => readFilters(router.query));
  const [applied, setApplied] = useState(() => readFilters(router.query));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [unread, setUnread] = useState(0);

  const queryString = useMemo(() => toQueryString(applied), [applied]);

  // The unread notification count for the header badge, counted in the database.
  useEffect(() => {
    requestJson('/api/notifications?unread=true&pageSize=1').then(response => {
      if (response.ok) setUnread(response.data?.unread ?? 0);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const response = await requestJson(`/api/transactions?${queryString}`);
    if ([401, 403].includes(response.status)) {
      router.replace('/signin');
      return;
    }
    if (!response.ok) {
      setResult(null);
      setError(apiErrorMessage(response, 'Unable to load your transactions right now.'));
      setLoading(false);
      return;
    }
    setResult(response.data);
    setLoading(false);
  }, [queryString, router]);

  useEffect(() => { load(); }, [load]);

  // Keep the address bar in step with the applied filters.
  useEffect(() => {
    if (!router.isReady) return;
    router.replace({ pathname: '/transactions', query: Object.fromEntries(new URLSearchParams(queryString)) }, undefined, { shallow: true });
  }, [queryString, router]);

  const apply = event => {
    event.preventDefault();
    // Both dates must be real and ordered. The API rejects a reversed range
    // too; catching it here avoids a pointless round trip.
    if (draft.from && draft.to && draft.from > draft.to) {
      setRangeError('The start date must be on or before the end date.');
      return;
    }
    setRangeError('');
    setApplied({ ...draft, page: 1 });
  };

  const reset = () => {
    setDraft({ ...EMPTY_FILTERS });
    setApplied({ ...EMPTY_FILTERS });
    setRangeError('');
  };

  const goToPage = page => setApplied(current => ({ ...current, page }));
  const changeSort = sort => {
    setDraft(current => ({ ...current, sort }));
    setApplied(current => ({ ...current, sort, page: 1 }));
  };

  const transactions = result?.transactions ?? [];
  const total = result?.total ?? 0;
  const page = result?.page ?? applied.page;
  const totalPages = result?.totalPages ?? 1;
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <Head>
        <title>Transactions | TopMint</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#071c18" />
      </Head>
      <main style={s.page} className="tm-transactions-page">
        <div className="tm-portal-shell">
          <PortalHeader unread={unread} />

          <p style={s.eyebrow}>ACCOUNT ACTIVITY</p>
          <div style={s.titleRow}>
            <div>
              <h1 style={s.title}>Transactions</h1>
              <p style={s.sub}>Every deposit, withdrawal, investment and wallet movement on your account.</p>
            </div>
            <button type="button" style={s.secondary} onClick={load} disabled={loading}>Refresh</button>
          </div>

          {error && (
            <div role="alert" style={s.error}>
              <span>{error}</span>
              <button type="button" style={s.errorButton} onClick={load}>Try again</button>
            </div>
          )}

          <section style={s.card}>
            <form onSubmit={apply} style={s.form}>
              <div className="tm-filter-grid">
                <label style={s.field}>
                  <span style={s.label}>Reference</span>
                  <input
                    style={s.input}
                    value={draft.q}
                    onChange={event => setDraft({ ...draft, q: event.target.value })}
                    placeholder="e.g. DEP-4F2A9C"
                    maxLength={64}
                    autoComplete="off"
                  />
                </label>
                <label style={s.field}>
                  <span style={s.label}>Type</span>
                  <select style={s.input} value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value })}>
                    <option value="">All types</option>
                    {TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label style={s.field}>
                  <span style={s.label}>Status</span>
                  <select style={s.input} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>
                    <option value="">All statuses</option>
                    {STATUSES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label style={s.field}>
                  <span style={s.label}>From</span>
                  <input style={s.input} type="date" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} />
                </label>
                <label style={s.field}>
                  <span style={s.label}>To</span>
                  <input style={s.input} type="date" value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} />
                </label>
              </div>

              {rangeError && <p role="alert" style={s.inlineError}>{rangeError}</p>}

              <div style={s.formFooter}>
                <label style={s.field}>
                  <span style={s.label}>Sort</span>
                  <select style={s.input} value={applied.sort} onChange={event => changeSort(event.target.value)}>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
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
              <h2 style={s.sectionTitle}>History</h2>
              <p style={s.summary} aria-live="polite">
                {loading ? 'Loading…' : total === 0 ? 'No matching transactions' : `Showing ${firstRow}–${lastRow} of ${total}`}
              </p>
            </div>

            {loading && (
              <div style={s.state} aria-busy="true">
                <div style={s.skeleton} />
                <div style={s.skeleton} />
                <div style={s.skeleton} />
              </div>
            )}

            {!loading && !transactions.length && (
              <div style={s.state}>
                <strong style={s.stateTitle}>{isFiltered(applied) ? 'No transactions match these filters' : 'No transactions yet'}</strong>
                <p style={s.stateText}>
                  {isFiltered(applied)
                    ? 'Try a different reference, type, status or date range.'
                    : 'Your deposits, withdrawals and investments will appear here once you make them.'}
                </p>
                {isFiltered(applied) && <button type="button" style={s.primary} onClick={reset}>Clear filters</button>}
              </div>
            )}

            {!loading && transactions.length > 0 && (
              <>
                <div className="tm-tx-head" style={{ paddingLeft: 8, paddingRight: 8 }}>
                  <span>Reference</span>
                  <span>Type</span>
                  <span>Description</span>
                  <span>Method</span>
                  <span>Date</span>
                  <span style={{ textAlign: 'right' }}>Amount</span>
                </div>
                {transactions.map(row => (
                  <button
                    key={row.id}
                    type="button"
                    className="tm-tx-row"
                    onClick={() => setOpenId(row.id)}
                    aria-label={`View details for ${row.reference}`}
                  >
                    <span className="tm-tx-cell" data-label="Reference" style={{ ...s.cell, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, fontWeight: 700 }}>
                      {row.reference}
                    </span>
                    <span className="tm-tx-cell" data-label="Type" style={s.cell}>
                      <span>{TYPE_LABELS[row.type] || row.type}</span>
                    </span>
                    <span className="tm-tx-cell" data-label="Description" style={{ ...s.cell, color: '#55655c' }}>
                      <span style={s.truncate}>{row.description || '—'}</span>
                    </span>
                    <span className="tm-tx-cell" data-label="Method" style={{ ...s.cell, color: '#55655c' }}>
                      <span style={s.truncate}>{row.paymentMethod || (row.deposit ? 'Wallet deposit' : row.withdrawal ? 'Bank transfer' : '—')}</span>
                    </span>
                    <span className="tm-tx-cell" data-label="Date" style={{ ...s.cell, color: '#55655c' }}>
                      <span>{dateOnly(row.createdAt)}</span>
                    </span>
                    <span className="tm-tx-cell" data-label="Amount" style={{ ...s.cell, justifyContent: 'flex-end', textAlign: 'right' }}>
                      <span style={s.amount}>{money(row.amount, row.currency)}</span>
                      <span style={{ ...s.pill, ...(STATUS_TONE[row.status] || STATUS_TONE.PENDING) }}>{STATUS_LABELS[row.status] || row.status}</span>
                    </span>
                  </button>
                ))}

                <div className="tm-pager">
                  <p style={s.pagerText}>Page {page} of {totalPages}</p>
                  <div style={s.pagerButtons}>
                    <button type="button" style={s.secondary} onClick={() => goToPage(1)} disabled={page <= 1}>First</button>
                    <button type="button" style={s.secondary} onClick={() => goToPage(page - 1)} disabled={page <= 1}>Previous</button>
                    <button type="button" style={s.secondary} onClick={() => goToPage(page + 1)} disabled={page >= totalPages}>Next</button>
                    <button type="button" style={s.secondary} onClick={() => goToPage(totalPages)} disabled={page >= totalPages}>Last</button>
                  </div>
                </div>
              </>
            )}
          </section>

          <p style={s.foot}>Read-only record. Transaction amounts and statuses can only be changed by TopMint operations.</p>
        </div>
      </main>

      {openId && <TransactionDetails id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

// Details are fetched from the API by id rather than reused from the list, so
// the modal always shows the current status and the server re-checks ownership.
function TransactionDetails({ id, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', transaction: null });
  const closeRef = useRef(null);

  useEffect(() => {
    let active = true;
    requestJson(`/api/transactions/${encodeURIComponent(id)}`)
      .then(response => {
        if (!active) return;
        if (!response.ok) throw new Error(apiErrorMessage(response, 'Unable to load that transaction.'));
        setState({ loading: false, error: '', transaction: response.data?.transaction ?? null });
      })
      .catch(error => {
        if (active) setState({ loading: false, error: error.message || 'Unable to load that transaction.', transaction: null });
      });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const transaction = state.transaction;

  return (
    <div className="tm-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="tm-modal" role="dialog" aria-modal="true" aria-labelledby="tm-tx-detail-title">
        <div style={s.modalHead}>
          <div>
            <p style={s.eyebrow}>TRANSACTION DETAILS</p>
            <h2 id="tm-tx-detail-title" style={s.modalTitle}>{transaction?.reference || 'Loading…'}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} style={s.close} aria-label="Close transaction details">✕</button>
        </div>

        {state.loading && <p style={s.stateText}>Loading transaction details…</p>}

        {!state.loading && state.error && (
          <div role="alert" style={s.error}><span>{state.error}</span></div>
        )}

        {transaction && (
          <>
            <div className="tm-detail-grid">
              <Detail label="Type" value={transaction.typeLabel || transaction.type} />
              <Detail label="Amount" value={money(transaction.amount, transaction.currency)} />
              <Detail label="Currency" value={transaction.currency} />
              <Detail label="Status" value={transaction.statusLabel || transaction.status} />
              <Detail label="Created" value={dateTime(transaction.createdAt)} />
              <Detail label="Last updated" value={dateTime(transaction.updatedAt)} />
              {transaction.paymentMethod && <Detail label="Payment method" value={transaction.paymentMethod} />}
              {transaction.relatedReference && <Detail label="Related reference" value={transaction.relatedReference} />}
              {transaction.withdrawal && <Detail label="Account" value={`${transaction.withdrawal.accountName || '—'} ${transaction.withdrawal.accountNumberMasked || ''}`} />}
              {transaction.investment?.planName && <Detail label="Investment plan" value={transaction.investment.planName} />}
            </div>

            {transaction.description && (
              <div style={s.note}>
                <span style={s.noteLabel}>Description</span>
                <p style={s.noteText}>{transaction.description}</p>
              </div>
            )}

            <h3 style={s.modalSection}>Status history</h3>
            {transaction.history?.length ? (
              <ol style={s.timeline}>
                {transaction.history.map((entry, index) => (
                  <li key={`${entry.label}-${index}`} style={s.timelineItem}>
                    <span style={s.timelineDot} />
                    <div>
                      <strong style={s.timelineLabel}>{entry.label}</strong>
                      <p style={s.timelineMeta}>{dateTime(entry.at)}{entry.by ? ` · ${entry.by}` : ''}</p>
                      {entry.detail && <p style={s.timelineMeta}>{entry.detail}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p style={s.stateText}>No status changes have been recorded for this transaction.</p>
            )}

            {transaction.ledger?.length > 0 && (
              <>
                <h3 style={s.modalSection}>Wallet movements</h3>
                <div style={s.ledger}>
                  {transaction.ledger.map((entry, index) => (
                    <div key={index} style={s.ledgerRow}>
                      <div>
                        <strong style={s.ledgerAmount}>{money(entry.amount, transaction.currency)}</strong>
                        <p style={s.timelineMeta}>{entry.description || 'Wallet entry'} · {dateTime(entry.createdAt)}</p>
                      </div>
                      <span style={s.ledgerBalance}>Balance {money(entry.balanceAfter, transaction.currency)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <p style={s.legal}>
              This record is read-only. TopMint only changes a transaction status as part of a verified payment or authorized
              adjustment, and every such change is audited.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div style={s.detail}>
      <span style={s.detailLabel}>{label}</span>
      <strong style={s.detailValue}>{value}</strong>
    </div>
  );
}

const s = {
  page: { minHeight: '100vh', background: '#f5f7f6', color: '#14211d', fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '26px clamp(16px, 4vw, 40px) 56px', boxSizing: 'border-box' },
  eyebrow: { fontSize: 10, fontWeight: 800, letterSpacing: 1.6, color: '#38815c', margin: '22px 0 8px' },
  titleRow: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 22 },
  title: { fontSize: 'clamp(28px, 5vw, 40px)', letterSpacing: -1.4, margin: 0, fontWeight: 850 },
  sub: { color: '#718078', fontSize: 13, margin: '8px 0 0', lineHeight: 1.6, maxWidth: 620 },
  card: { background: '#fff', border: '1px solid #e5ece7', borderRadius: 18, padding: '18px 20px', marginBottom: 18 },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  formFooter: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', borderTop: '1px solid #f0f3f1', paddingTop: 14 },
  formButtons: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#7d8c84' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #dce5df', borderRadius: 10, background: '#fbfcfb', fontSize: 13, color: '#172c21', minWidth: 0 },
  primary: { border: 0, borderRadius: 10, background: '#174f39', color: '#fff', fontWeight: 750, fontSize: 12, padding: '11px 16px', cursor: 'pointer' },
  secondary: { border: '1px solid #dce5df', borderRadius: 10, background: '#fff', color: '#1f4a38', fontWeight: 700, fontSize: 12, padding: '10px 14px', cursor: 'pointer' },
  error: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: '#fff4df', color: '#855d16', padding: 13, borderRadius: 12, marginBottom: 16, fontSize: 12 },
  errorButton: { border: 0, background: 'transparent', textDecoration: 'underline', color: 'inherit', fontWeight: 700, cursor: 'pointer' },
  inlineError: { margin: 0, fontSize: 12, color: '#a52020' },
  listHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 },
  sectionTitle: { fontSize: 17, fontWeight: 800, margin: 0, letterSpacing: -0.3 },
  summary: { fontSize: 11, color: '#7b8981', margin: 0 },
  state: { padding: '30px 10px', textAlign: 'center', color: '#78877f' },
  stateTitle: { display: 'block', fontSize: 14, color: '#20352b', marginBottom: 6 },
  stateText: { fontSize: 12, lineHeight: 1.7, margin: '0 0 14px', color: '#74847d' },
  skeleton: { height: 46, borderRadius: 12, background: 'linear-gradient(90deg, #f2f5f3 25%, #e9efeb 37%, #f2f5f3 63%)', backgroundSize: '400% 100%', marginBottom: 8 },
  cell: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, fontSize: 12, minWidth: 0 },
  truncate: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' },
  amount: { fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' },
  pill: { fontSize: 9, fontWeight: 800, letterSpacing: 0.5, padding: '3px 7px', borderRadius: 20, whiteSpace: 'nowrap' },
  pagerText: { fontSize: 11, color: '#7b8981', margin: 0 },
  pagerButtons: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  foot: { fontSize: 10, color: '#8b9891', textAlign: 'center', margin: '6px 0 0' },
  modalHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 },
  modalTitle: { fontSize: 18, margin: '4px 0 16px', fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' },
  close: { border: '1px solid #dce5df', background: '#fff', borderRadius: 10, width: 34, height: 34, cursor: 'pointer', fontSize: 14, color: '#4b6157' },
  detail: { padding: '11px 0', borderBottom: '1px solid #f0f3f1', minWidth: 0 },
  detailLabel: { display: 'block', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#8a9992', marginBottom: 4 },
  detailValue: { fontSize: 13, wordBreak: 'break-word' },
  note: { background: '#f6faf7', borderRadius: 12, padding: 13, marginTop: 16 },
  noteLabel: { fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#7d8c84', fontWeight: 800 },
  noteText: { fontSize: 12, lineHeight: 1.7, margin: '6px 0 0', color: '#40514a' },
  modalSection: { fontSize: 13, margin: '22px 0 10px', fontWeight: 800, letterSpacing: -0.2 },
  timeline: { listStyle: 'none', margin: 0, padding: 0 },
  timelineItem: { display: 'flex', gap: 10, padding: '8px 0' },
  timelineDot: { width: 8, height: 8, borderRadius: 10, background: '#2b8b61', marginTop: 6, flexShrink: 0 },
  timelineLabel: { fontSize: 12, display: 'block' },
  timelineMeta: { fontSize: 10, color: '#7b8981', margin: '3px 0 0' },
  ledger: { border: '1px solid #eef2ef', borderRadius: 12, overflow: 'hidden' },
  ledgerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '11px 13px', borderBottom: '1px solid #f3f6f4' },
  ledgerAmount: { fontSize: 12 },
  ledgerBalance: { fontSize: 11, color: '#5d6b64' },
  legal: { fontSize: 10, lineHeight: 1.7, color: '#8b9891', margin: '20px 0 0' },
};
