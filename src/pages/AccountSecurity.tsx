import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {LoaderCircle, LogOut, ShieldCheck} from 'lucide-react';
import {api, ApiError, useApp} from '../state';
import {Field, Modal} from '../ui';
import './AccountSecurity.css';

type Security = {checkedAt: string; disabled: boolean; sharedAccounts: true; passwordsDistinct: boolean; ownerPasswordStrong: boolean; managerPasswordStrong: boolean};
const validSecurity = (value: any): value is Security => Boolean(value && typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt)) && value.sharedAccounts === true && ['disabled', 'passwordsDistinct', 'ownerPasswordStrong', 'managerPasswordStrong'].every(key => typeof value[key] === 'boolean'));

export default function AccountSecurity() {
  const {data, refresh, endSession} = useApp();
  const [result, setResult] = useState<Security | null>(null), [checking, setChecking] = useState(false), [error, setError] = useState('');
  const [target, setTarget] = useState<'owner' | 'manager' | null>(null), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [dialogError, setDialogError] = useState(''), [success, setSuccess] = useState('');
  const request = useRef<AbortController | null>(null), mutation = useRef<AbortController | null>(null), role = useRef(data.role), scope = useRef(0), saving = useRef(false);
  if (role.current !== data.role) {role.current = data.role; scope.current++;}
  useEffect(() => {
    request.current?.abort(); mutation.current?.abort(); request.current = null; mutation.current = null; saving.current = false;
    setResult(null); setChecking(false); setError(''); setTarget(null); setPassword(''); setBusy(false); setDialogError(''); setSuccess('');
    return () => {scope.current++; request.current?.abort(); mutation.current?.abort();};
  }, [data.role]);
  const closeDialog = useCallback(() => {if (saving.current) return; setTarget(null); setPassword(''); setDialogError('');}, []);
  async function check() {
    if (request.current || role.current !== 'owner') return;
    const controller = new AbortController(), version = scope.current; request.current = controller;
    setChecking(true); setError(''); setResult(null);
    try {
      const response = await api('/security', {signal: controller.signal});
      if (controller.signal.aborted || role.current !== 'owner' || version !== scope.current) return;
      if (!validSecurity(response)) throw new Error('The account check returned an incomplete result.');
      setResult(response);
    } catch (caught) {
      if (controller.signal.aborted || role.current !== 'owner' || version !== scope.current) return;
      setError('Account protection could not be checked just now. Please try again.');
      if (caught instanceof ApiError && [401, 403].includes(caught.status)) void refresh();
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted && role.current === 'owner' && version === scope.current) setChecking(false);
    }
  }
  function openDialog(next: 'owner' | 'manager') {if (saving.current) return; setTarget(next); setPassword(''); setDialogError(''); setSuccess('');}
  async function revoke(event: FormEvent) {
    event.preventDefault();
    if (saving.current || !target || !password || role.current !== 'owner') return;
    const selected = target, version = scope.current, controller = new AbortController(); mutation.current = controller; saving.current = true;
    setBusy(true); setDialogError('');
    try {
      const response = await api('/security/sign-out-all', {method: 'POST', body: JSON.stringify({role: selected, password}), signal: controller.signal});
      if (controller.signal.aborted || role.current !== 'owner' || version !== scope.current) return;
      if (response?.ok !== true || response.role !== selected || response.currentSessionRevoked !== (selected === 'owner')) throw new Error('Device sign-out could not be confirmed. Check account access before trying again.');
      setPassword(''); setTarget(null);
      if (response.currentSessionRevoked) endSession();
      else setSuccess('All manager devices have been signed out. The manager can sign in again with the current password.');
    } catch (caught) {
      if (controller.signal.aborted || role.current !== 'owner' || version !== scope.current) return;
      setPassword('');
      setDialogError(caught instanceof Error ? caught.message : 'Device sign-out could not be confirmed.');
      if (caught instanceof ApiError && caught.status === 401) void refresh();
    } finally {
      if (mutation.current === controller) mutation.current = null;
      if (version === scope.current) {saving.current = false; if (!controller.signal.aborted && role.current === 'owner') setBusy(false);}
    }
  }
  if (data.role !== 'owner') return null;
  const disabled = Boolean(data.demoMode || result?.disabled);
  return <section className="studio-card studio-card-pad account-security" aria-labelledby="account-security-title">
    <div className="account-security-heading"><ShieldCheck size={21}/><h2 id="account-security-title" className="studio-settings-title">Account protection</h2></div>
    <p className="studio-settings-sub">Review sign-in protection and end access on devices you no longer trust.</p>
    {!result && !checking && !error && <p className="account-security-pending">Not checked in this session.</p>}
    {checking && <p className="account-security-pending" role="status">Checking account protection…</p>}
    {error && <p className="studio-error" role="alert">{error}</p>}
    {result && (result.disabled ? <p className="account-security-note">This demonstration workspace does not use private account protection. Device sign-out is disabled.</p> : <>
      <dl className="account-security-facts">
        <div><dt>Separate account passwords</dt><dd className={result.passwordsDistinct ? '' : 'needs-review'}>{result.passwordsDistinct ? 'Different passwords configured' : 'Use different owner and manager passwords'}</dd></div>
        <div><dt>Owner password length</dt><dd className={result.ownerPasswordStrong ? '' : 'needs-review'}>{result.ownerPasswordStrong ? 'At least 12 characters' : 'Use at least 12 characters'}</dd></div>
        <div><dt>Manager password length</dt><dd className={result.managerPasswordStrong ? '' : 'needs-review'}>{result.managerPasswordStrong ? 'At least 12 characters' : 'Use at least 12 characters'}</dd></div>
      </dl>
      <p className="account-security-note">These are length and separation checks, not a guarantee against guessing. Use unique passwords saved privately in a password manager. An administrator can change them in the hosting settings.</p>
    </>)}
    <button type="button" className="btn btn-secondary" onClick={() => void check()} disabled={checking || busy}>{checking ? <LoaderCircle size={14} className="studio-spinner"/> : <ShieldCheck size={14}/>} {checking ? 'Checking…' : 'Check account protection'}</button>
    <p className="account-security-note">The owner and manager use separate shared accounts. This does not identify individual workers or add two-step verification.</p>
    {success && <p className="account-security-success" role="status">{success}</p>}
    <div className="account-security-actions"><button type="button" className="btn btn-secondary" disabled={disabled || busy} onClick={() => openDialog('manager')}><LogOut size={15}/>Sign out all manager devices</button><button type="button" className="btn btn-secondary" disabled={disabled || busy} onClick={() => openDialog('owner')}><LogOut size={15}/>Sign out all owner devices</button></div>
    <p className="account-security-note">Signing out devices keeps saved work. Anyone who still knows the password can sign in again; change it if it may have been shared.</p>
    {target && <Modal title={target === 'owner' ? 'Sign out all owner devices?' : 'Sign out all manager devices?'} onClose={closeDialog}><form className="account-security-modal" onSubmit={event => void revoke(event)}><p>{target === 'owner' ? 'This also signs you out of this device. Saved company work stays in the workspace.' : 'The manager will need to sign in again on every device. Your owner session stays open.'}</p><Field label="Confirm owner password"><input type="password" autoComplete="current-password" maxLength={1024} required disabled={busy} value={password} onChange={event => setPassword(event.target.value)}/></Field>{dialogError && <p className="studio-error" role="alert">{dialogError}</p>}<div className="account-security-modal-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={closeDialog}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || !password}>{busy ? <LoaderCircle size={14} className="studio-spinner"/> : <LogOut size={14}/>} {busy ? 'Signing out devices…' : 'Confirm device sign-out'}</button></div></form></Modal>}
  </section>;
}
