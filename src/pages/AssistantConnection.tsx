import {useEffect, useRef, useState} from 'react';
import {Check, LoaderCircle, MessageCircle} from 'lucide-react';
import {api, ApiError, useApp} from '../state';

export default function AssistantConnection() {
  const {data, refresh} = useApp();
  const [checkedAt, setCheckedAt] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null), role = useRef(data.role);
  role.current = data.role;
  useEffect(() => {
    request.current?.abort(); request.current = null;
    setCheckedAt(''); setBusy(false); setError('');
    return () => request.current?.abort();
  }, [data.role]);
  async function check() {
    if (request.current || role.current !== 'owner') return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setCheckedAt('');
    try {
      const result = await api('/readiness/assistant', {method: 'POST', body: JSON.stringify({}), signal: controller.signal});
      if (controller.signal.aborted || role.current !== 'owner') return;
      if (result?.ok !== true || result.check !== 'assistant-response' || typeof result.checkedAt !== 'string' || Number.isNaN(Date.parse(result.checkedAt))) throw new Error('The assistant check returned an incomplete result.');
      setCheckedAt(result.checkedAt);
    } catch (caught) {
      if (controller.signal.aborted || role.current !== 'owner') return;
      if (caught instanceof ApiError && [401, 403].includes(caught.status)) void refresh();
      setError(caught instanceof Error ? caught.message : 'The assistant connection could not be checked.');
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted && role.current === 'owner') setBusy(false);
    }
  }
  if (data.role !== 'owner') return null;
  return <section className="studio-card studio-card-pad data-protection" aria-labelledby="assistant-connection-title">
    <div className="data-protection-heading"><MessageCircle size={21}/><h2 id="assistant-connection-title" className="studio-settings-title">Assistant connection</h2></div>
    <p className="studio-settings-sub">Send a short test message to check that your assistant can respond. This uses your connected service and sends no company records.</p>
    {!busy && !checkedAt && !error && <p className="data-protection-pending">Not checked in this session.</p>}
    {busy && <p role="status">Waiting for an assistant response…</p>}
    {error && <p className="studio-error" role="alert">{error}</p>}
    {checkedAt && <p className="data-protection-checked" role="status">Assistant responded successfully. Checked {new Date(checkedAt).toLocaleString('en-GH', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Accra'})}.</p>}
    <button type="button" className="btn btn-secondary" disabled={busy || !data.assistantConfigured} onClick={() => void check()}>{busy ? <LoaderCircle size={14} className="studio-spinner"/> : checkedAt ? <Check size={14}/> : <MessageCircle size={14}/>} {busy ? 'Checking assistant…' : 'Check assistant connection'}</button>
    {!data.assistantConfigured && <p className="studio-hint">Ask your administrator to connect the assistant first.</p>}
    <p className="studio-hint">This checks a real reply. Review suggested changes before saving, and use the studio to check a complete design request.</p>
  </section>;
}
