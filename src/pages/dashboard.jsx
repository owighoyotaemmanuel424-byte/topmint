import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
const date = value => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const title = value => String(value || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [plans, setPlans] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const endpoints = ['/api/auth/me', '/api/wallet', '/api/transactions?limit=8', '/api/investments', '/api/investments/plans', '/api/notifications'];
      const responses = await Promise.all(endpoints.map(url => fetch(url)));
      const results = await Promise.all(responses.map(async r => ({ ok: r.ok, data: await r.json() })));
      if (!results[0].ok) { router.replace('/signin'); return; }
      if (!results.every(x => x.ok)) throw new Error('Some dashboard information could not be loaded. Please retry.');
      setUser(results[0].data.user);
      setWallet(results[1].data.wallet);
      setTransactions(results[2].data.transactions || []);
      setInvestments(results[3].data.investments || []);
      setPlans(results[4].data.plans || []);
      setNotifications(results[5].data.notifications || []);
    } catch (e) { setError(e.message || 'Unable to load your dashboard.'); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const logout = async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    if (typeof window !== 'undefined') sessionStorage.removeItem('activeUser');
    router.replace('/signin');
  };
  const markRead = async id => {
    const response = await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (response.ok) setNotifications(items => items.map(item => item.id === id ? { ...item, read: true } : item));
  };

  if (loading) return <main style={s.page}><div style={s.loading}><span style={s.brandMark}>T</span><p>Loading your TopMint account…</p></div></main>;
  if (!user) return <main style={s.page}><div style={s.panel}><h2>We couldn&apos;t load your account</h2><p style={s.muted}>{error || 'Your session may have expired.'}</p><button style={s.primary} onClick={load}>Try again</button></div></main>;

  const currency = wallet?.currency || 'USD';
  const unread = notifications.filter(n => !n.read).length;
  const activeInvestments = investments.filter(i => i.status === 'ACTIVE');
  const invested = activeInvestments.reduce((sum, i) => sum + Number(i.principal || 0), 0);

  return <>
    <Head><title>Overview | TopMint</title><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="theme-color" content="#071c18" /></Head>
    <main style={s.page}>
      <aside style={s.sidebar}>
        <Link href="/dashboard" style={s.brand}><span style={s.brandMark}>T</span><span>topmint<small>YOUR MONEY, IN VIEW</small></span></Link>
        <p style={s.navLabel}>WORKSPACE</p>
        <Link style={{...s.navItem,...s.navActive}} href="/dashboard"><span>⌂</span> Overview</Link>
        <Link style={s.navItem} href="/deposit"><span>＋</span> Add funds</Link>
        <Link style={s.navItem} href="/withdraw"><span>↗</span> Withdraw</Link>
        <Link style={s.navItem} href="/investments"><span>◫</span> Investments</Link>
        <Link style={s.navItem} href="/transactions"><span>↔</span> Transactions</Link>
        <Link style={s.navItem} href="/notifications"><span>♧</span> Notifications {unread > 0 && <b style={s.badge}>{unread}</b>}</Link>
        <div style={s.sidebarBottom}><Link style={s.navItem} href="/profile"><span>◎</span> My profile</Link><button onClick={logout} style={s.logout}>↪ Sign out</button><p style={s.secure}>● Secure customer portal</p></div>
      </aside>
      <section style={s.main}>
        <header style={s.topbar}><div><p style={s.kicker}>YOUR FINANCIAL SPACE</p><h1 style={s.pageTitle}>Overview</h1></div><div style={s.userBox}><div style={s.avatar}>{(user.name || user.email || 'T').charAt(0).toUpperCase()}</div><div><strong>{user.name || 'TopMint member'}</strong><small>{user.email}</small></div><button style={s.mobileSignout} onClick={logout}>Sign out</button></div></header>
        {error && <div style={s.alert}><span>{error}</span><button style={s.linkButton} onClick={load}>Retry</button></div>}
        <section style={s.hero}>
          <div style={s.heroGlow} />
          <div style={s.heroContent}><p style={s.heroLabel}>TOTAL AVAILABLE BALANCE <span style={s.live}><i /> LIVE</span></p><h2 style={s.balance}>{money(wallet?.balance, currency)}</h2><p style={s.heroSub}>Your {currency} wallet balance</p><div style={s.heroActions}><button style={s.heroButton} onClick={() => router.push('/deposit')}>＋ Add funds</button><button style={s.heroOutline} onClick={() => router.push('/withdraw')}>Withdraw ↗</button></div></div>
          <div style={s.heroSymbol}>$</div>
          <div style={s.heroFooter}><span>WALLET STATUS</span><strong><i /> Active</strong><span style={{marginLeft:'auto'}}>MEMBER SINCE {date(user.createdAt)}</span></div>
        </section>
        <div style={s.statsGrid}>
          <article style={s.statCard}><div style={s.statTop}><span style={s.statIcon}>↗</span><span style={s.statHint}>Portfolio</span></div><p style={s.statLabel}>Active investments</p><h3>{activeInvestments.length}</h3><p style={s.statFoot}>{money(invested, currency)} principal invested</p></article>
          <article style={s.statCard}><div style={s.statTop}><span style={{...s.statIcon,background:'#f1edff',color:'#7557c7'}}>◷</span><span style={s.statHint}>In progress</span></div><p style={s.statLabel}>Pending transactions</p><h3>{transactions.filter(t => ['PENDING','PROCESSING'].includes(t.status)).length}</h3><p style={s.statFoot}>Awaiting completion</p></article>
          <article style={s.statCard}><div style={s.statTop}><span style={{...s.statIcon,background:'#fff3e7',color:'#a65c16'}}>▤</span><span style={s.statHint}>Explore</span></div><p style={s.statLabel}>Available plans</p><h3>{plans.length}</h3><p style={s.statFoot}>Options available to you</p></article>
        </div>
        <div style={s.contentGrid}>
          <section style={s.panel}><div style={s.sectionHead}><div><p style={s.kicker}>ACCOUNT ACTIVITY</p><h2 style={s.sectionTitle}>Recent transactions</h2></div><button style={s.textLink} onClick={() => router.push('/transactions')}>View all ↗</button></div>
            {transactions.length ? <div style={s.table}>{transactions.slice(0,6).map(t => <div key={t.id} style={s.transaction}><div style={s.txIcon}>{t.type === 'DEPOSIT' ? '↓' : t.type === 'WITHDRAWAL' ? '↑' : t.type === 'INVESTMENT' ? '◈' : '↔'}</div><div style={s.txInfo}><strong>{title(t.description || t.type)}</strong><small>{date(t.createdAt)} · {t.reference}</small></div><div style={s.txAmount}><strong>{money(t.amount, t.currency || currency)}</strong><small style={{color:t.status === 'COMPLETED' ? '#16805d' : t.status === 'FAILED' ? '#b42318' : '#9a6700'}}>{title(t.status)}</small></div></div>)}</div> : <div style={s.empty}><span>↔</span><strong>No transactions yet</strong><p>Your deposits, withdrawals and investments will appear here.</p><button style={s.primary} onClick={() => router.push('/deposit')}>Make your first deposit</button></div>}
          </section>
          <section style={s.panel}><div style={s.sectionHead}><div><p style={s.kicker}>GROW WITH A PLAN</p><h2 style={s.sectionTitle}>Investment options</h2></div><button style={s.textLink} onClick={() => router.push('/investments')}>Explore ↗</button></div>
            {plans.length ? plans.slice(0,4).map(plan => <div key={plan.id} style={s.planRow}><div style={s.planIcon}>✳</div><div style={s.planInfo}><strong>{plan.name}</strong><small>{plan.durationDays} days · {plan.returnRate}% stated rate</small><small>From {money(plan.minimumAmount, currency)}</small></div><button style={s.arrowButton} aria-label={'View '+plan.name} onClick={() => router.push('/investments')}>↗</button></div>) : <div style={s.emptySmall}>No investment plans are available right now.</div>}
            <div style={s.noticeBox}><span>ⓘ</span><p>Review each plan&apos;s terms, risks, fees and withdrawal conditions before investing. Returns are not guaranteed unless explicitly stated in the applicable terms.</p></div>
          </section>
        </div>
        <section style={s.panel}><div style={s.sectionHead}><div><p style={s.kicker}>STAY INFORMED</p><h2 style={s.sectionTitle}>Notifications {unread > 0 && <span style={s.unread}>{unread} new</span>}</h2></div><button style={s.textLink} onClick={() => router.push('/notifications')}>All notifications ↗</button></div>
          {notifications.length ? notifications.slice(0,3).map(n => <div key={n.id} style={s.noticeRow}><span style={{...s.noticeDot,background:n.read?'#d1d5db':'#1c8b67'}}/><div style={{flex:1}}><strong>{n.title}</strong><p>{n.message}</p><small>{date(n.createdAt)}</small></div>{!n.read && <button style={s.textLink} onClick={() => markRead(n.id)}>Mark read</button>}</div>) : <p style={s.muted}>You&apos;re all caught up. New account updates will appear here.</p>}
        </section>
        <footer style={s.footer}><span>© {new Date().getFullYear()} TopMint</span><span>USD is the platform&apos;s primary currency for new wallets. Historical balances retain their recorded currency.</span></footer>
      </section>
      <nav style={s.mobileNav}><Link href="/dashboard">⌂<small>Home</small></Link><Link href="/deposit">＋<small>Fund</small></Link><Link href="/investments">◫<small>Invest</small></Link><Link href="/transactions">↔<small>Activity</small></Link><Link href="/profile">◎<small>Profile</small></Link></nav>
    </main>
  </>;
}

