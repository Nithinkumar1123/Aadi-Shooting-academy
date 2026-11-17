import { useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, useNavigate, Link, Navigate } from 'react-router-dom';
import { Activity, Bell, CalendarDays, LayoutDashboard, LogOut, Menu, QrCode, Settings, ShieldCheck, Target, UserCheck, Users, Wallet, ArrowRight, CheckCircle2, MapPin, Phone, Clock3, Trophy, Crosshair, House, BookOpen, MapPinned, Medal, TrendingUp, X, Star, Mail, ChevronDown, ArrowUp, UserPlus, ClipboardCheck, Eye, EyeOff, Lock, ArrowLeft } from 'lucide-react';
import { supabase, supabaseConfigured } from './lib/supabase';
import PushToggle from './components/PushToggle';
import { detachPush } from './lib/push';
import { playNotificationSound, showBrowserNotification, unlockNotificationAudio, requestBrowserNotifications } from './lib/notificationUtils';
import Dashboard from './pages/Dashboard';
import Shooters from './pages/Shooters';
import Attendance from './pages/Attendance';
import Approvals from './pages/Approvals';
import ShooterPortal from './pages/ShooterPortal';
import Scores from './pages/Scores';
import Payments from './pages/Payments';
import Notifications from './pages/Notifications';

const ACADEMY = 'AADI RIFLE SHOOTING ACADEMY';
const ADMIN_ROLES = ['super_admin', 'admin', 'reception'];

function Brand({ light=false }) { return <div className={`brand ${light?'brand-light':''}`}><div className="brand-mark"><Target size={21}/></div><div><strong>AADI</strong><span>RIFLE SHOOTING ACADEMY</span></div></div>; }

const NAV_ITEMS = [['home','Home',House],['about','About',Users],['programs','Programs',Trophy],['location','Location',MapPinned]];

function PublicNav() {
  const [active, setActive] = useState('home');
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ids = NAV_ITEMS.map(([id]) => id);
    function onScroll() {
      setScrolled(window.scrollY > 8);
      const line = window.scrollY + 140;
      let current = 'home', best = -Infinity;
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const top = el.getBoundingClientRect().top + window.pageYOffset;
        if (top <= line && top > best) { best = top; current = id; }
      });
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) current = 'location';
      setActive(current);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open]);

  function go(e, id) {
    e.preventDefault();
    document.body.style.overflow = '';   // release the mobile menu scroll-lock before scrolling
    setOpen(false);
    const el = document.getElementById(id);
    if (!el) return;
    requestAnimationFrame(() => {
      const top = id === 'home' ? 0 : el.getBoundingClientRect().top + window.pageYOffset - 76;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      setActive(id);
      try { window.history.replaceState(window.history.state, '', `#${id}`); } catch (_) {}
    });
  }

  return <header className={`public-nav ${scrolled ? 'is-scrolled' : ''}`}>
    <div className="public-nav-inner">
      <a href="#home" onClick={e => go(e, 'home')} className="landing-logo" aria-label="AADI Rifle Shooting Academy home"><img src="/aadi-logo.png" alt="AADI Rifle Shooting Academy" /></a>
      <nav className="public-main-nav" aria-label="Main navigation">
        {NAV_ITEMS.map(([id, label, Icon]) => <a key={id} href={`#${id}`} onClick={e => go(e, id)} className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined}><Icon size={18}/> <span>{label}</span></a>)}
      </nav>
      <div className="nav-cta">
        <Link className="nav-login" to="/login"><UserCheck size={18}/> <span>Sign in</span></Link>
        <Link className="nav-register" to="/signup">Join the academy <ArrowRight size={16}/></Link>
        <button type="button" className="nav-toggle" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={24}/> : <Menu size={24}/>}</button>
      </div>
    </div>
    <div className={`nav-drawer ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
      <div className="nav-drawer-panel" onClick={e => e.stopPropagation()}>
        {NAV_ITEMS.map(([id, label, Icon]) => <a key={id} href={`#${id}`} onClick={e => go(e, id)} className={active === id ? 'active' : ''}><Icon size={20}/> {label}</a>)}
        <Link to="/login" className="drawer-login"><UserCheck size={20}/> Sign in</Link>
        <Link to="/signup" className="nav-register drawer-join">Join the academy <ArrowRight size={16}/></Link>
      </div>
    </div>
  </header>;
}

