import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Profile(){
 const [user,setUser]=useState(null); const [loading,setLoading]=useState(true);
 const router=useRouter();
 useEffect(()=>{fetch('/api/auth/me').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'Session expired');setUser(d.user)}).catch(()=>router.replace('/signin')).finally(()=>setLoading(false))},[router]);
 const signout=async()=>{await fetch('/api/auth/signout',{method:'POST'});sessionStorage.removeItem('activeUser');router.push('/signin')};
 if(loading)return <main style={{padding:40}}><h2>Loading your account...</h2></main>;
 if(!user)return null;
 const balance=Number(user.wallet?.balance||0);
 return <><Head><title>TopMint Account</title></Head><main style={{padding:'32px',maxWidth:900,margin:'0 auto'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:20}}><div><h1>Welcome back, {user.name}</h1><p>{user.email}</p></div><button onClick={signout}>Sign out</button></div><section style={{marginTop:30,padding:24,borderRadius:16,background:'#f5f5f5'}}><h2>Wallet</h2><strong>{user.wallet?.currency||'NGN'} {balance.toLocaleString()}</strong><p>Available wallet balance</p></section><section style={{marginTop:20}}><h2>Account</h2><p>Status: {user.status}</p><p>Member since: {new Date(user.createdAt).toLocaleDateString()}</p></section></main></>
}
