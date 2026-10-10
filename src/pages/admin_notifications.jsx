import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { requestJson, apiErrorMessage } from '../lib/api-client';

const dateTime = value => (value ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

// Delivery channels the deployment actually supports. If email or SMS is not
// configured, the screen says so instead of implying a message was sent.
function deliveryLabel(status) {
  if (status === 'delivered') return 'Delivered';
  if (status === 'not_configured') return 'Not configured';
  return 'Unknown';
}

export default function AdminNotifications() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ title: '', message: '', audience: 'ACTIVE', link: '' });
  const [publishing, setPublishing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const result = await requestJson('/api/admin/notifications');
    if ([401, 403].includes(result.status)) {
      router.replace('/signin_admin');
      return;
    }
    if (!result.ok) {
      setError(apiErrorMessage(result, 'Unable to load announcements right now.'));
      setLoading(false);
      return;
    }
    setData(result.data);
    setLoading(false);
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const publish = async event => {
    event.preventDefault();
    if (!confirming) {
      setConfirming(true);
      setNotice('');
      return;
    }
    setPublishing(true);
    setError('');
    setNotice('');
    try {
      const result = await requestJson('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          message: form.message,
          audience: form.audience,
          link: form.link ? form.link : undefined,
        }),
      });
      if (!result.ok) throw new Error(apiErrorMessage(result, 'Unable to publish the announcement.'));
      const { created = 0, skipped = 0, recipients = 0 } = result.data || {};
      setNotice(
        `Announcement recorded for ${created} of ${recipients} customers${skipped ? ` — ${skipped} already had this exact announcement and were skipped` : ''}. ` +
          'Delivery was in-app only; email and SMS are not configured on this deployment.',
      );
      setForm({ title: '', message: '', audience: form.audience, link: '' });
      setConfirming(false);
      await load();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setPublishing(false);
    }
  };

  const canPublish = data?.permissions?.canPublish;
  const delivery = data?.delivery;

  return (
    <>
      <Head>
        <title>Announcements | TopMint Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main style={s.page}>
        <header style={s.header}>
          <div>
            <p style={s.eyebrow}>ADMINISTRATION</p>
            <h1 style={s.title}>Announcements</h1>
            <p style={s.sub}>Send a platform-wide notification to customers and review what has been published.</p>
          </div>
          <div style={s.headerActions}>
            <button type="button" style={s.secondary} onClick={() => router.push('/admin_transactions')}>Pending reviews</button>
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
          <h2 style={s.sectionTitle}>Publish an announcement</h2>
          {loading ? (
            <p style={s.muted}>Loading your permissions…</p>
          ) : canPublish ? (
            <form onSubmit={publish} style={s.form}>
              <label style={s.field}>
                <span style={s.label}>Title</span>
                <input
                  style={s.input}
                  value={form.title}
                  onChange={event => { setForm({ ...form, title: event.target.value }); setConfirming(false); }}
                  minLength={3}
                  maxLength={160}
                  required
                  placeholder="Scheduled maintenance on Sunday"
                />
              </label>
              <label style={s.field}>
                <span style={s.label}>Message</span>
                <textarea
                  style={{ ...s.input, minHeight: 96, resize: 'vertical', fontFamily: 'inherit' }}
                  value={form.message}
                  onChange={event => { setForm({ ...form, message: event.target.value }); setConfirming(false); }}
                  minLength={3}
                  maxLength={1000}
                  required
                  placeholder="Explain what is changing and what customers need to do."
                />
              </label>
              <div style={s.row}>
                <label style={s.field}>
                  <span style={s.label}>Audience</span>
                  <select style={s.input} value={form.audience} onChange={event => { setForm({ ...form, audience: event.target.value }); setConfirming(false); }}>
                    <option value="ACTIVE">Active customers</option>
                    <option value="ALL">All customers</option>
                  </select>
                </label>
                <label style={s.field}>
                  <span style={s.label}>Link (optional)</span>
                  <input
                    style={s.input}
                    value={form.link}
                    onChange={event => { setForm({ ...form, link: event.target.value }); setConfirming(false); }}
                    maxLength={200}
                    placeholder="/dashboard"
                  />
                </label>
              </div>

              <div style={s.preview}>
                <span style={s.previewTag}>Preview</span>
                <strong style={s.previewTitle}>{form.title || 'Announcement title'}</strong>
                <p style={s.previewMessage}>{form.message || 'Your announcement message will appear here.'}</p>
              </div>

              <div style={s.actions}>
                <button type="submit" style={confirming ? s.danger : s.primary} disabled={publishing}>
                  {publishing ? 'Publishing…' : confirming ? 'Confirm and publish to selected audience' : 'Publish announcement'}
                </button>
                {confirming && (
                  <button
                    type="button"
                    style={s.secondary}
                    onClick={() => { setConfirming(false); setNotice(''); }}
                  >
                    Cancel
                  </button>
                )}
              </div>
              <p style={s.hint}>
                Publishing the same title and message again does not re-notify anyone: each announcement is stored once per
                customer using a content fingerprint.
              </p>
            </form>
          ) : (
            <p style={s.muted}>
              Your administrator role ({data?.permissions?.role || 'read-only'}) can review announcements but cannot publish
              them. A Super Admin or Admin role is required.
            </p>
          )}
        </section>

        <section style={s.card}>
          <div style={s.cardHead}>
            <h2 style={s.sectionTitle}>Delivery status</h2>
            <span style={s.muted}>In-app notifications are stored in PostgreSQL.</span>
          </div>
          <div style={s.deliveryGrid}>
            <div style={s.deliveryCell}>
              <span style={s.label}>In-app</span>
              <strong style={{ ...s.badge, ...(delivery?.inApp === 'delivered' ? s.badgeOk : s.badgeOff) }}>
                {deliveryLabel(delivery?.inApp)}
              </strong>
            </div>
            <div style={s.deliveryCell}>
              <span style={s.label}>Email</span>
              <strong style={{ ...s.badge, ...s.badgeOff }}>{deliveryLabel(delivery?.email)}</strong>
            </div>
            <div style={s.deliveryCell}>
              <span style={s.label}>SMS</span>
              <strong style={{ ...s.badge, ...s.badgeOff }}>{deliveryLabel(delivery?.sms)}</strong>
            </div>
          </div>
          <p style={s.hint}>
            No email or SMS provider is configured, so nothing is sent outside the platform. These statuses report that
            truthfully rather than implying an external message was delivered.
          </p>
        </section>

        <section style={s.card}>
          <div style={s.cardHead}>
            <h2 style={s.sectionTitle}>Published announcements</h2>
            <span style={s.muted}>
              {data?.stats ? `${data.stats.announcements} announcements · ${data.stats.notifications} notifications stored · ${data.stats.unread} unread` : ''}
            </span>
          </div>
          {loading ? (
            <p style={s.muted}>Loading announcements…</p>
          ) : data?.announcements?.length ? (
            data.announcements.map(item => (
              <article key={item.eventKey} style={s.announcement}>
                <div style={s.announcementHead}>
                  <strong style={s.announcementTitle}>{item.title}</strong>
                  <span style={s.recipients}>{item.recipients} recipient{item.recipients === 1 ? '' : 's'}</span>
                </div>
                <p style={s.announcementMessage}>{item.message}</p>
                <small style={s.announcementMeta}>
                  Published {dateTime(item.createdAt)}{item.link ? ` · links to ${item.link}` : ''}
                </small>
              </article>
            ))
          ) : (
            <p style={s.muted}>No announcements have been published yet.</p>
          )}
        </section>
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
  sub: { fontSize: 13, color: '#718078', margin: '8px 0 0', maxWidth: 620, lineHeight: 1.6 },
  card: { background: '#fff', border: '1px solid #e5ece7', borderRadius: 18, padding: '20px 22px', marginBottom: 18 },
  cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 },
  sectionTitle: { fontSize: 17, fontWeight: 800, margin: 0, letterSpacing: -0.3 },
  form: { display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 7 },
  label: { fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#7d8c84' },
  input: { boxSizing: 'border-box', width: '100%', padding: '11px 13px', border: '1px solid #dce5df', borderRadius: 10, background: '#fbfcfb', fontSize: 13, color: '#172c21' },
  preview: { border: '1px dashed #cfe0d5', background: '#f7fbf8', borderRadius: 12, padding: 14 },
  previewTag: { fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#38815c' },
  previewTitle: { display: 'block', fontSize: 13, margin: '7px 0 5px' },
  previewMessage: { fontSize: 12, lineHeight: 1.7, color: '#55655c', margin: 0 },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  primary: { border: 0, borderRadius: 10, background: '#174f39', color: '#fff', fontWeight: 750, fontSize: 12, padding: '12px 17px', cursor: 'pointer' },
  danger: { border: 0, borderRadius: 10, background: '#a52020', color: '#fff', fontWeight: 750, fontSize: 12, padding: '12px 17px', cursor: 'pointer' },
  secondary: { border: '1px solid #dce5df', borderRadius: 10, background: '#fff', color: '#1f4a38', fontWeight: 700, fontSize: 12, padding: '11px 15px', cursor: 'pointer' },
  hint: { fontSize: 11, lineHeight: 1.7, color: '#7b8981', margin: 0 },
  muted: { fontSize: 12, color: '#7b8981', lineHeight: 1.7, margin: 0 },
  error: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: '#fff4df', color: '#855d16', padding: 13, borderRadius: 12, marginBottom: 14, fontSize: 12 },
  errorButton: { border: 0, background: 'transparent', textDecoration: 'underline', color: 'inherit', fontWeight: 700, cursor: 'pointer' },
  notice: { background: '#e9f6ee', color: '#1f5f43', padding: 13, borderRadius: 12, fontSize: 12, lineHeight: 1.7, margin: '0 0 16px' },
  deliveryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 12 },
  deliveryCell: { display: 'flex', flexDirection: 'column', gap: 8 },
  badge: { display: 'inline-block', alignSelf: 'flex-start', fontSize: 11, fontWeight: 800, borderRadius: 20, padding: '5px 10px' },
  badgeOk: { background: '#e2f4e7', color: '#1c6b46' },
  badgeOff: { background: '#f1f3f2', color: '#6b7770' },
  announcement: { padding: '15px 0', borderBottom: '1px solid #f0f3f1' },
  announcementHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  announcementTitle: { fontSize: 13 },
  recipients: { fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: '#1c6b46', background: '#e2f4e7', borderRadius: 20, padding: '3px 9px' },
  announcementMessage: { fontSize: 12, lineHeight: 1.7, color: '#55655c', margin: '7px 0' },
  announcementMeta: { fontSize: 10, color: '#8a9790' },
};
