import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { requireCustomerAuth } from '../lib/page-auth';
import { requestJson, apiErrorMessage } from '../lib/api-client';

// Server-side guard: a request without a valid session cookie is redirected
// before any of this page's markup is rendered.
export async function getServerSideProps(context) {
  return requireCustomerAuth(context);
}

export default function Profile() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const router = useRouter();

  useEffect(() => {
    requestJson('/api/auth/me')
      .then((result) => {
        if (!result.ok) throw new Error('Session expired');
        setUser(result.data.user);
      })
      .catch(() => router.replace('/signin'))
      .finally(() => setLoading(false));
  }, [router]);

  const signout = async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    sessionStorage.removeItem('activeUser');
    router.push('/signin');
  };

  // Changing the password is recorded in the audit log and produces a security
  // notification on the account, so there is a permanent trail for it.
  const changePassword = async (event) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordNotice('');
    setSavingPassword(true);
    try {
      const result = await requestJson('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwords),
      });
      if (!result.ok) throw new Error(apiErrorMessage(result, 'Unable to change your password.'));
      setPasswords({ currentPassword: '', newPassword: '' });
      setPasswordNotice('Your password has been changed. A security notification has been added to your account.');
    } catch (error) {
      setPasswordError(error.message);
    } finally {
      setSavingPassword(false);
    }
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
          <h2 style={styles.balance}>{new Intl.NumberFormat('en-US', { style: 'currency', currency: user.wallet?.currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(balance)}</h2>
          <p style={styles.caption}>Available wallet balance</p>
        </section>
        <section style={styles.account}>
          <h2 style={styles.sectionTitle}>Account</h2>
          <p style={styles.detail}><span>Status</span><strong>{user.status}</strong></p>
          <p style={styles.detail}><span>Member since</span><strong>{new Date(user.createdAt).toLocaleDateString()}</strong></p>
        </section>
        <section style={styles.account}>
          <h2 style={styles.sectionTitle}>Security</h2>
          <form onSubmit={changePassword} style={styles.form}>
            <label style={styles.fieldLabel}>
              Current password
              <input
                style={styles.input}
                type="password"
                autoComplete="current-password"
                required
                value={passwords.currentPassword}
                onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })}
              />
            </label>
            <label style={styles.fieldLabel}>
              New password (8+ characters)
              <input
                style={styles.input}
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={passwords.newPassword}
                onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })}
              />
            </label>
            {passwordError && <p role="alert" style={styles.formError}>{passwordError}</p>}
            {passwordNotice && <p role="status" style={styles.formNotice}>{passwordNotice}</p>}
            <button type="submit" style={styles.saveButton} disabled={savingPassword}>
              {savingPassword ? 'Saving…' : 'Change password'}
            </button>
          </form>
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
  form: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, marginTop: 16 },
  fieldLabel: { display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12, fontWeight: 700, color: '#cbd5e1' },
  input: { boxSizing: 'border-box', width: '100%', padding: '12px 13px', borderRadius: 10, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc', fontSize: 14 },
  formError: { margin: 0, fontSize: 12, color: '#fca5a5' },
  formNotice: { margin: 0, fontSize: 12, color: '#86efac', lineHeight: 1.6 },
  saveButton: { alignSelf: 'flex-start', border: 0, borderRadius: 10, padding: '12px 18px', background: '#166534', color: '#f8fafc', fontWeight: 700, cursor: 'pointer' },
};
