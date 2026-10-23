import {useEffect, useRef, useState} from 'react';
import {Database, ExternalLink, LoaderCircle, ShieldCheck} from 'lucide-react';
import {api, ApiError, useApp} from '../state';
import './DataProtection.css';

type Protection = {
  checkedAt: string;
  storage: 'postgres' | 'sqlite';
  database: 'connected';
  durableMedia: boolean;
  rls: {enabled: boolean; protectedTables: number; totalTables: number; browserAccessBlocked: boolean} | null;
  backups: 'unverified';
};

function verifiedResponse(value: any): value is Protection {
  if (!value || !['postgres', 'sqlite'].includes(value.storage) || value.database !== 'connected' || typeof value.durableMedia !== 'boolean' || value.backups !== 'unverified' || typeof value.checkedAt !== 'string' || Number.isNaN(Date.parse(value.checkedAt))) return false;
  if (value.storage === 'sqlite') return value.rls === null;
  const rls = value.rls;
  return Boolean(rls && typeof rls.enabled === 'boolean' && typeof rls.browserAccessBlocked === 'boolean' && Number.isSafeInteger(rls.protectedTables) && Number.isSafeInteger(rls.totalTables) && rls.totalTables > 0 && rls.protectedTables >= 0 && rls.protectedTables <= rls.totalTables);
}

export default function DataProtection() {
  const {data, refresh: refreshWorkspace} = useApp();
  const [result, setResult] = useState<Protection | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null), role = useRef(data.role);
  role.current = data.role;
  useEffect(() => {
    request.current?.abort(); request.current = null;
    setResult(null); setBusy(false); setError('');
    return () => request.current?.abort();
  }, [data.role]);

  async function check() {
    if (busy || role.current !== 'owner') return;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await api('/data-protection', {signal: controller.signal});
      if (controller.signal.aborted || role.current !== 'owner') return;
      if (!verifiedResponse(response)) throw new Error('The protection check returned an incomplete result. Please try again.');
      setResult(response);
    } catch (caught) {
      if (controller.signal.aborted || role.current !== 'owner') return;
      if (caught instanceof ApiError && [401, 403].includes(caught.status)) void refreshWorkspace();
      setError('We couldn’t verify your saved workspace just now. Check the connection and try again.');
    } finally {
      if (!controller.signal.aborted && role.current === 'owner') setBusy(false);
    }
  }

  if (data.role !== 'owner') return null;
  const postgres = result?.storage === 'postgres';
  const protectedDatabase = Boolean(postgres && result?.rls?.enabled && result.rls.browserAccessBlocked && result.rls.protectedTables === result.rls.totalTables);
  return <section className="studio-card studio-card-pad data-protection" aria-labelledby="data-protection-title">
    <div className="data-protection-heading"><ShieldCheck size={21}/><h2 id="data-protection-title" className="studio-settings-title">Your saved workspace</h2></div>
    <p className="studio-settings-sub">Check where your saved records and photos are kept.</p>
    {!result && !busy && !error && <p className="data-protection-pending">Not checked yet.</p>}
    {busy && <p className="data-protection-pending" role="status">Checking storage and access protection…</p>}
    {error && <p className="studio-error" role="alert">{error}</p>}
    {result && <>
      <dl className="data-protection-facts">
        <div><dt><Database size={15}/>Saved records</dt><dd>{postgres ? 'Connected PostgreSQL database' : 'Local workspace database'}</dd></div>
        <div><dt>Uploaded & generated photos</dt><dd>{result.durableMedia ? 'Stored in the connected database' : 'Stored on this server — protect its files too'}</dd></div>
        <div><dt>Database row security</dt><dd className={protectedDatabase ? 'data-protection-checked' : ''}>{postgres ? protectedDatabase ? `Enabled on all ${result.rls!.totalTables} private tables` : 'Needs administrator review' : 'Not applicable to this local workspace'}</dd></div>
        {postgres && <div><dt>Direct browser access</dt><dd>{result.rls!.browserAccessBlocked ? 'Blocked for public app roles' : 'Needs administrator review'}</dd></div>}
      </dl>
      {postgres && <p className="studio-hint">Database protection blocks direct access. The app also checks owner and manager permissions for each request.</p>}
      <p className="data-protection-checked-at">Checked {new Date(result.checkedAt).toLocaleString('en-GH', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Accra'})}</p>
    </>}
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void check()}>{busy ? <LoaderCircle size={14} className="studio-spinner"/> : <ShieldCheck size={14}/>} {busy ? 'Checking…' : result ? 'Check again' : 'Check saved workspace'}</button>
    <div className="data-protection-backups"><h3>Recovery backups</h3><p>This check cannot verify your backup schedule or how far back you can restore. Confirm these in your Supabase project’s backup settings.</p><a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="text-link">Open Supabase <ExternalLink size={13}/></a></div>
    <p className="studio-hint data-protection-scope">Only saved work is stored by the app. Unsent drafts, temporary assistant chats and images linked from other websites are not a database backup.</p>
  </section>;
}
