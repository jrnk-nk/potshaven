import React,{lazy,Suspense,useEffect,useRef,useState} from 'react';
import './connection.css';
import './mobile.css';
import {BRAND_NAME,BRAND_LOGO,BRAND_LOGO_PREVIEW} from './branding';
import {useApp,money,today} from './state';
import {Icon,Modal,Field,initials} from './ui';
import BrandSignature from './BrandSignature';
const operations = () => import('./pages/Operations');
const studio = () => import('./pages/Studio');
const PlacesPage=lazy(()=>operations().then(module=>({default:module.PlacesPage})));
const SchedulePage=lazy(()=>operations().then(module=>({default:module.SchedulePage})));
const ProjectsPage=lazy(()=>operations().then(module=>({default:module.ProjectsPage})));
const TeamPage=lazy(()=>operations().then(module=>({default:module.TeamPage})));
const JobForm=lazy(()=>operations().then(module=>({default:module.JobForm})));
const InventoryPage=lazy(()=>import('./pages/Inventory').then(module=>({default:module.InventoryPage})));
const BusinessPage=lazy(()=>import('./pages/Business').then(module=>({default:module.BusinessPage})));
const StudioPage=lazy(()=>studio().then(module=>({default:module.StudioPage})));
const CompanyAssistant=lazy(()=>import('./pages/Assistant'));
const PortfolioPage=lazy(()=>studio().then(module=>({default:module.PortfolioPage})));
const SettingsPage=lazy(()=>studio().then(module=>({default:module.SettingsPage})));
import Dashboard from './pages/Dashboard';
const nav=[
 {key:'overview',label:'Home',icon:'LayoutDashboard'},
 {key:'schedule',label:'Schedule',icon:'CalendarDays'},
 {key:'places',label:'Places',icon:'MapPin'},
 {key:'inventory',label:'Inventory',icon:'Sprout'},
 {key:'studio',label:'Design studio',icon:'WandSparkles'},
 {key:'assistant',label:'Company assistant',icon:'MessageCircle'},
 {key:'projects',label:'Projects',icon:'FolderKanban'},
 {key:'team',label:'Team & vehicles',icon:'UsersRound'},
 {key:'business',label:'Business',icon:'ChartNoAxesCombined'},
 {key:'portfolio',label:'Portfolio & reports',icon:'Images'},
];
export default function App(){
 const {data,loading,refreshing,error,errorCode,connection,hasData,authenticated,refresh,notify,toast}=useApp();
 const [page,setPage]=useState(location.hash.slice(1)||'overview'),[mobile,setMobile]=useState(false),[search,setSearch]=useState(''),[notifications,setNotifications]=useState(false),[newJob,setNewJob]=useState<string|boolean>(false),[help,setHelp]=useState(false),[more,setMore]=useState(nav.findIndex(n=>n.key===(location.hash.slice(1)||'overview'))>4);
 const sidebarRef=useRef<HTMLElement>(null),notificationRef=useRef<HTMLDivElement>(null);
 const go=(key:string)=>{location.hash=key;setPage(key);setMobile(false);setSearch('');setNotifications(false);setMore(nav.findIndex(n=>n.key===key)>4);};
 useEffect(()=>{if(nav.findIndex(n=>n.key===page)>4)setMore(true);},[page]);
 useEffect(()=>{const onHash=()=>{setPage(location.hash.slice(1)||'overview');setMobile(false);setNotifications(false);};const onJob=(e:Event)=>setNewJob((e as CustomEvent).detail||true);window.addEventListener('hashchange',onHash);window.addEventListener('potshaven:job',onJob);return()=>{window.removeEventListener('hashchange',onHash);window.removeEventListener('potshaven:job',onJob);};},[]);
 useEffect(()=>{const color=data.settings.accentColor;if(/^#[0-9a-f]{6}$/i.test(color||'')){document.documentElement.style.setProperty('--green',color);document.documentElement.style.setProperty('--green-dark',color);}else{document.documentElement.style.removeProperty('--green');document.documentElement.style.removeProperty('--green-dark');}},[data.settings.accentColor]);
 useEffect(()=>{document.title=`${data.settings.companyName||'PotsHaven'} · ${nav.find(n=>n.key===page)?.label||'Settings'}`;},[page,data.settings]);
 useEffect(()=>{
  if(!mobile)return;
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  sidebarRef.current?.querySelector<HTMLElement>('.drawer-close')?.focus();
  const keyboard=(event:KeyboardEvent)=>{
   if(event.key==='Escape')setMobile(false);
   if(event.key!=='Tab')return;
   const items=[...(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')||[])].filter(item=>item.offsetParent!==null);
   const first=items[0],last=items.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };
  document.addEventListener('keydown',keyboard);
  return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keyboard);previous?.focus();};
 },[mobile]);
 useEffect(()=>{
  if(!notifications)return;
  const close=(event:PointerEvent)=>{if(!notificationRef.current?.contains(event.target as Node))setNotifications(false);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setNotifications(false);notificationRef.current?.querySelector<HTMLButtonElement>('.notification-button')?.focus();}};
  document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
 },[notifications]);
 const low=data.inventory.filter(i=>Number(i.quantity)<=Number(i.minStock));
 const due=data.jobs.filter(j=>j.status!=='Completed'&&(j.deadline||j.date)<today());
 const soon = new Date(Date.now()+2*86400000).toISOString().slice(0,10);
 const upcoming=data.jobs.filter(j=>{const date=j.type==='Project'?(j.deadline||j.date):j.date;return j.status!=='Completed'&&date>=today()&&date<=soon;});
 const renewals=data.contracts.filter(c=>c.status==='Active'&&c.renewalDate>=today()&&c.renewalDate<=new Date(Date.now()+14*86400000).toISOString().slice(0,10));
 const alerts=[...due.map(j=>({title:j.title,detail:'Visit overdue · '+j.date,page:'schedule',icon:'CalendarClock'})),...low.map(i=>({title:i.name,detail:`Low stock · ${i.quantity} ${i.unit||'left'}`,page:'inventory',icon:'Sprout'})),...data.equipment.filter(e=>(e.nextService||e.nextServiceDate||'9999')<=today()).map(e=>({title:e.name,detail:'Equipment service due',page:'inventory',icon:'Wrench'})),...data.payments.filter(p=>p.status!=='Paid'&&p.dueDate<today()).map(p=>({title:p.description,detail:'Payment overdue · '+money(p.amount),page:'business',icon:'Wallet'})),...upcoming.map(j=>({title:j.title,detail:j.type==='Project'?`Project deadline · ${j.deadline||j.date}`:`Upcoming visit · ${j.date} at ${j.time||'09:00'}`,page:'schedule',icon:'CalendarDays'})),...renewals.map(c=>({title:c.title,detail:'Contract renewal · '+c.renewalDate,page:'business',icon:'FolderOpen'}))];
 if(loading)return <div className="loading-screen"><Brand/><span className="loader"/><p>Getting things growing…</p></div>;
 if(!authenticated)return <Login/>;
 if(connection==='setup'&&!hasData)return <SetupScreen retry={refresh} busy={refreshing} error={error} code={errorCode}/>;
 const results=search.trim()?[
 ...data.places.filter(p=>(p.name+' '+p.client).toLowerCase().includes(search.toLowerCase())).map(p=>({title:p.name,subtitle:'Place · '+p.client,page:'places',icon:'MapPin'})),
 ...data.jobs.filter(j=>j.title.toLowerCase().includes(search.toLowerCase())).map(j=>({title:j.title,subtitle:'Job · '+j.status,page:'schedule',icon:'CalendarDays'})),
 ...data.inventory.filter(i=>i.name.toLowerCase().includes(search.toLowerCase())).map(i=>({title:i.name,subtitle:'Inventory · '+i.quantity+' available',page:'inventory',icon:'Sprout'}))].slice(0,7):[];
 return <div className="app-shell">
 {mobile&&<button className="sidebar-overlay" aria-label="Close menu" onClick={()=>setMobile(false)}/>}
 <aside id="workspace-menu" ref={sidebarRef} className={`sidebar ${mobile?'sidebar-open':''}`} role={mobile?'dialog':undefined} aria-modal={mobile?true:undefined} aria-label={mobile?'Workspace menu':undefined}><button type="button" className="icon-button drawer-close" aria-label="Close workspace menu" onClick={()=>setMobile(false)}><Icon name="X"/></button><a className="brand-link" href="#overview" onClick={()=>go('overview')}><Brand name={data.settings.companyName} logo={data.settings.logo}/><span className="sidebar-brand-note">MANAGER</span></a><div className="workspace-label">YOUR DAY</div>
 <nav aria-label="Main navigation">
 {nav.slice(0,5).map(n=><button key={n.key} className={`nav-item ${page===n.key?'active':''}`} aria-current={page===n.key?'page':undefined} onClick={()=>go(n.key)}><Icon name={n.icon} size={20}/><span>{n.label}</span></button>)}
 <button className={`nav-item more-tools-button ${more?'expanded':''}`} aria-expanded={more} aria-controls="extra-tools" onClick={()=>setMore(!more)}><Icon name="FolderOpen" size={20}/><span>More tools</span><Icon name="ChevronDown" size={15}/></button>
 <div id="extra-tools" className="extra-tools" hidden={!more}>{nav.slice(5).map(n=><button key={n.key} className={`nav-item ${page===n.key?'active':''}`} aria-current={page===n.key?'page':undefined} onClick={()=>go(n.key)}><Icon name={n.icon} size={18}/><span>{n.label}</span></button>)}</div>
 </nav>
 <div className="sidebar-bottom"><button className="help-link" onClick={()=>{setMobile(false);setHelp(true);}}><Icon name="CircleHelp" size={17}/> How to use this app</button><button className={`nav-item ${page==='settings'?'active':''}`} onClick={()=>go('settings')}><Icon name="Settings2"/><span>Settings & branding</span></button><button className="sidebar-account" onClick={()=>go('settings')}><div className="avatar owner-avatar">{initials(data.settings.ownerName||'Business Owner')}</div><div><strong>{data.settings.ownerName||'Your workspace'}</strong><span>{data.role==='manager'?'Manager':'Business owner'}</span></div><Icon name="ChevronDown" size={15}/></button></div></aside>
 <div className={`workspace${page==='studio'?' studio-workspace':page==='assistant'?' assistant-workspace':''}`}><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open menu" aria-expanded={mobile} aria-controls="workspace-menu" onClick={()=>{setNotifications(false);setMobile(true);}}><Icon name="Menu"/></button><strong>{nav.find(n=>n.key===page)?.label||'Settings & branding'}</strong><a className="mobile-studio-brand" href="#overview" aria-label="Go to home" onClick={()=>go('overview')}><Brand name={data.settings.companyName} logo={data.settings.logo}/></a></div><div className="topbar-actions"><div className="global-search"><Icon name="Search" size={16}/><input aria-label="Search workspace" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find anything…"/>{search&&<div className="search-results">{results.length?results.map((r,i)=><button key={i} onClick={()=>go(r.page)}><Icon name={r.icon}/><span><strong>{r.title}</strong><small>{r.subtitle}</small></span><Icon name="ArrowUpRight" size={14}/></button>):<p>No matches. Try a place, job, or plant.</p>}</div>}</div><span className="topbar-divider"/><div className="notifications-wrap" ref={notificationRef}><button className="icon-button notification-button" aria-expanded={notifications} aria-controls="workspace-alerts" aria-label={`Notifications, ${alerts.length} alerts`} onClick={()=>setNotifications(!notifications)}><Icon name="Bell"/>{alerts.length>0&&<i/>}</button>{notifications&&<div className="notification-popover" id="workspace-alerts"><div className="popover-heading"><strong>A little attention</strong><span>{alerts.length} alerts</span><button type="button" className="icon-button" aria-label="Close alerts" onClick={()=>setNotifications(false)}><Icon name="X" size={16}/></button></div>{alerts.length?alerts.map((a,i)=><button key={i} onClick={()=>{go(a.page);setNotifications(false);}}><span className="notice-icon"><Icon name={a.icon}/></span><span><strong>{a.title}</strong><small>{a.detail}</small></span><Icon name="ChevronRight" size={14}/></button>):<p>Everything is up to date.</p>}</div>}</div><button className="avatar top-avatar" aria-label="Open account settings" onClick={()=>go('settings')}>{initials(data.settings.ownerName||'Business Owner')}</button></div></header>
 {data.demoMode&&<div className="demo-banner"><span><span className="demo-dot"/>Demo workspace <span className="demo-detail">· Sample records to help you explore</span></span><button onClick={()=>go('settings')}>Make it yours <Icon name="ArrowUpRight" size={13}/></button></div>}
 {error&&hasData&&<div className="connection-banner" data-testid="connection-status" role="status"><Icon name="WifiOff" size={18}/><div><strong>Connection lost. Showing last loaded data.</strong><span>{refreshing?'Reconnecting…':error}</span></div><button className="btn btn-secondary btn-sm" onClick={()=>void refresh()} disabled={refreshing}>{refreshing?'Reconnecting…':'Try again'}</button></div>}
 <main className="main-content">{error&&!hasData?<div className="panel error-panel"><Icon name="WifiOff"/><h2>Your workspace isn’t connected yet</h2><p>{error}</p><button className="btn btn-primary" onClick={()=>void refresh()} disabled={refreshing}>{refreshing?'Reconnecting…':'Try again'}</button></div>:<ScreenBoundary key={page}><Suspense fallback={<PageLoading/>}>
 {page==='overview'&&<Dashboard go={go} onAdd={()=>setNewJob(true)}/>}{page==='schedule'&&<SchedulePage/>}{page==='projects'&&<ProjectsPage/>}{page==='places'&&<PlacesPage/>}{page==='team'&&<TeamPage/>}{page==='inventory'&&<InventoryPage/>}{page==='business'&&<BusinessPage/>}{page==='studio'&&<StudioPage/>}{page==='assistant'&&<CompanyAssistant/>}{page==='portfolio'&&<PortfolioPage/>}{page==='settings'&&<SettingsPage/>}{!nav.some(n=>n.key===page)&&page!=='settings'&&<Dashboard go={go} onAdd={()=>setNewJob(true)}/>}</Suspense></ScreenBoundary>}</main>
 <footer className="workspace-footer"><BrandSignature settings={data.settings} compact className="workspace-brand-signature"/><span>{data.settings.companyName||BRAND_NAME} Manager · Every place, beautifully cared for.</span></footer></div>
 <nav className="mobile-bottom-nav" aria-label="Everyday navigation">{nav.slice(0,5).map(n=><button key={n.key} className={page===n.key?'active':''} aria-current={page===n.key?'page':undefined} onClick={()=>go(n.key)}><Icon name={n.icon} size={19}/><span>{n.key==='studio'?'Designs':n.label}</span></button>)}</nav>
 {toast&&<div className="toast" role="status"><Icon name="CircleCheck"/>{toast}<button aria-label="Dismiss notification" onClick={()=>notify('')}><Icon name="X" size={15}/></button></div>}
 {newJob&&<Suspense fallback={<div className="modal-backdrop"><PageLoading/></div>}><JobForm job={typeof newJob==='string'?data.jobs.find(j=>j.id===newJob)||{}:{}} type="Maintenance" close={()=>setNewJob(false)}/></Suspense>}
 {help&&<Modal title="A workspace that grows with you" onClose={()=>setHelp(false)}><p className="muted">Start by adding your company logo in Settings, then add a place and schedule its first visit.</p><div className="welcome-steps">{[['MapPin','Add your places','Keep clients, measurements, and site notes together.'],['CalendarDays','Plan the day','Assign a crew and share their instructions on WhatsApp.'],['Sprout','Keep stock in check','Record plants and materials used against each job.']].map(([icon,title,desc])=><div key={title}><Icon name={icon}/><div><strong>{title}</strong><p>{desc}</p></div></div>)}</div><button className="btn btn-primary" onClick={()=>{setHelp(false);go('places');}}>Start with your places <Icon name="ArrowRight" size={16}/></button></Modal>}
 </div>;
}
function Brand({name=BRAND_NAME,logo=BRAND_LOGO}:{name?:string;logo?:string}){return <div className="brand brand-logo"><img src={!logo||logo===BRAND_LOGO?BRAND_LOGO_PREVIEW:logo} alt={`${name||BRAND_NAME} logo`}/></div>;}
function Login(){const {signIn}=useApp();const [role,setRole]=useState('owner'),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);return <div className="login-screen"><div className="login-art"><Brand/><span className="login-brand-note">BRIGHTEN YOUR WORLD</span><h1>A little more care.<br/><em>A lot more growth.</em></h1><img src="/images/plant-monstera.svg" alt="Monstera botanical illustration"/></div><div className="login-form"><div className="login-mobile-brand"><BrandSignature compact/></div><span className="eyebrow">POTSHAVEN MANAGER</span><h1>Welcome back.</h1><p className="muted">A good day starts with everything in its place.</p><form onSubmit={async e=>{e.preventDefault();setError('');setBusy(true);try{await signIn(role,password);}catch(e:any){setError(e.message);}finally{setBusy(false);}}}><Field label="Sign in as"><select value={role} onChange={e=>setRole(e.target.value)}><option value="owner">Business owner</option><option value="manager">Manager</option></select></Field><Field label="Password"><input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></Field>{error&&<p className="form-error" role="alert">{error}</p>}<button disabled={busy} className="btn btn-primary" type="submit">{busy?'Signing in…':'Enter your workspace'}<Icon name="ArrowRight" size={16}/></button></form></div></div>;}

function PageLoading(){return <div className="page-loading" role="status"><span className="loader"/><p>Opening your workspace…</p></div>;}
function SetupScreen({retry,busy,error,code}:{retry:()=>Promise<void>;busy:boolean;error:string;code:string}){
 const database=code==='DATABASE_NOT_CONFIGURED';
 const authentication=code==='AUTH_NOT_CONFIGURED';
 return <div className="setup-screen"><Brand/><section className="setup-card" aria-labelledby="setup-title"><span className="setup-icon"><Icon name="Settings2" size={27}/></span><p className="eyebrow">ONE LAST STEP</p><h1 id="setup-title">Finish setting up your workspace</h1><p className="setup-intro">{database?'Your app is online. Connect its database and choose private sign-in passwords to start saving your work.':error}</p>{database||authentication?<ol>{database&&<><li><strong>Connect your Supabase database.</strong><span>In Supabase, open Connect and copy the Transaction Pooler connection string privately.</span></li><li><strong>Add the database connection in Vercel.</strong><span>Save the connection string as <code>DATABASE_URL</code> in this project’s environment settings.</span></li></>}<li><strong>Choose owner and manager passwords.</strong><span>Save <code>APP_OWNER_PASSWORD</code> and <code>APP_MANAGER_PASSWORD</code> privately in the same Vercel environment settings.</span></li><li><strong>Redeploy the app.</strong><span>Apply the environment settings to this deployment, then check the connection again.</span></li></ol>:<p className="setup-guidance">Add the required private settings in Vercel’s environment settings, then redeploy.</p>}<div className="setup-actions">{database&&<a className="btn btn-primary" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase <Icon name="ArrowUpRight" size={16}/></a>}<a className={`btn ${database?'btn-secondary':'btn-primary'}`} href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">Open Vercel <Icon name="ArrowUpRight" size={16}/></a><button className="btn btn-secondary" disabled={busy} onClick={()=>void retry()}>{busy?'Checking…':'Check connection'}</button></div><p className="setup-note">Keep passwords and database connection values out of chat and Git. Your records will stay in the connected database between deployments. <a href="https://github.com/jrnk-nk/potshaven/blob/main/SUPABASE_SETUP.md" target="_blank" rel="noreferrer">Read the setup guide.</a></p></section></div>;
}

class ScreenBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<div className="panel error-panel" role="alert"><Icon name="WifiOff" size={25}/><h2>This screen couldn’t load</h2><p>Check your connection, then reload to open this part of your workspace.</p><button className="btn btn-secondary" onClick={()=>location.reload()}>Reload screen</button></div>:this.props.children;}
}
