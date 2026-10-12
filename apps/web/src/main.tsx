import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowRight, BookOpen, Check, ChevronRight, CircleAlert, CircleCheck, Clipboard, Code2, Download, ExternalLink, FileClock, Fingerprint, FlaskConical, History, Menu, Moon, Plus, Radio, Search, Settings, ShieldCheck, Sun, X } from 'lucide-react';
import './style.css';
import './premium.css';
import './studio.css';

const API = 'http://127.0.0.1:3100/api/v1';
type Envelope<T> = { data?: T; error?: { code: string; message: string } };
type Run = { id: string; created_at: string; updated_at: string; target_url: string; profile: string; app_mode: string; interaction_mode: string; state: string; error_code?: string | null; report?: Report | null };
type Signature = { signer: string; state: string; valid: boolean | null; signatureBase64: string | null };
type Instruction = { index: number; programId: string; label: string; dataBase64: string; accountKeys: string[] };
type TxEvidence = { serializedBase64: string; messageBase64: string; messageHash: string; feePayer: string | null; recentBlockhash: string | null; signatures: Signature[]; instructions: Instruction[] };
type Finding = { ruleId: string; title: string; severity: string; evidence: string; explanation: string; fix: string };
type Report = { id: string; createdAt: string; completedAt?: string; targetUrl: string; profile: string; appMode: string; interactionMode?: string; outcome: string; broadcastStatus?: string; capture?: { before: TxEvidence; after: TxEvidence } | null; analysis?: { messageChanged: boolean; instructionDiff: Array<{ type: string; instruction: Instruction }>; earlierSignatureAgainstReturnedMessage: boolean | null; applicationHandling: string } | null; findings: Finding[]; applicationHandling?: string; error?: string; note?: string };
type EventItem = { id: string; sequence: number; timestamp: string; type: string; source: string; payload: Record<string, unknown> };
type Profile = { id: string; name: string; description: string; behavior: string };
const profiles: Profile[] = [
  { id: 'BASELINE_VERBATIM_V1', name: 'Baseline Wallet', description: 'Signs the exact message it receives. Establishes a known-good round trip.', behavior: 'Message preserved' },
  { id: 'WALLET_APPENDED_INSTRUCTION_V1', name: 'Wallet-Appended Instruction', description: 'Adds one deterministic Memo before signing to stress a pre-existing co-signature.', behavior: 'One Memo added' },
  { id: 'SIGN_ONLY_V1', name: 'Sign-Only Wallet', description: 'Omits the optional sign-and-send capability from its feature registry.', behavior: 'Capability omitted' }
];
const short = (value: string, n = 9) => value.length > n * 2 ? `${value.slice(0,n)}…${value.slice(-n)}` : value;
const date = (value?: string) => value ? new Date(value).toLocaleString() : '—';
const title = (value?: string) => value ? value.replaceAll('_',' ').replaceAll('-',' ') : '—';
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, options);
  const envelope = await response.json() as Envelope<T>;
  if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || `Request failed: ${response.status}`);
  return envelope.data;
}
function navigate(path: string) { location.hash = path; }
function currentPath() { return location.hash.slice(1) || '/'; }
async function downloadReport(id: string, format: 'json' | 'markdown') {
  const response = await fetch(`${API}/runs/${id}/export?format=${format}`);
  if (!response.ok) throw new Error(`Export failed: ${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `errling-${id}.${format === 'json' ? 'json' : 'md'}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="icon-button" type="button" aria-label={`${label} to clipboard`} title={label} onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(()=>setCopied(false),1700); }}>{copied ? <Check size={15}/> : <Clipboard size={15}/>}</button>;
}
function Badge({ children, tone = 'neutral' }: {children: React.ReactNode; tone?: 'neutral'|'success'|'danger'|'teal'|'warning'}) { return <span className={`badge ${tone}`}>{children}</span>; }
function Brand() { return <div className="brand-lockup"><span className="brand-card"><img src="/errling-icon.svg" alt=""/><span className="brand-title" role="img" aria-label="Errling"/></span><span className="brand-sub">FIREFLY TRACE</span></div>; }
function App() {
  const [path, setPath] = useState(currentPath());
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('errling-theme-v2') || 'dark');
  useEffect(() => { const update = () => { setPath(currentPath()); setMenuOpen(false); window.scrollTo({top:0,left:0,behavior:'instant'}); }; addEventListener('hashchange', update); return () => removeEventListener('hashchange', update); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('errling-theme-v2', theme); }, [theme]);
  const items = [ { path:'/', label:'Overview', icon: Activity }, { path:'/new', label:'New Trace', icon: Plus }, { path:'/runs', label:'Runs / History', icon: History }, { path:'/inspect', label:'Inspect Transaction', icon: Search }, { path:'/docs', label:'Documentation', icon: BookOpen }, { path:'/settings', label:'Settings', icon: Settings } ];
  return <div className="app-shell">
    <button className="mobile-menu" onClick={()=>setMenuOpen(true)} aria-label="Open navigation"><Menu size={22}/></button>
    {menuOpen && <button className="drawer-backdrop" aria-label="Close navigation" onClick={()=>setMenuOpen(false)}/>}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="sidebar-head"><Brand/><button className="close-menu" onClick={()=>setMenuOpen(false)} aria-label="Close navigation"><X size={20}/></button></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Primary navigation">{items.map(item => { const Icon = item.icon; const active = path === item.path || (item.path === '/runs' && path.startsWith('/runs/')); return <a key={item.path} href={`#${item.path}`} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}><Icon size={18}/><span>{item.label}</span>{item.path === '/new' && <ChevronRight size={16} className="nav-chevron"/>}</a>; })}</nav>
      <div className="sidebar-footer"><div className="network-indicator"><i/> Local diagnostic environment</div><div className="sidebar-footnote">Disposable test identities<br/>Off-chain by default</div></div>
    </aside>
    <main className="content"><header className="topbar"><div className="breadcrumb">ERRLING <span>/</span> {path === '/' ? 'OVERVIEW' : path.startsWith('/runs/') ? 'TRACE REPORT' : path.slice(1).replace('/',' / ').toUpperCase()}</div><button className="theme-button" onClick={()=>setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? <Moon size={18}/> : <Sun size={18}/>}</button></header>
      {path === '/' ? <Overview/> : path === '/new' ? <NewTrace/> : path === '/runs' ? <Runs/> : path.startsWith('/runs/') ? <RunDetail id={path.split('/')[2]}/> : path === '/inspect' ? <Inspector/> : path === '/docs' ? <Docs/> : path === '/settings' ? <SettingsPage/> : <div className="page"><h1>Page not found</h1><button onClick={()=>navigate('/')}>Return to overview</button></div>}
    </main>
  </div>;
}
function Overview() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState('');
  const stageRef = useRef<HTMLDivElement | null>(null);
  const storyRef = useRef<HTMLElement | null>(null);
  const [storyPhase, setStoryPhase] = useState(0);

  useEffect(() => { request<Run[]>('/runs').then(setRuns).catch(e => setError(e.message)); }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let targetX = 0, targetY = 0, x = 0, y = 0, frame = 0;
    const settle = () => {
      x += (targetX - x) * .085;
      y += (targetY - y) * .085;
      stage.style.setProperty('--tilt-x', `${(-y * 7).toFixed(2)}deg`);
      stage.style.setProperty('--tilt-y', `${(x * 9).toFixed(2)}deg`);
      stage.style.setProperty('--light-x', `${(50 + x * 18).toFixed(1)}%`);
      stage.style.setProperty('--light-y', `${(48 + y * 18).toFixed(1)}%`);
      frame = Math.abs(targetX - x) + Math.abs(targetY - y) > .002 ? requestAnimationFrame(settle) : 0;
    };
    const move = (event: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - .5) * 2));
      targetY = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - .5) * 2));
      if (!frame) frame = requestAnimationFrame(settle);
    };
    const leave = () => { targetX = 0; targetY = 0; if (!frame) frame = requestAnimationFrame(settle); };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerleave', leave);
    return () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerleave', leave); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>('.overview-page [data-reveal]:not(.is-visible)');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      elements.forEach(element => element.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
      });
    }, { threshold: .12, rootMargin: '0px 0px -42px 0px' });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [runs, error]);

  useEffect(() => {
    const section = storyRef.current;
    if (!section || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const update = () => {
      const rect = section.getBoundingClientRect();
      const distance = Math.max(1, rect.height - window.innerHeight + 73);
      const progress = Math.max(0, Math.min(1, (73 - rect.top) / distance));
      section.style.setProperty('--story-x', `${(6 + progress * 88).toFixed(2)}%`);
      section.style.setProperty('--story-width', `${(progress * 88).toFixed(2)}%`);
      setStoryPhase(Math.min(2, Math.floor(progress * 3)));
      frame = 0;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    return () => { removeEventListener('scroll', schedule); removeEventListener('resize', schedule); cancelAnimationFrame(frame); };
  }, []);

  const completed = runs?.filter(run => run.state === 'COMPLETED') ?? [];
  const hazards = completed.filter(run => run.report?.findings?.some(finding => finding.ruleId === 'ERR-SIG-001')).length;

  return <div className="page overview-page">
    <section className="editorial-hero" aria-labelledby="editorial-title">
      <div className="hero-meta"><span>ERRLING / 001</span></div>
      <div className="hero-composition">
        <div className="editorial-copy">
          <div className="hero-eyebrow"><span className="eyebrow-line"/> THE WALLET BOUNDARY, MADE VISIBLE</div>
          <h1 id="editorial-title"><span className="hero-mask"><span>What the wallet</span></span><span className="hero-mask"><span><i>really</i> signed.</span></span></h1>
          <div className="hero-description"><span className="description-index">01 / THE QUESTION</span><p>A transaction can change between your dApp and the wallet. Errling captures both sides of that moment and turns the difference into evidence you can act on.</p></div>
          <div className="editorial-actions"><button className="primary hero-primary" onClick={() => navigate('/new')}>Start a trace <ArrowRight size={18}/></button><button className="hero-method" onClick={() => navigate('/docs')}>Explore the method <span>↗</span></button></div>
        </div>
        <div className="firefly-stage" ref={stageRef} aria-hidden="true">
          <span className="stage-topline">A LIGHT ON THE UNSEEN <span>↗</span></span>
          <div className="stage-aperture"/>
          <svg className="stage-trajectory" viewBox="0 0 660 660" preserveAspectRatio="none"><path className="trajectory-base" d="M-28 421 C144 365 204 483 330 369 S515 238 688 279"/><path className="trajectory-drawn" d="M-28 421 C144 365 204 483 330 369 S515 238 688 279"/></svg>
          <div className="stage-light"/>
          <div className="firefly-sculpture"><div className="firefly-glow"/><div className="firefly-depth"/><img src="/errling-icon.svg" alt=""/><div className="firefly-highlight"/></div>
          <div className="stage-data stage-data-left"><span>INPUT / 01</span><b>CAPTURED</b></div>
          <div className="stage-data stage-data-right"><span>OUTPUT / 02</span><b>VERIFIED</b></div>
          <div className="stage-bottomline"><span>FIREFLY TRACE</span><span>ILLUMINATE TRANSACTION ISSUES</span></div>
        </div>
      </div>
      <div className="hero-baseline"><span>01 <i/> CAPTURE</span><span>02 <i/> COMPARE</span><span>03 <i/> VERIFY</span><span className="baseline-end">SCROLL TO EXPLORE ↓</span></div>
    </section>

    <section className="motion-story" ref={storyRef} data-phase={storyPhase} aria-label="How Errling traces the wallet boundary">
      <div className="story-sticky">
        <div className="story-header"><span>01 / THE SIGNING BOUNDARY</span><span>SCROLL TO FOLLOW THE EVIDENCE</span></div>
        <div className="story-layout">
          <div className="story-narrative">
            {[
              {number:'01',label:'CAPTURE',title:'Begin with the exact bytes.',body:'Errling records the transaction your dApp hands to its controlled wallet before signing begins.'},
              {number:'02',label:'COMPARE',title:'Find the moment it changes.',body:'It compares the returned message and instructions with the original request, exposing any difference at the wallet boundary.'},
              {number:'03',label:'VERIFY',title:'Turn the difference into proof.',body:'Signature checks and a clear report show whether the dApp handled the changed response safely.'}
            ].map((step,i)=><div className={`story-panel ${storyPhase===i?'active':''}`} key={step.number}>
              <div className="story-kicker"><span>{step.number} / 03</span><span>{step.label}</span></div>
              <h2>{step.title}</h2><p>{step.body}</p>
            </div>)}
          </div>
          <div className="story-visual" aria-hidden="true">
            <div className="story-orbit story-orbit-one"/><div className="story-orbit story-orbit-two"/>
            <div className="story-trace"><div className="story-trace-active"/><span className="story-node node-one"/><span className="story-node node-two"/><span className="story-node node-three"/><span className="story-signal"><img src="/errling-icon.svg" alt=""/></span></div>
            <div className="story-visual-labels"><span>REQUEST</span><span>WALLET</span><span>EVIDENCE</span></div>
          </div>
        </div>
        <div className="story-footer"><span>01 — 03 / A TRANSACTION’S JOURNEY</span><span>NO BROADCAST IN THE CONTROLLED TRACE</span></div>
      </div>
    </section>

    <section className="editorial-section ways-section" data-reveal>
      <div className="section-rail"><span>02 / INVESTIGATE</span><span>START WITH A QUESTION</span></div>
      <div className="section-lead"><h2>See the change.<br/><em>Understand the cause.</em></h2><p>Two precise ways into the evidence. Run a controlled signing flow, or inspect a transaction that already landed on-chain.</p></div>
      <div className="investigation-list">
        <button className="investigation-row" onClick={() => navigate('/new')}><span className="investigation-number">01</span><span className="investigation-copy"><strong>Trace a wallet round trip</strong><small>Exercise a real Wallet Standard flow in a controlled browser.</small></span><span className="investigation-action"><ArrowRight size={21}/></span></button>
        <button className="investigation-row" onClick={() => navigate('/inspect')}><span className="investigation-number">02</span><span className="investigation-copy"><strong>Inspect an existing transaction</strong><small>Read confirmed on-chain evidence by signature and network.</small></span><span className="investigation-action"><ArrowRight size={21}/></span></button>
      </div>
    </section>

    <section className="editorial-statement" data-reveal><span>THE PRINCIPLE / 03</span><p>The difference between what was requested and what was signed should never be invisible<span>.</span></p><div className="statement-rule"><i/></div></section>

    <section className="editorial-section recent-section" data-reveal>
      <div className="section-rail"><span>04 / YOUR WORKSPACE</span><span>LOCAL EVIDENCE</span></div>
      <div className="recent-heading"><div><h2>Recent traces</h2><p>Every run stays on this machine, with the evidence needed to understand its outcome.</p></div><button className="text-link" onClick={() => navigate('/runs')}>View all runs <ArrowRight size={16}/></button></div>
      {error ? <div className="notice danger"><CircleAlert size={20}/><span>{error}. Start the local API with <code>npm run dev</code>.</span></div> : !runs ? <div className="skeleton-panel">Loading local run history…</div> : runs.length === 0 ? <div className="empty-state"><div className="empty-symbol"><img src="/errling-icon.svg" alt=""/></div><h3>Your first trace starts here</h3><p>Completed signing tests will appear here with captured message hashes, signature checks, and application handling.</p><button className="primary small" onClick={() => navigate('/new')}>Start a trace <ArrowRight size={16}/></button></div> : <><div className="metrics"><div><span>Completed runs</span><strong>{completed.length}</strong></div><div><span>Verified signature hazards</span><strong>{hazards}</strong></div><div><span>Total local runs</span><strong>{runs.length}</strong></div></div><div className="list-panel">{runs.slice(0, 5).map(run => <RunRow key={run.id} run={run}/>)}</div></>}
    </section>
    <div className="scope-note" data-reveal><Radio size={17}/><div><strong>Two distinct evidence paths.</strong> A Trace captures a wallet round trip in a test browser. The Inspector reads already confirmed transactions from Solana RPC. A signing test is not an on-chain confirmation.</div></div>
  </div>;
}

function NewTrace() {
  const [targetKind, setTargetKind] = useState<'example'|'local'>('example');
  const [targetUrl, setTargetUrl] = useState('http://127.0.0.1:3001');
  const [profile, setProfile] = useState(profiles[1].id);
  const [appMode, setAppMode] = useState<'vulnerable'|'protected'>('vulnerable');
  const [interactionMode, setInteractionMode] = useState<'automated'|'guided'>('automated');
  const [connectSelector, setConnectSelector] = useState('[data-testid="connect-wallet"]');
  const [signSelector, setSignSelector] = useState('[data-testid="run-signing"]');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const start = async () => {
    setError(''); setLoading(true);
    try { const data = await request<{id:string}>('/runs', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ targetUrl: targetKind === 'example' ? 'http://127.0.0.1:3001' : targetUrl, profile, appMode, interactionMode: targetKind === 'example' ? 'automated' : interactionMode, interactionPlan: targetKind === 'local' && interactionMode === 'automated' ? [{selector:connectSelector,action:'click'},{selector:signSelector,action:'click'}] : undefined, broadcastEnabled:false }) }); navigate(`/runs/${data.id}`); }
    catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  return <div className="page narrow"><div className="page-intro"><div className="eyebrow">NEW DIAGNOSTIC RUN</div><h1>Configure a trace</h1><p>Choose a dApp and a controlled wallet behavior. Errling will capture the transaction at the signing boundary and verify the returned bytes.</p></div>
    <section className="form-section"><div className="section-number">01</div><div className="section-body"><h2>Application under test</h2><div className="choice-grid"><button className={`choice-card ${targetKind==='example'?'selected':''}`} onClick={()=>setTargetKind('example')} aria-pressed={targetKind==='example'}><span className="choice-top"><FlaskConical size={22}/><Badge tone="teal">Recommended</Badge></span><strong>Try Example App</strong><small>Bundled reference flow with known selectors and a disposable co-signer.</small></button><button className={`choice-card ${targetKind==='local'?'selected':''}`} onClick={()=>{setTargetKind('local');setInteractionMode('guided');}} aria-pressed={targetKind==='local'}><span className="choice-top"><Code2 size={22}/></span><strong>Test Local dApp</strong><small>Open a loopback Wallet Standard app in a controlled browser.</small></button></div>{targetKind==='local' && <div className="field"><label htmlFor="target-url">Local application URL</label><input id="target-url" value={targetUrl} onChange={e=>setTargetUrl(e.target.value)} placeholder="http://127.0.0.1:3001"/><p>Guided mode opens a visible browser. Connect the Errling wallet and trigger signing manually.</p><div className="segmented"><button className={interactionMode==='guided'?'active':''} onClick={()=>setInteractionMode('guided')}>Guided browser</button><button className={interactionMode==='automated'?'active':''} onClick={()=>setInteractionMode('automated')}>Configured selectors</button></div>{interactionMode==='automated'&&<div className="selector-fields"><label htmlFor="connect-selector">Connect button selector</label><input id="connect-selector" value={connectSelector} onChange={e=>setConnectSelector(e.target.value)}/><label htmlFor="sign-selector">Sign button selector</label><input id="sign-selector" value={signSelector} onChange={e=>setSignSelector(e.target.value)}/></div>}</div>}</div></section>
    <section className="form-section"><div className="section-number">02</div><div className="section-body"><h2>Wallet behavior profile</h2><div className="profile-stack">{profiles.map((p,i)=><button key={p.id} className={`profile-card ${profile===p.id?'selected':''}`} onClick={()=>setProfile(p.id)} aria-pressed={profile===p.id}><span className={`profile-icon ${i===1?'coral':''}`}>{i===0?<ShieldCheck size={20}/>:i===1?<Activity size={20}/>:<Fingerprint size={20}/>}</span><span className="profile-copy"><strong>{p.name}</strong><small>{p.description}</small><span className="profile-behavior">{p.behavior}</span></span><span className="radio-dot"/></button>)}</div></div></section>
    <section className="form-section"><div className="section-number">03</div><div className="section-body"><h2>Example application handling</h2><p className="section-caption">The same signing scenario can reveal a hazard and still be handled correctly by the app.</p><div className="segmented wide"><button className={appMode==='vulnerable'?'active':''} onClick={()=>setAppMode('vulnerable')}>Vulnerable Flow</button><button className={appMode==='protected'?'active':''} onClick={()=>setAppMode('protected')}>Protected Flow</button></div><p className="hint">{appMode==='vulnerable'?'The example deliberately continues without enforcing returned-message integrity. It never broadcasts.':'The example compares the returned message and validates signatures before proceeding.'}</p></div></section>
    <div className="run-footer"><div><strong>Off-chain signing only</strong><span>Devnet chain metadata · no transaction will be submitted</span></div><button className="primary" onClick={start} disabled={loading}>{loading?'Starting browser…':'Start Trace'} <ArrowRight size={18}/></button></div>{error && <div className="notice danger" role="alert"><CircleAlert size={18}/>{error}</div>}
  </div>;
}
function RunRow({run}:{run:Run}) { return <button className="run-row" onClick={()=>navigate(`/runs/${run.id}`)}><span className="run-icon"><Activity size={18}/></span><span className="run-primary"><strong>{profiles.find(p=>p.id===run.profile)?.name || run.profile}</strong><small>{run.target_url} · {title(run.app_mode)} flow</small></span><span className="run-date">{date(run.created_at)}</span><Badge tone={run.state==='COMPLETED'?'success':run.state==='FAILED'?'danger':'warning'}>{title(run.state)}</Badge><ChevronRight size={18}/></button>; }
function Runs() { const [runs,setRuns]=useState<Run[]|null>(null); const [error,setError]=useState(''); useEffect(()=>{request<Run[]>('/runs').then(setRuns).catch(e=>setError(e.message));},[]); return <div className="page"><div className="page-intro horizontal"><div><div className="eyebrow">LOCAL HISTORY</div><h1>Runs & reports</h1><p>Every completed run is saved on this machine with its captured evidence.</p></div><button className="primary" onClick={()=>navigate('/new')}>New Trace <Plus size={17}/></button></div>{error?<div className="notice danger">{error}</div>:!runs?<div className="skeleton-panel">Loading runs…</div>:runs.length===0?<div className="empty-state"><History size={33}/><h3>No runs yet</h3><p>Start with the bundled reference app to create your first evidence-backed report.</p><button className="primary small" onClick={()=>navigate('/new')}>New Trace</button></div>:<div className="list-panel">{runs.map(run=><RunRow key={run.id} run={run}/>)}</div>}</div>; }
function RunDetail({id}:{id:string}) {
  const [run,setRun]=useState<Run|null>(null); const [events,setEvents]=useState<EventItem[]>([]); const [error,setError]=useState(''); const [exportError,setExportError]=useState('');
  useEffect(()=>{let mounted=true; const load=()=>request<Run>(`/runs/${id}`).then(data=>{if(mounted)setRun(data);}).catch(e=>{if(mounted)setError(e.message);}); load(); const timer=setInterval(load,1200); const source=new EventSource(`${API}/runs/${id}/events`); source.onmessage=e=>{const item=JSON.parse(e.data) as EventItem; setEvents(prev=>prev.some(x=>x.id===item.id)?prev:[...prev,item].sort((a,b)=>a.sequence-b.sequence));}; return()=>{mounted=false;clearInterval(timer);source.close();};},[id]);
  if(error) return <div className="page"><div className="notice danger">{error}</div></div>;
  if(!run) return <div className="page"><div className="skeleton-panel">Loading trace…</div></div>;
  const report=run.report;
  const complete=['COMPLETED','FAILED','CANCELLED','TIMED_OUT'].includes(run.state);
  return <div className="page"><div className="report-heading"><div><div className="eyebrow">TRACE REPORT · {short(id,6).toUpperCase()}</div><h1>{report?.capture ? report.analysis?.messageChanged ? 'Message changed at the wallet boundary' : 'Signing round trip captured' : complete ? 'Diagnostic run finished' : 'Tracing the wallet interaction'}</h1><p>{profiles.find(p=>p.id===run.profile)?.name} · {title(run.app_mode)} flow · {date(run.created_at)}</p></div><Badge tone={run.state==='COMPLETED'?'success':run.state==='FAILED'?'danger':'warning'}>{title(run.state)}</Badge></div>
    {!complete && <div className="progress-panel"><span className="pulse-dot"/><div><strong>{title(run.state)}</strong><p>{run.interaction_mode === 'guided' ? 'Use the visible Chrome window to connect Errling Controlled Wallet and trigger signing. Captured evidence will appear here.' : 'Browser actions and wallet evidence are being captured. This page updates as the run progresses.'}</p></div><button className="secondary small" onClick={()=>request(`/runs/${id}/cancel`,{method:'POST'}).catch(e=>setError(e.message))}>Cancel run</button></div>}
    {report && <><div className="report-summary"><div className={`summary-icon ${report.applicationHandling==='unsafe-assumption'?'danger':''}`}>{report.applicationHandling==='handled-correctly'?<ShieldCheck size={27}/>:report.findings.length?<CircleAlert size={27}/>:<CircleCheck size={27}/>}</div><div><div className="eyebrow">APPLICATION HANDLING</div><h2>{report.applicationHandling==='handled-correctly'?'Handled correctly':report.applicationHandling==='unsafe-assumption'?'Unsafe application assumption':report.applicationHandling==='accepted'?'Valid baseline signing':'Outcome inconclusive'}</h2><p>{report.applicationHandling==='handled-correctly'?'The example rejected the unexpected change or checked the missing capability before use.':report.applicationHandling==='unsafe-assumption'?'The example proceeded without the required integrity or capability check. No broadcast occurred.':report.error||report.note||'The captured evidence is shown below.'}</p></div></div>
      {report.findings.length>0 && <section className="report-section"><div className="section-heading"><div><div className="eyebrow">RULE-BASED ANALYSIS</div><h2>Findings</h2></div></div><div className="finding-stack">{report.findings.map(f=><div className="finding" key={f.ruleId}><div className="finding-top"><Badge tone={f.severity==='critical'?'danger':'warning'}>{f.ruleId}</Badge><Badge tone="neutral">{f.evidence}</Badge></div><h3>{f.title}</h3><p>{f.explanation}</p><div className="fix"><strong>Suggested fix</strong><span>{f.fix}</span><CopyButton value={f.fix} label="Copy suggested fix"/></div></div>)}</div></section>}
      {report.capture && <><section className="report-section"><div className="section-heading"><div><div className="eyebrow">SERIALIZED TRANSACTION EVIDENCE</div><h2>Before / after</h2></div><Badge tone={report.analysis?.messageChanged?'danger':'success'}>{report.analysis?.messageChanged?'Message changed':'Message preserved'}</Badge></div><div className="comparison"><div className="evidence-card"><div className="evidence-title">Before wallet <Badge>INPUT</Badge></div><label>SHA-256 message hash</label><div className="hash-line"><code>{report.capture.before.messageHash}</code><CopyButton value={report.capture.before.messageHash}/></div><label>Instructions</label>{report.capture.before.instructions.map(ix=><InstructionRow key={ix.index} ix={ix}/>)}</div><div className="evidence-card"><div className="evidence-title">Returned by wallet <Badge tone="teal">OUTPUT</Badge></div><label>SHA-256 message hash</label><div className="hash-line"><code>{report.capture.after.messageHash}</code><CopyButton value={report.capture.after.messageHash}/></div><label>Instructions</label>{report.capture.after.instructions.map(ix=><InstructionRow key={ix.index} ix={ix} added={ix.index>=report.capture!.before.instructions.length}/>)}</div></div><details className="raw-evidence"><summary>Raw serialized evidence <ChevronRight size={16}/></summary><div><label>Input transaction · base64</label><div className="raw-line"><code>{report.capture.before.serializedBase64}</code><CopyButton value={report.capture.before.serializedBase64}/></div><label>Returned transaction · base64</label><div className="raw-line"><code>{report.capture.after.serializedBase64}</code><CopyButton value={report.capture.after.serializedBase64}/></div></div></details></section>
      <section className="report-section"><div className="section-heading"><div><div className="eyebrow">INDEPENDENT ED25519 VERIFICATION</div><h2>Required signatures</h2></div></div><div className="signature-table"><div className="table-head"><span>Signer</span><span>Before</span><span>Returned</span></div>{report.capture.after.signatures.map(sig=>{const before=report.capture!.before.signatures.find(s=>s.signer===sig.signer);return <div className="table-row" key={sig.signer}><span className="mono address" title={sig.signer}>{short(sig.signer,12)} <CopyButton value={sig.signer}/></span><Badge tone={before?.state==='valid'?'success':'warning'}>{before?.state||'missing'}</Badge><Badge tone={sig.state==='valid'?'success':'danger'}>{sig.state}</Badge></div>})}</div><p className="evidence-note">Each signature was verified against exact serialized message bytes and its signer public key. A signature present in the byte array is not automatically valid.</p></section></>}
      <div className="report-actions"><button className="secondary" onClick={()=>void downloadReport(id,'json').catch(e=>setExportError(e.message))}><Download size={17}/> Export JSON</button><button className="secondary" onClick={()=>void downloadReport(id,'markdown').catch(e=>setExportError(e.message))}><Download size={17}/> Export Markdown</button><CopyButton value={id} label="Copy run ID"/><span className="mono muted">{id}</span></div>{exportError&&<div className="notice danger" role="alert">{exportError}</div>}</>}
    <section className="report-section"><div className="section-heading"><div><div className="eyebrow">OBSERVED EVENTS</div><h2>Trace timeline</h2></div></div><div className="timeline">{events.map(e=><div className="timeline-item" key={e.id}><span className="timeline-dot"/><span className="mono">{new Date(e.timestamp).toLocaleTimeString()}</span><strong>{title(e.type)}</strong><small>{e.source}</small></div>)}</div></section>
  </div>;
}
function InstructionRow({ix,added=false}:{ix:Instruction;added?:boolean}) { return <div className={`instruction ${added?'added':''}`}><span className="instruction-index">{String(ix.index+1).padStart(2,'0')}</span><div><strong>{ix.label}</strong><code>{ix.programId}</code>{added&&<Badge tone="danger">Added</Badge>}</div></div>; }
type RpcTransaction = { slot: number; blockTime: number | null; version: string|number; meta: {err: unknown;fee:number;logMessages?: string[]|null;preBalances?:number[];postBalances?:number[]} | null; transaction: {signatures:string[];message:{accountKeys:Array<string|{pubkey:string;signer?:boolean}>;instructions:Array<{program?:string;programId:string;parsed?:unknown;data?:string}>}} };
function Inspector() {
  const [signature,setSignature]=useState(''); const [network,setNetwork]=useState<'devnet'|'mainnet'>('devnet'); const [result,setResult]=useState<{network:string;endpoint:string;retrievedAt:string;transaction:RpcTransaction}|null>(null); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const inspect=async()=>{setLoading(true);setError('');setResult(null);try{setResult(await request('/transactions/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signature:signature.trim(),network})}));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);}};
  const tx=result?.transaction;
  return <div className="page"><div className="page-intro"><div className="eyebrow">READ-ONLY RPC INSPECTION</div><h1>Inspect a transaction</h1><p>Retrieve confirmed on-chain evidence from your selected Solana network. This is separate from a wallet round-trip Trace.</p></div><div className="inspector-form"><div className="field grow"><label htmlFor="signature">Transaction signature</label><input id="signature" className="mono" value={signature} onChange={e=>setSignature(e.target.value)} placeholder="Paste a base58 Solana transaction signature" onKeyDown={e=>{if(e.key==='Enter')void inspect();}}/></div><div className="field"><label htmlFor="network">Network</label><select id="network" value={network} onChange={e=>setNetwork(e.target.value as 'devnet'|'mainnet')}><option value="devnet">Devnet</option><option value="mainnet">Mainnet</option></select></div><button className="primary" onClick={inspect} disabled={loading||!signature.trim()}>{loading?'Retrieving…':'Inspect'} <Search size={17}/></button></div>{error&&<div className="notice danger" role="alert"><CircleAlert size={18}/><span>{error}</span></div>}{loading&&<div className="skeleton-panel">Querying Solana RPC for confirmed transaction data…</div>}{tx&&<><div className="rpc-banner"><Badge tone="success">RPC Confirmed</Badge><span>Retrieved {date(result?.retrievedAt)} from {result?.network}</span><a href={`https://explorer.solana.com/tx/${signature}?cluster=${network === 'mainnet' ? 'mainnet-beta' : 'devnet'}`} target="_blank" rel="noreferrer">Open in Explorer <ExternalLink size={14}/></a></div><div className="inspector-grid"><div className="stat-card"><span>Execution</span><strong className={tx.meta?.err?'error-text':'success-text'}>{tx.meta?.err?'Failed':'Succeeded'}</strong></div><div className="stat-card"><span>Slot</span><strong>{tx.slot.toLocaleString()}</strong></div><div className="stat-card"><span>Version</span><strong>{String(tx.version)}</strong></div><div className="stat-card"><span>Fee</span><strong>{tx.meta?.fee!=null?`${(tx.meta.fee/1e9).toFixed(9)} SOL`:'Unavailable'}</strong></div></div>{tx.meta?.err&&<div className="notice danger"><CircleAlert size={18}/><div><strong>Network execution error</strong><pre>{JSON.stringify(tx.meta.err,null,2)}</pre></div></div>}<section className="report-section"><div className="section-heading"><div><div className="eyebrow">NETWORK MESSAGE</div><h2>Instructions</h2></div></div><div className="list-panel">{tx.transaction.message.instructions.map((ix,i)=><div className="rpc-instruction" key={i}><span className="instruction-index">{String(i+1).padStart(2,'0')}</span><div><strong>{ix.program||'Program instruction'}</strong><code>{ix.programId}</code>{ix.parsed!=null&&<pre>{JSON.stringify(ix.parsed,null,2)}</pre>}{ix.data&&<code>Data: {ix.data}</code>}</div></div>)}</div></section><section className="report-section"><div className="section-heading"><div><div className="eyebrow">ACCOUNT KEYS</div><h2>Accounts</h2></div></div><div className="list-panel">{tx.transaction.message.accountKeys.map((key,i)=>{const address=typeof key==='string'?key:key.pubkey;const delta=tx.meta?.preBalances?.[i]!=null&&tx.meta?.postBalances?.[i]!=null?(tx.meta.postBalances[i]-tx.meta.preBalances[i])/1e9:null;return <div className="account-row" key={i}><span className="mono">{short(address,18)}</span>{typeof key==='object'&&key.signer&&<Badge tone="teal">Signer</Badge>}{delta!==null&&<span className="mono muted">{delta>=0?'+':''}{delta.toFixed(9)} SOL</span>}<CopyButton value={address}/></div>})}</div></section>{tx.meta?.logMessages&&<section className="report-section"><div className="section-heading"><div><div className="eyebrow">EXECUTION META</div><h2>Logs</h2></div></div><pre className="logs">{tx.meta.logMessages.join('\n')}</pre></section>}</>}{!result&&!error&&!loading&&<div className="empty-state inspector-empty"><Search size={34}/><h3>No transaction loaded</h3><p>Paste a signature above. The result will show only data returned by the selected RPC endpoint.</p></div>}</div>;
}
function Docs() { return <div className="page narrow"><div className="page-intro"><div className="eyebrow">PRODUCT GUIDE</div><h1>How Errling works</h1><p>Errling makes the wallet a controlled variable and verifies the bytes crossing the signing boundary.</p></div><div className="doc-stack"><section><div className="doc-icon"><FlaskConical size={20}/></div><h2>Trace a signing flow</h2><p>A Playwright browser opens a local Wallet Standard web app with Errling’s disposable wallet registered before the app loads. The reference app creates a real, partially signed legacy Solana transaction. The wallet captures its input bytes, applies the selected behavior, signs, and returns serialized bytes.</p></section><section><div className="doc-icon"><Fingerprint size={20}/></div><h2>Verify the difference</h2><p>Errling hashes the original and returned messages, decodes instructions, and verifies each Ed25519 signature against the exact message bytes. A changed message can invalidate an earlier co-signer signature. The report assesses the hazard separately from how the dApp reacted.</p></section><section><div className="doc-icon"><ShieldCheck size={20}/></div><h2>Interpret the result</h2><p>The appended Memo is a controlled stress test, not a claim about a named real wallet. Protected Flow refuses an unexpected change and receives a positive handling assessment. Vulnerable Flow intentionally demonstrates the unsafe assumption without broadcasting a transaction.</p></section><section><div className="doc-icon"><Search size={20}/></div><h2>Inspect an on-chain transaction</h2><p>The Inspector queries Solana RPC for an existing signature. It cannot reconstruct a historical transaction’s pre-wallet bytes. Off-chain signing evidence and on-chain execution evidence remain separate.</p></section></div><div className="doc-cta"><div><strong>Ready to see the wallet boundary?</strong><p>Run the example app with Wallet-Appended Instruction and compare vulnerable and protected handling.</p></div><button className="primary small" onClick={()=>navigate('/new')}>New Trace <ArrowRight size={16}/></button></div></div>; }
function SettingsPage() { const [health,setHealth]=useState<{status:string;database:string;browser:string}|null>(null); const [error,setError]=useState(''); useEffect(()=>{request<{status:string;database:string;browser:string}>('/health').then(setHealth).catch(e=>setError(e.message));},[]); return <div className="page narrow"><div className="page-intro"><div className="eyebrow">LOCAL ENVIRONMENT</div><h1>Settings</h1><p>Runtime details for this machine. Errling has no personal wallet connection or cloud account.</p></div><div className="setting-card"><div><strong>Diagnostic API</strong><p>Bound to the local loopback interface.</p></div><Badge tone={health?'success':'danger'}>{health?'Available':'Unavailable'}</Badge></div><div className="setting-card"><div><strong>Browser runner</strong><p>{health?.browser||'Start the local API to check browser configuration.'}</p></div><Badge>Playwright</Badge></div><div className="setting-card"><div><strong>History storage</strong><p className="mono">{health?.database||'Local SQLite database'}</p></div><Badge>Local</Badge></div>{error&&<div className="notice danger">{error}</div>}<div className="scope-note"><ShieldCheck size={18}/><span>Private signing keys are generated for each run and are never saved to reports or history.</span></div></div>; }
createRoot(document.getElementById('root')!).render(<App/>);
