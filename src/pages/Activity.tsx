import {useRef,useState} from 'react';
import {useOwnerActivity,type ActivityItem} from '../activity-state';
import {useApp} from '../state';
import {Icon,PageHeader} from '../ui';
import './Activity.css';

const actionIcons:Record<string,string>={created:'Plus',updated:'FolderOpen',completed:'CircleCheck',visit_recorded:'MapPin',stock_used:'Sprout',assigned:'UsersRound'};
function timestamp(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'Date unavailable':date.toLocaleString('en-GH',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Accra'});}
export default function ActivityPage(){
 const {data,refresh:refreshWorkspace,openJob}=useApp();
 const role=useRef(data.role);role.current=data.role;
 const {items,unreadCount,loading,error,refresh,markRead,markAllRead}=useOwnerActivity();
 const [filter,setFilter]=useState<'all'|'unread'>('all'),[saving,setSaving]=useState('');
 if(data.role!=='owner')return <section className="panel empty-state"><h1>Owner inbox</h1><p>This inbox is available to the business owner.</p></section>;
 const visible=filter==='unread'?items.filter(item=>!item.readAt):items;
 async function read(item?:ActivityItem){setSaving(item?.id||'all');try{if(item)await markRead(item.id);else await markAllRead();}finally{setSaving('');}}
 async function open(item:ActivityItem){
  await refreshWorkspace();
  if(role.current!=='owner')return;
  if(item.collection==='purchaseRequests'){try{sessionStorage.setItem('potshaven:inventory-tab','Purchase requests');}catch{}location.hash='inventory';return;}
  if(item.siteId){location.hash=`sites?site=${encodeURIComponent(item.siteId)}`;return;}
  if(item.collection==='jobs'||item.jobId){location.hash='schedule';openJob(item.jobId||item.recordId);return;}
  location.hash=['workers','vehicles'].includes(item.collection)?'team':item.collection==='places'?'sites':'inventory';
 }
 return <div className="activity-page">
  <PageHeader title="Manager activity" eyebrow="OWNER INBOX" description="Updates from the work your manager records."><button type="button" className="btn btn-secondary" disabled={loading} onClick={()=>void refresh()}><Icon name="CalendarClock" size={16}/>{loading?'Checking…':'Refresh'}</button></PageHeader>
  <section className="activity-summary"><span className="activity-summary-icon"><Icon name="MessageCircle" size={25}/></span><div><strong>{unreadCount?`${unreadCount} unread ${unreadCount===1?'update':'updates'}`:error?'Updates unavailable':loading?'Checking for updates…':'You’re up to date'}</strong><p>Site visits, completed work, requests, assignments and stock use appear here.</p></div>{unreadCount>0&&<button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(saving)} onClick={()=>void read()}>{saving==='all'?'Saving…':'Mark all as read'}</button>}</section>
  <div className="activity-toolbar"><div className="activity-filters" role="group" aria-label="Activity view"><button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All updates</button><button type="button" aria-pressed={filter==='unread'} onClick={()=>setFilter('unread')}>Unread</button></div><span>Updates refresh automatically</span></div>
  {error&&<p className="activity-error" role="alert">{error}</p>}
  <section className="activity-list" aria-label="Manager updates">{visible.map(item=><article className={`activity-card ${item.readAt?'':'activity-unread'}`} key={item.id}>
   <span className="activity-type-icon"><Icon name={actionIcons[item.action]||'FolderOpen'} size={20}/></span>
   <div className="activity-content"><div className="activity-card-top"><span>{item.actor||'Manager account'}</span><time dateTime={item.createdAt}>{timestamp(item.createdAt)}</time>{!item.readAt&&<span className="activity-new">New</span>}</div><h2>{item.title}</h2><p>{item.summary}{item.action==='stock_used'&&typeof item.quantity==='number'?` · ${item.quantity} ${item.unit||'units'}`:''}</p>{item.siteName&&<p className="activity-site"><Icon name="MapPin" size={14}/>{item.siteName}</p>}<div className="activity-card-actions"><button type="button" className="text-link" onClick={()=>void open(item)}>{item.collection==='purchaseRequests'?'Review request':item.siteId?'Open site':'View details'} <Icon name="ArrowRight" size={14}/></button>{!item.readAt&&<button type="button" className="activity-read" disabled={Boolean(saving)} onClick={()=>void read(item)}><Icon name="Check" size={14}/>{saving===item.id?'Saving…':'Mark as read'}</button>}</div></div>
  </article>)}</section>
  {!visible.length&&!loading&&!error&&<section className="panel empty-state"><Icon name="CircleCheck" size={32}/><h2>{filter==='unread'?'No unread updates':'No manager updates yet'}</h2><p>{filter==='unread'?'Switch to All updates to see the recent history.':'New manager activity will appear here as work is saved.'}</p></section>}
  <p className="activity-note">Showing the latest 100 updates. “Manager account” identifies the shared sign-in used for these actions. This inbox does not send emails or WhatsApp messages.</p>
 </div>;
}
