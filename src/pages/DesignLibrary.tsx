import {useEffect, useMemo, useRef, useState, type FormEvent, type RefObject} from 'react';
import {Check, CheckCircle2, ChevronRight, FolderHeart, LoaderCircle, MapPin, Search, Star, X} from 'lucide-react';
import './DesignLibrary.css';

type Row = Record<string, any>;
export type DesignConversation = {id: string; designs: Row[]; title: string; updatedAt: string};
type LibraryProps = {conversations: DesignConversation[]; activeId: string; places: Row[]; onSelect: (id: string) => void; onClose: () => void};
type DetailsProps = {conversation: DesignConversation; places: Row[]; online: boolean; onClose: () => void; onSave: (patch: Row) => Promise<void>};

function useModal(ref: RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const cancel = (event: Event) => {event.preventDefault(); closeRef.current();};
    const backdrop = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeRef.current();
    };
    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('click', backdrop);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('click', backdrop);
      dialog.close();
      if (previous?.isConnected) previous.focus({preventScroll: true});
    };
  }, [ref]);
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Saved design' : date.toLocaleDateString('en-GH', {month: 'short', day: 'numeric'});
}

export default function DesignLibrary({conversations, activeId, places, onSelect, onClose}: LibraryProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const [favourites, setFavourites] = useState(false);
  useModal(dialog, onClose);
  const results = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return conversations.filter(conversation => {
      const root = conversation.designs[0] || {};
      const place = places.find(item => item.id === root.placeId);
      if (favourites && !root.favorite) return false;
      return !query || [conversation.title, place?.name || '', ...conversation.designs.map(item => item.prompt || '')].join(' ').toLocaleLowerCase().includes(query);
    });
  }, [conversations, places, search, favourites]);

  return <dialog ref={dialog} className="dc-library dl-dialog" id="dc-recent-chats" aria-labelledby="dl-title">
    <div className="dl-heading"><div><span className="dl-eyebrow">YOUR DESIGN SPACE</span><h2 id="dl-title">Recent designs</h2></div><button className="dl-close" type="button" aria-label="Close recent designs" onClick={onClose}><X size={19} /></button></div>
    <label className="dl-search"><Search size={17} /><input autoFocus aria-label="Search designs" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a design or place…" /></label>
    <div className="dl-filter-row" aria-label="Design filters"><button type="button" className={!favourites ? 'is-selected' : ''} aria-pressed={!favourites} onClick={() => setFavourites(false)}>All designs<span>{conversations.length}</span></button><button type="button" className={favourites ? 'is-selected' : ''} aria-pressed={favourites} onClick={() => setFavourites(true)}><Star size={13} />Favourites</button></div>
    <div className="dl-results" aria-live="polite">{results.length ? results.map(conversation => {
      const root = conversation.designs[0] || {};
      const latest = conversation.designs[conversation.designs.length - 1];
      const place = places.find(item => item.id === root.placeId);
      const approved = conversation.designs.some(item => item.id === root.approvedDesignId);
      return <button type="button" className={`dl-item${conversation.id === activeId ? ' is-active' : ''}`} key={conversation.id} aria-pressed={conversation.id === activeId} onClick={() => onSelect(conversation.id)}>
        {latest?.image && <img src={latest.image} alt="" loading="lazy" />}
        <span className="dl-item-content"><strong>{conversation.title}</strong>{place && <small className="dl-place"><MapPin size={11} />{place.name}</small>}<small>{dateLabel(conversation.updatedAt)} · {conversation.designs.length} {conversation.designs.length === 1 ? 'version' : 'versions'}{approved && <span className="dl-approved"><CheckCircle2 size={11} />Chosen</span>}</small></span>
        {root.favorite && <Star className="dl-star" size={14} fill="currentColor" aria-label="Favourite" />}{conversation.id === activeId ? <Check className="dl-selected" size={16} /> : <ChevronRight className="dl-chevron" size={15} />}
      </button>;
    }) : <div className="dl-empty"><FolderHeart size={30} strokeWidth={1.2} /><strong>{search ? 'No designs found' : 'Your favourites go here'}</strong><p>{search ? 'Try another name, place, or design idea.' : 'Open a design’s details and add it to favourites.'}</p>{(search || favourites) && <button type="button" onClick={() => {setSearch(''); setFavourites(false);}}>Show all designs</button>}</div>}</div>
  </dialog>;
}

export function DesignDetails({conversation, places, online, onClose, onSave}: DetailsProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const root = conversation.designs[0] || {};
  const [title, setTitle] = useState(root.studioTitle || conversation.title);
  const [placeId, setPlaceId] = useState(root.placeId || '');
  const [favorite, setFavorite] = useState(Boolean(root.favorite));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  useModal(dialog, () => {if (!savingRef.current) onClose();});
  const approvedVersion = conversation.designs.findIndex(item => item.id === root.approvedDesignId);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || savingRef.current || !online) return;
    savingRef.current = true; setSaving(true); setError('');
    try {await onSave({studioTitle: title.trim(), placeId, favorite}); onClose();}
    catch (caught) {setError(caught instanceof Error ? caught.message : 'Your changes could not be saved. Try again.');}
    finally {savingRef.current = false; setSaving(false);}
  }
  return <dialog ref={dialog} className="dl-details dl-dialog" aria-labelledby="dl-details-title">
    <div className="dl-heading"><div><span className="dl-eyebrow">KEEP THINGS TOGETHER</span><h2 id="dl-details-title">Design details</h2></div><button type="button" className="dl-close" aria-label="Close design details" onClick={onClose} disabled={saving}><X size={19} /></button></div>
    <form className="dl-details-form" onSubmit={event => void save(event)}>
      <label className="dl-field"><span>Design name</span><input autoFocus aria-label="Design name" required maxLength={100} value={title} onChange={event => setTitle(event.target.value)} disabled={saving} /></label>
      <label className="dl-field"><span>Site <small>optional</small></span><select aria-label="Design site" value={placeId} onChange={event => setPlaceId(event.target.value)} disabled={saving}><option value="">No site linked</option>{places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}</select><small>Search by this site in your design library.</small></label>
      <label className="dl-favourite-field"><input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)} disabled={saving} /><Star size={17} fill={favorite ? 'currentColor' : 'none'} /><span>Add to favourites</span></label>
      {approvedVersion >= 0 && <p className="dl-chosen-note"><CheckCircle2 size={16} />Version {approvedVersion + 1} is your chosen design.</p>}
      {!online && <p className="dl-form-note" role="status">Reconnect to save your changes.</p>}
      {error && <p className="dl-form-error" role="alert">{error}</p>}
      <div className="dl-form-actions"><button type="button" className="dl-cancel" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="dl-save" disabled={saving || !online || !title.trim()}>{saving ? <><LoaderCircle size={15} className="dc-spin" />Saving…</> : 'Save details'}</button></div>
    </form>
  </dialog>;
}