function QuickHelpers() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const f = () => setShow(window.scrollY > 700);
    f(); window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  return <>
    <button type="button" className={`to-top ${show ? 'show' : ''}`} aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowUp size={20}/></button>
    <div className="mobile-bar" role="region" aria-label="Quick actions">
      <a href="tel:9591123300" className="mb-call"><Phone size={18}/> Call</a>
      <Link to="/signup" className="mb-join">Join the academy <ArrowRight size={16}/></Link>
    </div>
  </>;
}

const FAQ = [
  ['Who can join the academy?', 'AADI welcomes all age groups, from complete beginners to experienced shooters preparing for competition.'],
  ['Do I need any shooting experience?', 'No. Our programs are structured so you start with safety and fundamentals and progress at your own pace.'],
  ['How do I become a member?', 'Create an account on this website and submit your details. The academy reviews your request and confirms your membership.'],
  ['Which disciplines do you train?', 'We train 10m Air Rifle and 10m Air Pistol, along with competition preparation for shooters who are ready for matches.'],
  ['How do I check schedules and availability?', 'Call us on 95911 23300 or visit the academy at Avalahalli, Yelahanka. The team will share current training timings.'],
];

function LandingPage() {
  return <div className="public-site">
    <a href="#home" className="skip-link" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus();}}>Skip to content</a>
    <PublicNav />

    <main id="main-content" tabIndex={-1}>
      <section className="public-hero" id="home">
        <div className="hero-copy">
          <span className="hero-kicker"><span className="hero-kicker-dot"/> Now Open in Yelahanka</span>
          <h1>Focus. Discipline.<br/><em>Precision.</em><br/>Excellence.</h1>
          <p>Build confidence, sharpen your skills and grow with a professional shooting academy focused on safe training and personal progress.</p>
          <div className="hero-actions">
            <Link to="/signup" className="primary hero-primary">Get Started <ArrowRight size={17}/></Link>
            <a href="#programs" className="hero-secondary"><BookOpen size={19}/> Explore Programs</a>
          </div>
        </div>

        <div className="hero-visual">
          <div className="hero-photo-wrap">
            <img src="/hero-shooters.jpg" alt="AADI Rifle Shooting Academy training"/>
            <div className="photo-fade"/>
          </div>
          <div className="hero-slogan"><span>Aim High...</span><strong>Achieve More...</strong></div>
          <div className="hero-feature-card feature-one"><span className="feature-icon blue"><Target size={34}/></span><div><b>Precision</b><small>Training</small></div></div>
          <div className="hero-feature-card feature-two"><span className="feature-icon gold"><Trophy size={34}/></span><div><b>10m Air Rifle</b><small>Olympic Discipline</small></div></div>
          <div className="hero-feature-card feature-three"><span className="feature-icon green"><ShieldCheck size={34}/></span><div><b>Safety First</b></div></div>
        </div>
      </section>

      <section className="hero-benefits">
        <div className="benefit"><Users size={38}/><b>Expert Coaching</b></div>
        <div className="benefit"><TrendingUp size={38}/><b>Structured Programs</b></div>
        <div className="benefit"><Medal size={38}/><b>Track Your Progress</b></div>
        <div className="benefit"><Trophy size={38}/><b>Build a Winning Mindset</b></div>
      </section>

      <section className="choose-section" id="about">
        <div className="sec-head"><span className="sec-pill">Why choose AADI?</span><h2>More Than Just Shooting</h2><p>A complete academy for all age groups — from beginners to champions.</p></div>
        <div className="choose-grid">
          <article><span className="sec-icon"><ShieldCheck size={26}/></span><h3>Safety First</h3><p>Learn correct range discipline and safe shooting habits from day one.</p></article>
          <article><span className="sec-icon"><Users size={26}/></span><h3>Expert Coaching</h3><p>Build fundamentals, consistency and confidence with structured guidance.</p></article>
          <article><span className="sec-icon"><TrendingUp size={26}/></span><h3>Progress Tracking</h3><p>Measure your development and stay focused on your next milestone.</p></article>
          <article><span className="sec-icon"><Star size={26}/></span><h3>Competition Ready</h3><p>Prepare for serious performance with focused practice and match discipline.</p></article>
        </div>
      </section>

      <section className="program-section" id="programs">
        <div className="sec-head"><span className="sec-pill">Training programs</span><h2>Find your starting point</h2><p>Structured training for every stage of your shooting journey.</p></div>
        <div className="program-grid">
          <article><span className="sec-icon navy"><Target size={26}/></span><h3>10m Air Rifle</h3><p>Build a stable position, breathing control and consistent shot routine.</p><Link to="/signup" className="card-link">Enrol now <ArrowRight size={15}/></Link></article>
          <article><span className="sec-icon navy"><Crosshair size={26}/></span><h3>10m Air Pistol</h3><p>Develop balance, precision and confident pistol fundamentals.</p><Link to="/signup" className="card-link">Enrol now <ArrowRight size={15}/></Link></article>
          <article><span className="sec-icon navy"><Trophy size={26}/></span><h3>Competition Preparation</h3><p>Focused practice, performance tracking and match readiness.</p><Link to="/signup" className="card-link">Enrol now <ArrowRight size={15}/></Link></article>
          <article><span className="sec-icon navy"><Users size={26}/></span><h3>Beginner to Advanced</h3><p>Progressive coaching that meets you at your current skill level.</p><Link to="/signup" className="card-link">Enrol now <ArrowRight size={15}/></Link></article>
        </div>
      </section>

      <section className="steps-section" id="how-to-join">
        <div className="sec-head"><span className="sec-pill">How to join</span><h2>Start in three simple steps</h2><p>From sign-up to your first session, we keep it clear and easy.</p></div>
        <ol className="steps-grid">
          <li><span className="step-no">1</span><span className="sec-icon"><UserPlus size={26}/></span><h3>Create your account</h3><p>Register online with your basic details. It takes only a couple of minutes.</p></li>
          <li><span className="step-no">2</span><span className="sec-icon"><ClipboardCheck size={26}/></span><h3>Get approved</h3><p>The academy reviews your request and confirms your membership.</p></li>
          <li><span className="step-no">3</span><span className="sec-icon"><Target size={26}/></span><h3>Begin training</h3><p>Meet your coaches, learn range safety and start your first session.</p></li>
        </ol>
      </section>

      <section className="public-poster">
        <div><span className="sec-pill on-dark">Come train with us</span><h2>Your journey starts<br/>with one focused shot.</h2><p>Join AADI Rifle Shooting Academy and take your first step towards better focus, discipline and precision.</p><Link to="/signup" className="nav-register poster-cta">Create your account <ArrowRight size={16}/></Link></div>
        <img src="/aadi-academy-poster.jpg" alt="AADI academy opening details"/>
      </section>

      <section className="faq-section" id="faq">
        <div className="sec-head"><span className="sec-pill">Questions</span><h2>Frequently asked questions</h2><p>Quick answers before you visit. Still unsure? Call us and we will help.</p></div>
        <div className="faq-list">
          {FAQ.map(([q, a]) => <details key={q}><summary>{q}<ChevronDown size={20}/></summary><p>{a}</p></details>)}
        </div>
      </section>

      <section className="location-section" id="location">
        <div className="sec-head left"><span className="sec-pill">Visit the academy</span><h2>Now open at Yelahanka</h2><p>Drop by to see the range, meet the coaches and ask about the right program for you.</p></div>
        <div className="loc-grid">
          <div className="loc-info">
            <div className="loc-row"><span className="sec-icon"><MapPin size={22}/></span><div><b>Address</b><p>Avalahalli, opposite Prestige Royale Garden Apartment, Yelahanka, Bengaluru, Karnataka – 560064</p></div></div>
            <div className="loc-row"><span className="sec-icon"><Phone size={22}/></span><div><b>Phone</b><p><a href="tel:9591123300">95911 23300</a></p></div></div>
            <div className="loc-row"><span className="sec-icon"><Clock3 size={22}/></span><div><b>Timings</b><p>Contact the academy for training schedules and availability.</p></div></div>
            <div className="loc-actions">
              <a className="hero-primary" href="https://www.google.com/maps/search/?api=1&query=Avalahalli%2C+Yelahanka%2C+Bengaluru+560064" target="_blank" rel="noreferrer">Get directions <ArrowRight size={16}/></a>
              <a className="hero-secondary" href="tel:9591123300"><Phone size={18}/> Call now</a>
            </div>
          </div>
          <div className="loc-map"><iframe title="AADI Rifle Shooting Academy location" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=Avalahalli,Yelahanka,Bengaluru+560064&output=embed"/></div>
        </div>
      </section>
    </main>
    <footer className="public-footer">
      <div className="pf-grid">
        <div className="pf-brand"><img src="/aadi-logo.png" alt="AADI Rifle Shooting Academy"/><p>Safe, structured rifle and pistol training for every age and skill level in Yelahanka, Bengaluru.</p></div>
        <div><h4>Explore</h4><a href="#home">Home</a><a href="#programs">Programs</a><a href="#about">About</a><a href="#faq">FAQ</a></div>
        <div><h4>Members</h4><Link to="/signup">Join the academy</Link><Link to="/login">Member and staff sign in</Link></div>
        <div><h4>Contact</h4><a href="tel:9591123300"><Phone size={15}/> 95911 23300</a><span><MapPin size={15}/> Avalahalli, Yelahanka, Bengaluru 560064</span></div>
      </div>
      <div className="pf-bottom"><span>© {new Date().getFullYear()} AADI Rifle Shooting Academy. All rights reserved.</span><span>Train safe. Aim high.</span></div>
    </footer>
    <QuickHelpers />
  </div>;
}
function AuthScreen({ initialMode='signin' }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [info, setInfo] = useState('');
  const signup = mode === 'signup';
  const [showPw, setShowPw] = useState(false);
  const [fe, setFe] = useState({});
  const friendly = m => /invalid login/i.test(m) ? 'Incorrect email or password. Please check and try again.' : /already registered|already been registered/i.test(m) ? 'This email already has an account. Try signing in instead.' : /rate limit|too many/i.test(m) ? 'Too many attempts. Please wait a moment and try again.' : /email not confirmed/i.test(m) ? 'Please confirm your email first, then sign in.' : m;
  function validate() {
    const x = {};
    if (!email.trim()) x.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) x.email = 'Enter a valid email, like name@example.com.';
    if (!password) x.password = signup ? 'Create a password.' : 'Enter your password.';
    else if (signup && password.length < 6) x.password = 'Use at least 6 characters.';
    return x;
  }
  async function submit(e) {
    e.preventDefault(); setError(''); setInfo('');
    const x = validate(); setFe(x);
    if (x.email || x.password) { document.getElementById(x.email ? 'au-email' : 'au-password')?.focus(); return; }
    setBusy(true);
    const result = signup ? await supabase.auth.signUp({ email: email.trim(), password }) : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error) setError(friendly(result.error.message));
    else if (!signup) navigate('/');
    else if (signup && !result.data.session) { setInfo('Your account has been created. Please confirm your email, then sign in.'); setMode('signin'); }
    setBusy(false);
  }
  const switchMode = m => { setMode(m); setError(''); setInfo(''); setFe({}); };
  return <div className="au-page">
    <aside className="au-side">
      <img className="au-side-img" src="/hero-shooters.jpg" alt="" aria-hidden="true"/>
      <div className="au-side-shade"/>
      <div className="au-side-inner">
        <Link to="/" className="au-logo" aria-label="AADI Rifle Shooting Academy home"><img src="/aadi-logo.png" alt="AADI Rifle Shooting Academy"/></Link>
        <div className="au-side-copy">
          <span className="au-pill">Member portal</span>
          <h1>Your progress.<br/><em>Your journey.</em></h1>
          <p>One secure place for your membership, attendance, scores and academy updates.</p>
          <ul className="au-points">
            <li><CalendarDays size={20}/> Attendance and check-ins</li>
            <li><Target size={20}/> Shooting scores and progress</li>
            <li><Wallet size={20}/> Fees and payment history</li>
          </ul>
        </div>
        <div className="au-side-note"><ShieldCheck size={20}/><span>Secure access for academy members and staff</span></div>
      </div>
    </aside>

    <main className="au-main">
      <div className="au-top">
        <Link to="/" className="au-back"><ArrowLeft size={17}/> Back to website</Link>
        <Link to="/" className="au-logo-sm" aria-label="AADI home"><img src="/aadi-logo.png" alt="AADI Rifle Shooting Academy"/></Link>
      </div>

      <div className="au-card">
        <div className="au-tabs" role="tablist" aria-label="Sign in or create account">
          <button type="button" role="tab" aria-selected={!signup} className={!signup ? 'active' : ''} onClick={() => switchMode('signin')}>Sign in</button>
          <button type="button" role="tab" aria-selected={signup} className={signup ? 'active' : ''} onClick={() => switchMode('signup')}>Create account</button>
        </div>
        <h2>{signup ? 'Create your account' : 'Welcome back'}</h2>
        <p className="au-sub">{signup ? 'Register as a shooter. Your membership will be reviewed by the academy.' : 'Sign in to continue to your member or staff dashboard.'}</p>

        <form onSubmit={submit} noValidate>
          <div className="au-field">
            <label htmlFor="au-email">Email address</label>
            <div className={`au-input ${fe.email ? 'invalid' : ''}`}><Mail size={19}/><input id="au-email" type="email" inputMode="email" autoComplete="email" value={email} aria-invalid={!!fe.email} aria-describedby={fe.email ? 'au-email-err' : undefined} onChange={e => { setEmail(e.target.value); if (fe.email) setFe({ ...fe, email: '' }); }} placeholder="you@example.com"/></div>
            {fe.email && <p className="au-err" id="au-email-err" role="alert">{fe.email}</p>}
          </div>
          <div className="au-field">
            <label htmlFor="au-password">Password</label>
            <div className={`au-input ${fe.password ? 'invalid' : ''}`}><Lock size={19}/><input id="au-password" type={showPw ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} value={password} aria-invalid={!!fe.password} aria-describedby={fe.password ? 'au-pw-err' : undefined} onChange={e => { setPassword(e.target.value); if (fe.password) setFe({ ...fe, password: '' }); }} placeholder={signup ? 'At least 6 characters' : 'Enter your password'}/>
              <button type="button" className="au-eye" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw(!showPw)}>{showPw ? <EyeOff size={19}/> : <Eye size={19}/>}</button></div>
            {fe.password && <p className="au-err" id="au-pw-err" role="alert">{fe.password}</p>}
          </div>
          {error && <p className="au-msg error" role="alert">{error}</p>}
          {info && <p className="au-msg ok" role="status">{info}</p>}
          <button className="au-submit" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in securely'} {!busy && <ArrowRight size={17}/>}</button>
        </form>

        <p className="au-switch">{signup ? 'Already registered?' : 'New to AADI?'} <button type="button" onClick={() => switchMode(signup ? 'signin' : 'signup')}>{signup ? 'Sign in' : 'Create a shooter account'}</button></p>
        {!signup && <p className="au-hint">New accounts need approval from the academy before full access.</p>}
      </div>

      <span className="au-copy">© {new Date().getFullYear()} AADI Rifle Shooting Academy</span>
    </main>
  </div>;
}

