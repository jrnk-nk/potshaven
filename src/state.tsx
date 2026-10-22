import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

let activeCurrency = 'GHS';
export type RecordData = { id: string; [key: string]: any };
export type AppData = { [key: string]: any; places: RecordData[]; jobs: RecordData[]; inventory: RecordData[]; workers: RecordData[]; vehicles: RecordData[]; contracts: RecordData[]; payments: RecordData[]; expenses: RecordData[]; purchaseRequests: RecordData[]; equipment: RecordData[]; issues: RecordData[]; careGuides: RecordData[]; designs: RecordData[]; stockMovements: RecordData[]; settings: Record<string, any> };
const empty: AppData = {places:[],jobs:[],inventory:[],workers:[],vehicles:[],contracts:[],payments:[],expenses:[],purchaseRequests:[],equipment:[],issues:[],careGuides:[],designs:[],stockMovements:[],settings:{}};
type Context = { data: AppData; loading: boolean; error: string; authenticated: boolean; refresh: () => Promise<void>; create: (collection: string, payload: any) => Promise<any>; update: (collection: string, id: string, payload: any) => Promise<any>; remove: (collection: string, id: string) => Promise<void>; notify: (message: string) => void; openJob: (id?: string) => void; toast: string };
const AppContext = createContext<Context>(null!);
export async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({ error: 'The server could not complete this request.' }));
  if (!response.ok) throw Object.assign(new Error(result.error || result.message || 'Something went wrong.'), {status: response.status});
  return result;
}
export function AppProvider({children}: {children: React.ReactNode}) {
  const [data,setData] = useState<AppData>(empty), [loading,setLoading] = useState(true), [error,setError] = useState(''), [authenticated,setAuthenticated] = useState(true), [toast,setToast] = useState('');
  const refresh = useCallback(async () => {
    try { const result = await api('/state'); activeCurrency = result.settings?.currency || 'GHS'; setData({...empty,...result}); setAuthenticated(true); setError(''); }
    catch(e:any) { if(e.status===401) setAuthenticated(false); else setError(e.message); }
    finally { setLoading(false); }
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(timer);},[toast]);
  const create = async(collection:string,payload:any)=>{const result=await api(`/${collection}`,{method:'POST',body:JSON.stringify(payload)});await refresh();return result;};
  const update = async(collection:string,id:string,payload:any)=>{const result=await api(`/${collection}${id?`/${encodeURIComponent(id)}`:''}`,{method:'PATCH',body:JSON.stringify(payload)});await refresh();return result;};
  const remove = async(collection:string,id:string)=>{await api(`/${collection}/${encodeURIComponent(id)}`,{method:'DELETE'});await refresh();};
  const openJob=(id?:string)=>window.dispatchEvent(new CustomEvent('potshaven:job',{detail:id}));
  return <AppContext.Provider value={{data,loading,error,authenticated,refresh,create,update,remove,notify:setToast,openJob,toast}}>{children}</AppContext.Provider>;
}
export const useApp=()=>useContext(AppContext);
export const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Accra'});
export const money=(value:number,currency=activeCurrency)=>new Intl.NumberFormat('en-GH',{style:'currency',currency,maximumFractionDigits:0}).format(Number(value)||0);
