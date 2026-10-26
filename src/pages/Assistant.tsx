import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent} from 'react';
import {ArrowRight, ArrowUp, CalendarDays, Check, ChevronDown, CircleAlert, Copy, History, LoaderCircle, MessageCircle, Plus, RefreshCw, Sparkles, X} from 'lucide-react';
import {api, ApiError, today, useApp, type AppData} from '../state';
import './Assistant.css';
import {Modal} from '../ui';
import {dailyWorkBrief} from '../manager-day';
import {canAccessPage, canonicalPage} from '../access';
import {FINANCIAL_FEATURES_ENABLED} from '../features';

type Action = {id: string; label: string; collection: 'jobs' | 'workers' | 'vehicles' | 'issues' | 'purchaseRequests'; operation: 'create' | 'update'; recordId?: string; changes: Record<string, any>; warnings?: string[]};
type Proposal = Action & {key: string; baseline?: Record<string, any>};
type ChatMessage = {id: string; role: 'user' | 'assistant'; content: string; proposals?: Proposal[]};
type BriefingItem = {id: string; title: string; detail: string; page: string; kind: string; href?: string; severity?: 'urgent' | 'attention' | 'upcoming'};
type Briefing = {summary: string; items: BriefingItem[]; total?: number; checkedAt?: string};
type ConversationSummary = {id: string; title: string; updatedAt: string; version: number; messageCount: number};
type Conversation = Omit<ConversationSummary, 'messageCount'> & {messages: ChatMessage[]};
type PendingExchange = {conversationId: string; exchangeId: string; expectedVersion: number; user: string; assistant: string};
type SaveState = {status: 'saving' | 'saved' | 'blocked' | 'uncertain' | 'check-failed'; error?: string};