function AdminShell({ session, onLogout }) {
  const [mobileOpen,setMobileOpen]=useState(false); const [pending,setPending]=useState(0); const [unreadNotifications,setUnreadNotifications]=useState(0);
  const [notificationSoundOn,setNotificationSoundOn]=useState(localStorage.getItem('aadi_notification_sound') !== 'off');
  // Mobile menu: Esc closes, page scroll is locked while open, auto-close on desktop resize, swipe left to close
  useEffect(()=>{
    if(!mobileOpen) return;
    const onKey=e=>{ if(e.key==='Escape') setMobileOpen(false); };
    const onResize=()=>{ if(window.innerWidth>1000) setMobileOpen(false); };
    document.addEventListener('keydown',onKey); window.addEventListener('resize',onResize);
    const prev=document.body.style.overflow; document.body.style.overflow='hidden';
    return ()=>{ document.removeEventListener('keydown',onKey); window.removeEventListener('resize',onResize); document.body.style.overflow=prev; };
  },[mobileOpen]);
  const swipe=useRef(null);
  const onSwipeStart=e=>{ swipe.current=e.touches[0].clientX; };
  const onSwipeEnd=e=>{ if(swipe.current!==null && swipe.current-e.changedTouches[0].clientX>60) setMobileOpen(false); swipe.current=null; };
  async function loadPending(){const {count}=await supabase.from('shooters').select('id',{count:'exact',head:true}).eq('approval_status','pending');setPending(count||0); const {count:unread}=await supabase.from('notifications').select('id',{count:'exact',head:true}).eq('audience','admin').is('read_at',null); setUnreadNotifications(unread||0);}
  useEffect(()=>{
    loadPending();
    const unlock=()=>{ if(notificationSoundOn) unlockNotificationAudio(); };
    window.addEventListener('pointerdown', unlock, {once:true});
    const refreshUnreadNotifications = async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('audience', 'admin')
        .is('read_at', null);
      setUnreadNotifications(count || 0);
    };
    const channel=supabase.channel('aadi-admin-live-notifications')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications'},async(payload)=>{
        const row=payload.new;
        if(row.audience!=='admin') return;
        // Always recalculate the real unread count instead of incrementing a
        // local counter. This keeps the sidebar badge in sync when an item
        // is already read or when several notifications arrive together.
        await refreshUnreadNotifications();
        if(notificationSoundOn){ await playNotificationSound(row.type || 'notification'); }
        showBrowserNotification(row.title || 'AADI Academy', row.message || 'You have a new academy notification.');
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'notifications'},async(payload)=>{
        const row=payload.new;
        if(row.audience==='admin') await refreshUnreadNotifications();
      })
      .subscribe();
    return()=>{ window.removeEventListener('pointerdown', unlock); supabase.removeChannel(channel); };
  },[notificationSoundOn]);
  async function toggleNotificationSound(){
    const next=!notificationSoundOn;
    setNotificationSoundOn(next);
    localStorage.setItem('aadi_notification_sound',next?'on':'off');
    if(next){ await unlockNotificationAudio(); await requestBrowserNotifications(); await playNotificationSound('notification'); }
  }
  const nav=[['/','Overview',LayoutDashboard],['/approvals','Approvals',UserCheck],['/shooters','Shooters',Users],['/attendance','Check-in / check-out',QrCode],['/scores','Shooting scores',Target],['/payments','Fees & payments',Wallet],['/notifications','Notifications',Bell],['/settings','Settings',Settings]];
  return <div className="app-shell"><div className={`sidebar-backdrop ${mobileOpen?'show':''}`} onClick={()=>setMobileOpen(false)} aria-hidden="true"/><aside id="admin-sidebar" className={`sidebar ${mobileOpen?'open':''}`} aria-label="Main navigation" onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}><button type="button" className="sidebar-close" onClick={()=>setMobileOpen(false)} aria-label="Close menu"><X size={20}/></button><Link to="/" className="side-logo" aria-label="AADI home"><img src="/aadi-logo.png" alt="AADI Rifle Shooting Academy"/></Link><div className="side-label">Academy workspace</div><nav>{nav.map(([path,label,Icon])=><NavLink key={path} to={path} end={path==='/'} onClick={()=>setMobileOpen(false)}><Icon size={18}/>{label}{label==='Approvals'&&pending>0&&<span className="nav-count">{pending}</span>}{label==='Notifications'&&unreadNotifications>0&&<span className="nav-count">{unreadNotifications}</span>}</NavLink>)}</nav><div className="sidebar-bottom"><div className="secure-note"><ShieldCheck size={17}/><span>Secure academy workspace</span></div><button className="logout" onClick={onLogout}><LogOut size={17}/>Sign out</button></div></aside><main className="main"><header className="topbar"><button type="button" className="icon-btn mobile-menu" aria-label="Open menu" aria-expanded={mobileOpen} aria-controls="admin-sidebar" onClick={()=>setMobileOpen(true)}><Menu/></button><div><p className="eyebrow">AADI Rifle Shooting Academy</p><strong>Academy management</strong></div><div className="top-actions"><button className="secondary notification-sound-toggle" onClick={toggleNotificationSound} title="Enable or disable notification sounds">{notificationSoundOn?'🔔 Sound on':'🔕 Sound off'}</button><PushToggle/><span className="status-pill"><i/> Connected</span><div className="avatar" title={session.user.email}>{(session.user.email||'AD').slice(0,2).toUpperCase()}</div></div></header><div className="page-content"><Routes><Route path="/" element={<Dashboard/>}/><Route path="/approvals" element={<Approvals onChanged={loadPending}/>}/><Route path="/shooters" element={<Shooters/>}/><Route path="/attendance" element={<Attendance/>}/><Route path="/scores" element={<Scores/>}/><Route path="/payments" element={<Payments/>}/><Route path="/notifications" element={<Notifications/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></div></main></div>;
}

