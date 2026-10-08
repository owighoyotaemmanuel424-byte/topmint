import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function SigninAdmin() {
  const [form,setForm]=useState({email:'',password:''});
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const router=useRouter();
  const submit=async(e)=>{
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const r=await fetch('/api/admin/signin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
      const d=await r.json(); if(!r.ok) throw new Error(d.error||'Unable to sign in.');
      localStorage.setItem('activeAdmin',JSON.stringify(d.admin)); router.push('/dashboard_admin');
    } catch(e){setError(e.message)} finally{setLoading(false)}
  };
  return <div className='signupCntn'><Head><title>Sign In - Admin</title></Head><div className='leftSide'><video src='signup_vid2.mp4' autoPlay loop muted/><div className='overlay'><h2>&quot;You have the power -<br/>Take charge.&quot;</h2><p><span>--</span> TopMint Admin <span>--</span></p></div></div><div className='righside'><form onSubmit={submit}><Link href='/' className='topsignuplink'><img src='/topmintLogo.png' alt='logo'/></Link><h1>Admin Sign In</h1><div className='inputcontainer'><div className='inputCntn'><input type='email' placeholder='Admin email' required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></div><div className='passcntn'><input type='password' placeholder='Password' required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></div>{error&&<p className='errorMsg'>{error}</p>}<button className='fancyBtn' disabled={loading}>{loading?'Signing In...':'Sign In'}</button></div><p className='haveanaccount'><Link href='/signin'>Customer sign in</Link></p></form></div></div>
}
