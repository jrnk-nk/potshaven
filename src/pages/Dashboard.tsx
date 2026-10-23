import {useApp,today} from '../state';
import {Icon,Status} from '../ui';
import './Dashboard.css';

export default function Dashboard({go,onAdd}:{go:(page:string)=>void;onAdd:()=>void}){
 const {data,openJob}=useApp();
 const date=today();
 const jobs=data.jobs.filter(j=>j.date===date).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
 const completed=jobs.filter(j=>j.status==='Completed').length;
 const low=data.inventory.filter(i=>Number(i.quantity)<=Number(i.minStock));
 const overdue=data.jobs.filter(j=>j.status!=='Completed'&&(j.deadline||j.date)<date);
 const name=data.settings.ownerName?.trim().split(' ')[0];
 const dateLabel=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',timeZone:'Africa/Accra'});
 return <div className="simple-home">
  <div className="simple-home-heading"><div><p className="home-date">{dateLabel}</p><h1>{name?`Hello, ${name}.`:'Hello. Let’s get started.'}</h1><p>Everything you need to look after today.</p></div><button className="btn btn-primary" onClick={onAdd}><Icon name="Plus"/> Add a job</button></div>
  <section className="home-shortcuts" aria-label="Quick actions">
   <button onClick={()=>go('schedule')}><span className="shortcut-icon"><Icon name="CalendarDays" size={24}/></span><span><strong>Plan the day</strong><small>Jobs, crews & WhatsApp instructions</small></span><Icon name="ArrowRight" size={18}/></button>
   <button onClick={()=>go('inventory')}><span className="shortcut-icon shortcut-sage"><Icon name="Sprout" size={24}/></span><span><strong>Check your plants</strong><small>See stock or record plants used</small></span><Icon name="ArrowRight" size={18}/></button>
   <button onClick={()=>go('studio')}><span className="shortcut-icon shortcut-sand"><Icon name="WandSparkles" size={24}/></span><span><strong>Create a design</strong><small>Start with a photo of the space</small></span><Icon name="ArrowRight" size={18}/></button>
  </section>
  <button className="home-assistant-entry" onClick={()=>go('assistant')}><span className="shortcut-icon"><Icon name="MessageCircle" size={22}/></span><span><strong>Your company assistant</strong><small>Ask what needs attention, plan a job, or assign your team.</small></span><Icon name="ArrowRight" size={18}/></button>
  <div className="home-layout">
   <section className="panel home-jobs"><div className="panel-heading"><div><h2>Today’s jobs <span className="home-count">{jobs.length}</span></h2><p>{jobs.length?`${completed} of ${jobs.length} completed`:'Your schedule is clear today.'}</p></div><button className="text-link" onClick={()=>go('schedule')}>See schedule <Icon name="ArrowRight" size={16}/></button></div>
    <div className="simple-job-list">{jobs.length?jobs.map(job=>{const place=data.places.find(p=>p.id===job.placeId);const crew=data.workers.filter(w=>job.crewIds?.includes(w.id));return <button className="simple-job" key={job.id} onClick={()=>openJob(job.id)}><span className="simple-job-time">{job.time||'09:00'}</span><span className="simple-job-photo"><img src={place?.image||'/images/place-1.svg'} alt=""/></span><span className="simple-job-info"><strong>{place?.name||job.title}</strong><span>{job.title}</span><small>{crew.length?crew.map(w=>w.name.split(' ')[0]).join(' & '):'Assign a crew'}</small></span><Status>{job.status}</Status><Icon name="ChevronRight" size={17}/></button>}):<div className="empty-state"><Icon name="CalendarDays" size={31}/><h3>Ready when you are</h3><p>Add a job to give your team a plan.</p><button className="btn btn-secondary" onClick={onAdd}>Add your first job</button></div>}</div>
    {jobs.length>0&&<div className="home-jobs-footer"><Icon name="MessageCircle" size={18}/><span>Send today’s plan to your workers.</span><button className="btn btn-secondary btn-sm" onClick={()=>go('schedule')}>Prepare WhatsApp message <Icon name="ArrowRight" size={15}/></button></div>}
   </section>
   <aside className="home-side"><section className="panel home-reminders"><div className="panel-heading"><h2>Needs attention</h2><Icon name="Bell" size={19}/></div>{overdue.length>0&&<button className="simple-reminder" onClick={()=>go('schedule')}><span className="reminder-icon warning"><Icon name="CalendarClock" size={20}/></span><span><strong>{overdue.length} overdue {overdue.length===1?'job':'jobs'}</strong><small>Choose a new date or mark complete</small></span><Icon name="ChevronRight" size={16}/></button>}{low.length>0&&<button className="simple-reminder" onClick={()=>go('inventory')}><span className="reminder-icon"><Icon name="Sprout" size={20}/></span><span><strong>{low.length} items running low</strong><small>{low.slice(0,2).map(i=>i.name).join(', ')}</small></span><Icon name="ChevronRight" size={16}/></button>}{!overdue.length&&!low.length&&<p className="everything-current"><Icon name="CircleCheck" size={22}/> Everything is up to date.</p>}</section>
    <section className="home-design-card"><img src="/images/hero-monstera.svg" alt=""/><span className="eyebrow">A FRESH IDEA</span><h2>A photo.<br/>A new possibility.</h2><p>Show your clients what their space could become.</p><button onClick={()=>go('studio')}>Open design studio <Icon name="ArrowUpRight" size={17}/></button></section>
   </aside>
  </div>
  <section className="home-more"><div><Icon name="FolderOpen" size={22}/><span><strong>Looking for something else?</strong><small>Projects, payments, your team, and client reports.</small></span></div><div className="home-more-links"><button onClick={()=>go('projects')}>Projects <Icon name="ArrowUpRight" size={14}/></button><button onClick={()=>go('business')}>Money & contracts <Icon name="ArrowUpRight" size={14}/></button><button onClick={()=>go('team')}>Your team <Icon name="ArrowUpRight" size={14}/></button></div></section>
 </div>;
}
