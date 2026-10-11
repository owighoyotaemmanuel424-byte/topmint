import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { requestJson, apiErrorMessage } from '../lib/api-client';

export default function DashboardAdmin(){
 const [data,setData]=useState(null); const [error,setError]=useState(''); const router=useRouter();
 useEffect(()=>{requestJson('/api/admin/overview').then(r=>{if(!r.ok)throw new Error(apiErrorMessage(r,'Unauthorized'));setData(r.data)}).catch(()=>router.replace('/signin_admin'))},[router]);
 const logout=async()=>{await fetch('/api/admin/signout',{method:'POST'});localStorage.removeItem('activeAdmin');router.push('/signin_admin')};
 if(!data)return <main style={{padding:40}}><h2>Loading admin dashboard...</h2></main>;
 return <><Head><title>TopMint Admin</title></Head><main style={{padding:'32px',maxWidth:1100,margin:'0 auto'}}><header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><h1>TopMint Admin</h1><p>Neon-powered operations dashboard</p></div><nav style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}><button onClick={()=>router.push('/admin_transactions')}>Pending reviews</button><button onClick={()=>router.push('/admin/deposits')}>Deposit review</button><button onClick={()=>router.push('/admin/withdrawals')}>Withdrawal operations</button><button onClick={()=>router.push('/admin/notifications')}>Announcements</button><button onClick={()=>router.push('/admin_users')}>Customers</button><button onClick={logout}>Sign out</button></nav></header><section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:16,marginTop:30}}>{[['Users',data.counts.users],['Investments',data.counts.investments],['Withdrawals',data.counts.withdrawals],['Pending withdrawals',data.counts.pendingWithdrawals],['Pending deposits',data.counts.pendingDeposits ?? 0]].map(([label,value])=><article key={label} style={{padding:24,borderRadius:16,background:'#f5f5f5'}}><p>{label}</p><h2>{value}</h2></article>)}</section><section style={{marginTop:30}}><h2>System</h2><p>Database: Neon PostgreSQL</p><p>Authentication: secure HTTP-only JWT cookies</p></section></main></>
}
