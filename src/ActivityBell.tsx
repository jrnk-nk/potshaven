import {useOwnerActivity} from './activity-state';
import {Icon} from './ui';
import './pages/Activity.css';

export default function ActivityBell({onOpen}:{onOpen:()=>void}){
 const {unreadCount}=useOwnerActivity();
 return <button type="button" className="icon-button activity-bell" aria-label={`Manager activity, ${unreadCount} unread updates`} onClick={onOpen}><Icon name="MessageCircle" size={20}/>{unreadCount>0&&<span aria-hidden="true">{unreadCount>99?'99+':unreadCount}</span>}</button>;
}
