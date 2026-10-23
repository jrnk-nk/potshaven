import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import './Sites.css';
import ServiceReports from './ServiceReports';
import { prepareImage, dataUrlByteLength } from '../images';
import {engagementTypes, engagementState, workerCanBeAssigned, assignmentWarnings} from '../workforce';

type Row = Record<string, any>;
const pickFields = (row: Row, fields: string[]) => Object.fromEntries(fields.filter(field => row[field] !== undefined).map(field => [field, row[field]]));
const today = () => new Date().toISOString().slice(0, 10);
const dateLabel = (date: string, options?: Intl.DateTimeFormatOptions) => date ? new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', options || { day: 'numeric', month: 'short' }) : 'Not set';
const initials = (name: string) => String(name || 'Team').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
const taskTitle = (task: any) => typeof task === 'string' ? task : task?.title || task?.text || task?.label || '';
const photo = (place: Row) => place.image || '/images/place-1.svg';

function Mark({ name = 'arrow', size = 18 }: { name?: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 5 7 7-7 7M4 12h12" />,
    pin: <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    leaf: <><path d="M20 4C7 2 2 9 7 16s15 1 13-12Z" /><path d="m4 21 11-11" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    edit: <><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z" /></>,
    chat: <><path d="M21 11a9 9 0 0 1-13 8l-6 2 2-6a9 9 0 1 1 17-4Z" /><path d="M8 8c0 5 3 7 7 7l1-2-3-1-1 1-2-2 1-1-1-3Z" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    truck: <><path d="M3 6h11v11H3ZM14 10h4l3 4v3h-7" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
    phone: <path d="M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C10 21 3 14 3 5a2 2 0 0 1 2-2Z" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 11h18" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.arrow}</svg>;
}

function OpsStyles() {
  return <style>{`
    .ops-head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:26px}.ops-head h1{font-family:var(--font-display,Georgia,serif);font-size:32px;font-weight:500;margin:0 0 7px;color:#173c30}.ops-head p{margin:0;color:#849088;font-size:13px}.ops-head-actions{display:flex;gap:9px;align-items:center}.ops-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 0}.ops-tabs{display:flex;gap:5px;flex-wrap:wrap}.ops-tabs button{border:0;background:transparent;padding:9px 16px;border-radius:7px;color:#7a857d;font:inherit;font-size:12px;cursor:pointer}.ops-tabs button.active{background:#e9eee5;color:#274e38;font-weight:600}.ops-search{border:1px solid #e4e8df;background:#fff;border-radius:7px;padding:10px 13px;font:inherit;font-size:12px;min-width:220px;color:#344b3e}.ops-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.ops-card{background:white;border:1px solid #e6e9e1;border-radius:12px;overflow:hidden}.ops-image{height:175px;position:relative;overflow:hidden;background:linear-gradient(130deg,#d2dec7,#849877)}.ops-image img{width:100%;height:100%;object-fit:cover;transition:transform .5s}.ops-card:hover .ops-image img{transform:scale(1.035)}.ops-image .ops-pill{position:absolute;left:14px;top:14px;background:rgba(255,255,255,.95);color:#294d37}.ops-card-body{padding:20px}.ops-card h3{font-family:var(--font-display,Georgia,serif);font-size:22px;font-weight:500;margin:0 0 7px;color:#233f30}.ops-small{font-size:12px;color:#829086;line-height:1.6}.ops-line{display:flex;align-items:center;gap:6px}.ops-pill{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:5px;background:#eef2e9;color:#52684f;font-size:10px;font-weight:600;letter-spacing:.2px;white-space:nowrap}.ops-pill.warm{background:#fbf0dd;color:#a07b32}.ops-pill.red{background:#f9e9e4;color:#b3654f}.ops-card-foot{border-top:1px solid #edf0e9;padding:13px 20px;display:flex;align-items:center;justify-content:space-between;gap:8px}.ops-text-button{border:0;background:transparent;font:inherit;font-size:11px;color:#446b49;padding:3px 0;display:inline-flex;align-items:center;gap:5px;cursor:pointer}.ops-chip-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:16px}.ops-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;margin-bottom:22px}.ops-stat{padding:19px 22px;border-radius:10px;border:1px solid #e5e9e0;background:#fff}.ops-stat span{font-size:11px;color:#829086}.ops-stat strong{display:block;font-family:var(--font-display,Georgia,serif);font-size:30px;font-weight:500;color:#254b36;margin-top:7px}.ops-modal-backdrop{position:fixed;z-index:100;inset:0;background:#132b2359;backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px}.ops-modal{background:#fafbf7;border-radius:15px;width:min(640px,100%);max-height:90vh;overflow:auto;box-shadow:0 25px 80px #1b2c2a40}.ops-modal-title{display:flex;align-items:center;justify-content:space-between;padding:22px 26px;border-bottom:1px solid #e2e8dc}.ops-modal-title h2{font-family:var(--font-display,Georgia,serif);font-size:25px;font-weight:500;margin:0;color:#214b35}.ops-icon-button{border:0;border-radius:6px;background:#edf1e7;color:#536b51;width:30px;height:30px;display:grid;place-items:center;cursor:pointer}.ops-modal-content{padding:24px 26px}.ops-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.ops-field{display:flex;flex-direction:column;gap:7px;font-size:11px;font-weight:600;color:#586958}.ops-field.wide{grid-column:1/-1}.ops-field input,.ops-field select,.ops-field textarea{width:100%;box-sizing:border-box;font:inherit;font-size:13px;font-weight:400;background:#fff;border:1px solid #dfe5d8;border-radius:7px;min-height:42px;padding:10px 12px;color:#354e39}.ops-field textarea{min-height:84px;resize:vertical}.ops-form-actions{margin-top:24px;display:flex;justify-content:flex-end;gap:9px}.ops-error{padding:10px 12px;margin-top:12px;background:#f8e9e4;color:#a35744;font-size:12px;border-radius:6px}.ops-empty{text-align:center;padding:55px 20px;color:#7e8a7c;font-size:13px}.ops-empty strong{display:block;color:#37563a;font-size:17px;margin-bottom:8px}.ops-section-title{font-family:var(--font-display,Georgia,serif);font-size:22px;font-weight:500;color:#294c34;margin:0 0 18px}.ops-detail-meta{display:grid;grid-template-columns:1fr 1fr;gap:17px;margin:20px 0}.ops-detail-meta dt{font-size:10px;color:#8a9487;margin-bottom:4px;text-transform:uppercase;letter-spacing:.6px}.ops-detail-meta dd{font-size:13px;color:#40573e;margin:0;line-height:1.5}.ops-inspection{border-left:2px solid #d3ddca;margin:16px 0;padding:0 0 0 15px}.ops-inspection h4{font-size:12px;margin:0 0 5px;color:#3c593e}.ops-inspection p{font-size:12px;color:#7e8a78;margin:0 0 5px;line-height:1.5}.ops-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;margin-bottom:22px}.ops-day{border:1px solid #e4e8de;background:#fff;border-radius:9px;min-height:81px;padding:11px;text-align:left;cursor:pointer;color:#83907c}.ops-day span{font-size:10px;display:block;text-transform:uppercase;letter-spacing:.7px}.ops-day strong{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:26px;display:block;margin:4px 0;color:#385c3a}.ops-day i{display:block;font-size:9px;font-style:normal}.ops-day.active{background:#254c38;color:#dbe4d4;border-color:#254c38}.ops-day.active strong{color:#fff}.ops-route{background:#fff;border:1px solid #e4e8de;border-radius:12px;overflow:hidden}.ops-route-header{padding:20px 24px;border-bottom:1px solid #edf0e8;display:flex;justify-content:space-between;align-items:center;gap:12px}.ops-route-header h3{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:22px;margin:0 0 4px;color:#294c36}.ops-stop{padding:21px 24px;border-bottom:1px solid #edf0e8;display:grid;grid-template-columns:44px 1fr auto;gap:16px}.ops-stop:last-child{border-bottom:0}.ops-stop-index{width:36px;height:36px;background:#f0f3ea;border:1px solid #e4eadc;border-radius:50%;display:grid;place-items:center;color:#5d7950;font-size:12px;margin-top:4px}.ops-stop h4{font-size:14px;font-weight:600;color:#365137;margin:0 0 6px}.ops-stop-actions{display:flex;flex-direction:column;align-items:flex-end;gap:12px}.ops-avatar{display:grid;place-items:center;background:#e9eee1;color:#56714b;border:2px solid #fff;width:30px;height:30px;border-radius:50%;font-size:10px;font-weight:600;flex-shrink:0}.ops-avatars{display:flex;align-items:center}.ops-avatars .ops-avatar+.ops-avatar{margin-left:-7px}.ops-crew-checks{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}.ops-check-chip{display:flex;gap:6px;align-items:center;font-size:11px;padding:7px 9px;background:#fff;border:1px solid #e1e6d9;border-radius:5px;cursor:pointer}.ops-progress{height:5px;border-radius:10px;background:#ecf0e6;overflow:hidden;margin-top:9px}.ops-progress>span{display:block;height:100%;background:#8ca272;border-radius:10px}.ops-task{display:flex;align-items:center;gap:9px;font-size:13px;color:#52694a;padding:12px 0;border-bottom:1px solid #edf0e7;cursor:pointer}.ops-task input{accent-color:#446a48}.ops-task.done span{text-decoration:line-through;color:#96a18f}.ops-person-top{display:flex;gap:12px;align-items:center}.ops-person-top .ops-avatar{width:45px;height:45px;font-size:14px}.ops-person-top h3{font-size:20px}.ops-table{width:100%;border-collapse:collapse;font-size:12px}.ops-table th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:#8e9888;font-weight:500;padding:14px 20px;border-bottom:1px solid #e7ecdf;background:#fafbf7}.ops-table td{padding:17px 20px;color:#51644c;border-bottom:1px solid #edf0e7}.ops-table tr:last-child td{border-bottom:0}.ops-workload{display:flex;gap:4px}.ops-workload>span{height:18px;width:19px;background:#e9eee2;border-radius:3px}.ops-workload>span.filled{background:#819c6b}.ops-note{background:#eef2e8;border:1px solid #e3e9da;border-radius:7px;font-size:12px;line-height:1.6;padding:12px 15px;color:#6f8062;margin:16px 0}.ops-date-nav{display:flex;align-items:center;gap:8px}.ops-date-nav input{padding:8px 10px;border:1px solid #e0e6d7;border-radius:6px;color:#5b7050;background:white;font:inherit;font-size:12px}.ops-footer-note{font-size:11px;color:#98a18f;margin:18px 0}.ops-photo-preview{width:100%;height:140px;object-fit:cover;border-radius:7px}.ops-type-icon{width:42px;height:42px;background:#eff3e8;color:#70875d;display:grid;place-items:center;border-radius:10px;margin-bottom:16px}
    .ops-summary{display:flex;align-items:center;flex-wrap:wrap;gap:7px 18px;color:#687b65;font-size:13px;margin:-7px 0 22px}.ops-summary strong{font-weight:600;color:#35543b}.ops-details{margin-top:20px;border-top:1px solid #e2e7dc;padding-top:16px}.ops-details>summary{font-size:13px;font-weight:600;color:#426748;cursor:pointer;list-style:none;display:flex;gap:9px;align-items:center;min-height:30px}.ops-details>summary:before{content:'+';font-size:19px;font-weight:400;width:17px}.ops-details[open]>summary:before{content:'−'}.ops-details[open]>summary{margin-bottom:18px}.ops-details .ops-field{font-size:12px}.ops-form-help{font-size:12px;color:#71816b;line-height:1.6;margin:0 0 21px}.ops-field{font-size:12px;color:#4b624d}.ops-field input,.ops-field select,.ops-field textarea{font-size:14px;min-height:44px}.ops-small{color:#6c7e69}.ops-head p{color:#70806b}.ops-text-button{font-size:12px;min-height:30px}.ops-check-chip{font-size:12px;min-height:38px}.ops-text-button[disabled]{opacity:.35}.ops-week-picker{margin:0 0 20px}.ops-week-picker>summary{font-size:12px;color:#71826b;cursor:pointer;list-style:none;padding:3px 0 8px}.ops-week-picker>summary:after{content:' +';margin-left:5px}.ops-week-picker[open]>summary:after{content:' −'}.ops-week-picker .ops-week{margin:5px 0 0}.ops-route-header .btn{background:#285442;color:#fff;border-color:#285442}.ops-search-select{min-width:160px}.ops-photo-grid{display:flex;gap:10px;flex-wrap:wrap}.ops-photo-tile{position:relative}.ops-photo-tile img{width:90px;height:90px;object-fit:cover;border-radius:7px}
    @media(max-width:1100px){.ops-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ops-head h1{font-size:28px}.ops-stop{padding:18px;gap:10px;grid-template-columns:32px 1fr auto}}
    @media(max-width:680px){.ops-head{align-items:flex-start;gap:12px}.ops-head h1{font-size:26px}.ops-head-actions .btn{font-size:11px;padding:9px 10px}.ops-grid{grid-template-columns:1fr}.ops-stats{gap:8px}.ops-stat{padding:14px 12px}.ops-stat strong{font-size:24px}.ops-stat span{font-size:10px}.ops-toolbar{align-items:flex-start;flex-wrap:wrap}.ops-search{min-width:0;flex:1}.ops-tabs button{padding:8px 10px;font-size:11px}.ops-week{gap:4px}.ops-day{padding:10px 6px;min-height:72px}.ops-day strong{font-size:23px}.ops-day i{font-size:8px}.ops-day span{font-size:8px}.ops-route-header{padding:17px;flex-wrap:wrap}.ops-stop{grid-template-columns:26px 1fr}.ops-stop-actions{grid-column:2;align-items:flex-start;flex-direction:row;flex-wrap:wrap;gap:12px 18px}.ops-stop-actions>.ops-text-button{white-space:nowrap}.ops-stop-index{width:25px;height:25px;font-size:10px}.ops-modal-backdrop{padding:12px}.ops-modal-title,.ops-modal-content{padding:20px}.ops-form-grid{grid-template-columns:1fr}.ops-field.wide{grid-column:auto}.ops-table{min-width:560px}.ops-card-body{padding:18px}.ops-head-actions{flex-wrap:wrap;justify-content:flex-end}}
  `}</style>;
}

function Heading({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return <><OpsStyles /><div className="ops-head"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="ops-head-actions">{children}</div></div></>;
}
function Dialog({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) {
  const closeRef = useRef(close); closeRef.current = close;
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') || []).filter(element => element.offsetParent !== null);
    const firstField = dialogRef.current?.querySelector<HTMLElement>('.ops-modal-content input, .ops-modal-content select, .ops-modal-content textarea, .ops-modal-content button');
    (firstField || dialogRef.current)?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') {
        const elements = focusables(); const first = elements[0]; const last = elements[elements.length - 1];
        if (!first) { event.preventDefault(); dialogRef.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', listener);
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', listener); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return <div className="ops-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section ref={dialogRef} tabIndex={-1} className="ops-modal" role="dialog" aria-modal="true" aria-label={title}><div className="ops-modal-title"><h2>{title}</h2><button className="ops-icon-button" aria-label="Close dialog" onClick={close}><Mark name="close" /></button></div><div className="ops-modal-content">{children}</div></section></div>;
}
function Input({ label, value, onChange, type = 'text', required = false, wide = false, min, placeholder }: any) {
  return <label className={`ops-field ${wide ? 'wide' : ''}`}>{label}<input type={type} value={value ?? ''} required={required} min={min} step={type === 'number' ? 'any' : undefined} placeholder={placeholder} onChange={e => onChange(e.target.value)} /></label>;
}
function Select({ label, value, onChange, options, wide = false, required = false }: any) {
  return <label className={`ops-field ${wide ? 'wide' : ''}`}>{label}<select aria-label={label} required={required} value={value ?? ''} onChange={e => onChange(e.target.value)}>{options.map((o: any) => <option key={typeof o === 'string' ? o : o.value} value={typeof o === 'string' ? o : o.value}>{typeof o === 'string' ? o : o.label}</option>)}</select></label>;
}
function Textarea({ label, value, onChange, placeholder }: any) {
  return <label className="ops-field wide">{label}<textarea value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>;
}
function PhotoInput({ label, onChange, onBusyChange }: { label: string; onChange: (value: string) => void; onBusyChange?: (busy: boolean) => void }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const read = async (file?: File) => {
    if (!file) return;
    setError(''); setLoading(true); onBusyChange?.(true);
    try { onChange(await prepareImage(file)); }
    catch (error) { setError(error instanceof Error ? error.message : 'That photo could not be opened. Please try another image.'); }
    finally { setLoading(false); onBusyChange?.(false); }
  };
  return <label className="ops-field wide">{label}<input type="file" accept="image/jpeg,image/png,image/webp" aria-label={label} disabled={loading} onChange={e => { void read(e.target.files?.[0]); e.target.value = ''; }} />{loading && <span className="ops-small">Preparing photo…</span>}{error && <span role="alert" className="ops-small" style={{ color: '#a35744' }}>{error}</span>}</label>;
}
function SaveActions({ busy, close, label = 'Save changes' }: any) { return <div className="ops-form-actions"><button type="button" className="btn btn-secondary" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Saving…' : label}</button></div>; }
function Pill({ children, tone = '' }: { children: React.ReactNode; tone?: string }) { return <span className={`ops-pill ${tone}`}>{children}</span>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="ops-empty"><strong>{title}</strong>{text}</div>; }
function StatePill({ status }: { status: string }) { return <Pill tone={status === 'Overdue' || status === 'Unavailable' ? 'red' : status === 'In progress' || status === 'Scheduled' ? 'warm' : ''}>{status}</Pill>; }
function Crew({ ids, workers }: { ids: string[]; workers: Row[] }) { return <div className="ops-avatars">{(ids || []).map(id => { const person = workers.find(w => w.id === id); return person ? <span className="ops-avatar" key={id} title={person.name}>{initials(person.name)}</span> : null; })}</div>; }

export function PlacesPage() { return <SitesPage/>; }

export function SitesPage() {
  const {data, create, update, notify} = useApp() as any;
  const isOwner = data.role === 'owner';
  const places: Row[] = data.places || [];
  const jobs: Row[] = data.jobs || [];
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(location.hash.split('?')[1] || '').get('site') || '');
  useEffect(() => {const sync = () => {setSelectedId(new URLSearchParams(location.hash.split('?')[1] || '').get('site') || '');setTab('Work');};window.addEventListener('hashchange',sync);return () => window.removeEventListener('hashchange',sync);}, []);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All sites');
  const [tab, setTab] = useState('Work');
  const [editing, setEditing] = useState<Row | null>(null);
  const [visit, setVisit] = useState<Row | null>(null);
  const [issue, setIssue] = useState<Row | null>(null);
  const [job, setJob] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pendingJob, setPendingJob] = useState('');
  const [error, setError] = useState('');
  const selected = places.find(site => site.id === selectedId);
  const siteJobs = selected ? jobs.filter(work => work.placeId === selected.id) : [];
  const activeJobs = siteJobs.filter(work => work.status !== 'Completed');
  const completedJobs = siteJobs.filter(work => work.status === 'Completed');
  const siteIssues: Row[] = selected ? (data.issues || []).filter((item: Row) => item.placeId === selected.id) : [];
  const unassigned = jobs.filter(work => !places.some(site => site.id === work.placeId));
  const outstanding = (site: Row) => jobs.filter(work => work.placeId === site.id && work.status !== 'Completed');
  const needsAttention = (site: Row) => outstanding(site).some(work => (work.type === 'Project' ? work.deadline || work.date : work.date) < today())
    || (data.issues || []).some((item: Row) => item.placeId === site.id && !['Resolved','Closed','Completed'].includes(item.status))
    || (Array.isArray(site.inspections) && site.inspections[0]?.plantHealth && site.inspections[0].plantHealth !== 'Healthy');
  const visible = places.filter(site => (filter !== 'Needs attention' || needsAttention(site)) && `${site.name} ${site.client || ''} ${site.address || ''}`.toLowerCase().includes(search.toLowerCase()));
  const set = (key: string) => (value: any) => setDraft(current => ({...current,[key]:value}));
  const openSite = (site: Row) => {setSelectedId(site.id);setTab('Work');location.hash = `sites?site=${encodeURIComponent(site.id)}`;};
  const editSite = (site: Row = {}) => {setEditing(site);setDraft({name:'',client:'',address:'',phone:'',type:'Residential',measurements:'',image:'',notes:'',...site});setError('');};
  const openVisit = () => {setVisit(selected!);setDraft({id:crypto.randomUUID(),date:today(),plantHealth:'Healthy',irrigation:'Working well',workNeeded:'',notes:'',photos:[]});setError('');};
  const openIssue = () => {setIssue(selected!);setDraft({title:'',description:'',priority:'Normal',followUpDate:today(),status:'Open'});setError('');};
  const addVisitPhoto = (value: string) => {
    const photos = [...(draft.photos || []),value];
    if(photos.length > 4 || photos.filter((source: string) => source.startsWith('data:image/')).reduce((total: number,source: string) => total + dataUrlByteLength(source),0) > 2400 * 1024) throw new Error('Add up to four photos to a site visit.');
    set('photos')(photos);
  };
  const saveSite = async (event: React.FormEvent) => {
    event.preventDefault();setBusy(true);setError('');
    try {
      const payload = pickFields(draft,['name','client','address','phone','type','measurements','image','notes']);
      const saved = editing?.id ? await update('places',editing.id,payload,editing) : await create('places',payload);
      setEditing(null);openSite(saved);notify(editing?.id ? 'Site updated.' : 'Site added. Plan its work or record a visit.');
    } catch(caught: any) {setError(caught.message);} finally {setBusy(false);}
  };
  const saveVisit = async (event: React.FormEvent) => {
    event.preventDefault();if(!visit || busy)return;setBusy(true);setError('');
    try {
      const entry = pickFields(draft,['id','date','plantHealth','irrigation','workNeeded','notes','photos']);
      await update('places',visit.id,{inspection:entry});
      setVisit(null);setTab('Visits');notify('Site visit recorded.');
    } catch(caught: any) {setError(caught.message);} finally {setBusy(false);}
  };
  const saveIssue = async (event: React.FormEvent) => {
    event.preventDefault();if(!issue)return;setBusy(true);setError('');
    try {await create('issues',{...pickFields(draft,['title','description','priority','followUpDate','status']),placeId:issue.id,date:today()});setIssue(null);notify('Site follow-up added.');}
    catch(caught: any) {setError(caught.message);} finally {setBusy(false);}
  };
  const changeJob = async (work: Row, patch: Row) => {setPendingJob(work.id);try {await update('jobs',work.id,patch,work);notify('Work updated.');}catch(caught: any){notify(caught.message);}finally{setPendingJob('');}};
  const workCard = (work: Row) => {
    const tasks: any[] = Array.isArray(work.tasks) ? work.tasks : [];
    const checked = tasks.filter(task => task && typeof task === 'object' && task.done === true).length;
    const crew = (data.workers || []).filter((person: Row) => (work.crewIds || []).includes(person.id));
    const vehicle = (data.vehicles || []).find((item: Row) => item.id === work.vehicleId);
    const date = work.type === 'Project' ? work.deadline || work.date : work.date;
    return <article className="site-work-card" key={work.id}>
      <div className="site-work-heading"><div><span className="site-work-kind">{work.type === 'Project' ? 'PROJECT WORK' : 'MAINTENANCE VISIT'}</span><h3>{work.title}</h3></div><StatePill status={work.status !== 'Completed' && date && date < today() ? 'Overdue' : work.status}/></div>
      <p className="ops-small site-work-meta"><span><Mark name="calendar" size={14}/>{work.type === 'Project' ? 'Due ' : ''}{dateLabel(date)}{work.time && work.type !== 'Project' ? ` · ${work.time}` : ''}</span>{work.recurrence && work.recurrence !== 'None' && <span><Mark name="leaf" size={14}/>{work.recurrence}</span>}</p>
      <p className="ops-small">{crew.length ? crew.map((person: Row) => person.name).join(', ') : 'People to assign'} · {vehicle?.name || 'Transport to confirm'}</p>
      {work.notes && <p className="ops-small site-work-notes">{work.notes}</p>}
      {tasks.length > 0 && <details className="site-checklist"><summary>{checked}/{tasks.length} tasks checked</summary>{tasks.map((task,index) => <label className={`ops-task ${task?.done ? 'done' : ''}`} key={task?.id || `${index}-${taskTitle(task)}`}><input type="checkbox" checked={Boolean(task && typeof task === 'object' && task.done === true)} disabled={pendingJob === work.id} onChange={() => void changeJob(work,{tasks:tasks.map((item,i) => ({...(item && typeof item === 'object' ? pickFields(item,['id','text','title','label']) : {title:taskTitle(item)}),done:i === index ? !(item && typeof item === 'object' && item.done === true) : item && typeof item === 'object' && item.done === true}))})}/><span>{taskTitle(task)}</span></label>)}</details>}
      {work.status === 'Completed' && checked < tasks.length && <p className="site-attention">Some tasks still need confirmation.</p>}
      <div className="site-work-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setJob(work)}>View / edit work <Mark name="edit" size={13}/></button><button type="button" className="ops-text-button" disabled={pendingJob === work.id} onClick={() => void changeJob(work,{status:work.status === 'Completed' ? 'Scheduled' : 'Completed'})}>{work.status === 'Completed' ? 'Reopen work' : 'Mark complete'} <Mark name="check" size={14}/></button></div>
    </article>;
  };
  return <div className="sites-page"><OpsStyles/>
    {!selected ? <>
      <Heading title="Sites" subtitle="Every location, project and maintenance visit together."><button className="btn btn-primary" onClick={() => editSite()}><Mark name="plus" size={16}/> Add a site</button></Heading>
      <p className="ops-summary"><span><strong>{places.length}</strong> sites</span><span><strong>{jobs.filter(work => work.status !== 'Completed').length}</strong> work items in progress</span><span><strong>{places.filter(needsAttention).length}</strong> need attention</span></p>
      <div className="ops-toolbar"><input className="ops-search" aria-label="Search sites" placeholder="Find a site or client…" value={search} onChange={event => setSearch(event.target.value)}/><div className="ops-tabs" aria-label="Site filter">{['All sites','Needs attention'].map(label => <button type="button" key={label} aria-pressed={filter === label} className={filter === label ? 'active' : ''} onClick={() => setFilter(label)}>{label}</button>)}</div></div>
      <div className="ops-grid">{visible.map(site => {
        const work = outstanding(site);
        const next = work.filter(item => item.type === 'Maintenance').sort((a,b) => String(a.date || '9999').localeCompare(String(b.date || '9999')))[0];
        return <article className="ops-card site-card" key={site.id}><button className="site-card-open" type="button" aria-label={`Open ${site.name}`} onClick={() => openSite(site)}><div className="ops-image"><img src={photo(site)} alt="" loading="lazy"/><Pill>{site.type || 'Site'}</Pill></div><div className="ops-card-body"><h2>{site.name}</h2><p className="ops-small">{site.client || 'Client to add'}</p><p className="ops-small ops-line"><Mark name="pin" size={13}/>{site.address || 'Location to add'}</p><div className="ops-chip-row"><Pill>{work.filter(item => item.type === 'Project').length} projects</Pill><Pill tone={needsAttention(site) ? 'warm' : ''}>{next ? `Visit ${dateLabel(next.date)}` : 'No visit planned'}</Pill></div></div></button><div className="ops-card-foot"><button className="ops-text-button" onClick={() => openSite(site)}>Open site <Mark size={13}/></button><button className="ops-text-button" aria-label={`Edit ${site.name}`} onClick={() => editSite(site)}><Mark name="edit" size={14}/> Edit</button></div></article>;
      })}</div>
      {!visible.length && <Empty title={places.length ? 'No sites match this view' : 'Start with your first site'} text={places.length ? 'Try another name or show all sites.' : 'Add the location once, then keep its projects, visits and maintenance here.'}/>}
      {unassigned.length > 0 && <section className="site-unassigned"><h2>Work waiting for a site</h2><p className="ops-small">These existing jobs are saved. Open one and choose its site to bring everything together.</p><div className="site-work-list">{unassigned.map(workCard)}</div></section>}
    </> : <>
      <button className="site-back" type="button" onClick={() => {setSelectedId('');setTab('Work');location.hash = 'sites';}}>← All sites</button>
      <div className="site-title"><div><p className="site-work-kind">{selected.type || 'SITE'}</p><h1>{selected.name}</h1><p>{selected.client || 'Client to add'}{selected.address ? ` · ${selected.address}` : ''}</p></div><button className="btn btn-secondary" onClick={() => editSite(selected)}><Mark name="edit" size={14}/> Edit site</button></div>
      <div className="site-actions"><button className="btn btn-primary" onClick={() => setJob({placeId:selected.id,type:'Maintenance'})}><Mark name="calendar" size={16}/> Schedule maintenance</button><button className="btn btn-secondary" onClick={openVisit}><Mark name="check" size={16}/> Record site visit</button>{isOwner && <button className="btn btn-secondary" onClick={() => setJob({placeId:selected.id,type:'Project'})}><Mark name="plus" size={16}/> Plan project</button>}</div>
      <nav className="site-tabs" aria-label="Site sections">{['Work','Visits','Details','Visit reports'].map(label => <button type="button" key={label} aria-pressed={tab === label} className={tab === label ? 'active' : ''} onClick={() => setTab(label)}>{label}{label === 'Work' ? ` · ${activeJobs.length}` : label === 'Visits' ? ` · ${(selected.inspections || []).length}` : ''}</button>)}</nav>
      {tab === 'Work' && <><section className="site-work-list" aria-label="Active site work">{activeJobs.sort((a,b) => String(a.date || '').localeCompare(String(b.date || ''))).map(workCard)}{!activeJobs.length && <Empty title="Ready for the next visit" text="Schedule maintenance or plan project work for this site."/>}</section>{completedJobs.length > 0 && <details className="site-completed"><summary>Completed work · {completedJobs.length}</summary><div className="site-work-list">{completedJobs.map(workCard)}</div></details>}
        <section className="site-followups"><div className="site-section-heading"><div><h2>Site follow-ups</h2><p>Repairs, replacements and anything that needs attention.</p></div><button className="btn btn-secondary btn-sm" onClick={openIssue}>Add follow-up <Mark name="plus" size={14}/></button></div>{siteIssues.length ? siteIssues.map(item => <article className="site-issue" key={item.id}><div><strong>{item.title}</strong><p className="ops-small">{[item.description || item.notes,item.followUpDate ? `Follow up ${dateLabel(item.followUpDate)}` : ''].filter(Boolean).join(' · ')}</p></div><StatePill status={item.status || 'Open'}/>{!['Resolved','Closed','Completed'].includes(item.status) && <button className="ops-text-button" onClick={async () => {try{await update('issues',item.id,{status:'Resolved'},item);notify('Follow-up resolved.');}catch(caught: any){notify(caught.message);}}}>Resolve</button>}</article>) : <p className="ops-small">No follow-ups recorded.</p>}</section>
      </>}
      {tab === 'Visits' && <section className="site-history"><div className="site-section-heading"><div><h2>Visit history</h2><p>Condition checks, work needed and photos from the site.</p></div><button className="btn btn-secondary btn-sm" onClick={openVisit}>Record visit <Mark name="plus" size={14}/></button></div>{(selected.inspections || []).map((entry: Row) => <article className="site-visit" key={entry.id}><div className="site-work-heading"><h3>{dateLabel(entry.date)}</h3><Pill tone={entry.plantHealth !== 'Healthy' ? 'warm' : ''}>{entry.plantHealth || 'Condition recorded'}</Pill></div><p className="ops-small">Irrigation: {entry.irrigation || 'Not recorded'}</p>{entry.workNeeded && <p className="ops-small"><strong>Work needed:</strong> {entry.workNeeded}</p>}{entry.notes && <p className="ops-small">{entry.notes}</p>}{entry.photos?.length > 0 && <div className="site-photo-history">{entry.photos.map((item: any,index: number) => <div key={index}><img src={typeof item === 'string' ? item : item.url || item.image} alt={`Visit photo ${index + 1}`} loading="lazy"/></div>)}</div>}{entry.workNeeded && <button className="ops-text-button" onClick={() => setJob({placeId:selected.id,type:'Maintenance',title:`Follow-up care · ${selected.name}`,notes:entry.workNeeded})}>Plan this work <Mark name="calendar" size={14}/></button>}</article>)}{!selected.inspections?.length && <Empty title="Your site’s care history starts here" text="Record the first visit, the condition of the plants and any work needed."/>}</section>}
      {tab === 'Visit reports' && <ServiceReports siteId={selected.id}/>}
      {tab === 'Details' && <section className="site-details"><img className="site-cover" src={photo(selected)} alt={selected.name}/><dl className="ops-detail-meta"><div><dt>Client</dt><dd>{selected.client || 'Not recorded'}</dd></div><div><dt>Phone</dt><dd>{selected.phone || 'Not recorded'}</dd></div><div><dt>Location</dt><dd>{selected.address || 'Not recorded'}</dd></div><div><dt>Measurements</dt><dd>{selected.measurements || 'Not recorded'}</dd></div></dl>{selected.notes && <div className="ops-note">{selected.notes}</div>}<a className="btn btn-secondary" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selected.address || selected.name)}`} target="_blank" rel="noreferrer"><Mark name="pin" size={15}/> Directions</a><h2>Plants & materials used</h2>{(data.stockMovements || []).filter((movement: Row) => movement.type === 'use' && siteJobs.some(work => work.id === movement.jobId)).map((movement: Row) => <div className="site-stock-row" key={movement.id}><span>{movement.itemName}</span><strong>{movement.quantity} used</strong><small>{dateLabel(movement.date)}</small></div>)}{!(data.stockMovements || []).some((movement: Row) => movement.type === 'use' && siteJobs.some(work => work.id === movement.jobId)) && <p className="ops-small">Stock recorded against this site’s jobs will appear here.</p>}</section>}
    </>}
    {editing && <Dialog title={editing.id ? 'Edit site' : 'Add a site'} close={() => setEditing(null)}><form onSubmit={saveSite}><p className="ops-form-help">Save the location once. Its projects, visits and maintenance stay together.</p><div className="ops-form-grid"><Input label="Site name" required value={draft.name} onChange={set('name')}/><Input label="Client / company" value={draft.client} onChange={set('client')}/><Input label="Address or location" wide required value={draft.address} onChange={set('address')}/><PhotoInput label="Upload site photo" onChange={set('image')} onBusyChange={setPhotoBusy}/>{draft.image && <img className="ops-photo-preview" style={{gridColumn:'1 / -1'}} src={draft.image} alt="Site photo preview"/>}</div><details className="ops-details"><summary>Measurements & access notes</summary><div className="ops-form-grid"><Select label="Type of site" value={draft.type} onChange={set('type')} options={['Residential','Hotel','Commercial','Median','Roundabout','Other']}/><Input label="Contact phone" type="tel" value={draft.phone} onChange={set('phone')}/><Input label="Measurements" value={draft.measurements} onChange={set('measurements')} placeholder="e.g. 24 m × 12 m"/><Textarea label="Site and access notes" value={draft.notes} onChange={set('notes')}/></div></details>{error && <div className="ops-error" role="alert">{error}</div>}<SaveActions busy={busy || photoBusy} close={() => setEditing(null)} label={editing.id ? 'Save site' : 'Add site'}/></form></Dialog>}
    {visit && <Dialog title="Record site visit" close={() => setVisit(null)}><form onSubmit={saveVisit}><p className="ops-form-help">{visit.name}</p><div className="ops-form-grid"><Input label="Visit date" type="date" required value={draft.date} onChange={set('date')}/><Select label="Plant health" value={draft.plantHealth} onChange={set('plantHealth')} options={['Healthy','Needs attention','Replacement needed']}/><Select label="Irrigation" value={draft.irrigation} onChange={set('irrigation')} options={['Working well','Needs repair','Manual watering','Not applicable']}/><Textarea label="Work or replacements needed" value={draft.workNeeded} onChange={set('workNeeded')}/><Textarea label="Visit notes" value={draft.notes} onChange={set('notes')}/><PhotoInput label="Add visit photo" onBusyChange={setPhotoBusy} onChange={addVisitPhoto}/>{draft.photos?.length > 0 && <div className="ops-photo-grid">{draft.photos.map((source: string,index: number) => <div className="ops-photo-tile" key={index}><img src={source} alt={`Visit photo preview ${index + 1}`}/><button className="ops-icon-button" type="button" aria-label={`Remove visit photo ${index + 1}`} onClick={() => set('photos')(draft.photos.filter((_: string,i: number) => i !== index))}><Mark name="close" size={12}/></button></div>)}</div>}</div>{error && <div className="ops-error" role="alert">{error}</div>}<SaveActions busy={busy || photoBusy} close={() => setVisit(null)} label="Save visit"/></form></Dialog>}
    {issue && <Dialog title="Add site follow-up" close={() => setIssue(null)}><form onSubmit={saveIssue}><div className="ops-form-grid"><Input label="Follow-up title" required wide value={draft.title} onChange={set('title')}/><Select label="Priority" value={draft.priority} onChange={set('priority')} options={['Low','Normal','High','Urgent']}/><Input label="Follow-up date" type="date" value={draft.followUpDate} onChange={set('followUpDate')}/><Textarea label="What needs attention?" value={draft.description} onChange={set('description')}/></div>{error && <div className="ops-error" role="alert">{error}</div>}<SaveActions busy={busy} close={() => setIssue(null)} label="Save follow-up"/></form></Dialog>}
    {job && <JobForm job={job} type={job.type || 'Maintenance'} close={() => setJob(null)}/>}
  </div>;
}

export function JobForm({ job, type, close }: { job: Row; type: string; close: () => void }) {
  const { data, create, update, notify } = useApp() as any;
  const isOwner = data.role === 'owner';
  const [draft, setDraft] = useState<Row>({ title: '', placeId: '', date: today(), time: '08:00', status: 'Scheduled', crewIds: [], vehicleId: '', deadline: job.deadline || job.date || today(), recurrence: 'None', type, ...job });
  const [tasks, setTasks] = useState<string>((job.tasks || []).map(taskTitle).join('\n'));
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: string) => (value: any) => setDraft(d => ({ ...d, [key]: value }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    const taskList = tasks.split('\n').map(value => value.trim()).filter(Boolean).map(title => {
      const previous = (job.tasks || []).find((task: any) => taskTitle(task) === title);
      return {...(previous && typeof previous === 'object' ? pickFields(previous,['id']) : {}), title, done: previous?.done === true};
    });
    const payload = {...pickFields(draft,['title','placeId','date','time','status','crewIds','vehicleId','notes','photos','completionPhotos','completedAt','routeOrder','recurrence',...((isOwner || draft.type === 'Maintenance') ? ['deadline'] : []),...(isOwner ? ['type'] : [])]),...(!job.id && !isOwner ? {type:'Maintenance'} : {}),tasks:taskList};
    try {if(job.id) await update('jobs',job.id,payload,job);else await create('jobs',payload);notify(job.id ? 'Job updated.' : 'Job scheduled.');close();}
    catch(caught: any) {setError(caught.message);} finally {setBusy(false);}
  };
  const careOptions = [
    ['Watering','Water plants and check soil moisture'],['Pruning','Prune shrubs and remove damaged growth'],
    ['Weeding','Remove weeds from beds and pots'],['Fertilising','Apply suitable plant feed'],
    ['Pest checks','Inspect plants for pests and disease'],['Irrigation','Check irrigation and report leaks'],['Cleanup','Collect garden waste and leave the site tidy'],
  ];
  const toggleCareTask = (title: string) => setTasks(previous => {const lines = previous.split('\n').map(value => value.trim()).filter(Boolean);return (lines.includes(title) ? lines.filter(value => value !== title) : [...lines,title]).join('\n');});

  const setDate = (value: string) => setDraft(previous => ({ ...previous, date: value, ...((isOwner || previous.type === 'Maintenance') ? {deadline: !previous.deadline || previous.deadline === previous.date ? value : previous.deadline} : {}) }));
  const addPhoto = (value: string) => {
    const photos = [...(draft.photos || []), value];
    const inline = photos.map((photo: any) => typeof photo === 'string' ? photo : photo.url || photo.image || '').filter((source: string) => source.startsWith('data:image/'));
    if (inline.length > 4 || inline.reduce((sum: number, source: string) => sum + dataUrlByteLength(source), 0) > 2400 * 1024) {
      throw new Error('Save these photos before adding more. You can upload up to four photos at a time.');
    }
    setError(''); set('photos')(photos);
  };
  const warnings = assignmentWarnings(draft, data.jobs || [], data.workers || [], data.vehicles || []);
  const assignedCrew = (data.workers || []).filter((worker: Row) => (draft.crewIds || []).includes(worker.id));
  const assignedVehicle = (data.vehicles || []).find((vehicle: Row) => vehicle.id === draft.vehicleId);
  return <><OpsStyles /><Dialog title={job.id ? 'Edit job' : draft.type === 'Project' ? 'Create a project' : 'Schedule a visit'} close={close}><form onSubmit={save}>
    <div className="ops-form-grid"><Input label="Job title" value={draft.title} required wide onChange={set('title')} placeholder="e.g. Weekly garden care" /><Select label="Site" required wide value={draft.placeId} onChange={set('placeId')} options={[{ value: '', label: 'Choose a site' }, ...(data.places || []).map((p: Row) => ({ value: p.id, label: p.name }))]} /><Input label="Visit / start date" type="date" required value={draft.date} onChange={setDate} /><Input label="Start time" type="time" value={draft.time} onChange={set('time')} />{draft.type === 'Maintenance' ? <Select label="Repeat maintenance" wide value={draft.recurrence} onChange={set('recurrence')} options={['None', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly']} /> : <>{isOwner ? <Input label="Deadline" type="date" value={draft.deadline} onChange={set('deadline')} /> : <div className="ops-field"><span>Project deadline</span><p className="ops-small">{dateLabel(job.deadline)} · Set by the owner</p></div>}</>}
    {draft.type === 'Maintenance' && draft.recurrence !== 'None' && <p className="ops-small" style={{gridColumn:'1 / -1',margin:0}}>The next visit is scheduled when this one is marked complete.</p>}
    <div className="ops-field wide">Who is doing the work?</div>
    <div className="ops-crew-checks">{(data.workers || []).map((worker: Row) => <label className="ops-check-chip" key={worker.id}><input type="checkbox" aria-label={worker.name} checked={(draft.crewIds || []).includes(worker.id)} onChange={e => set('crewIds')(e.target.checked ? [...(draft.crewIds || []), worker.id] : (draft.crewIds || []).filter((id: string) => id !== worker.id))} /><span>{worker.name}{worker.engagementType && worker.engagementType !== 'Permanent' && <small style={{display:'block',fontSize:10,color:'#657861'}}>{worker.engagementType}{!workerCanBeAssigned(worker, data.jobs || [], draft.date) ? ' · check agreement' : ''}</small>}</span></label>)}</div>
    <Select label="Vehicle" wide value={draft.vehicleId} onChange={set('vehicleId')} options={[{value:'',label:'No vehicle assigned'}, ...(data.vehicles || []).map((vehicle: Row) => ({value:vehicle.id,label:`${vehicle.name}${vehicle.registration ? ` · ${vehicle.registration}` : ''}${vehicle.status && vehicle.status !== 'Available' ? ` · ${vehicle.status}` : ''}`}))]} />
    {(assignedCrew.length > 0 || assignedVehicle) && <div className="ops-note" style={{gridColumn:'1 / -1',margin:0}} aria-label="Assignment summary"><strong>Assigned:</strong> {assignedCrew.map((worker: Row) => worker.name).join(', ') || 'No crew yet'}{assignedVehicle ? ` · ${assignedVehicle.name}` : ' · No vehicle'}</div>}
    {warnings.length > 0 && <div className="ops-note" style={{gridColumn:'1 / -1',margin:0,background:'#fff6e7',borderColor:'#ead9b4',color:'#775d32'}} role="status"><strong>Before assigning</strong><ul style={{margin:'7px 0 0',paddingLeft:18}}>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><p style={{margin:'8px 0 0'}}>You can still save this plan after checking with the team.</p></div>}
    {draft.type === 'Maintenance' && <fieldset className="site-care-picker"><legend>Maintenance options</legend><p>Tap to add a task, then adjust the checklist below.</p><div>{careOptions.map(([label,title]) => <button key={label} type="button" aria-pressed={tasks.split('\n').includes(title)} onClick={() => toggleCareTask(title)}>{tasks.split('\n').includes(title) ? '✓ ' : '+ '}{label}</button>)}</div></fieldset>}
    <Textarea label="Task checklist · one task per line" value={tasks} onChange={setTasks} placeholder="Trim hedges\nCheck irrigation\nRemove green waste" /></div>
    <details className="ops-details"><summary>More job details</summary><div className="ops-form-grid">{isOwner && <Select label="Job type" value={draft.type} onChange={set('type')} options={['Maintenance', 'Project']} />}<Select label="Status" value={draft.status} onChange={set('status')} options={['Scheduled', 'In progress', 'Completed', 'Overdue']} />{draft.type === 'Maintenance' && <><Input label="Deadline" type="date" value={draft.deadline} onChange={set('deadline')} /></>}<Textarea label="Instructions for the crew" value={draft.notes} onChange={set('notes')} /><PhotoInput onBusyChange={setPhotoBusy} label="Add completion photo from WhatsApp or camera" onChange={addPhoto} />{(draft.photos || []).length > 0 && <div className="ops-photo-grid">{(draft.photos || []).map((p: any, i: number) => <div key={i} className="ops-photo-tile"><img src={typeof p === 'string' ? p : p.url} alt={`Completion photo ${i + 1}`} /><button type="button" className="ops-icon-button" aria-label={`Remove completion photo ${i + 1}`} style={{ position: 'absolute', right: 2, top: 2, width: 20, height: 20 }} onClick={() => set('photos')((draft.photos || []).filter((_: any, index: number) => i !== index))}><Mark name="close" size={12} /></button></div>)}</div>}</div></details>{error && <div className="ops-error" role="alert">{error}</div>}<SaveActions busy={busy || photoBusy} close={close} label={job.id ? 'Save job' : 'Create job'} /></form></Dialog></>;

}

export function SchedulePage() {
  const { data, update, notify } = useApp() as any;
  const [date, setDate] = useState(today());
  const [crew, setCrew] = useState('all');
  const [editing, setEditing] = useState<Row | null>(null);
  const jobs: Row[] = data.jobs || [];
  const workers: Row[] = data.workers || [];
  const visible = jobs.filter(j => j.date === date && (crew === 'all' || (j.crewIds || []).includes(crew))).sort((a, b) => (a.routeOrder ?? 100) - (b.routeOrder ?? 100) || (a.time || '').localeCompare(b.time || ''));
  const monday = new Date(`${date}T12:00:00`); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); });
  const shareMessage = (selected: Row[]) => { const person = workers.find(w => w.id === crew); const lines = [`${data.settings?.companyName || 'PotsHaven'} · Work instructions`, dateLabel(date, { weekday: 'long', day: 'numeric', month: 'long' }), '', ...selected.flatMap((j, i) => { const place = data.places.find((p: Row) => p.id === j.placeId); const vehicle = (data.vehicles || []).find((v: Row) => v.id === j.vehicleId); return [`${i + 1}. ${j.time || '08:00'} · ${j.title}`, `Location: ${place?.name || 'To be confirmed'}${place?.address ? `, ${place.address}` : ''}`, `Crew: ${(j.crewIds || []).map((id: string) => workers.find(w => w.id === id)?.name).filter(Boolean).join(', ') || 'To be assigned'}`, `Vehicle: ${vehicle ? `${vehicle.name} ${vehicle.registration || ''}` : 'To be assigned'}`, ...(j.crewIds || []).flatMap((id: string) => { const worker = workers.find(w => w.id === id); return worker?.agreementNotes ? [`${worker.name} · agreed work: ${worker.agreementNotes}`] : []; }), ...(j.tasks || []).map((t: any) => `• ${taskTitle(t)}`), ...(j.notes ? [`Instructions: ${j.notes}`] : []), ...(j.deadline ? [`Deadline: ${dateLabel(j.deadline)}`] : []), 'Please send completion photos and report any issues.', '']; })]; const phone = person?.phone?.replace(/\D/g, '') || ''; return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`; };
  const moveStop = async (index: number, direction: number) => { const target = index + direction; if (target < 0 || target >= visible.length) return; const reordered = [...visible]; [reordered[index], reordered[target]] = [reordered[target], reordered[index]]; try { await Promise.all(reordered.map((j, i) => update('jobs', j.id, { routeOrder: i },j))); notify('Route order updated.'); } catch (e: any) { notify(e.message); } };
  const finish = async (job: Row) => { try { await update('jobs', job.id, { status: job.status === 'Completed' ? 'Scheduled' : 'Completed', completedAt: job.status === 'Completed' ? null : new Date().toISOString() },job); notify(job.status === 'Completed' ? 'Job reopened.' : 'Visit marked complete.'); } catch (e: any) { notify(e.message); } };
  return <div><Heading title="Schedule & routes" subtitle="A clear plan for every crew, every day."><button className="btn btn-primary" onClick={() => setEditing({ date })}><Mark name="plus" size={15} /> Schedule a visit</button></Heading>
    <div className="ops-toolbar"><div className="ops-date-nav"><input type="date" aria-label="Schedule date" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} /><button className="btn btn-secondary btn-sm" onClick={() => setDate(today())}>Today</button></div><select className="ops-search" aria-label="Filter by crew member" value={crew} onChange={e => setCrew(e.target.value)}><option value="all">All crew members</option>{workers.map(w => <option value={w.id} key={w.id}>{w.name}</option>)}</select></div>
    <details className="ops-week-picker"><summary>Show this week</summary><div className="ops-week">{week.map(day => <button className={`ops-day ${day === date ? 'active' : ''}`} onClick={() => setDate(day)} key={day}><span>{dateLabel(day, { weekday: 'short' })}</span><strong>{new Date(`${day}T12:00:00`).getDate()}</strong><i>{jobs.filter(j => j.date === day).length} visits</i></button>)}</div></details>
    <section className="ops-route"><div className="ops-route-header"><div><h3>{dateLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h3><span className="ops-small">{visible.length} stops · {visible.filter(j => j.status === 'Completed').length} completed</span></div>{visible.length > 0 && <a className="btn btn-secondary btn-sm" href={shareMessage(visible)} target="_blank" rel="noreferrer"><Mark name="chat" size={15} /> Share route on WhatsApp</a>}</div>{visible.map((job, index) => { const place = data.places.find((p: Row) => p.id === job.placeId); return <article className="ops-stop" key={job.id}><span className="ops-stop-index">{job.status === 'Completed' ? <Mark name="check" size={14} /> : index + 1}</span><div><div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}><h4>{job.title}</h4><StatePill status={job.status} /></div><div className="ops-small ops-line"><Mark name="pin" size={12} />{place?.name || 'Site not assigned'} · {place?.address}</div><div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 11 }}><span className="ops-small ops-line"><Mark name="clock" size={12} />{job.time || '08:00'}</span><Crew ids={job.crewIds} workers={workers} /><span className="ops-small">{(job.tasks || []).length} tasks</span></div><p className="ops-small" style={{margin:'8px 0 0'}}>Crew: {(job.crewIds || []).map((id: string) => workers.find(worker => worker.id === id)?.name).filter(Boolean).join(', ') || 'Not assigned'} · Vehicle: {(data.vehicles || []).find((vehicle: Row) => vehicle.id === job.vehicleId)?.name || 'Not assigned'}</p>{job.notes && <p className="ops-small" style={{ marginBottom: 0 }}>{job.notes}</p>}</div><div className="ops-stop-actions"><button className="ops-text-button" onClick={() => setEditing(job)}>View / edit <Mark name="edit" size={13} /></button><div style={{ display: 'flex', gap: 12 }}><a className="ops-text-button" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place?.address || place?.name || '')}`} target="_blank" rel="noreferrer">Directions <Mark name="pin" size={12} /></a><button className="ops-text-button" onClick={() => finish(job)}>{job.status === 'Completed' ? 'Reopen' : 'Complete'} <Mark name="check" size={13} /></button></div><div style={{ display: 'flex', gap: 8 }}><button className="ops-text-button" disabled={index === 0} aria-label={`Move ${job.title} earlier`} onClick={() => moveStop(index, -1)}>↑ Earlier</button><button className="ops-text-button" disabled={index === visible.length - 1} aria-label={`Move ${job.title} later`} onClick={() => moveStop(index, 1)}>↓ Later</button></div></div></article>; })}{!visible.length && <Empty title="A fresh day, ready to plan" text="Schedule a maintenance visit or choose a different day." />}</section><p className="ops-footer-note">WhatsApp opens a prepared message for you to review and send. Route order is arranged by the manager.</p>
    {editing && <JobForm job={editing} type="Maintenance" close={() => setEditing(null)} />}
  </div>;
}

export function ProjectsPage() { return <SitesPage/>; }

export function TeamPage() {
  const {data, create, update, notify} = useApp() as any;
  const isOwner = data.role === 'owner';
  const [tab, setTab] = useState('Crew');
  const [search, setSearch] = useState('');
  const [crewFilter, setCrewFilter] = useState('All workers');
  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const workers: Row[] = data.workers || [];
  const vehicles: Row[] = data.vehicles || [];
  const jobs: Row[] = data.jobs || [];
  const activeJobs = (worker: Row) => jobs.filter(job => (job.crewIds || []).includes(worker.id) && job.status !== 'Completed');
  const todayJobs = (worker: Row) => activeJobs(worker).filter(job => job.date === today());
  const edit = (row: Row = {}) => {
    setEditing(row);
    setDraft(tab === 'Vehicles'
      ? {name:'',registration:'',capacity:'',status:'Available',notes:'',...row}
      : {name:'',role:'Gardener',phone:'',skills:[],available:true,workforceType:'Internal',engagementType:'Permanent',engagementStart:'',engagementEnd:'',relatedJobId:'',agreementStatus:'Not recorded',agreementReference:'',agreementNotes:'',...row});
    setError('');
  };
  const set = (key: string) => (value: any) => setDraft(previous => ({...previous,[key]:value}));
  const setEngagement = (value: string) => setDraft(previous => {
    const start = previous.engagementStart || today();
    const end = new Date(`${start}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + (value === 'Weekly' ? 6 : 0));
    return {...previous,engagementType:value,engagementStart:value === 'Permanent' ? '' : start,
      engagementEnd:['Permanent','Until job complete'].includes(value) ? '' : ['Daily','Weekly'].includes(value) ? end.toISOString().slice(0,10) : previous.engagementEnd || '',
      relatedJobId:value === 'Until job complete' ? previous.relatedJobId || '' : ''};
  });
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    const collection = tab === 'Vehicles' ? 'vehicles' : 'workers';
    const payload = !isOwner ? {status:draft.status, notes:draft.notes || ''} : collection === 'workers' ? {...pickFields(draft,['name','role','phone','available','workforceType','engagementType','engagementStart','engagementEnd','relatedJobId','agreementStatus','agreementReference','agreementNotes','notes','image']),skills:(draft.skills || []).filter(Boolean)} : pickFields(draft,['name','registration','capacity','status','notes','image']);
    try {
      if (editing?.id) await update(collection,editing.id,payload,editing); else await create(collection,payload);
      setEditing(null); notify(tab === 'Vehicles' ? 'Vehicle saved.' : 'Crew member saved.');
    } catch (caught: any) {setError(caught.message);} finally {setBusy(false);}
  };
  const visibleWorkers = workers.filter(worker => {
    const state = engagementState(worker,jobs,today());
    const matchFilter = crewFilter === 'All workers'
      || crewFilter === 'Company staff' && worker.workforceType !== 'External'
      || crewFilter === 'External workers' && worker.workforceType === 'External'
      || crewFilter === 'Ready to assign' && workerCanBeAssigned(worker,jobs,today())
      || crewFilter === 'Ended agreements' && ['Ended','Work complete'].includes(state);
    return matchFilter && `${worker.name} ${worker.role} ${(worker.skills || []).join(' ')} ${worker.engagementType || 'Permanent'}`.toLowerCase().includes(search.toLowerCase());
  });
  const temporary = draft.engagementType && draft.engagementType !== 'Permanent';
  return <div>
    <Heading title="Team & vehicles" subtitle="Your staff, extra hands, and transport in one place.">{isOwner && tab !== 'Workload' && <button className="btn btn-primary" onClick={() => edit()}><Mark name="plus" size={15} />{tab === 'Vehicles' ? 'Add vehicle' : 'Add crew member'}</button>}</Heading>
    <p className="ops-summary"><span><strong>{workers.filter(worker => workerCanBeAssigned(worker,jobs,today())).length}</strong> ready to assign</span><span>{workers.filter(worker => worker.workforceType === 'External').length} external workers · {vehicles.length} vehicles</span></p>
    <div className="ops-toolbar"><div className="ops-tabs">{['Crew','Vehicles','Workload'].map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => {setTab(value);setSearch('');}}>{value}</button>)}</div>
      {tab === 'Crew' && <><select className="ops-search ops-search-select" aria-label="Filter workers" value={crewFilter} onChange={event => setCrewFilter(event.target.value)}>{['All workers','Company staff','External workers','Ready to assign','Ended agreements'].map(value => <option key={value}>{value}</option>)}</select><input className="ops-search" placeholder="Search names or skills…" aria-label="Search crew" value={search} onChange={event => setSearch(event.target.value)} /></>}
    </div>
    {tab === 'Crew' && <>
      <div className="ops-grid">{visibleWorkers.map(worker => {
        const state = engagementState(worker,jobs,today());
        const linkedJob = jobs.find(job => job.id === worker.relatedJobId);
        const hasAgreement = worker.engagementType && worker.engagementType !== 'Permanent';
        return <article className="ops-card" key={worker.id}><div className="ops-card-body">
          <div className="ops-person-top"><span className="ops-avatar">{initials(worker.name)}</span><div><h3>{worker.name}</h3><span className="ops-small">{worker.role} · {worker.workforceType === 'External' ? 'External worker' : 'Company staff'}</span></div></div>
          <div className="ops-chip-row"><Pill tone={['Ended','Check linked job'].includes(state) ? 'red' : state === 'Not started' ? 'warm' : ''}>{worker.engagementType || 'Permanent'}{hasAgreement ? ` · ${state}` : ''}</Pill>{isOwner && worker.agreementStatus === 'Signed' && <Pill>Agreement signed</Pill>}</div>
          {hasAgreement && <p className="ops-small" style={{marginBottom:0}}>{worker.engagementStart ? `From ${dateLabel(worker.engagementStart)}` : 'Start not recorded'}{worker.engagementEnd ? ` to ${dateLabel(worker.engagementEnd)}` : ''}{worker.engagementType === 'Until job complete' ? ` · ${linkedJob?.title || 'Check linked job'}` : ''}</p>}
          <div className="ops-chip-row">{(worker.skills || []).filter(Boolean).map((skill: string) => <Pill key={skill}>{skill}</Pill>)}</div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:20}}><StatePill status={worker.available === false ? 'Unavailable' : 'Available'} /><span className="ops-small">{todayJobs(worker).length} jobs today</span></div>
        </div><div className="ops-card-foot">{worker.phone ? <a className="ops-text-button" href={`https://wa.me/${worker.phone.replace(/\D/g,'')}`} target="_blank" rel="noreferrer"><Mark name="chat" size={13} />WhatsApp</a> : <span className="ops-small">No phone added</span>}{isOwner ? <button className="ops-text-button" onClick={() => edit(worker)}>Edit profile <Mark name="edit" size={13} /></button> : <button className="ops-text-button" onClick={async () => {try {await update('workers', worker.id, {available: worker.available === false},worker); notify('Availability updated.');} catch (caught: any) {notify(caught.message);}}}>{worker.available === false ? 'Mark available' : 'Mark unavailable'}</button>}</div></article>;
      })}</div>
      {!visibleWorkers.length && <Empty title={workers.length ? 'No workers match this view' : 'Build your crew'} text={workers.length ? 'Try another filter or name.' : 'Add company staff or external workers, then assign them to jobs.'} />}
      <div className="ops-note">Workers receive instructions through WhatsApp. “Ready to assign” checks availability and agreement dates; review the schedule before assigning.</div>
    </>}
    {tab === 'Vehicles' && <div className="ops-grid">{vehicles.map(vehicle => {
      const assigned = jobs.filter(job => job.vehicleId === vehicle.id && job.date === today() && job.status !== 'Completed');
      return <article className="ops-card" key={vehicle.id}><div className="ops-card-body"><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><span className="ops-type-icon" style={{margin:0}}><Mark name="truck" size={22} /></span><StatePill status={vehicle.status || 'Available'} /></div><h3>{vehicle.name}</h3><span className="ops-small">{vehicle.registration || 'No registration added'}</span><dl className="ops-detail-meta"><div><dt>Capacity</dt><dd>{vehicle.capacity || 'Not specified'}</dd></div><div><dt>Jobs today</dt><dd>{assigned.length}</dd></div></dl>{assigned.length > 0 && <p className="ops-small">Assigned today: {assigned.map(job => job.title).join(', ')}</p>}{vehicle.notes && <p className="ops-small">{vehicle.notes}</p>}</div><div className="ops-card-foot"><span className="ops-small">Assign vehicles when scheduling jobs</span><button className="ops-text-button" onClick={() => edit(vehicle)}>Edit <Mark name="edit" size={13} /></button></div></article>;
    })}{!vehicles.length && <Empty title="Make room for the journey" text={isOwner ? "Add a vehicle to assign it to crew routes." : "Vehicles approved by the owner will appear here for scheduling."} />}</div>}
    {tab === 'Workload' && <><div className="ops-route" style={{overflowX:'auto'}}><table className="ops-table"><thead><tr><th>Crew member</th><th>Today</th><th>Active jobs</th><th>Agreement</th><th>Next assignment</th></tr></thead><tbody>{workers.map(worker => {
      const active = activeJobs(worker); const next = [...active].filter(job => job.date >= today()).sort((a,b) => a.date.localeCompare(b.date))[0];
      return <tr key={worker.id}><td><div className="ops-person-top"><span className="ops-avatar" style={{width:31,height:31,fontSize:10}}>{initials(worker.name)}</span><div><strong style={{fontWeight:500}}>{worker.name}</strong><div className="ops-small">{worker.role}</div></div></div></td><td>{todayJobs(worker).length} visits</td><td>{active.length}</td><td>{worker.engagementType || 'Permanent'}<div className="ops-small">{engagementState(worker,jobs,today())}</div></td><td>{next ? <>{next.title}<div className="ops-small">{dateLabel(next.date)}</div></> : <span className="ops-small">No upcoming assignment</span>}</td></tr>;
    })}</tbody></table>{!workers.length && <Empty title="No crew members yet" text="Add your team to see their workload." />}</div><p className="ops-footer-note">Workload is based on assigned unfinished jobs. Edit a visit in Schedule & routes to balance assignments.</p></>}
    {editing && (isOwner || tab === 'Vehicles') && <Dialog title={tab === 'Vehicles' ? editing.id ? 'Edit vehicle' : 'Add vehicle' : editing.id ? 'Edit crew member' : 'Add crew member'} close={() => setEditing(null)}><form onSubmit={save}>
      <div className="ops-form-grid">{isOwner && <Input label={tab === 'Vehicles' ? 'Vehicle name' : 'Full name'} required value={draft.name} onChange={set('name')} />}
      {tab === 'Vehicles' ? <>{isOwner && <><Input label="Registration" value={draft.registration} onChange={set('registration')} /><Input label="Capacity" value={draft.capacity} onChange={set('capacity')} placeholder="e.g. 5 people + equipment" /></>}<Select label="Status" value={draft.status} onChange={set('status')} options={['Available','In use','Servicing','Unavailable']} /><Textarea label="Vehicle notes" value={draft.notes} onChange={set('notes')} /></> : <>
        <Input label="Role" required value={draft.role} onChange={set('role')} /><Select label="Worker group" value={draft.workforceType} onChange={set('workforceType')} options={[{value:'Internal',label:'Company staff'},{value:'External',label:'External worker'}]} /><Select label="Work agreement" value={draft.engagementType} onChange={setEngagement} options={engagementTypes} />
        {temporary && <><Input label="Agreement start" required type="date" value={draft.engagementStart} onChange={set('engagementStart')} />{draft.engagementType !== 'Until job complete' && <Input label="Agreement end" required={draft.engagementType === 'Fixed contract'} type="date" value={draft.engagementEnd} onChange={set('engagementEnd')} />}{draft.engagementType === 'Until job complete' && <Select label="Work until this job is complete" required value={draft.relatedJobId} onChange={set('relatedJobId')} options={[{value:'',label:'Choose a job'},...jobs.map(job => ({value:job.id,label:`${job.title}${job.status === 'Completed' ? ' · Completed' : ''}`}))]} />}</>}
        <Input label="WhatsApp phone" type="tel" value={draft.phone} onChange={set('phone')} placeholder="e.g. +233 24 000 0000" /><Select label="Availability" value={draft.available === false ? 'Unavailable' : 'Available'} onChange={(value: string) => set('available')(value === 'Available')} options={['Available','Unavailable']} />
        <Input label="Skills · separate with commas" wide value={(draft.skills || []).join(', ')} onChange={(value: string) => set('skills')(value.split(',').map(skill => skill.trim()))} placeholder="Pruning, planting, driving" />
      </>}</div>
      {isOwner && tab !== 'Vehicles' && <details className="ops-details"><summary>Agreement details</summary><p className="ops-form-help">Keep the signed reference and work instructions with this person.</p><div className="ops-form-grid"><Select label="Agreement status" value={draft.agreementStatus} onChange={set('agreementStatus')} options={['Not recorded','Pending','Signed']} /><Input label="Signed agreement reference" value={draft.agreementReference} onChange={set('agreementReference')} placeholder="e.g. Agreement dated 23 Oct" /><Textarea label="Agreed work & crew instructions" value={draft.agreementNotes} onChange={set('agreementNotes')} placeholder="Agreed scope, working days, or instructions to include in WhatsApp job messages" /></div></details>}
      {error && <div className="ops-error" role="alert">{error}</div>}<SaveActions busy={busy} close={() => setEditing(null)} label={tab === 'Vehicles' ? 'Save vehicle' : 'Save crew member'} />
    </form></Dialog>}
  </div>;
}
