import {useCallback, useMemo, useRef, useState} from 'react';
import {useApp, today} from '../state';
import {Icon, Modal, Status} from '../ui';
import {checklistProgress, dailyWorkBrief, managerDay} from '../manager-day';
import './Dashboard.css';

type Row = Record<string, any>;
export default function Dashboard({go, onAdd}: {go: (page: string) => void; onAdd: () => void}) {
  const {data, openJob} = useApp();
  const date = today();
  const day = useMemo(() => managerDay(data, date), [data, date]);
  const brief = useMemo(() => dailyWorkBrief(data, date), [data, date]);
  const [view, setView] = useState<'today' | 'attention'>('today');
  const [briefOpen, setBriefOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const closeBrief = useCallback(() => setBriefOpen(false), []);
  const jobs = view === 'today' ? day.scheduled : day.attentionJobs;
  const name = data.settings.ownerName?.trim().split(' ')[0];
  const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Accra'});
  function prepareBrief() {setCopied(false); setCopyError(''); setBriefOpen(true);}
  async function copyBrief() {
    setCopyError('');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(brief);
      else {briefRef.current?.select(); if (!document.execCommand('copy')) throw new Error();}
      setCopied(true);
    } catch {setCopyError('Select the plan below, then copy it to your message.'); briefRef.current?.focus(); briefRef.current?.select();}
  }
  return <div className="simple-home">
    <div className="simple-home-heading"><div><p className="home-date">{dateLabel}</p><h1>{name ? `Hello, ${name}.` : 'Hello. Let’s get started.'}</h1><p>Your day, clearly laid out.</p></div><button className="btn btn-primary" onClick={onAdd}><Icon name="Plus"/> Add a job</button></div>
    <section className="md-overview" aria-labelledby="md-overview-title"><div className="md-overview-heading"><h2 id="md-overview-title">Today at a glance</h2><button type="button" onClick={prepareBrief}><Icon name="MessageCircle" size={15}/> Prepare daily brief</button></div><div className="md-stats">
      <button type="button" onClick={() => setView('today')}><span className="md-stat-icon"><Icon name="CalendarDays" size={19}/></span><span><strong>{day.scheduled.length}</strong><small>Jobs today</small></span><em>{day.completed} marked complete</em></button>
      <button type="button" onClick={() => setView('attention')}><span className="md-stat-icon md-stat-warm"><Icon name="CalendarCheck2" size={19}/></span><span><strong>{day.attentionJobs.length}</strong><small>Work to follow up</small></span><em>Due work & checklist checks</em></button>
      <button type="button" onClick={() => go('schedule')}><span className="md-stat-icon"><Icon name="UsersRound" size={19}/></span><span><strong>{day.assignmentChecks.length}</strong><small>Assignment checks</small></span><em>People, transport & timing</em></button>
    </div></section>
    <section className="home-shortcuts" aria-label="Quick actions">
      <button onClick={() => go('schedule')}><span className="shortcut-icon"><Icon name="CalendarDays" size={24}/></span><span><strong>Plan the day</strong><small>Jobs, people & transport</small></span><Icon name="ArrowRight" size={18}/></button>
      <button onClick={() => go('inventory')}><span className="shortcut-icon shortcut-sage"><Icon name="Sprout" size={24}/></span><span><strong>Check your plants</strong><small>See stock or record plants used</small></span><Icon name="ArrowRight" size={18}/></button>
      <button onClick={() => go('studio')}><span className="shortcut-icon shortcut-sand"><Icon name="Images" size={24}/></span><span><strong>Open your gallery</strong><small>Your spaces, together</small></span><Icon name="ArrowRight" size={18}/></button>
    </section>
    <button className="home-assistant-entry" onClick={() => go('assistant')}><span className="shortcut-icon"><Icon name="MessageCircle" size={22}/></span><span><strong>Your company assistant</strong><small>Ask what needs attention, plan a job, or assign your team.</small></span><Icon name="ArrowRight" size={18}/></button>
    <div className="home-layout">
      <section className="panel home-jobs"><div className="panel-heading"><div><h2>{view === 'today' ? 'Today’s jobs' : 'Work to follow up'} <span className="home-count">{jobs.length}</span></h2><p>{view === 'today' ? `${day.completed} of ${day.scheduled.length} marked complete` : 'Due work, unchecked completion, and assignments to confirm.'}</p></div><button className="text-link" onClick={() => go('schedule')}>See schedule <Icon name="ArrowRight" size={16}/></button></div>
        <div className="md-job-filters" role="group" aria-label="Job view"><button type="button" aria-pressed={view === 'today'} onClick={() => setView('today')}>Today</button><button type="button" aria-pressed={view === 'attention'} onClick={() => setView('attention')}>Needs attention{day.attentionJobs.length > 0 && <span>{day.attentionJobs.length}</span>}</button></div>
        <div className="simple-job-list">{jobs.length ? jobs.map((job: Row) => {
          const place = data.places.find(item => item.id === job.placeId);
          const crew = data.workers.filter(worker => job.crewIds?.includes(worker.id));
          const vehicle = data.vehicles.find(item => item.id === job.vehicleId);
          const progress = checklistProgress(job);
          const check = day.assignmentChecks.find(item => item.job.id === job.id);
          return <button className="simple-job md-job" key={job.id} onClick={() => openJob(job.id)}>
            <span className="simple-job-time">{job.date === date ? job.time || 'Set time' : job.date ? new Date(`${job.date}T12:00:00Z`).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', timeZone: 'Africa/Accra'}) : 'Set date'}</span>
            <span className="simple-job-photo"><img src={place?.image || '/images/place-1.svg'} alt=""/></span>
            <span className="simple-job-info"><strong>{job.title}</strong><span>{place?.name || 'Choose a place'}</span><small className="md-job-assignment"><Icon name="UsersRound" size={12}/>{crew.length ? crew.map(worker => worker.name.split(' ')[0]).join(', ') : 'Assign people'}<span>·</span>{vehicle?.name || 'Confirm transport'}</small><span className="md-job-progress">{progress.total ? <><i><b style={{width: `${progress.done / progress.total * 100}%`}}/></i>{progress.done}/{progress.total} tasks checked</> : 'No checklist recorded'}{check && <em>Check assignment</em>}{job.status === 'Completed' && progress.remaining > 0 && <em>Confirm remaining tasks</em>}</span></span>
            <Status>{job.status}</Status><Icon name="ChevronRight" size={17}/>
          </button>;
        }) : <div className="empty-state"><Icon name={view === 'today' ? 'CalendarDays' : 'CircleCheck'} size={31}/><h3>{view === 'today' ? 'A clear day ahead' : 'No work flagged here'}</h3><p>{view === 'today' ? 'Add a job to give your team a plan.' : 'Keep the schedule and checklists current as work is finished.'}</p>{view === 'today' && <button className="btn btn-secondary" onClick={onAdd}>Add your first job</button>}</div>}</div>
        <div className="home-jobs-footer"><Icon name="MessageCircle" size={18}/><span>A clear plan for the people doing the work.</span><button className="btn btn-secondary btn-sm" onClick={prepareBrief}>Prepare daily brief <Icon name="ArrowRight" size={15}/></button></div>
      </section>
      <aside className="home-side"><section className="panel home-reminders"><div className="panel-heading"><h2>Operational reminders</h2><Icon name="Bell" size={19}/></div>{day.reminders.length ? day.reminders.map(item => <button className="simple-reminder" key={item.id} onClick={() => item.id === 'checklists' || item.id === 'overdue' ? setView('attention') : go(item.page)}><span className={`reminder-icon ${item.tone || ''}`}><Icon name={item.icon} size={20}/></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><Icon name="ChevronRight" size={16}/></button>) : <p className="everything-current"><Icon name="CircleCheck" size={22}/> No recorded operational alerts.</p>}<p className="md-reminder-note">Based on saved schedules, checklists, stock, and work agreements.</p></section>
        <section className="home-design-card"><img src="/images/hero-monstera.svg" alt=""/><span className="eyebrow">POTSHAVEN STUDIO</span><h2>Beautiful spaces.<br/>All together.</h2><p>A gallery of your work, ready to share.</p><button onClick={() => go('studio')}>Open your gallery <Icon name="ArrowUpRight" size={17}/></button></section>
      </aside>
    </div>
    <section className="home-more"><div><Icon name="FolderOpen" size={22}/><span><strong>Everything for the day’s work</strong><small>Your projects, people, transport, and client reports.</small></span></div><div className="home-more-links"><button onClick={() => go('projects')}>Projects <Icon name="ArrowUpRight" size={14}/></button><button onClick={() => go('team')}>Team & vehicles <Icon name="ArrowUpRight" size={14}/></button><button onClick={() => go('portfolio')}>Client reports <Icon name="ArrowUpRight" size={14}/></button></div></section>
    {briefOpen && <Modal title="Your daily work brief" onClose={closeBrief} wide><p className="md-brief-intro">Review today’s plan, then copy it or choose who to share it with.</p><textarea ref={briefRef} className="md-brief-text" aria-label="Daily work brief" readOnly value={brief}/>{copyError && <p className="md-copy-error" role="alert">{copyError}</p>}<div className="md-brief-actions"><button type="button" className="btn btn-secondary" onClick={() => void copyBrief()}><Icon name={copied ? 'Check' : 'FolderOpen'} size={15}/>{copied ? 'Copied' : 'Copy plan'}</button>{brief.length <= 12000 ? <a className="btn btn-primary" href={`https://wa.me/?text=${encodeURIComponent(brief)}`} target="_blank" rel="noreferrer"><Icon name="MessageCircle" size={15}/> Open WhatsApp</a> : <p>This plan is long. Copy it and paste it into your message.</p>}</div><p className="md-brief-note" role="status">{copied ? 'The plan is copied and ready to paste.' : 'Nothing is sent until you send it in WhatsApp.'}</p></Modal>}
  </div>;
}
