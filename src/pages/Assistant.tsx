import {useEffect, useRef, useState, type FormEvent, type KeyboardEvent} from 'react';
import {ArrowRight, ArrowUp, Check, ChevronDown, CircleAlert, LoaderCircle, RefreshCw, Sparkles, X} from 'lucide-react';
import {api, ApiError, today, useApp, type AppData} from '../state';
import './Assistant.css';

type Action = {id: string; label: string; collection: 'jobs' | 'workers' | 'vehicles' | 'issues'; operation: 'create' | 'update'; recordId?: string; changes: Record<string, any>; warnings?: string[]};
type Proposal = Action & {key: string; baseline?: Record<string, any>};
type ChatMessage = {id: string; role: 'user' | 'assistant'; content: string; proposals?: Proposal[]};
type BriefingItem = {id: string; title: string; detail: string; page: string; kind: string};
type Briefing = {summary: string; items: BriefingItem[]};
type SaveState = {status: 'saving' | 'saved' | 'blocked' | 'uncertain' | 'check-failed'; error?: string};

const prompts = ['What needs attention?', 'Who has unfinished work?', 'Help plan tomorrow'];
const pages = new Set(['overview', 'schedule', 'projects', 'places', 'team', 'inventory', 'business']);
const collections = new Set(['jobs', 'workers', 'vehicles', 'issues']);
const fields: Record<string, string> = {title: 'Title', name: 'Name', date: 'Date', time: 'Start time', deadline: 'Deadline', crewIds: 'People', vehicleId: 'Vehicle', placeId: 'Place', status: 'Status', type: 'Type', tasks: 'Checklist', notes: 'Instructions', recurrence: 'Repeat', priority: 'Priority', role: 'Role', phone: 'Phone', workforceType: 'Worker type', engagementType: 'Agreement', engagementStart: 'Starts', engagementEnd: 'Ends', startDate: 'Starts', endDate: 'Ends', agreedRate: 'Agreed pay', rateBasis: 'Pay basis', relatedJobId: 'Linked job', agreementNotes: 'Agreement notes', agreementStatus: 'Agreement status', agreementReference: 'Agreement reference', skills: 'Skills', available: 'Available', registration: 'Registration', capacity: 'Capacity'};
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function describeField(field: string, value: any, data: AppData) {
  const name = (collection: string, id: string) => (data[collection] || []).find((item: any) => item.id === id)?.name || 'No longer available';
  if (field === 'workforceType') return value === 'Internal' ? 'Company staff' : value === 'External' ? 'External worker' : String(value);
  if (field === 'skills' && Array.isArray(value)) return value.join(', ') || 'No skills added';
  if (field === 'crewIds' && Array.isArray(value)) return value.length ? value.map(id => name('workers', id)).join(', ') : 'No people assigned';
  if (field === 'relatedJobId') return value ? (data.jobs.find(job => job.id === value)?.title || 'No longer available') : 'No linked job';
  if (field === 'vehicleId') return value ? name('vehicles', value) : 'No vehicle assigned';
  if (field === 'placeId') return value ? name('places', value) : 'No place assigned';
  if (field === 'tasks' && Array.isArray(value)) return value.map(task => typeof task === 'string' ? task : `${task.done ? '✓ ' : ''}${task.title || task.text || ''}`).join('\n') || 'No tasks';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === '' || value === null) return 'None';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function Assistant() {
  const {data, connection, create, update, notify, refresh} = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [briefingError, setBriefingError] = useState('');
  const [briefingBusy, setBriefingBusy] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(() => window.matchMedia('(min-width: 901px)').matches);
  const [briefingVersion, setBriefingVersion] = useState(0);
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const saving = useRef(new Set<string>());
  const mounted = useRef(true);
  const dataRef = useRef(data);
  dataRef.current = data;
  const online = connection === 'online';
  const configured = Boolean(data.assistantConfigured ?? data.imageGenerationConfigured);

  useEffect(() => {mounted.current = true; return () => {mounted.current = false; requestRef.current?.abort();};}, []);
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    setBriefingBusy(true);
    void api(`/assistant/briefing?today=${encodeURIComponent(today())}`, {signal: controller.signal}).then(result => {
      if (controller.signal.aborted) return;
      if (!result || !Array.isArray(result.items) || typeof result.summary !== 'string') throw new Error('The daily briefing could not be opened.');
      setBriefing(result); setBriefingError('');
    }).catch(caught => {
      if (!controller.signal.aborted) {setBriefingError(errorMessage(caught)); if (caught instanceof ApiError && caught.status === 401) void refresh();}
    }).finally(() => {if (!controller.signal.aborted) setBriefingBusy(false);});
    return () => controller.abort();
  }, [online, briefingVersion, data.jobs, data.inventory, data.workers, data.vehicles, data.issues, data.contracts, refresh]);
  useEffect(() => {
    const input = draftRef.current;
    if (input) {input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 130)}px`;}
  }, [draft]);
  useEffect(() => {
    if (!messages.length) return;
    const frame = requestAnimationFrame(() => endRef.current?.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest'}));
    return () => cancelAnimationFrame(frame);
  }, [messages.length, busy]);

  function choosePrompt(prompt: string) {setDraft(prompt); setError(''); draftRef.current?.focus();}
  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || inFlight.current || !online || !configured) return;
    const user: ChatMessage = {id: crypto.randomUUID(), role: 'user', content};
    const requestRecords: Record<string, any[]> = Object.fromEntries([...collections].map(collection => [collection, structuredClone(dataRef.current[collection] || [])]));
    const history = messages.slice(-8).map(({role, content}) => ({role, content: content.slice(0, 2000)}));
    const controller = new AbortController();
    requestRef.current = controller; inFlight.current = true;
    setMessages(current => [...current, user]); setDraft(''); setError(''); setBusy(true);
    const timer = setTimeout(() => controller.abort(), 75000);
    try {
      const response = await fetch('/api/assistant', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({message: content, history, today: today()}), signal: controller.signal});
      const result = await response.json().catch(() => null);
      if (!response.ok) {if (response.status === 401) void refresh(); throw new Error(typeof result?.error === 'string' ? result.error : 'Your assistant could not respond. Please try again.');}
      if (!result || typeof result.reply !== 'string' || !Array.isArray(result.actions)) throw new Error('Your assistant returned an incomplete response. Please try again.');
      const id = crypto.randomUUID();
      const proposals = result.actions.filter((action: any) => action && collections.has(action.collection) && ['create', 'update'].includes(action.operation) && typeof action.label === 'string' && action.changes && typeof action.changes === 'object' && !Array.isArray(action.changes) && (action.operation !== 'update' || typeof action.recordId === 'string')).map((action: Action, index: number): Proposal => {
        const record = (requestRecords[action.collection] || []).find((item: any) => item.id === action.recordId);
        return {...action, key: `${id}-${index}`, baseline: record};
      });
      if (mounted.current) setMessages(current => [...current, {id, role: 'assistant', content: result.reply, proposals}]);
    } catch (caught) {
      if (!mounted.current) return;
      setDraft(content); setMessages(current => current.filter(item => item.id !== user.id));
      setError(controller.signal.aborted ? 'Your assistant is taking longer than expected. Your request is still here; please try again.' : errorMessage(caught));
    } finally {
      clearTimeout(timer); inFlight.current = false; requestRef.current = null;
      if (mounted.current) {setBusy(false); requestAnimationFrame(() => draftRef.current?.focus());}
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !window.matchMedia('(pointer: coarse)').matches) {event.preventDefault(); void send();}
  }
  async function apply(proposal: Proposal) {
    if (saving.current.has(proposal.key) || (saves[proposal.key] && saves[proposal.key].status !== 'check-failed') || !online) return;
    saving.current.add(proposal.key);
    setSaves(previous => ({...previous, [proposal.key]: {status: 'saving'}}));
    if (proposal.operation === 'update') {
      try {
        const records = await api(`/${proposal.collection}`);
        if (!Array.isArray(records)) throw new Error('The latest record could not be checked.');
        const current = records.find((record: any) => record.id === proposal.recordId);
        if (!current || !proposal.baseline || JSON.stringify(canonical(current)) !== JSON.stringify(canonical(proposal.baseline))) {
          if (mounted.current) setSaves(previous => ({...previous, [proposal.key]: {status: 'blocked', error: 'This record changed since the suggestion was prepared. Ask for a fresh suggestion before saving.'}}));
          saving.current.delete(proposal.key); return;
        }
      } catch (caught) {
        if (mounted.current) setSaves(previous => ({...previous, [proposal.key]: {status: 'check-failed', error: `The latest record could not be checked, so nothing was saved. ${errorMessage(caught)}`}}));
        saving.current.delete(proposal.key);
        if (caught instanceof ApiError && caught.status === 401) void refresh();
        return;
      }
    }
    if (!mounted.current) {saving.current.delete(proposal.key); return;}
    try {
      if (proposal.operation === 'create') await create(proposal.collection, proposal.changes);
      else await update(proposal.collection, proposal.recordId!, proposal.changes);
      if (mounted.current) {setSaves(previous => ({...previous, [proposal.key]: {status: 'saved'}})); notify('Change saved.');}
    } catch (caught) {
      if (mounted.current) setSaves(previous => ({...previous, [proposal.key]: {status: 'uncertain', error: `${errorMessage(caught)} Check your records before asking for the change again.`}}));
    } finally {saving.current.delete(proposal.key);}
  }

  return <section className="company-assistant" aria-label="Company assistant">
    <header className="ca-header"><div><span className="ca-eyebrow">A LITTLE HELP WITH THE EVERYDAY</span><h1>Company assistant</h1><p>Plan the work. Find what needs care. Keep things moving.</p></div><span className="ca-header-mark" aria-hidden="true"><Sparkles size={23} strokeWidth={1.5} /></span></header>
    <div className="ca-layout">
      <aside className={`ca-briefing${briefingOpen ? ' is-open' : ''}`} aria-label="Needs attention">
        <div className="ca-briefing-heading"><button type="button" aria-expanded={briefingOpen} aria-controls="ca-briefing-list" onClick={() => setBriefingOpen(open => !open)}><span className="ca-attention-icon"><CircleAlert size={18} /></span><span><strong>Needs attention</strong><small>{briefing ? `${briefing.items.length} ${briefing.items.length === 1 ? 'item' : 'items'} to review` : briefingBusy ? 'Checking your records…' : 'Your company, at a glance'}</small></span><ChevronDown size={16} /></button><button className="ca-icon-button" type="button" aria-label="Refresh briefing" disabled={briefingBusy || !online} onClick={() => setBriefingVersion(version => version + 1)}><RefreshCw size={15} className={briefingBusy ? 'ca-spin' : ''} /></button></div>
        {briefingOpen && <div id="ca-briefing-list" className="ca-briefing-content">{briefingError && <p className="ca-briefing-error" role="status">{briefingError}</p>}{briefing && <><p className="ca-briefing-summary">{briefing.summary}</p><div className="ca-attention-list">{briefing.items.map(item => <a key={item.id} href={`#${pages.has(item.page) ? item.page : 'overview'}`} className={`ca-attention-item ca-kind-${item.kind}`}><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowRight size={14} /></a>)}</div></>}{!briefing && !briefingError && <p className="ca-briefing-summary">{online ? 'Looking for unfinished work, upcoming deadlines, and stock that needs care.' : 'Reconnect to check the latest records.'}</p>}<p className="ca-records-note">Based on the records saved in your workspace.</p></div>}
      </aside>
      <div className="ca-chat">
        <div className={`ca-thread${!messages.length ? ' ca-thread-empty' : ''}`} role="log" aria-label="Assistant conversation" aria-live="polite" aria-busy={busy}>
          {!messages.length ? <div className="ca-welcome"><span className="ca-welcome-icon"><Sparkles size={27} strokeWidth={1.3} /></span><h2>What can I help with?</h2><p>Ask about unfinished work, plan a visit, or assign people and a vehicle to a job.</p><div className="ca-prompts">{prompts.map(prompt => <button type="button" key={prompt} onClick={() => choosePrompt(prompt)}>{prompt}<ArrowRight size={14} /></button>)}</div><p className="ca-example">Try “Assign a crew and a vehicle to tomorrow’s hotel visit.”</p></div> : <div className="ca-messages">{messages.map(entry => <article key={entry.id} className={`ca-message ca-message-${entry.role}`}><span className="ca-message-author">{entry.role === 'user' ? 'You' : <><Sparkles size={13} />Your assistant</>}</span><p>{entry.content}</p>{entry.proposals?.length ? <div className="ca-proposals"><span className="ca-review-label">Review before saving</span>{entry.proposals.map(proposal => {const save = saves[proposal.key]; return <article key={proposal.key} className={`ca-proposal${save?.status === 'saved' ? ' is-saved' : ''}`} aria-label={proposal.label}><div className="ca-proposal-heading"><span>{proposal.operation === 'create' ? 'Add' : 'Update'} · {proposal.collection === 'jobs' ? 'Job' : proposal.collection === 'workers' ? 'Person' : proposal.collection === 'vehicles' ? 'Vehicle' : 'Issue'}</span>{save?.status === 'saved' && <small><Check size={13} />Saved</small>}</div><h3>{proposal.label}</h3><dl>{Object.entries(proposal.changes).map(([field, value]) => <div key={field}><dt>{fields[field] || field.replace(/([A-Z])/g, ' $1')}</dt><dd>{describeField(field, value, data)}</dd></div>)}</dl>{proposal.warnings?.map((warning, index) => <p className="ca-action-warning" key={index}><CircleAlert size={14} />{warning}</p>)}{save?.error && <p className="ca-action-error" role="alert">{save.error}</p>}<div className="ca-proposal-actions"><button type="button" className="ca-apply-button" onClick={() => void apply(proposal)} disabled={Boolean(save && save.status !== 'check-failed') || !online}>{save?.status === 'saving' ? <><LoaderCircle size={15} className="ca-spin" />Saving…</> : save?.status === 'saved' ? <><Check size={15} />Saved</> : save?.status === 'check-failed' ? 'Try checking again' : save ? 'Review your records' : <>Save this change<Check size={15} /></>}</button>{save?.status === 'blocked' || save?.status === 'uncertain' ? <a href={`#${proposal.collection === 'jobs' ? 'schedule' : proposal.collection === 'issues' ? 'places' : 'team'}`}>Open records <ArrowRight size={13} /></a> : null}</div></article>;})}</div> : null}</article>)}{busy && <div className="ca-thinking" role="status"><LoaderCircle size={17} className="ca-spin" /><span>Checking your company records…</span></div>}<div ref={endRef} /></div>}
        </div>
        <div className="ca-compose-area">
          {!configured && <p className="ca-connection-note">Connect your assistant in <a href="#settings">Settings</a> to get help with your company. Your attention list is still available.</p>}
          {!online && <p className="ca-connection-note">Reconnect before asking or saving. Your message will stay here.</p>}
          {error && <div className="ca-error" role="alert"><span>{error}</span><button type="button" className="ca-icon-button" aria-label="Dismiss assistant error" onClick={() => setError('')}><X size={16} /></button></div>}
          <form className="ca-composer" onSubmit={event => void send(event)}><textarea ref={draftRef} aria-label="Message company assistant" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="Tell me what you need help with…" maxLength={3000} rows={2} disabled={busy} /><button type="submit" className="ca-send" aria-label="Send assistant message" disabled={!draft.trim() || busy || !online || !configured}>{busy ? <LoaderCircle size={19} className="ca-spin" /> : <ArrowUp size={20} />}</button></form>
          <p className="ca-compose-note">Review each suggestion, then save it when it looks right.</p>
        </div>
      </div>
    </div>
  </section>;
}
