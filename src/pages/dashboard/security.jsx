import { useEffect, useState } from 'react';
import Head from 'next/head';
import { requireCustomerAuth } from '../../lib/page-auth';
import { requestJson, apiErrorMessage } from '../../lib/api-client';

export async function getServerSideProps(context) { return requireCustomerAuth(context); }

export default function SecurityPage() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [events, setEvents] = useState([]);
  const [security, setSecurity] = useState(null);
  useEffect(() => {
    requestJson('/api/security/activity').then(r => { if (r.ok) { setEvents(r.data.events || []); setSecurity(r.data); } }).catch(() => {});
  }, []);
  async function submit(e) {
    e.preventDefault(); setError(''); setNotice('');
    if (form.newPassword !== form.confirmPassword) { setError('New password and confirmation do not match.'); return; }
    if (form.newPassword.length < 12) { setError('Use at least 12 characters for a stronger password.'); return; }
    setBusy(true);
    try {
      const r = await requestJson('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }) });
      if (!r.ok) throw new Error(apiErrorMessage(r, 'Unable to change password.'));
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); setNotice('Password changed. A security notification has been recorded.');
      const activity = await requestJson('/api/security/activity'); if (activity.ok) { setEvents(activity.data.events || []); setSecurity(activity.data); }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const card = { background: '#0f172a', border: '1px solid #263449', borderRadius: 16, padding: 22, marginTop: 18 };
  const label = { display: 'grid', gap: 7, color: '#cbd5e1', fontSize: 13, marginBottom: 14 };
  const input = { width: '100%', boxSizing: 'border-box', padding: 12, background: '#080f1e', color: '#f8fafc', border: '1px solid #334155', borderRadius: 9 };
  return <><Head><title>Account Security | TopMint</title><meta name="viewport" content="width=device-width, initial-scale=1" /></Head><main style={{ maxWidth: 900, margin: '0 auto', padding: 'clamp(18px,4vw,42px)', minHeight: '100vh', background: '#050816', color: '#f8fafc', fontFamily: 'Inter,Arial,sans-serif' }}>
    <a href="/dashboard" style={{ color: '#86efac' }}>← Dashboard</a><h1 style={{ fontSize: 'clamp(28px,5vw,38px)', marginBottom: 6 }}>Account security</h1><p style={{ color: '#94a3b8' }}>Manage your password and review recorded account security events.</p>
    <section style={card}><h2>Change password</h2><p style={{ color: '#94a3b8', fontSize: 14 }}>Use a unique password of at least 12 characters.</p><form onSubmit={submit}>
    {[['currentPassword','Current password','current-password'],['newPassword','New password','new-password'],['confirmPassword','Confirm new password','new-password']].map(([key,title,auto])=><label key={key} style={label}>{title}<input style={input} type={show?'text':'password'} autoComplete={auto} minLength={key==='currentPassword'?1:12} maxLength={128} required value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
    <button type="button" onClick={()=>setShow(!show)} style={{ background: 'transparent', color: '#86efac', border: 0, padding: '4px 0 16px' }}>{show?'Hide passwords':'Show passwords'}</button>
    {error&&<p role="alert" style={{color:'#fca5a5'}}>{error}</p>}{notice&&<p role="status" style={{color:'#86efac'}}>{notice}</p>}<button disabled={busy} style={{ background:'#166534', color:'white', border:0, borderRadius:9, padding:'12px 18px', fontWeight:700 }}>{busy?'Updating…':'Update password'}</button></form></section>
    <section style={card}><h2>Security overview</h2><p>Email verification: <strong>{security?.emailVerifiedAt ? 'Verified' : 'Not verified / unavailable'}</strong></p><p>Password last changed: <strong>{security?.passwordChangedAt ? new Date(security.passwordChangedAt).toLocaleString() : 'Not recorded'}</strong></p><p>Last login: <strong>{security?.lastLoginAt ? new Date(security.lastLoginAt).toLocaleString() : 'No login activity recorded'}</strong></p></section>
    <section style={card}><h2>Recent security events</h2>{events.length===0?<p style={{color:'#94a3b8'}}>No recorded security events yet.</p>:events.map(ev=><article key={ev.id} style={{padding:'13px 0',borderBottom:'1px solid #263449'}}><strong>{String(ev.action).replaceAll('.',' ').replace(/\b\w/g,c=>c.toUpperCase())}</strong><p style={{color:'#94a3b8',fontSize:13,marginBottom:0}}>{new Date(ev.createdAt).toLocaleString()}</p></article>)}</section>
  </main></>;
}
