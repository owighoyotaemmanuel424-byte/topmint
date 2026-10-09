import { useState, useContext } from 'react';
import Link from 'next/link';
import { themeContext } from '../../providers/ThemeProvider';
import { useRouter } from 'next/router';
import Head from 'next/head';

const Signin = () => {
  const [passwordShow, setPasswordShow] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });
  const router = useRouter();
  const { registerFromPath } = useContext(themeContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrMsg('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) {
        const messages = {
          DATABASE_CONFIG_ERROR: 'Account service is not connected to the database yet. Please try again shortly.',
          DATABASE_RUNTIME_ERROR: 'Account service is starting up. Please try again in a moment.',
          DATABASE_SCHEMA_MISMATCH: 'The account database needs its latest migration. Please try again after deployment finishes.',
          DATABASE_CONNECTION_ERROR: 'The account database is temporarily unavailable. Please try again shortly.',
          AUTH_CONFIG_ERROR: 'Account authentication is not configured correctly. Please contact support.',
        };
        throw new Error(messages[data.code] || data.error || 'Unable to sign in.');
      }
      sessionStorage.setItem('activeUser', JSON.stringify(data.user));
      e.target.reset();
      router.push(registerFromPath || '/dashboard');
    } catch (error) {
      setErrMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='signupCntn'>
      <Head><title>Sign In</title><meta property='og:title' content='Sign In' /></Head>
      <div className='leftSide'>
        <video src='signup_vid2.mp4' autoPlay loop muted />
        <div className='overlay'><h2>&quot;Look First -<br /> Then Leap.&quot;</h2><p><span>--</span> Alex Hennold <span>--</span></p></div>
      </div>
      <div className='righside'>
        <form onSubmit={handleSubmit}>
          <Link href='/' className='topsignuplink'><img src='/topmintLogo.png' alt='logo' /></Link>
          <h1>Sign In with Email</h1>
          <div className='inputcontainer'>
            <div className='inputCntn'>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type='email' placeholder='Email' required />
              <span><i className='icofont-ui-email' /></span>
            </div>
            <div className='passcntn'>
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} type={passwordShow ? 'text' : 'password'} placeholder='Password' required />
              <button type='button' onClick={() => setPasswordShow((v) => !v)}><i className={`icofont-eye-${!passwordShow ? 'alt' : 'blocked'}`} /></button>
            </div>
            {errMsg && <p className='errorMsg'>{errMsg}</p>}
            <label className='form-control2'><input type='checkbox' required /> Remember me</label>
            <button type='submit' className='fancyBtn' disabled={loading}>{loading ? 'Signing In...' : 'Sign In'}</button>
          </div>
          <p className='haveanaccount'>Are you an admin? <Link href='/signin_admin'>Sign In as admin</Link></p>
          <p className='haveanaccount'>Don&apos;t have an account? <Link href='/signup'>Sign Up</Link></p>
        </form>
      </div>
    </div>
  );
};

export default Signin;
