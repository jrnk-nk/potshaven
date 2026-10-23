import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {api,ApiError,useApp} from './state';

export type ActivityItem={id:string;actor:string;action:string;collection:string;recordId:string;title:string;summary:string;siteId?:string;siteName?:string;jobId?:string;quantity?:number;unit?:string;createdAt:string;readAt:string|null};
type ActivityState={items:ActivityItem[];unreadCount:number;loading:boolean;error:string;refresh:()=>Promise<void>;markRead:(id:string)=>Promise<void>;markAllRead:()=>Promise<void>};
const ActivityContext=createContext<ActivityState|null>(null);

export function ActivityProvider({children}:{children:ReactNode}){
 const {data,hasData,authenticated,connection,refresh:refreshWorkspace}=useApp();
 const enabled=authenticated&&hasData&&data.role==='owner';
 const [items,setItems]=useState<ActivityItem[]>([]),[unreadCount,setUnreadCount]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),enabledRef=useRef(enabled),controller=useRef<AbortController|null>(null),inFlight=useRef<Promise<void>|null>(null);
 enabledRef.current=enabled;
 const refresh=useCallback(async()=>{
  if(!enabledRef.current)return;
  if(inFlight.current)return inFlight.current;
  const version=generation.current;
  const abort=new AbortController();controller.current=abort;
  let task!:Promise<void>;
  task=(async()=>{
   setLoading(true);
   try{
    const result=await api('/activity?limit=100',{signal:abort.signal});
    if(abort.signal.aborted||version!==generation.current||!enabledRef.current)return;
    if(!result||!Array.isArray(result.items)||!Number.isSafeInteger(result.unreadCount)||result.unreadCount<0)throw new Error('Invalid activity response');
    setItems(result.items);setUnreadCount(result.unreadCount);setError('');
   }catch(caught){
    if(abort.signal.aborted||version!==generation.current||!enabledRef.current)return;
    if(caught instanceof ApiError&&(caught.status===401||caught.status===403)){setItems([]);setUnreadCount(0);void refreshWorkspace();}
    setError('Activity updates are temporarily unavailable. Try refreshing the inbox.');
   }finally{
    if(version===generation.current&&!abort.signal.aborted)setLoading(false);
    if(inFlight.current===task)inFlight.current=null;
   }
  })();inFlight.current=task;return task;
 },[refreshWorkspace]);
 useEffect(()=>{
  generation.current++;controller.current?.abort();inFlight.current=null;
  setItems([]);setUnreadCount(0);setError('');setLoading(false);
  if(!enabled)return;
  void refresh();
  const check=()=>{if(document.visibilityState==='visible')void refresh();};
  const timer=setInterval(check,30000);
  window.addEventListener('focus',check);window.addEventListener('online',check);document.addEventListener('visibilitychange',check);
  return()=>{generation.current++;controller.current?.abort();inFlight.current=null;clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener('online',check);document.removeEventListener('visibilitychange',check);};
 },[enabled,refresh]);
 useEffect(()=>{if(enabled&&connection==='online')void refresh();},[enabled,connection,refresh]);
 const acknowledge=async(id?:string)=>{
  if(!enabledRef.current)return;
  const version=generation.current;
  try{
   await api(id?`/activity/${encodeURIComponent(id)}/read`:'/activity/read-all',{method:'POST'});
   if(version!==generation.current||!enabledRef.current)return;
   controller.current?.abort();inFlight.current=null;
   setError('');await refresh();
  }catch(caught){
   if(version!==generation.current||!enabledRef.current)return;
   if(caught instanceof ApiError&&(caught.status===401||caught.status===403)){setItems([]);setUnreadCount(0);void refreshWorkspace();}
   setError('Couldn’t mark the update as read. Please try again.');
  }
 };
 const value:ActivityState={items:enabled?items:[],unreadCount:enabled?unreadCount:0,loading:enabled&&loading,error:enabled?error:'',refresh,markRead:id=>acknowledge(id),markAllRead:()=>acknowledge()};
 return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}
export function useOwnerActivity(){const value=useContext(ActivityContext);if(!value)throw new Error('ActivityProvider is required.');return value;}