const prompts = ['What needs attention?', 'Who has unfinished work?', 'Plan the next seven days', 'Prepare a supply request'];
const pages = new Set(['overview', 'schedule', 'sites', 'team', 'inventory', ...(FINANCIAL_FEATURES_ENABLED ? ['business'] : [])]);
// Ignore disabled proposals entirely so their labels cannot advertise a change
// that is unavailable. The API independently enforces the same restriction.
const financialField = (key: string) => /cost|price|amount|budget|salary|wage|payment|invoice|profit|revenue|payroll|currency|agreedrate|ratebasis|bankaccount|bankdetails|payrate|receiptreference|receiptimage|paiddate/i.test(key.replace(/[^a-z]/gi, ''));
const containsFinancialFields = (value: unknown): boolean => Boolean(value && typeof value === 'object' && (Array.isArray(value) ? value.some(containsFinancialFields) : Object.entries(value).some(([key, child]) => financialField(key) || containsFinancialFields(child))));
const collections = new Set(['jobs', 'workers', 'vehicles', 'issues', 'purchaseRequests']);
const fields: Record<string, string> = {requestedBy: 'Requested by', jobId: 'Job', quantity: 'Quantity', requestType: 'Request', category: 'Category', title: 'Title', name: 'Name', date: 'Date', time: 'Start time', deadline: 'Deadline', crewIds: 'People', vehicleId: 'Vehicle', placeId: 'Site', status: 'Status', type: 'Type', tasks: 'Checklist', notes: 'Instructions', recurrence: 'Repeat', priority: 'Priority', role: 'Role', phone: 'Phone', workforceType: 'Worker type', engagementType: 'Agreement', engagementStart: 'Starts', engagementEnd: 'Ends', startDate: 'Starts', endDate: 'Ends', agreedRate: 'Agreed pay', rateBasis: 'Pay basis', relatedJobId: 'Linked job', agreementNotes: 'Agreement notes', agreementStatus: 'Agreement status', agreementReference: 'Agreement reference', skills: 'Skills', available: 'Available', registration: 'Registration', capacity: 'Capacity'};
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function describeField(field: string, value: any, data: AppData) {
  const name = (collection: string, id: string) => (data[collection] || []).find((item: any) => item.id === id)?.name || 'No longer available';
  if (field === 'requestedBy') return value === 'owner' ? 'Owner account' : value === 'manager' ? 'Manager account' : String(value);
  if (field === 'workforceType') return value === 'Internal' ? 'Company staff' : value === 'External' ? 'External worker' : String(value);
  if (field === 'skills' && Array.isArray(value)) return value.join(', ') || 'No skills added';
  if (field === 'crewIds' && Array.isArray(value)) return value.length ? value.map(id => name('workers', id)).join(', ') : 'No people assigned';
  if (field === 'relatedJobId' || field === 'jobId') return value ? (data.jobs.find(job => job.id === value)?.title || 'No longer available') : 'No linked job';
  if (field === 'vehicleId') return value ? name('vehicles', value) : 'No vehicle assigned';
  if (field === 'placeId') return value ? name('places', value) : 'No site assigned';
  if (field === 'tasks' && Array.isArray(value)) return value.map(task => typeof task === 'string' ? task : `${task.done ? '✓ ' : ''}${task.title || task.text || ''}`).join('\n') || 'No tasks';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === '' || value === null) return 'None';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function validConversation(value: any): value is Conversation {
  return Boolean(value && typeof value.id === 'string' && typeof value.title === 'string' && Number.isSafeInteger(value.version) && value.version > 0 && Array.isArray(value.messages) && value.messages.every((message: any) => message && typeof message.id === 'string' && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string'));
}
function briefingHref(item: BriefingItem, role: AppData['role']) {
  const page = pages.has(item.page) && canAccessPage(role, item.page) ? item.page : 'overview';
  const target = typeof item.href === 'string' ? /^#([a-z]+)(?:\?|$)/.exec(item.href)?.[1] : undefined;
  if (target && pages.has(target) && canAccessPage(role, target) && !/[\r\n]/.test(item.href!)) return item.href!;
  return `#${page}`;
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
  const [siteId, setSiteId] = useState('');
  const [contextNote, setContextNote] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false), [historyBusy, setHistoryBusy] = useState(false), [historyError, setHistoryError] = useState('');
  const [historyItems, setHistoryItems] = useState<ConversationSummary[]>([]), [historyTotal, setHistoryTotal] = useState(0), [historyNext, setHistoryNext] = useState<number | null>(null);
  const [chatTitle, setChatTitle] = useState('New conversation'), [memoryNote, setMemoryNote] = useState('');
  const [pendingExchange, setPendingExchange] = useState<PendingExchange | null>(null);
  const [switchIntent, setSwitchIntent] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false), [planDate, setPlanDate] = useState(today), [copied, setCopied] = useState(false), [copyError, setCopyError] = useState('');
  const conversationRef = useRef({id: crypto.randomUUID() as string, version: 0});
  const scopeRef = useRef(0), historyRequest = useRef<AbortController | null>(null), memoryRequest = useRef<AbortController | null>(null);
  const planRef = useRef<HTMLTextAreaElement>(null);
  const closeHistory = useCallback(() => {historyRequest.current?.abort(); setHistoryOpen(false); setHistoryBusy(false);}, []);
  const closePlan = useCallback(() => setPlanOpen(false), []);
  const closeSwitch = useCallback(() => setSwitchIntent(null), []);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  // Keep the same request reference and body after an interrupted response.
  // A manual retry can recover the original result without a second paid call.
  const attemptRef = useRef<{identity: string; exchangeId: string; body: string} | null>(null);
  const inFlight = useRef(false);
  const saving = useRef(new Set<string>());
  const mounted = useRef(true);
  const dataRef = useRef(data);
  dataRef.current = data;
  const roleRef = useRef(data.role);
  if (roleRef.current !== data.role) scopeRef.current++;
  roleRef.current = data.role;
  const online = connection === 'online';
  const manager = data.role === 'manager';
  const configured = Boolean(data.assistantConfigured ?? data.imageGenerationConfigured);
  const conversationFull = conversationRef.current.version >= 50;

  useEffect(() => {mounted.current = true; return () => {mounted.current = false; requestRef.current?.abort(); historyRequest.current?.abort(); memoryRequest.current?.abort(); scopeRef.current++;};}, []);
  useEffect(() => {
    requestRef.current?.abort(); historyRequest.current?.abort(); memoryRequest.current?.abort(); scopeRef.current++;
    conversationRef.current = {id: crypto.randomUUID(), version: 0};
    attemptRef.current = null;
    setPendingExchange(null); setMemoryNote(''); setHistoryOpen(false); setHistoryBusy(false); setHistoryError(''); setHistoryItems([]); setHistoryTotal(0); setHistoryNext(null); setChatTitle('New conversation'); setSiteId(''); setContextNote(''); setPlanOpen(false); setSwitchIntent(null);
    inFlight.current = false; setBusy(false); saving.current.clear();
    setMessages([]); setDraft(''); setError(''); setSaves({}); setBriefing(null); setBriefingError('');
  }, [data.role]);
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    setBriefingBusy(true);
    void api(`/assistant/briefing?today=${encodeURIComponent(today())}${siteId ? `&siteId=${encodeURIComponent(siteId)}` : ''}`, {signal: controller.signal}).then(result => {
      if (controller.signal.aborted) return;
      if (!result || !Array.isArray(result.items) || typeof result.summary !== 'string') throw new Error('The daily briefing could not be opened.');
      setBriefing({...result, items: result.items.filter((item: BriefingItem) => FINANCIAL_FEATURES_ENABLED || item.page !== 'business').map((item: BriefingItem) => ({...item, page: canonicalPage(item.page)}))}); setBriefingError('');
    }).catch(caught => {
      if (!controller.signal.aborted) {setBriefingError(errorMessage(caught)); if (caught instanceof ApiError && caught.status === 401) void refresh();}
    }).finally(() => {if (!controller.signal.aborted) setBriefingBusy(false);});
    return () => controller.abort();
  }, [online, siteId, data.role, briefingVersion, data.jobs, data.inventory, data.workers, data.vehicles, data.issues, data.contracts, data.equipment, data.purchaseRequests, refresh]);
  useEffect(() => {
    if (!online) return;
    const checkVisible = () => {if (document.visibilityState === 'visible') setBriefingVersion(version => version + 1);};
    const timer = window.setInterval(checkVisible, 60000);
    window.addEventListener('focus', checkVisible); document.addEventListener('visibilitychange', checkVisible);
    return () => {window.clearInterval(timer); window.removeEventListener('focus', checkVisible); document.removeEventListener('visibilitychange', checkVisible);};
  }, [online]);
  useEffect(() => {if (siteId && !data.places.some(site => site.id === siteId)) setSiteId('');}, [data.places, siteId]);
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
  const currentScope = (scope: number) => mounted.current && scopeRef.current === scope;

  async function persistExchange(exchange: PendingExchange, scope: number) {
    const controller = new AbortController(); memoryRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    setMemoryNote('Saving conversation…');
    try {
      const result = await api(`/assistant/conversations/${exchange.conversationId}`, {method: 'PUT', body: JSON.stringify({exchangeId: exchange.exchangeId, expectedVersion: exchange.expectedVersion, user: exchange.user, assistant: exchange.assistant}), signal: controller.signal});
      if (!currentScope(scope)) return;
      if (!validConversation(result) || result.id !== exchange.conversationId) throw new Error('The save could not be confirmed.');
      conversationRef.current = {id: result.id, version: result.version};
      setChatTitle(result.title); setPendingExchange(null); setMemoryNote('Conversation saved');
    } catch (caught) {
      if (!currentScope(scope)) return;
      setPendingExchange(exchange);
      setMemoryNote(`Conversation save not confirmed. Your reply is still here. ${controller.signal.aborted ? 'Check the connection and try saving again.' : errorMessage(caught)}`);
      if (caught instanceof ApiError && caught.status === 401) void refresh();
    } finally {clearTimeout(timer); if (memoryRequest.current === controller) memoryRequest.current = null;}
  }
  async function retryConversation() {
    if (!pendingExchange || inFlight.current || !online) return;
    const scope = scopeRef.current; inFlight.current = true; setBusy(true);
    try {await persistExchange(pendingExchange, scope);} finally {if (currentScope(scope)) {inFlight.current = false; setBusy(false);}}
  }
  async function openHistory(offset = 0) {
    if (inFlight.current) return;
    const scope = scopeRef.current, controller = new AbortController();
    historyRequest.current?.abort(); historyRequest.current = controller;
    setHistoryOpen(true); setHistoryBusy(true); setHistoryError(''); if (!offset) {setHistoryItems([]); setHistoryNext(null);}
    try {
      const result = await api(`/assistant/conversations${offset ? `?offset=${offset}` : ''}`, {signal: controller.signal});
      if (!currentScope(scope) || controller.signal.aborted) return;
      if (!result || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.items.some((item: any) => !item || typeof item.id !== 'string' || typeof item.title !== 'string' || !Number.isSafeInteger(item.messageCount))) throw new Error('Saved conversations could not be opened.');
      setHistoryItems(previous => offset ? [...new Map([...previous, ...result.items].map(item => [item.id, item])).values()] : result.items); setHistoryTotal(result.total); setHistoryNext(Number.isSafeInteger(result.nextOffset) && result.nextOffset > offset ? result.nextOffset : null);
    } catch (caught) {if (currentScope(scope) && !controller.signal.aborted) {setHistoryError(errorMessage(caught)); if (caught instanceof ApiError && caught.status === 401) void refresh();}}
    finally {if (currentScope(scope) && !controller.signal.aborted) setHistoryBusy(false);}
  }
  async function switchConversation(id: string) {
    if (inFlight.current || saving.current.size) return;
    setSwitchIntent(null);
    if (id === 'new') {
      scopeRef.current++; conversationRef.current = {id: crypto.randomUUID(), version: 0};
      attemptRef.current = null;
      setMessages([]); setDraft(''); setSaves({}); setError(''); setContextNote(''); setMemoryNote(''); setPendingExchange(null); setChatTitle('New conversation'); closeHistory();
      draftRef.current?.focus(); return;
    }
    const scope = scopeRef.current, controller = new AbortController();
    historyRequest.current?.abort(); historyRequest.current = controller;
    setHistoryBusy(true); setHistoryError('');
    try {
      const result = await api(`/assistant/conversations/${encodeURIComponent(id)}`, {signal: controller.signal});
      if (!currentScope(scope) || controller.signal.aborted) return;
      if (!validConversation(result) || result.id !== id) throw new Error('This conversation could not be opened.');
      scopeRef.current++; conversationRef.current = {id: result.id, version: result.version};
      attemptRef.current = null;
      setMessages(result.messages.map(({id, role, content}: ChatMessage) => ({id, role, content}))); setDraft(''); setSaves({}); setError(''); setContextNote(''); setMemoryNote('Saved conversation · ask for fresh suggestions before making changes'); setPendingExchange(null); setChatTitle(result.title); setSiteId(''); closeHistory();
    } catch (caught) {if (currentScope(scope) && !controller.signal.aborted) {setHistoryError(errorMessage(caught)); if (caught instanceof ApiError && caught.status === 401) void refresh();}}
    finally {if (currentScope(scope) && !controller.signal.aborted) setHistoryBusy(false);}
  }
  function requestSwitch(id: string) {
    if (inFlight.current || saving.current.size) return;
    if (draft.trim() || pendingExchange) setSwitchIntent(id);
    else void switchConversation(id);
  }
  const validPlanDate = /^\d{4}-\d{2}-\d{2}$/.test(planDate) && !Number.isNaN(Date.parse(`${planDate}T12:00:00Z`));
  const plan = useMemo(() => planOpen && validPlanDate ? dailyWorkBrief(data, planDate, {siteId}) : '', [planOpen, validPlanDate, data, planDate, siteId]);
  async function copyPlan() {
    setCopyError('');
    try {if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(plan); else {planRef.current?.select(); if (!document.execCommand('copy')) throw new Error();} setCopied(true);}
    catch {setCopyError('Select the plan below and copy it to your message.'); planRef.current?.focus(); planRef.current?.select();}
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || inFlight.current || pendingExchange || historyBusy || conversationFull || !online || !configured) return;
    const requestRole = data.role, scope = scopeRef.current;
    const conversation = {...conversationRef.current};
    const requestRecords: Record<string, any[]> = Object.fromEntries([...collections].map(collection => [collection, structuredClone(dataRef.current[collection] || [])]));
    const history = messages.slice(-8).map(({role, content}) => ({role, content: content.slice(0, 2000)}));
    const identity = JSON.stringify({requestRole, conversation, content, siteId});
    const exchangeId = attemptRef.current?.identity === identity ? attemptRef.current.exchangeId : crypto.randomUUID();
    const user: ChatMessage = {id: exchangeId, role: 'user', content};
    const body = attemptRef.current?.identity === identity ? attemptRef.current.body : JSON.stringify({message: content, history, today: today(), conversation: {id: conversation.id, exchangeId, expectedVersion: conversation.version}, ...(siteId ? {siteId} : {})});
    attemptRef.current = {identity, exchangeId, body};
    const controller = new AbortController();
    requestRef.current = controller; inFlight.current = true;
    setMessages(current => [...current, user]); setDraft(''); setError(''); setBusy(true);
    const timer = setTimeout(() => controller.abort(), 75000);
    try {
      const response = await fetch('/api/assistant', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body, signal: controller.signal});
      const result = await response.json().catch(() => null);
      if (!currentScope(scope) || roleRef.current !== requestRole) return;
      if (!response.ok) {if (response.status === 401) void refresh(); throw new Error(typeof result?.error === 'string' ? result.error : 'Your assistant could not respond. Please try again.');}
      if (!result || typeof result.reply !== 'string' || !Array.isArray(result.actions)) throw new Error('Your assistant returned an incomplete response. Please try again.');
      attemptRef.current = null;
      const id = crypto.randomUUID();
      const proposals = result.actions.filter((action: any) => action && collections.has(action.collection) && ['create', 'update'].includes(action.operation) && (action.collection !== 'purchaseRequests' || action.operation === 'create') && typeof action.label === 'string' && action.changes && typeof action.changes === 'object' && !Array.isArray(action.changes) && (FINANCIAL_FEATURES_ENABLED || !containsFinancialFields(action.changes)) && (action.operation !== 'update' || typeof action.recordId === 'string')).map((action: Action, index: number): Proposal => {
        const record = (requestRecords[action.collection] || []).find((item: any) => item.id === action.recordId);
        return {...action, key: `${id}-${index}`, baseline: record};
      });
      setMessages(current => [...current, {id, role: 'assistant', content: result.reply, proposals}]);
      setContextNote(typeof result.contextScope?.message === 'string' ? result.contextScope.message : '');
      clearTimeout(timer);
      const exchange = {conversationId: conversation.id, expectedVersion: conversation.version, exchangeId: user.id, user: content, assistant: result.reply};
      if (validConversation(result.conversation) && result.conversation.id === conversation.id) {
        conversationRef.current = {id: result.conversation.id, version: result.conversation.version};
        setChatTitle(result.conversation.title); setPendingExchange(null); setMemoryNote('Conversation saved');
      } else if (typeof result.historyError === 'string' || result.conversation) {
        setPendingExchange(exchange); setMemoryNote('Conversation save not confirmed. Your reply is still here. Try saving it again before sending another message.');
      } else await persistExchange(exchange, scope);
    } catch (caught) {
      if (!currentScope(scope) || roleRef.current !== requestRole) return;
      setDraft(content); setMessages(current => current.filter(item => item.id !== user.id));
      setError(controller.signal.aborted ? 'Your assistant is taking longer than expected. Check Saved chats for its reply. Retrying this message keeps the original request reference.' : errorMessage(caught));
    } finally {
      clearTimeout(timer); if (currentScope(scope)) inFlight.current = false; if (requestRef.current === controller) requestRef.current = null;
      if (currentScope(scope)) {setBusy(false); requestAnimationFrame(() => draftRef.current?.focus());}
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !window.matchMedia('(pointer: coarse)').matches) {event.preventDefault(); void send();}
  }
  async function apply(proposal: Proposal) {
    if ((!FINANCIAL_FEATURES_ENABLED && containsFinancialFields(proposal.changes)) || saving.current.has(proposal.key) || (saves[proposal.key] && saves[proposal.key].status !== 'check-failed') || !online) return;
    const applyScope = scopeRef.current;
    saving.current.add(proposal.key);
    setSaves(previous => ({...previous, [proposal.key]: {status: 'saving'}}));
    if (proposal.operation === 'update') {
      try {
        const records = await api(`/${proposal.collection}`);
        if (!Array.isArray(records)) throw new Error('The latest record could not be checked.');
        const current = records.find((record: any) => record.id === proposal.recordId);
        if (!current || !proposal.baseline || JSON.stringify(canonical(current)) !== JSON.stringify(canonical(proposal.baseline))) {
          if (currentScope(applyScope)) setSaves(previous => ({...previous, [proposal.key]: {status: 'blocked', error: 'This record changed since the suggestion was prepared. Ask for a fresh suggestion before saving.'}}));
          saving.current.delete(proposal.key); return;
        }
      } catch (caught) {
        if (currentScope(applyScope)) setSaves(previous => ({...previous, [proposal.key]: {status: 'check-failed', error: `The latest record could not be checked, so nothing was saved. ${errorMessage(caught)}`}}));
        saving.current.delete(proposal.key);
        if (caught instanceof ApiError && caught.status === 401) void refresh();
        return;
      }
    }
    if (!currentScope(applyScope)) {saving.current.delete(proposal.key); return;}
    try {
      if (proposal.operation === 'create') await create(proposal.collection, proposal.changes);
      else await update(proposal.collection, proposal.recordId!, proposal.changes, proposal.baseline);
      if (currentScope(applyScope)) {setSaves(previous => ({...previous, [proposal.key]: {status: 'saved'}})); notify('Change saved.');}
    } catch (caught) {
      if (currentScope(applyScope)) setSaves(previous => ({...previous, [proposal.key]: {status: 'uncertain', error: `${errorMessage(caught)} Check your records before asking for the change again.`}}));
    } finally {saving.current.delete(proposal.key);}
  }

  return <section className="company-assistant" aria-label="Company assistant">
    <header className="ca-header"><div><span className="ca-eyebrow">{manager ? "HELP WITH THE DAY’S WORK" : "A LITTLE HELP WITH THE EVERYDAY"}</span><h1>Company assistant</h1><p>{manager ? "Plan visits. Assign your team. Follow up on unfinished work." : "Plan the work. Find what needs care. Keep things moving."}</p></div><span className="ca-header-mark" aria-hidden="true"><Sparkles size={23} strokeWidth={1.5} /></span></header>
    <div className="ca-toolbar" aria-label="Assistant tools">
      <div className="ca-toolbar-buttons"><button type="button" onClick={() => void openHistory()} disabled={busy || historyBusy}><History size={15}/><span>Saved chats</span></button><button type="button" onClick={() => requestSwitch('new')} disabled={busy || historyBusy}><Plus size={15}/><span>New chat</span></button><button type="button" onClick={() => {setPlanOpen(true); setCopied(false); setCopyError('');}}><CalendarDays size={15}/><span>Work plan</span></button></div>
      <label className="ca-site-select"><span>Focus</span><select aria-label="Assistant site focus" value={siteId} disabled={busy} onChange={event => {setSiteId(event.target.value); setContextNote('');}}><option value="">All sites</option>{data.places.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
    </div>
    <div className="ca-layout">
      <aside className={`ca-briefing${briefingOpen ? ' is-open' : ''}`} aria-label="Needs attention">
        <div className="ca-briefing-heading"><button type="button" aria-expanded={briefingOpen} aria-controls="ca-briefing-list" onClick={() => setBriefingOpen(open => !open)}><span className="ca-attention-icon"><CircleAlert size={18} /></span><span><strong>Needs attention</strong><small>{briefing ? `${briefing.total ?? briefing.items.length} ${(briefing.total ?? briefing.items.length) === 1 ? 'item' : 'items'} to review` : briefingBusy ? 'Checking your records…' : 'Your company, at a glance'}</small></span><ChevronDown size={16} /></button><button className="ca-icon-button" type="button" aria-label="Refresh briefing" disabled={briefingBusy || !online} onClick={() => setBriefingVersion(version => version + 1)}><RefreshCw size={15} className={briefingBusy ? 'ca-spin' : ''} /></button></div>
        {briefingOpen && <div id="ca-briefing-list" className="ca-briefing-content">{briefingError && <p className="ca-briefing-error" role="status">{briefingError}</p>}{briefing && <><p className="ca-briefing-summary">{briefing.summary}</p><div className="ca-attention-list">{briefing.items.map(item => <a key={item.id} href={briefingHref(item, data.role)} className={`ca-attention-item ca-kind-${item.kind} ca-severity-${item.severity || 'attention'}`}><span>{item.severity === 'urgent' && <em>Priority</em>}<strong>{item.title}</strong><small>{item.detail}</small></span><ArrowRight size={14} /></a>)}</div></>}{!briefing && !briefingError && <p className="ca-briefing-summary">{online ? 'Looking for unfinished work, upcoming deadlines, and stock that needs care.' : 'Reconnect to check the latest records.'}</p>}<p className="ca-records-note">Based on saved records.{briefing?.checkedAt && !Number.isNaN(Date.parse(briefing.checkedAt)) ? ` Checked ${new Date(briefing.checkedAt).toLocaleTimeString('en-GH', {hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra'})}.` : ''}</p></div>}
      </aside>
      <div className="ca-chat">
        <div className="ca-chat-caption"><span title={chatTitle}>{chatTitle}</span>{memoryNote && !pendingExchange && <small role="status">{memoryNote}</small>}</div>
        <div className={`ca-thread${!messages.length ? ' ca-thread-empty' : ''}`} role="log" aria-label="Assistant conversation" aria-live="polite" aria-busy={busy}>
          {!messages.length ? <div className="ca-welcome"><span className="ca-welcome-icon"><Sparkles size={27} strokeWidth={1.3} /></span><h2>What can I help with?</h2><p>Ask about unfinished work, plan a visit, or assign people and a vehicle to a job.</p><div className="ca-prompts">{prompts.map(prompt => <button type="button" key={prompt} onClick={() => choosePrompt(prompt)}>{prompt}<ArrowRight size={14} /></button>)}</div><p className="ca-example">Try “Assign a crew and a vehicle to tomorrow’s hotel visit.”</p></div> : <div className="ca-messages">{messages.map(entry => <article key={entry.id} className={`ca-message ca-message-${entry.role}`}><span className="ca-message-author">{entry.role === 'user' ? 'You' : <><Sparkles size={13} />Your assistant</>}</span><p>{entry.content}</p>{entry.proposals?.length ? <div className="ca-proposals"><span className="ca-review-label">Review before saving</span>{entry.proposals.map(proposal => {const save = saves[proposal.key]; return <article key={proposal.key} className={`ca-proposal${save?.status === 'saved' ? ' is-saved' : ''}`} aria-label={proposal.label}><div className="ca-proposal-heading"><span>{proposal.operation === 'create' ? 'Add' : 'Update'} · {proposal.collection === 'jobs' ? 'Job' : proposal.collection === 'workers' ? 'Person' : proposal.collection === 'vehicles' ? 'Vehicle' : proposal.collection === 'purchaseRequests' ? 'Supply request' : 'Issue'}</span>{save?.status === 'saved' && <small><Check size={13} />Saved</small>}</div><h3>{proposal.label}</h3><dl>{Object.entries(proposal.changes).map(([field, value]) => <div key={field}><dt>{fields[field] || field.replace(/([A-Z])/g, ' $1')}</dt><dd>{describeField(field, value, data)}</dd></div>)}</dl>{proposal.warnings?.map((warning, index) => <p className="ca-action-warning" key={index}><CircleAlert size={14} />{warning}</p>)}{save?.error && <p className="ca-action-error" role="alert">{save.error}</p>}<div className="ca-proposal-actions"><button type="button" className="ca-apply-button" onClick={() => void apply(proposal)} disabled={Boolean(save && save.status !== 'check-failed') || !online}>{save?.status === 'saving' ? <><LoaderCircle size={15} className="ca-spin" />Saving…</> : save?.status === 'saved' ? <><Check size={15} />Saved</> : save?.status === 'check-failed' ? 'Try checking again' : save ? 'Review your records' : <>Save this change<Check size={15} /></>}</button>{save?.status === 'blocked' || save?.status === 'uncertain' ? <a href={`#${proposal.collection === 'jobs' ? 'schedule' : proposal.collection === 'issues' ? 'sites' : proposal.collection === 'purchaseRequests' ? 'inventory' : 'team'}`}>Open records <ArrowRight size={13} /></a> : null}</div></article>;})}</div> : null}</article>)}{busy && <div className="ca-thinking" role="status"><LoaderCircle size={17} className="ca-spin" /><span>Checking your company records…</span></div>}<div ref={endRef} /></div>}
        </div>
        <div className="ca-compose-area">
          {conversationFull && <p className="ca-context-note">This conversation is full. Start a new chat to keep every saved message.</p>}
          {contextNote && <p className="ca-context-note">{contextNote}</p>}
          {pendingExchange && <div className="ca-memory-error" role="status"><span>{memoryNote}</span><button type="button" onClick={() => void retryConversation()} disabled={busy || !online}>Save conversation again</button></div>}
          {!configured && <p className="ca-connection-note">{manager ? <>Ask the owner to connect your assistant. Your attention list is still available.</> : <>Connect your assistant in <a href="#settings">Settings</a> to get help with your company. Your attention list is still available.</>}</p>}
          {!online && <p className="ca-connection-note">Reconnect before asking or saving. Your message will stay here.</p>}
          {error && <div className="ca-error" role="alert"><span>{error}</span><button type="button" className="ca-icon-button" aria-label="Dismiss assistant error" onClick={() => setError('')}><X size={16} /></button></div>}
          <form className="ca-composer" onSubmit={event => void send(event)}><textarea ref={draftRef} aria-label="Message company assistant" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="Tell me what you need help with…" maxLength={3000} rows={2} disabled={busy} /><button type="submit" className="ca-send" aria-label="Send assistant message" disabled={!draft.trim() || busy || historyBusy || conversationFull || Boolean(pendingExchange) || !online || !configured}>{busy ? <LoaderCircle size={19} className="ca-spin" /> : <ArrowUp size={20} />}</button></form>
          <p className="ca-compose-note">Review each suggestion, then save it when it looks right.</p>
        </div>
      </div>
    </div>
    {historyOpen && !switchIntent && <Modal title="Saved conversations" onClose={closeHistory}><p className="ca-modal-note">Conversations saved for the {manager ? 'manager' : 'owner'} account. Open one to continue; previous suggestions are shown as text only.</p>{historyBusy && <p role="status">Opening saved conversations…</p>}{historyError && <p className="ca-action-error" role="alert">{historyError}</p>}{!historyBusy && !historyError && !historyItems.length && <p className="ca-modal-note">Your conversations will appear here after the first reply is saved.</p>}<div className="ca-history-list">{historyItems.map(item => <button type="button" key={item.id} disabled={historyBusy || busy} onClick={() => requestSwitch(item.id)}><MessageCircle size={17}/><span><strong>{item.title}</strong><small>{item.messageCount} messages{!Number.isNaN(Date.parse(item.updatedAt)) ? ` · ${new Date(item.updatedAt).toLocaleDateString('en-GH', {day: 'numeric', month: 'short', timeZone: 'Africa/Accra'})}` : ''}</small></span><ArrowRight size={16}/></button>)}</div>{historyTotal > historyItems.length && <p className="ca-modal-note">Showing {historyItems.length} of {historyTotal} saved conversations.</p>}{historyNext !== null && <button type="button" className="btn btn-secondary" disabled={historyBusy} onClick={() => void openHistory(historyNext)}>Load more conversations</button>}</Modal>}
    {switchIntent && <Modal title="Leave this conversation?" onClose={closeSwitch}><p className="ca-modal-note">{pendingExchange ? 'The latest reply has not been confirmed as saved. Copy anything you need before leaving. Saved company changes will remain.' : 'Your unsent message will be cleared. Saved conversations and company changes will remain.'}</p><div className="ca-modal-actions"><button type="button" className="btn btn-secondary" onClick={closeSwitch}>Keep this conversation</button><button type="button" className="btn btn-primary" onClick={() => void switchConversation(switchIntent)}>Continue</button></div></Modal>}
    {planOpen && <Modal title="Your work plan" onClose={closePlan} wide><p className="ca-modal-note">{siteId ? data.places.find(site => site.id === siteId)?.name : 'All sites'} · Review saved assignments and instructions before sharing.</p><label className="ca-plan-date">Date<input type="date" aria-label="Work plan date" value={planDate} onChange={event => {setPlanDate(event.target.value); setCopied(false); setCopyError('');}}/></label><textarea ref={planRef} className="ca-plan-text" aria-label="Work plan preview" readOnly value={plan || 'Choose a valid date to prepare a work plan.'}/>{copyError && <p role="alert" className="ca-action-error">{copyError}</p>}<div className="ca-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => void copyPlan()} disabled={!plan}><Copy size={15}/>{copied ? 'Copied' : 'Copy plan'}</button>{plan && plan.length <= 12000 && <a href={`https://wa.me/?text=${encodeURIComponent(plan)}`} target="_blank" rel="noreferrer" className="btn btn-primary"><MessageCircle size={15}/>Open WhatsApp</a>}</div><p className="ca-modal-note" role="status">Nothing is sent until you send it in WhatsApp.</p></Modal>}
  </section>;
}
