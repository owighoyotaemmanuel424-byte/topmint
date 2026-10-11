import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { requireCustomerAuth } from '../lib/page-auth';
import { requestJson, apiErrorMessage } from '../lib/api-client';

export async function getServerSideProps(context) { return requireCustomerAuth(context); }
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));
const date = n => n ? new Date(n).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}) : '—';
const status = n => ({COMPLETED:'Successful',PENDING:'Pending',PROCESSING:'Processing',FAILED:'Failed',CANCELLED:'Cancelled'}[n]||n||'Unknown');

export default function Deposit() {
 const router=useRouter(), [amount,setAmount]=useState(''), [deposits,setDeposits]=useState([]), [loading,setLoading]=useState(true), [busy,setBusy]=useState(false), [activeId,setActiveId]=useState(''), [message,setMessage]=useState(''), [error,setError]=useState('');
 const load=useCallback(async()=>{setLoading(true);try{const r=await requestJson('/api/deposits');if(!r.ok)throw Error(apiErrorMessage(r,'Unable to load deposit history.'));setDeposits(r.data.deposits||[]);}catch(e){setError(e.message||'Unable to load deposit history.');}finally{setLoading(false);}},[]);
 useEffect(()=>{load();},[load]);
 const submit=async e=>{e.preventDefault();setBusy(true);setMessage('');setError('');try{const n=Number(amount);if(!Number.isFinite(n)||n<0.01||n>100000000)throw Error('Enter an amount between $0.01 and $100,000,000.00.');const r=await requestJson('/api/deposits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:n.toFixed(2),paymentMethod:'MANUAL'})});if(!r.ok)throw Error(apiErrorMessage(r,'Deposit request failed.'));setMessage('Request '+r.data.reference+' created. It remains pending until an administrator verifies receipt of your payment. Your wallet has not been credited.');setAmount('');await load();}catch(e){setError(e.message||'Unable to create the deposit request.');}finally{setBusy(false);}};
 const cancel=async d=>{const ref=d.transaction?.reference||d.id;if(!window.confirm('Cancel pending deposit '+ref+'? No funds will be credited.'))return;setActiveId(d.id);setMessage('');setError('');try{const r=await requestJson('/api/deposits/'+encodeURIComponent(d.id),{method:'PATCH'});if(!r.ok)throw Error(apiErrorMessage(r,'Unable to cancel this deposit.'));setMessage('Deposit '+ref+' was cancelled.');await load();}catch(e){setError(e.message||'Unable to cancel this deposit.');}finally{setActiveId('');}};
 return <><Head><title>Add funds | TopMint</title><meta name="viewport" content="width=device-width, initial-scale=1"/></Head><main style={s.page} className="tm-deposit-page">
 <header style={s.header}><Link href="/dashboard" style={s.brand}><b style={s.mark}>T</b> topmint</Link><div style={s.actions}><Link href="/transactions" style={s.link}>Transaction history</Link><button style={s.back} onClick={()=>router.push('/dashboard')}>← Dashboard</button></div></header>
 <section style={s.wrap}><p style={s.eyebrow}>YOUR WALLET</p><h1 style={s.title}>Add funds</h1><p style={s.sub}>Create and track a deposit request in US dollars.</p>
 <div style={s.notice}><strong>Manual payment verification</strong><span>Automatic card or bank processing is not configured. Use only official payment details supplied by TopMint support or your administrator. Your wallet is credited only after payment is independently verified.</span></div>
 {message&&<p role="status" style={s.success}>{message}</p>}{error&&<p role="alert" style={s.error}>{error}</p>}
 <section style={s.card}><h2 style={s.cardTitle}>New deposit request</h2><p style={s.help}>Creating a request does not move money or credit your wallet.</p><form onSubmit={submit}>
 <label style={s.label} htmlFor="deposit-amount">Amount (USD)</label><div style={s.amount}><span>$</span><input id="deposit-amount" style={s.input} type="number" min="0.01" max="100000000" step="0.01" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" required/></div>
 <div style={s.quick}>{['25','50','100','250'].map(v=><button type="button" key={v} onClick={()=>setAmount(v)}>{'$'+v}</button>)}</div>
 <label style={s.label} htmlFor="method">Payment method</label><select id="method" style={s.select} disabled value="MANUAL"><option value="MANUAL">Manual transfer — verification required</option></select>
 <div style={s.instructions}><strong>Payment instructions</strong><p>Use only official payment details supplied by TopMint. Keep the generated deposit reference and submit proof of payment through the official support channel. Never send funds to an account supplied by an unverified person.</p></div>
 <button style={s.submit} disabled={busy||!amount}>{busy?'Creating request…':'Create pending request →'}</button></form></section>
 <section style={s.history}><div style={s.historyHead}><div><p style={s.eyebrow}>YOUR ACTIVITY</p><h2 style={s.historyTitle}>Deposit history</h2></div><button style={s.back} onClick={load} disabled={loading}>{loading?'Loading…':'Refresh'}</button></div>
 {loading?<div style={s.empty}>Loading your deposit history…</div>:!deposits.length?<div style={s.empty}><strong>No deposit requests yet</strong><p>Your deposit references and statuses appear here.</p></div>:<div style={s.list}>{deposits.map(d=>{const t=d.transaction||{},pending=d.status==='PENDING'&&t.status==='PENDING';return <article key={d.id} style={s.row}><div style={s.rowHead}><div style={{minWidth:0,flex:1}}><strong style={s.ref}>{t.reference||'Deposit request'}</strong><small style={s.date}>{date(d.createdAt)}</small></div><span style={{...s.badge,...(d.status==='COMPLETED'?s.done:d.status==='PENDING'?s.wait:d.status==='CANCELLED'?s.cancelled:s.failed)}}>{status(d.status)}</span></div><div style={s.rowBottom}><strong style={s.value}>{money(d.amount)}</strong><span style={s.method}>{d.provider==='MANUAL'?'Manual verification':(d.provider||'Payment provider')}</span></div>{pending&&<div style={s.pending}><p>Awaiting verification. Your wallet has not been credited.</p><button style={s.cancel} disabled={activeId===d.id} onClick={()=>cancel(d)}>{activeId===d.id?'Cancelling…':'Cancel request'}</button></div>}{d.providerRef&&<p style={s.date}>Payment reference: {d.providerRef}</p>}</article>;})}</div>}
 </section><p style={s.foot}>TopMint · USD wallet · Keep your deposit reference for support enquiries.</p></section></main></>;
}
const s={
 page:{minHeight:'100vh',background:'#f5f7f6',color:'#14211d',fontFamily:'Inter,system-ui,sans-serif',padding:'0 20px 56px'},
 header:{maxWidth:1080,margin:'auto',minHeight:76,display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,borderBottom:'1px solid #e3ebe5'},
 brand:{display:'flex',alignItems:'center',gap:10,textDecoration:'none',color:'#153d2c',fontSize:21,fontWeight:850},
 mark:{width:36,height:36,borderRadius:12,background:'#b8f36b',display:'inline-flex',alignItems:'center',justifyContent:'center',color:'#10291f'},
 actions:{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',justifyContent:'flex-end'},
 link:{fontSize:12,fontWeight:750,color:'#286342',textDecoration:'none'},
 back:{border:'1px solid #dce5df',background:'#fff',borderRadius:10,padding:'10px 13px',fontWeight:700,color:'#214a35'},
 wrap:{maxWidth:760,margin:'38px auto 0'},
 eyebrow:{fontSize:10,fontWeight:850,letterSpacing:1.7,color:'#38815c',margin:'0 0 8px'},
 title:{fontSize:'clamp(30px,6vw,42px)',letterSpacing:-1.5,margin:'8px 0'},
 sub:{color:'#718078',fontSize:14,margin:'0 0 22px',lineHeight:1.6},
 notice:{display:'grid',gap:6,background:'#fff8e9',border:'1px solid #f0dfb6',borderRadius:14,padding:16,color:'#755523',fontSize:12,lineHeight:1.7,marginBottom:16},
 success:{background:'#e8f7ec',color:'#24633d',padding:13,borderRadius:10,fontSize:12,lineHeight:1.6,overflowWrap:'anywhere'},
 error:{background:'#fff0ed',color:'#9c3e36',padding:13,borderRadius:10,fontSize:12,lineHeight:1.6,overflowWrap:'anywhere'},
 card:{background:'#fff',border:'1px solid #e5ece7',borderRadius:22,padding:'clamp(20px,5vw,32px)',boxShadow:'0 18px 50px #1135250d'},
 cardTitle:{fontSize:21,margin:'0 0 8px'},
 help:{fontSize:12,lineHeight:1.7,color:'#748178',margin:'0 0 20px'},
 label:{display:'block',fontSize:12,fontWeight:800,margin:'16px 0 9px',color:'#324b3c'},
 amount:{display:'flex',alignItems:'center',gap:10,border:'1px solid #dbe5de',borderRadius:12,padding:'0 14px',background:'#fbfcfb'},
 'amount span':{fontSize:22,fontWeight:800,color:'#37654d'},
 input:{border:0,outline:0,background:'transparent',width:'100%',padding:'15px 0',fontSize:24,fontWeight:750,color:'#172c21',minWidth:0},
 quick:{display:'flex',gap:8,flexWrap:'wrap',margin:'12px 0 8px'},
 'quick button':{border:'1px solid #dce8df',background:'#f7faf7',color:'#286544',borderRadius:9,padding:'8px 13px',fontWeight:750},
 select:{width:'100%',boxSizing:'border-box',border:'1px solid #dbe5de',borderRadius:11,padding:13,background:'#f8faf8',color:'#314b3b',font:'inherit',fontSize:13},
 instructions:{margin:'18px 0',padding:15,borderRadius:12,background:'#f6faf5',border:'1px solid #e3eee4',fontSize:12,lineHeight:1.7,color:'#53675a'},
 submit:{width:'100%',border:0,borderRadius:12,padding:15,background:'#174f39',color:'#fff',fontWeight:850,cursor:'pointer'},
 history:{marginTop:34},historyHead:{display:'flex',justifyContent:'space-between',alignItems:'end',gap:12,marginBottom:14},historyTitle:{fontSize:23,letterSpacing:-.6,margin:0},
 empty:{background:'#fff',border:'1px dashed #dce6df',borderRadius:16,padding:25,textAlign:'center',color:'#718078',fontSize:13,lineHeight:1.6},
 list:{display:'grid',gap:12},row:{background:'#fff',border:'1px solid #e1e9e3',borderRadius:16,padding:'17px clamp(14px,3vw,22px)',minWidth:0},
 rowHead:{display:'flex',alignItems:'center',gap:11},ref:{display:'block',fontSize:13,overflowWrap:'anywhere'},date:{display:'block',fontSize:10,color:'#87948c',marginTop:5,overflowWrap:'anywhere'},
 badge:{fontSize:9,fontWeight:850,letterSpacing:.4,padding:'7px 9px',borderRadius:99,flexShrink:0},done:{color:'#21633d',background:'#e4f6e9'},wait:{color:'#865a10',background:'#fff1cd'},cancelled:{color:'#596579',background:'#edf0f5'},failed:{color:'#973c35',background:'#ffebe8'},
 rowBottom:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,margin:'16px 0 0',flexWrap:'wrap'},value:{fontSize:22,letterSpacing:-.5},method:{fontSize:11,color:'#718078'},
 pending:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',borderTop:'1px solid #edf1ed',marginTop:15,paddingTop:13},'pending p':{fontSize:11,color:'#8a661d',lineHeight:1.5,margin:0,flex:'1 1 220px'},
 cancel:{border:'1px solid #f0cbc7',background:'#fff',color:'#a13d36',borderRadius:9,padding:'9px 12px',fontSize:11,fontWeight:800},
 foot:{textAlign:'center',fontSize:10,color:'#87948c',marginTop:24,lineHeight:1.6}
};