export default function App() {
  const [session,setSession]=useState(null); const [loading,setLoading]=useState(true); const [access,setAccess]=useState(null); const navigate=useNavigate();
  useEffect(()=>{if(!supabaseConfigured){setLoading(false);return;}supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false);});const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>subscription.unsubscribe();},[]);
  useEffect(()=>{if(!session){setAccess(null);return;}setAccess(null);supabase.from('profiles').select('role').eq('id',session.user.id).maybeSingle().then(({data})=>setAccess(data&&ADMIN_ROLES.includes(data.role)?'admin':'shooter'));},[session?.user?.id]);
  async function logout(){await detachPush();await supabase.auth.signOut();setSession(null);navigate('/');}
  if(!supabaseConfigured)return <div className="setup-screen"><div className="setup-card"><div className="brand-mark"><Target/></div><p className="eyebrow">INITIAL SETUP</p><h1>Connect your academy portal</h1><p className="muted">Create <code>web/.env</code> from <code>.env.example</code>, add your Supabase project URL and publishable/anon key, then restart the dev server.</p><pre>VITE_SUPABASE_URL=https://…supabase.co<br/>VITE_SUPABASE_ANON_KEY=…</pre><p className="tiny muted">Never put a Supabase service-role key in a browser application.</p></div></div>;
  if(loading)return <div className="loading">Loading AADI Rifle Shooting…</div>;
  if(!session)return <Routes><Route path="/login" element={<AuthScreen/>}/><Route path="/signup" element={<AuthScreen initialMode="signup"/>}/><Route path="*" element={<LandingPage/>}/></Routes>;
  if(!access)return <div className="loading">Loading your account…</div>;
  return access==='admin'?<AdminShell session={session} onLogout={logout}/>:<ShooterPortal session={session} onLogout={logout}/>;
}
