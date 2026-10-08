import { useState, useContext } from 'react';
import Link from 'next/link';
import { themeContext } from '../../providers/ThemeProvider';
import { useRouter } from 'next/router';
import Head from 'next/head';

const Signup = () => {
  const [passwordShow, setPasswordShow] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const router = useRouter();
  const { registerFromPath } = useContext(themeContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrMsg('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) {\n        const messages = {\n          DATABASE_CONFIG_ERROR: 'Account service is not connected to the database yet. Please try again shortly.',\n          DATABASE_SCHEMA_MISMATCH: 'The account database needs its latest migration. Please try again after deployment finishes.',\n          DATABASE_CONNECTION_ERROR: 'The account database is temporarily unavailable. Please try again shortly.',\n          AUTH_CONFIG_ERROR: 'Account authentication is not configured correctly. Please contact support.',\n          ACCOUNT_EXISTS: 'An account already exists with this email.',\n          VALIDATION_ERROR: 'Please enter a valid name, email and password of at least 8 characters.',\n        };\n        throw new Error(messages[data.code] || data.error || 'Unable to create your account.');\n      }
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
      <Head><title>Sign up</title><meta property='og:title' content='Sign up' /></Head>
      <div className='leftSide'>
        <video src='signup_vid2.mp4' autoPlay loop muted />
        <div className='overlay'><h2>&quot;When it rains gold, <br /> put out the bucket, <br /> not the thimble.&quot;</h2><p><span>--</span> Warren Buffett <span>--</span></p></div>
      </div>
      <div className='righside'>
        <form onSubmit={handleSubmit}>
          <Link href='/' className='topsignuplink'><img src='/topmintLogo.png' alt='logo' /></Link>
          <h1>Sign Up with Email</h1>
          <div className='inputcontainer'>
            <div className='inputCntn'>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type='email' placeholder='Email' required />
              <span><i className='icofont-ui-email' /></span>
            </div>
            <div className='inputCntn'>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} type='text' placeholder='Fullname' required />
              <span><i className='icofont-ui-user' /></span>
            </div>
            <div className='passcntn'>
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} type={passwordShow ? 'text' : 'password'} placeholder='Password (8+ characters)' minLength={8} required />
              <button type='button' onClick={() => setPasswordShow((v) => !v)}><i className={`icofont-eye-${!passwordShow ? 'alt' : 'blocked'}`} /></button>
            </div>
            {errMsg && <p className='errorMsg'>{errMsg}</p>}
            <label className='form-control2'><input type='checkbox' required /> I agree to all terms and conditions of TopMint.</label>
            <button type='submit' className='fancyBtn' disabled={loading}>{loading ? 'Creating Account...' : 'Create an Account'}</button>
          </div>
          <p className='haveanaccount'>Have an account? <Link href='/signin'>Sign In</Link></p>
        </form>
      </div>
    </div>
  );
};

export default Signup;
