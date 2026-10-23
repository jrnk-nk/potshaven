import {useMemo, useState} from 'react';
import {ArrowDownToLine, ArrowRight, Images, LoaderCircle, MapPin, Plus, Presentation, Search, Sprout, Star, X} from 'lucide-react';
import {BRAND_LOGO, BRAND_LOGO_PREVIEW, BRAND_NAME, BRAND_TAGLINE} from '../branding';
import './StudioGallery.css';

type Row = Record<string, any>;
type Conversation = {id: string; designs: Row[]; title: string; updatedAt: string};
type Props = {
  conversations: Conversation[];
  places: Row[];
  settings: Row;
  onOpen: (id: string) => void;
  onNew: () => void;
  onPresent: (conversationId: string) => void;
  onDownload: (design: Row) => void;
  actionBusy: string;
};

export default function StudioGallery({conversations, places, settings, onOpen, onNew, onPresent, onDownload, actionBusy}: Props) {
  const [search, setSearch] = useState('');
  const [favourites, setFavourites] = useState(false);
  const name = settings.companyName || BRAND_NAME;
  const logo = !settings.logo || settings.logo === BRAND_LOGO ? BRAND_LOGO_PREVIEW : settings.logo;
  const tagline = settings.tagline || BRAND_TAGLINE;
  const spaces = useMemo(() => conversations.flatMap(conversation => {
    const root = conversation.designs[0] || {};
    const place = places.find(item => item.id === root.placeId);
    const design = conversation.designs.find(item => item.id === root.approvedDesignId && item.image)
      || [...conversation.designs].reverse().find(item => item.image);
    if (!design) return [];
    // The caption belongs to the space. Instructions remain inside its chat.
    const title = (typeof root.studioTitle === 'string' && root.studioTitle.trim()) || place?.name || 'Untitled space';
    return [{id: conversation.id, title, place: place?.name || '', favorite: Boolean(root.favorite), design}];
  }), [conversations, places]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return spaces.filter(space => (!favourites || space.favorite) && (!query || `${space.title} ${space.place}`.toLocaleLowerCase().includes(query)));
  }, [spaces, search, favourites]);
  const filtered = Boolean(search.trim() || favourites);

  return <section className="studio-space-gallery" aria-label="Studio gallery">
    <header className="sg-header">
      <div><span className="sg-eyebrow">{name} STUDIO</span><h1>Your gallery</h1><p>Beautiful spaces, together.</p></div>
      <button type="button" className="sg-new" onClick={onNew}><Plus size={18}/><span>New space</span></button>
    </header>
    {spaces.length > 0 && <div className="sg-toolbar">
      <div className="sg-filters" role="group" aria-label="Gallery filters"><button type="button" aria-pressed={!favourites} onClick={() => setFavourites(false)}>All spaces<span>{spaces.length}</span></button><button type="button" aria-pressed={favourites} onClick={() => setFavourites(true)}><Star size={14}/>Favourites</button></div>
      <div className="sg-search"><Search size={17}/><input type="search" aria-label="Search gallery" placeholder="Find a space…" value={search} maxLength={200} onChange={event => setSearch(event.target.value)}/>{search && <button type="button" aria-label="Clear gallery search" onClick={() => setSearch('')}><X size={15}/></button>}</div>
    </div>}
    {visible.length ? <div className="sg-grid">{visible.map(space => <article key={space.id} className="sg-card" aria-label={space.title}>
      <button type="button" className="sg-image" aria-label={`Open space: ${space.title}`} onClick={() => onOpen(space.id)}>
        <span className="sg-image-fallback" aria-hidden="true"><Sprout size={40} strokeWidth={1}/></span><img className="sg-space-image" src={space.design.image} alt={space.title} loading="lazy" onError={event => {event.currentTarget.style.visibility = 'hidden';}}/>
        {space.favorite && <span className="sg-favourite" aria-label="Favourite"><Star size={14} fill="currentColor"/></span>}
        <span className="sg-image-signature"><img src={logo} alt=""/><span>{name}</span></span>
      </button>
      <div className="sg-card-body"><div className="sg-card-title"><h2>{space.title}</h2>{space.place && space.place !== space.title && <p><MapPin size={12}/>{space.place}</p>}</div><div className="sg-card-actions"><button type="button" className="sg-open" onClick={() => onOpen(space.id)}>Open space<ArrowRight size={15}/></button><div><button type="button" className="sg-icon-button" aria-label={`Present ${space.title}`} title="Present this space" onClick={() => onPresent(space.id)}><Presentation size={18}/></button><button type="button" className="sg-icon-button" aria-label={`Download ${space.title}`} title="Download branded image" disabled={Boolean(actionBusy)} onClick={() => onDownload({...space.design, title: space.title})}>{actionBusy === `download-${space.design.id}` ? <LoaderCircle size={18} className="sg-spin"/> : <ArrowDownToLine size={18}/>}</button></div></div></div>
    </article>)}</div> : <div className="sg-empty"><span className="sg-empty-icon"><Images size={34} strokeWidth={1.2}/></span><h2>{filtered ? 'No spaces found' : 'A fresh space starts here.'}</h2><p>{filtered ? 'Try another name or return to all your spaces.' : 'Add a photo, share your idea, and make room for something beautiful.'}</p>{filtered ? <button type="button" className="sg-reset" onClick={() => {setSearch(''); setFavourites(false);}}>Show all spaces<ArrowRight size={15}/></button> : <button type="button" className="sg-new" onClick={onNew}><Plus size={17}/>Start your first space</button>}</div>}
    <footer className="sg-signature"><img src={logo} alt={`${name} logo`}/><span>{tagline}</span></footer>
  </section>;
}
