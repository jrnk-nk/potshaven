import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {api, ApiError} from './api';
import {withBrandDefaults} from './branding';
export {api, ApiError} from './api';

let activeCurrency = 'GHS';
export type RecordData = { id: string; [key: string]: any };
export type AppData = { [key: string]: any; places: RecordData[]; jobs: RecordData[]; inventory: RecordData[]; workers: RecordData[]; vehicles: RecordData[]; contracts: RecordData[]; payments: RecordData[]; expenses: RecordData[]; purchaseRequests: RecordData[]; equipment: RecordData[]; issues: RecordData[]; careGuides: RecordData[]; designs: RecordData[]; stockMovements: RecordData[]; settings: Record<string, any> };
const collections = ['places','jobs','inventory','stockMovements','workers','vehicles','contracts','payments','expenses','purchaseRequests','equipment','issues','careGuides','designs'];
const empty: AppData = {places:[],jobs:[],inventory:[],workers:[],vehicles:[],contracts:[],payments:[],expenses:[],purchaseRequests:[],equipment:[],issues:[],careGuides:[],designs:[],stockMovements:[],settings:{}};
type Connection = 'connecting' | 'online' | 'offline' | 'setup';
type Context = { data: AppData; loading: boolean; refreshing: boolean; error: string; errorCode: string; connection: Connection; hasData: boolean; authenticated: boolean; refresh: () => Promise<void>; signIn: (role: string, password: string) => Promise<void>; signOut: () => Promise<void>; create: (collection: string, payload: any) => Promise<any>; update: (collection: string, id: string, payload: any, expectedRecord?: Record<string,any>) => Promise<any>; remove: (collection: string, id: string) => Promise<void>; notify: (message: string) => void; openJob: (id?: string) => void; toast: string };
const AppContext = createContext<Context>(null!);
function workspace(value: any): AppData {
  if (!value || typeof value !== 'object' || collections.some(key => !Array.isArray(value[key])) || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) {
    throw new ApiError('The server returned an incomplete workspace. Please check the backend deployment and try again.', {code:'INVALID_API_RESPONSE'});
  }
  return {...value,settings:withBrandDefaults(value.settings)};
}
const delay = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms));
function clearStudioDrafts(){try{for(const key of Object.keys(sessionStorage))if(key.startsWith('potshaven:studio-draft:'))sessionStorage.removeItem(key);localStorage.removeItem('potshaven:design-conversation');}catch{/* Private browser storage may be disabled. */}}
export function AppProvider({children}: {children: React.ReactNode}) {
  const [data,setData] = useState<AppData>(empty), [loading,setLoading] = useState(true), [refreshing,setRefreshing] = useState(false), [error,setError] = useState(''), [errorCode,setErrorCode] = useState(''), [authenticated,setAuthenticated] = useState(true), [toast,setToast] = useState(''), [connection,setConnection] = useState<Connection>('connecting'), [hasData,setHasData] = useState(false);
  const mounted=useRef(true), loaded=useRef(false), connectionRef=useRef<Connection>('connecting'), inFlight=useRef<Promise<void>|null>(null), flightEpoch=useRef(0), epoch=useRef(0), lastSuccess=useRef(0), retryTimer=useRef<ReturnType<typeof setTimeout>|null>(null), recoveryAttempts=useRef(0), sessionVersion=useRef(0);
  const markConnection=(state:Connection)=>{connectionRef.current=state;setConnection(state);};
  const clearRetry=()=>{if(retryTimer.current){clearTimeout(retryTimer.current);retryTimer.current=null;}};
  const expireSession=()=>{clearStudioDrafts();sessionVersion.current++;epoch.current++;loaded.current=false;activeCurrency='GHS';setData(empty);setHasData(false);setAuthenticated(false);setError('');setErrorCode('');markConnection('online');clearRetry();};
  const refresh = useCallback(():Promise<void> => {
    if(inFlight.current&&flightEpoch.current===epoch.current) return inFlight.current;
    clearRetry();
    const version=epoch.current;
    let task:Promise<void>;
    task=(async()=>{
      if(mounted.current)setRefreshing(true);
      const attempts=loaded.current?1:3;
      for(let attempt=0;attempt<attempts;attempt++){
        if(attempt)await delay(attempt===1?800:2000);
        if(!mounted.current)return;
        try {
          const result=workspace(await api('/state'));
          if(!mounted.current||version!==epoch.current)return;
          activeCurrency=result.settings.currency||'GHS';loaded.current=true;lastSuccess.current=Date.now();recoveryAttempts.current=0;
          setData(result);setHasData(true);setAuthenticated(true);setError('');setErrorCode('');markConnection('online');return;
        } catch(caught) {
          if(!mounted.current||version!==epoch.current)return;
          const failure=caught instanceof ApiError?caught:new ApiError('The workspace could not be loaded. Please try again.');
          if(failure.status===401){expireSession();return;}
          if(failure.retryable&&attempt+1<attempts)continue;
          setError(failure.message);setErrorCode(failure.code);markConnection(failure.setup?'setup':'offline');
          if(failure.retryable||failure.setup){
            // A deployment may gain its private settings while this tab is
            // still open. Recheck gently without repeating the initial load.
            const wait=failure.setup?30000:Math.min(30000,1500*2**Math.min(recoveryAttempts.current++,5));
            retryTimer.current=setTimeout(()=>{retryTimer.current=null;if(mounted.current)void refresh();},wait);
          }
          return;
        }
      }
    })().finally(()=>{
      if(inFlight.current===task){inFlight.current=null;if(mounted.current){setRefreshing(false);setLoading(false);}}
    });
    flightEpoch.current=version;inFlight.current=task;return task;
  },[]);
  const signIn=async(role:string,password:string)=>{
    await api('/auth/login',{method:'POST',body:JSON.stringify({role,password})});
    // A successful login establishes the session even if loading its company
    // data fails. Start a fresh read so a pre-login 401 cannot replace it, and
    // show workspace recovery rather than silently returning to the password.
    clearStudioDrafts();sessionVersion.current++;epoch.current++;loaded.current=false;lastSuccess.current=0;clearRetry();
    setData(empty);setHasData(false);setError('');setErrorCode('');
    setAuthenticated(true);setLoading(true);markConnection('connecting');
    await refresh();
  };
  const signOut=async()=>{
    await api('/auth/logout',{method:'POST'});
    expireSession();
  };
  useEffect(()=>{
    mounted.current=true;void refresh();
    const online=()=>{recoveryAttempts.current=0;void refresh();};
    const visible=()=>{if(document.visibilityState==='visible'&&(connectionRef.current==='offline'||Date.now()-lastSuccess.current>30000))void refresh();};
    window.addEventListener('online',online);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
    return()=>{mounted.current=false;clearRetry();window.removeEventListener('online',online);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
  },[refresh]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(timer);},[toast]);
  const mutate=async(path:string,options:RequestInit)=>{
    if(connectionRef.current!=='online')throw new ApiError('Reconnect before saving changes. Your last loaded records are still available to view.',{code:'OFFLINE_WRITE_BLOCKED'});
    const version=sessionVersion.current;
    try{const result=await api(path,options);if(version!==sessionVersion.current)throw new ApiError('Your account changed before this request finished.',{code:'SESSION_CHANGED'});return result;}catch(caught){
      if(version!==sessionVersion.current)throw new ApiError('Your account changed before this request finished.',{code:'SESSION_CHANGED'});
      if(caught instanceof ApiError&&caught.status===401)expireSession();
      else if(caught instanceof ApiError&&caught.retryable){setError(caught.message);setErrorCode(caught.code);markConnection('offline');clearRetry();retryTimer.current=setTimeout(()=>{retryTimer.current=null;if(mounted.current)void refresh();},1500);}
      throw caught;
    }
  };
  const reconcile=(collection:string,result:any,removeId?:string)=>{
    epoch.current++;
    if(collection==='settings')activeCurrency=result.currency||'GHS';
    setData(current=>{
      if(collection==='settings')return {...current,settings:withBrandDefaults(result)};
      const records=current[collection] as RecordData[];
      if(!Array.isArray(records))return current;
      if(removeId)return {...current,[collection]:records.filter(item=>item.id!==removeId)};
      const exists=records.some(item=>item.id===result.id);
      return {...current,[collection]:exists?records.map(item=>item.id===result.id?result:item):[...records,result]};
    });
  };
  const ensureSession=(version:number)=>{if(version!==sessionVersion.current)throw new ApiError('Your account changed before this request finished.',{code:'SESSION_CHANGED'});};
  const create=async(collection:string,payload:any)=>{const version=sessionVersion.current;const result=await mutate(`/${collection}`,{method:'POST',body:JSON.stringify(payload)});ensureSession(version);reconcile(collection,result);return result;};
  const update=async(collection:string,id:string,payload:any,expectedRecord?:Record<string,any>)=>{
    const version=sessionVersion.current;
    // Forms supply the snapshot they opened with. Quick actions use the last
    // loaded record. Visit appends merge atomically on the server instead.
    const baseline=expectedRecord||(Array.isArray(data[collection])?data[collection].find((record:RecordData)=>record.id===id):undefined);
    const conditional=id&&baseline&&!(collection==='places'&&Object.hasOwn(payload,'inspection'));
    let result;
    try {result=await mutate(`/${collection}${id?`/${encodeURIComponent(id)}`:''}`,{method:'PATCH',body:JSON.stringify(conditional?{...payload,_expected:baseline}:payload)});}
    catch(caught){if(version===sessionVersion.current&&caught instanceof ApiError&&caught.status===409)await refresh();throw caught;}
    ensureSession(version);reconcile(collection,result);
    // These operations also create a follow-up job or stock-ledger entry.
    if((collection==='jobs'&&payload.status==='Completed')||(collection==='inventory'&&payload.quantity!==undefined)){await refresh();}
    return result;
  };
  const remove=async(collection:string,id:string)=>{const version=sessionVersion.current;await mutate(`/${collection}/${encodeURIComponent(id)}`,{method:'DELETE'});ensureSession(version);reconcile(collection,null,id);};
  const openJob=(id?:string)=>window.dispatchEvent(new CustomEvent('potshaven:job',{detail:id}));
  return <AppContext.Provider value={{data,loading,refreshing,error,errorCode,connection,hasData,authenticated,refresh,signIn,signOut,create,update,remove,notify:setToast,openJob,toast}}>{children}</AppContext.Provider>;
}
export const useApp=()=>useContext(AppContext);
export const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Accra'});
export const money=(value:number,currency=activeCurrency)=>new Intl.NumberFormat('en-GH',{style:'currency',currency,maximumFractionDigits:0}).format(Number(value)||0);