const s = {
 page:{minHeight:'100vh',background:'#f5f7f6',color:'#14211d',fontFamily:'Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',display:'flex'},
 sidebar:{width:238,flexShrink:0,background:'#071c18',color:'#e8f4ef',padding:'26px 16px',display:'flex',flexDirection:'column',minHeight:'100vh',boxSizing:'border-box',position:'sticky',top:0,height:'100vh'},
 brand:{display:'flex',alignItems:'center',gap:10,textDecoration:'none',color:'#fff',fontWeight:800,fontSize:22,letterSpacing:'-.7px',padding:'0 8px',marginBottom:42},
 brandMark:{width:36,height:36,borderRadius:12,background:'#b8f36b',color:'#10291f',display:'inline-flex',alignItems:'center',justifyContent:'center',fontWeight:900,fontSize:21},
 'brand small':{display:'block',fontSize:8,letterSpacing:'1.6px',color:'#8aa69b',marginTop:3},
 navLabel:{fontSize:10,letterSpacing:'1.6px',fontWeight:800,color:'#739086',padding:'0 12px',marginBottom:12},
 navItem:{display:'flex',alignItems:'center',gap:12,padding:'12px',borderRadius:11,color:'#bbcec6',textDecoration:'none',fontSize:13,fontWeight:600,marginBottom:4},
 navActive:{background:'#173a30',color:'#d1fa9c'},
 badge:{marginLeft:'auto',fontSize:10,background:'#b8f36b',color:'#14211d',borderRadius:20,padding:'3px 7px'},
 sidebarBottom:{marginTop:'auto',borderTop:'1px solid #1d3931',paddingTop:16},
 logout:{display:'block',width:'100%',border:0,background:'transparent',color:'#bbcec6',padding:'12px',textAlign:'left',fontSize:13,cursor:'pointer'},
 secure:{fontSize:10,color:'#78968a',padding:'12px 8px'},
 main:{width:'min(100% - 238px, 1380px)',padding:'30px clamp(20px,3.5vw,48px) 26px',boxSizing:'border-box',margin:'0 auto'},
 topbar:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:20,marginBottom:26},
 kicker:{fontSize:10,fontWeight:800,letterSpacing:'1.6px',color:'#71867c',margin:'0 0 7px'},
 pageTitle:{fontSize:29,letterSpacing:'-1px',margin:0,fontWeight:800},
 userBox:{display:'flex',alignItems:'center',gap:11},
 avatar:{width:42,height:42,borderRadius:15,background:'#dcebdc',color:'#24543f',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800},
 'userBox strong':{display:'block',fontSize:12}, 'userBox small':{display:'block',fontSize:11,color:'#74847d',marginTop:3},
 mobileSignout:{display:'none'},
 hero:{position:'relative',overflow:'hidden',borderRadius:22,background:'linear-gradient(115deg,#0d3026 0%,#15513c 60%,#216d4d 100%)',color:'#fff',padding:'30px 32px 0',marginBottom:18,boxShadow:'0 16px 38px rgba(13,48,38,.13)'},
 heroGlow:{position:'absolute',width:280,height:280,borderRadius:'50%',background:'rgba(184,243,107,.10)',right:60,top:-160},
 heroContent:{position:'relative',zIndex:1},
 heroLabel:{fontSize:10,fontWeight:800,letterSpacing:'1.5px',color:'#b4cfc0',margin:'0 0 12px',display:'flex',alignItems:'center',gap:12},
 live:{display:'inline-flex',alignItems:'center',gap:5,fontSize:9,color:'#d7f8ad',letterSpacing:'.7px'},
 'live i':{display:'inline-block',width:6,height:6,borderRadius:10,background:'#b8f36b'},
 balance:{fontSize:'clamp(32px,4vw,46px)',letterSpacing:'-1.8px',margin:'0 0 6px',fontWeight:800,color:'#fff',overflowWrap:'anywhere'},
 heroSub:{fontSize:12,color:'#b9d0c5',margin:0},
 heroActions:{display:'flex',gap:10,margin:'24px 0 26px',flexWrap:'wrap'},
 heroButton:{background:'#c4f582',color:'#163522',border:0,borderRadius:10,padding:'12px 17px',fontWeight:800,fontSize:12,cursor:'pointer'},
 heroOutline:{background:'rgba(255,255,255,.08)',color:'#fff',border:'1px solid rgba(255,255,255,.24)',borderRadius:10,padding:'11px 17px',fontWeight:700,fontSize:12,cursor:'pointer'},
 heroSymbol:{position:'absolute',right:55,top:18,fontSize:180,fontWeight:900,color:'rgba(255,255,255,.045)',lineHeight:1,pointerEvents:'none'},
 heroFooter:{position:'relative',display:'flex',alignItems:'center',gap:8,borderTop:'1px solid rgba(255,255,255,.13)',padding:'15px 0',fontSize:9,letterSpacing:'1px',color:'#a9c8b9'},
 'heroFooter strong':{display:'inline-flex',alignItems:'center',gap:6,fontSize:10,color:'#d7f8ad',letterSpacing:0},
 'heroFooter i':{display:'inline-block',width:6,height:6,borderRadius:10,background:'#b8f36b'},
 statsGrid:{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:15,marginBottom:18},
 statCard:{background:'#fff',border:'1px solid #e8eeea',borderRadius:17,padding:'18px 19px',minWidth:0},
 statTop:{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14},
 statIcon:{width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:11,background:'#e4f5e7',color:'#23704d',fontSize:17,fontWeight:800},
 statHint:{fontSize:10,color:'#8a9992'},
 statLabel:{fontSize:11,color:'#728078',margin:'0 0 5px'},
 'statCard h3':{fontSize:27,letterSpacing:'-1px',margin:'0 0 5px'},
 statFoot:{fontSize:10,color:'#849189',margin:0},
 contentGrid:{display:'grid',gridTemplateColumns:'minmax(0,1.25fr) minmax(300px,.85fr)',gap:18,marginBottom:18},
 panel:{background:'#fff',border:'1px solid #e8eeea',borderRadius:17,padding:'21px 22px',marginBottom:18,minWidth:0},
 sectionHead:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,marginBottom:14},
 sectionTitle:{fontSize:17,letterSpacing:'-.4px',margin:0,fontWeight:800},
 textLink:{border:0,background:'transparent',color:'#247653',fontSize:11,fontWeight:800,cursor:'pointer',whiteSpace:'nowrap'},
 table:{display:'flex',flexDirection:'column'},
 transaction:{display:'flex',alignItems:'center',gap:11,padding:'13px 0',borderBottom:'1px solid #f0f3f1',minWidth:0},
 txIcon:{width:35,height:35,flexShrink:0,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',background:'#edf5ef',color:'#2c7953',fontSize:17,fontWeight:800},
 txInfo:{minWidth:0,flex:1},
 'txInfo strong':{display:'block',fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
 'txInfo small':{display:'block',fontSize:9,color:'#8a9790',marginTop:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
 txAmount:{textAlign:'right',flexShrink:0},
 'txAmount strong':{display:'block',fontSize:11},
 'txAmount small':{display:'block',fontSize:9,marginTop:4},
 planRow:{display:'flex',alignItems:'center',gap:10,padding:'13px 0',borderBottom:'1px solid #f0f3f1'},
 planIcon:{width:35,height:35,borderRadius:12,background:'#f0f5d9',color:'#5a7827',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0},
 planInfo:{flex:1,minWidth:0},
 'planInfo strong':{display:'block',fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
 'planInfo small':{display:'block',fontSize:10,color:'#7e8b83',marginTop:4},
 arrowButton:{width:30,height:30,border:'1px solid #e3eae5',borderRadius:9,background:'#fff',color:'#246b4a',cursor:'pointer'},
 noticeBox:{display:'flex',gap:9,background:'#f6f8ee',borderRadius:12,padding:12,marginTop:14,color:'#66754f'},
 'noticeBox p':{fontSize:10,lineHeight:1.6,margin:0},
 noticeRow:{display:'flex',alignItems:'flex-start',gap:11,padding:'12px 0',borderBottom:'1px solid #f0f3f1'},
 noticeDot:{width:7,height:7,borderRadius:10,marginTop:5,flexShrink:0},
 'noticeRow strong':{fontSize:12}, 'noticeRow p':{fontSize:11,color:'#66756d',margin:'4px 0'},'noticeRow small':{fontSize:9,color:'#9aa59f'},
 unread:{fontSize:10,background:'#e4f5e7',color:'#247653',borderRadius:20,padding:'4px 7px',marginLeft:5,verticalAlign:'middle'},
 empty:{display:'flex',alignItems:'center',flexDirection:'column',textAlign:'center',padding:'32px 10px',color:'#708078'},
 'empty span':{fontSize:25},'empty strong':{fontSize:13,color:'#20352b',marginTop:8},'empty p':{fontSize:11,maxWidth:260,lineHeight:1.6},
 emptySmall:{fontSize:12,color:'#839087',padding:'20px 0'},
 primary:{border:0,borderRadius:10,background:'#174f39',color:'#fff',fontWeight:700,padding:'11px 14px',cursor:'pointer'},
 muted:{color:'#78877f',fontSize:12,lineHeight:1.6},
 alert:{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',background:'#fff4df',color:'#855d16',padding:13,borderRadius:12,marginBottom:16,fontSize:12},
 linkButton:{border:0,background:'transparent',textDecoration:'underline',color:'inherit',cursor:'pointer'},
 footer:{display:'flex',justifyContent:'space-between',gap:15,flexWrap:'wrap',fontSize:9,color:'#8b9891',padding:'4px 2px 12px'},
 loading:{margin:'auto',textAlign:'center',color:'#61756b'},
 mobileNav:{display:'none'},
 'panel h2':{marginTop:0}
};
