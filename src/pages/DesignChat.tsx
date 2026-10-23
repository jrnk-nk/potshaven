import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent} from 'react';
import {ArrowDownToLine, ArrowRight, ArrowUp, Check, CornerUpLeft, ArrowLeft, Presentation, ImagePlus, LoaderCircle, Plus, Sparkles, Sprout, X, Columns2, Expand, MoreHorizontal, Settings2, Star, CheckCircle2} from 'lucide-react';
import {useApp} from '../state';
import {prepareImage} from '../images';
import './DesignChat.css';
import {DesignDetails} from './DesignLibrary';
import StudioGallery from './StudioGallery';
import StudioPresentation from './StudioPresentation';
import BrandSignature from '../BrandSignature';
import DesignPreview from './DesignPreview';

type Row = Record<string, any>;
type Photo = {id: string; image: string; name: string};
type PendingMessage = {prompt: string; photos: Photo[]};
type Conversation = {id: string; designs: Row[]; title: string; updatedAt: string};
type Props = {downloadBranded: (design: Row, settings: Row) => Promise<void>};

const selectionKey = 'potshaven:design-conversation';
const draftKey = 'potshaven:studio-draft:';
function savedDraft(id: string) {try {return sessionStorage.getItem(draftKey + (id || 'new'))?.slice(0, 6000) || '';} catch {return '';}}
const refinements = [
  {label: 'Less maintenance', prompt: 'Keep the layout and existing structures. Make this design easier to maintain with resilient plants and a practical watering plan.'},
  {label: 'More colour', prompt: 'Keep the layout and existing structures. Add more colour through a balanced mix of flowering plants and foliage.'},
  {label: 'Simpler design', prompt: 'Keep the layout and existing structures. Simplify this concept with fewer plant varieties, simple pots and a clean arrangement.'},
];
const suggestions = [
  {label: 'A welcoming entrance', prompt: 'Create a welcoming entrance with beautiful plants and elegant pots.'},
  {label: 'A greener roundabout', prompt: 'Design a lush, colourful roundabout that is easy to maintain.'},
  {label: 'Refresh a garden', prompt: 'Give this garden a fresh look with thoughtful planting and natural colours.'},
];
const message = (error: unknown) => error instanceof Error ? error.message : 'Your design could not be created. Please try again.';
const dateValue = (design: Row) => Date.parse(design.createdAt || '') || 0;
function initialSelection() {try {return localStorage.getItem(selectionKey) || '';} catch {return '';}}


export default function DesignChat({downloadBranded}: Props) {
  const {data, connection, refresh, update, notify} = useApp();
  const [activeId, setActiveId] = useState(initialSelection);
  const [recentResults, setRecentResults] = useState<Row[]>([]);
  const [draft, setDraft] = useState(() => savedDraft(initialSelection()));
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'gallery' | 'chat'>('gallery');
  const [showEarlier, setShowEarlier] = useState(false);
  const [presentId, setPresentId] = useState('');
  const [editFromId, setEditFromId] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [preview, setPreview] = useState<Row | null>(null);
  const [actionBusy, setActionBusy] = useState('');
  const inFlight = useRef(false);
  const spaceDrafts = useRef(new Map<string, {draft: string; photos: Photo[]; editFromId: string; placeId: string}>());
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const online = connection === 'online';
  const ready = Boolean(data.imageGenerationConfigured);
  const busy = Boolean(pending);

  const designs = useMemo(() => {
    const records = new Map<string, Row>();
    for (const design of recentResults) records.set(design.id, design);
    for (const design of data.designs || []) records.set(design.id, design);
    return [...records.values()].filter(design => design.image && design.source !== 'Portfolio upload').sort((a, b) => dateValue(a) - dateValue(b));
  }, [data.designs, recentResults]);
  const conversations = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const design of designs) {
      const id = design.conversationId || design.id;
      groups.set(id, [...(groups.get(id) || []), design]);
    }
    return [...groups.entries()].map(([id, versions]): Conversation => ({
      id, designs: versions, title: versions[0].studioTitle || (data.places || []).find((place: Row) => place.id === versions[0].placeId)?.name || 'Untitled space', updatedAt: versions[versions.length - 1].createdAt || '',
    })).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  }, [designs, data.places]);
  const conversation = conversations.find(item => item.id === activeId);
  const versions = conversation?.designs || [];
  const latest = versions[versions.length - 1];
  const visibleVersions = showEarlier ? versions : versions.slice(-1);
  const presentation = conversations.find(item => item.id === presentId);
  const presentationDesign = presentation?.designs.find(design => design.id === presentation.designs[0]?.approvedDesignId) || presentation?.designs.at(-1);
  const root = versions[0];
  const linkedPlace = (data.places || []).find((place: Row) => place.id === (root?.placeId || placeId));
  const original = versions.flatMap(design => Array.isArray(design.referenceImages) ? design.referenceImages : []).find(Boolean);
  const availablePlants = (data.inventory || []).filter((item: Row) => item.category === 'Plants' && Number(item.quantity) > 0).slice(0, 12);
  const parent = versions.find(design => design.id === editFromId) || latest;
  const selectedVersion = parent ? versions.findIndex(design => design.id === parent.id) + 1 : 0;
  const hasMessages = versions.length > 0 || busy;

  useEffect(() => {try {if (activeId) localStorage.setItem(selectionKey, activeId); else localStorage.removeItem(selectionKey);} catch {/* A private browsing session can still use the studio. */}}, [activeId]);
  useEffect(() => {try {if (draft) sessionStorage.setItem(draftKey + (activeId || 'new'), draft); else sessionStorage.removeItem(draftKey + (activeId || 'new'));} catch {/* Text drafts are optional when storage is unavailable. */}}, [activeId, draft]);
  useLayoutEffect(() => {
    // A new conversation reuses the scroll container. Reset the old chat's
    // scroll position before painting the welcome screen on shorter phones.
    if (!hasMessages && threadRef.current) threadRef.current.scrollTop = 0;
  }, [activeId, hasMessages]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;}
  }, [draft, view]);
  useEffect(() => {
    if (!hasMessages) return;
    const frame = requestAnimationFrame(() => bottomRef.current?.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'end'}));
    return () => cancelAnimationFrame(frame);
  }, [activeId, versions.length, busy, hasMessages, view]);


  function selectConversation(id: string) {
    if (busy || preparing) return;
    if (!id && threadRef.current) threadRef.current.scrollTop = 0;
    if (id !== activeId) {
      spaceDrafts.current.set(activeId, {draft, photos, editFromId, placeId});
      const saved = spaceDrafts.current.get(id);
      setActiveId(id); setDraft(saved?.draft ?? savedDraft(id)); setPhotos(saved?.photos || []); setEditFromId(saved?.editFromId || ''); setPlaceId(saved?.placeId || '');
    }
    setView('chat'); setError(''); setDetailsOpen(false); setShowEarlier(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }
  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (photos.length + files.length > 4) {setError('You can add up to 4 photos to a message.'); return;}
    setPreparing(true); setError('');
    try {
      const prepared = await Promise.all(files.map(async file => ({id: crypto.randomUUID(), name: file.name, image: await prepareImage(file, {maxDimension: 1600, maxBytes: 600 * 1024})})));
      setPhotos(current => [...current, ...prepared].slice(0, 4));
    } catch (caught) {setError(message(caught));}
    finally {setPreparing(false);}
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || inFlight.current || preparing) return;
    if (!online) {setError('Reconnect before sending your message.'); return;}
    if (!ready) {setError('The studio is unavailable at the moment. Please ask the owner to check its connection.'); return;}
    const submitted = {prompt, photos: [...photos]};
    inFlight.current = true; setPending(submitted); setError(''); setDraft(''); setPhotos([]); setShowEarlier(false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 295000);
    try {
      const response = await fetch('/api/designs/generate', {
        method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({prompt, ...(submitted.photos.length ? {referenceImages: submitted.photos.map(photo => photo.image)} : {}), ...(parent ? {parentDesignId: parent.id, placeId: root?.placeId || ''} : placeId ? {placeId} : {})}),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) void refresh();
        throw new Error(response.status === 401 ? 'Your session has ended. Sign in again to continue.' : response.status === 429 ? 'The studio is busy. Please try again shortly.' : response.status >= 500 ? 'The studio couldn’t finish this idea. Your message and photos are still here. Please try again.' : typeof result?.error === 'string' ? result.error : 'Your idea could not be saved. Please try again.');
      }
      const design = result?.design || result;
      if (!design?.id || !design.image) throw new Error('Your design could not be opened. Please refresh the conversation before trying again.');
      setRecentResults(current => [...current.filter(item => item.id !== design.id), design]);
      try {sessionStorage.removeItem(draftKey + (activeId || 'new'));} catch {/* The saved design remains available on the server. */}
      spaceDrafts.current.delete(activeId);
      setActiveId(design.conversationId || design.id); setEditFromId('');
      notify('Your design is ready.');
      void refresh();
    } catch (caught) {
      setDraft(submitted.prompt); setPhotos(submitted.photos);
      setError(controller.signal.aborted ? 'This idea is taking longer than expected. Check your gallery before trying again.' : message(caught));
      if (controller.signal.aborted) void refresh();
    } finally {
      clearTimeout(timeout); inFlight.current = false; setPending(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }
  function keyboardSend(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !matchMedia('(pointer: coarse)').matches) {event.preventDefault(); void send();}
  }
  async function download(design: Row) {
    setActionBusy(`download-${design.id}`); setError('');
    const group = conversations.find(item => item.designs.some(version => version.id === design.id));
    const title = group?.title || 'PotsHaven space';
    try {await downloadBranded({...design, title}, data.settings || {}); notify('Branded image downloaded.');}
    catch (caught) {setError(message(caught));}
    finally {setActionBusy('');}
  }
  async function publish(design: Row) {
    setActionBusy(`publish-${design.id}`); setError('');
    try {await update('designs', design.id, {published: !design.published}); notify(design.published ? 'Removed from your portfolio.' : 'Added to your portfolio.');}
    catch (caught) {setError(message(caught));}
    finally {setActionBusy('');}
  }

  async function saveDetails(patch: Row) {
    if (!root) return;
    const saved = await update('designs', root.id, patch);
    setRecentResults(current => [...current.filter(item => item.id !== saved.id), saved]);
    notify('Design details saved.');
  }
  async function chooseVersion(design: Row) {
    if (!root) return;
    setActionBusy(`choose-${design.id}`); setError('');
    try {await saveDetails({approvedDesignId: root.approvedDesignId === design.id ? '' : design.id}); notify(root.approvedDesignId === design.id ? 'Version selection cleared.' : `Version ${versions.findIndex(item => item.id === design.id) + 1} is your chosen design.`);}
    catch (caught) {setError(message(caught));}
    finally {setActionBusy('');}
  }
  function refine(prompt: string) {setDraft(prompt); setError(''); textareaRef.current?.focus();}

  const presentationView = presentation && presentationDesign ? <StudioPresentation design={presentationDesign} title={presentation.title} settings={data.settings || {}} onClose={() => setPresentId('')} onDownload={() => void download(presentationDesign)} downloading={Boolean(actionBusy)} /> : null;
  if (view === 'gallery') return <><StudioGallery conversations={conversations} places={data.places || []} settings={data.settings || {}} onOpen={selectConversation} onNew={() => selectConversation('')} onPresent={setPresentId} onDownload={design => void download(design)} actionBusy={actionBusy}/>{error && <p className="dc-gallery-error" role="alert">{error}</p>}{presentationView}</>;

  return <section className={`design-chat${hasMessages ? ' dc-has-messages' : ''}`} aria-label="Design studio">
    <header className="dc-header">
      <div className="dc-heading"><span className="dc-eyebrow">POTSHAVEN STUDIO</span><h1>Space chat</h1></div>
      <div className="dc-header-actions">
        <button type="button" aria-label="Gallery" className="dc-header-button dc-gallery-button" onClick={() => {setView('gallery'); setError('');}} disabled={busy || preparing}><ArrowLeft size={16}/><span>Gallery</span></button>
        {conversation && <button type="button" className="dc-header-button dc-present-button" aria-label="Present this space" onClick={() => setPresentId(activeId)} disabled={busy || preparing}><Presentation size={18}/><span>Present</span></button>}
      </div>
    </header>
    {presentationView}
    {detailsOpen && conversation && <DesignDetails conversation={conversation} places={data.places || []} online={online} onClose={() => setDetailsOpen(false)} onSave={saveDetails} />}
    {preview && <DesignPreview image={preview.image} original={original} version={versions.findIndex(item => item.id === preview.id) + 1} onClose={() => setPreview(null)} />}
    {conversation ? <div className="dc-project-bar"><button type="button" className="dc-project-title" aria-label="Design details" onClick={() => setDetailsOpen(true)} disabled={busy || preparing}>{root?.favorite && <Star size={15} fill="currentColor"/>}<span><strong>{conversation.title}</strong><small>{linkedPlace?.name || 'Name this space or link a site'}</small></span><Settings2 size={16}/></button>{root?.approvedDesignId && <span className="dc-chosen-badge"><CheckCircle2 size={13}/> Gallery image chosen</span>}</div> : (data.places || []).length > 0 && <div className="dc-place-context"><label htmlFor="dc-place">Design for</label><select id="dc-place" aria-label="Design site" value={placeId} onChange={event => setPlaceId(event.target.value)} disabled={busy}><option value="">Any site</option>{data.places.map((place: Row) => <option value={place.id} key={place.id}>{place.name}</option>)}</select><span>Optional</span></div>}
    <div className="dc-body">
      <div ref={threadRef} className={`dc-thread${!hasMessages ? ' dc-thread-empty' : ''}`} role="log" aria-label="Design conversation" aria-live="polite" aria-busy={busy}>
        {!hasMessages ? <div className="dc-welcome"><div className="dc-botanical" aria-hidden="true"><Sprout size={43} strokeWidth={1.15} /><Sparkles className="dc-botanical-spark" size={17} strokeWidth={1.3} /></div><span className="dc-welcome-eyebrow">BRIGHTEN YOUR WORLD</span><h2>What shall we create?</h2><p>Add a photo of the place, then describe your idea.<br className="dc-desktop-break" /> We can keep refining it together.</p><div className="dc-suggestions" aria-label="Ideas to get started">{suggestions.map((suggestion, index) => <button key={suggestion.label} type="button" onClick={() => {setDraft(suggestion.prompt); setError(''); textareaRef.current?.focus();}}><span className="dc-suggestion-number">0{index + 1}</span>{suggestion.label}<ArrowRight size={13} /></button>)}</div></div> : <div className="dc-messages">{versions.length > 1 && <button type="button" className="dc-earlier-button" aria-expanded={showEarlier} aria-label="Show earlier ideas" onClick={() => setShowEarlier(current => !current)} disabled={busy}>{showEarlier ? 'Show latest idea' : `Earlier ideas (${versions.length - 1})`}</button>}{visibleVersions.map(design => {const index = versions.findIndex(item => item.id === design.id); return <article className="dc-turn" key={design.id}>
          <div className="dc-user-message"><span className="dc-message-label">YOU</span>{Array.isArray(design.referenceImages) && design.referenceImages.length > 0 && <div className="dc-message-photos">{design.referenceImages.map((image: string, photoIndex: number) => <img key={`${image}-${photoIndex}`} src={image} alt={`Reference photo ${photoIndex + 1}`} loading="lazy" />)}</div>}<p>{design.prompt || design.title}</p>{design.parentDesignId && design.parentDesignId !== versions[index - 1]?.id && <span className="dc-branch-label"><CornerUpLeft size={11} />Editing version {Math.max(1, versions.findIndex(item => item.id === design.parentDesignId) + 1)}</span>}</div>
          <div className="dc-studio-reply"><div className="dc-reply-heading"><span className="dc-reply-avatar"><Sprout size={17} strokeWidth={1.5} /></span><strong>PotsHaven studio</strong><span className="dc-version">{design.id === latest?.id ? 'LATEST IDEA' : 'EARLIER IDEA'}</span></div><div className="dc-image-card"><button type="button" className="dc-open-image" aria-label={`View design version ${index + 1}`} onClick={() => setPreview(design)}><img className="dc-design-image" src={design.image} alt={`Design version ${index + 1}`} loading="lazy"/><span><Expand size={14}/> View image</span></button><div className="dc-image-signature"><BrandSignature settings={data.settings || {}} compact/></div><div className="dc-image-actions"><button type="button" aria-label="Download image" onClick={() => void download(design)} disabled={Boolean(actionBusy)}>{actionBusy === `download-${design.id}` ? <LoaderCircle size={14} className="dc-spin" /> : <ArrowDownToLine size={14} />}<span>Download</span></button>{original && <button type="button" aria-label="Compare before and after" onClick={() => setPreview(design)}><Columns2 size={15}/><span>Compare</span></button>}<details className="dc-version-menu"><summary aria-label={`More options for version ${index + 1}`}><MoreHorizontal size={19}/><span>More</span></summary><div><button type="button" aria-label={design.published ? 'Remove from portfolio' : 'Add to portfolio'} aria-pressed={Boolean(design.published)} onClick={() => void publish(design)} disabled={Boolean(actionBusy) || !online}>{design.published ? <Check size={15}/> : <Plus size={15}/>}<span>{design.published ? 'In portfolio' : 'Add to portfolio'}</span></button><button type="button" aria-pressed={editFromId === design.id} onClick={event => {setEditFromId(design.id); setError(''); event.currentTarget.closest('details')?.removeAttribute('open'); textareaRef.current?.focus();}} disabled={busy || preparing}><CornerUpLeft size={15}/><span>Edit this version</span></button><button type="button" aria-label={root?.approvedDesignId === design.id ? 'Clear chosen version' : 'Choose this version'} aria-pressed={root?.approvedDesignId === design.id} onClick={() => void chooseVersion(design)} disabled={Boolean(actionBusy) || !online}><CheckCircle2 size={15}/><span>{root?.approvedDesignId === design.id ? 'Chosen version' : 'Choose this version'}</span></button></div></details></div></div></div>
        </article>;})}{latest && !busy && <div className="dc-refinements" aria-label="Quick design edits"><span>TRY A CHANGE</span><div>{refinements.map(item => <button key={item.label} type="button" onClick={() => refine(item.prompt)}>{item.label}<ArrowRight size={12}/></button>)}{availablePlants.length > 0 && <button type="button" onClick={() => refine('Keep the layout and existing structures. Refine this concept using suitable plants from our available stock where possible. Available stock (quantities are totals, not a reservation): ' + availablePlants.map((plant: Row) => `${plant.name}: ${plant.quantity} ${plant.unit || 'plants'}`).join('; ') + '. Do not assume these quantities are sufficient for the site.')}><Sprout size={13}/> Use our plants</button>}</div><small>Choose an idea, then edit the message before sending.</small></div>}{pending && <article className="dc-turn dc-pending-turn"><div className="dc-user-message"><span className="dc-message-label">YOU</span>{pending.photos.length > 0 && <div className="dc-message-photos">{pending.photos.map((photo, index) => <img key={photo.id} src={photo.image} alt={`Reference photo ${index + 1}`} />)}</div>}<p>{pending.prompt}</p></div><div className="dc-creating" role="status"><span className="dc-creating-icon"><Sprout size={22} strokeWidth={1.3} /></span><div><strong>Creating your design…</strong><span>Bringing the details together.</span></div><span className="dc-typing"><i /><i /><i /></span></div></article>}<div ref={bottomRef} className="dc-scroll-anchor" /></div>}
      </div>

      <div className="dc-composer-area">
        {!ready && <div className="dc-connection-note"><Sprout size={17} /><span>The studio is currently unavailable. Ask the owner to check <a href="#settings">Settings <ArrowRight size={11}/></a>.</span></div>}
        {!online && <div className="dc-offline-note">Reconnect before sending. Your message will stay here.</div>}
        {error && <div className="dc-error" role="alert"><span>{error}</span><button type="button" className="dc-icon-button" aria-label="Dismiss design error" onClick={() => setError('')}><X size={15} /></button></div>}
        {editFromId && parent && <div className="dc-editing"><img src={parent.image} alt="" /><span><strong>Editing version {selectedVersion}</strong><small>Describe what you’d like to change.</small></span><button type="button" className="dc-icon-button" aria-label="Use latest version" onClick={() => setEditFromId('')} disabled={busy}><X size={15} /></button></div>}
        <form className={`dc-composer${busy ? ' is-busy' : ''}`} onSubmit={event => void send(event)}>
          {photos.length > 0 && <div className="dc-attachments">{photos.map((photo, index) => <div className="dc-attachment" key={photo.id}><img src={photo.image} alt={`Attached photo ${index + 1}`} /><button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setPhotos(current => current.filter(item => item.id !== photo.id))} disabled={busy || preparing}><X size={12} /></button><span>{photo.name}</span></div>)}</div>}
          <textarea ref={textareaRef} aria-label="Message design studio" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={keyboardSend} placeholder={busy ? 'Your design is on its way…' : 'Describe your idea or ask for a change…'} maxLength={6000} rows={2} disabled={busy} />
          <div className="dc-composer-toolbar"><div className="dc-compose-left"><button type="button" className="dc-attach-button" aria-label="Add photos" onClick={() => inputRef.current?.click()} disabled={busy || preparing || photos.length >= 4}>{preparing ? <LoaderCircle size={18} className="dc-spin" /> : <ImagePlus size={18} />}<span>{preparing ? 'Preparing photos…' : 'Add photos'}</span></button><input ref={inputRef} type="file" className="dc-file-input" tabIndex={-1} aria-label="Upload reference photos" accept="image/jpeg,image/png,image/webp" multiple onChange={event => void addPhotos(event)} disabled={busy || preparing || photos.length >= 4} /><span className="dc-photo-count">{photos.length ? `${photos.length} / 4` : 'Up to 4 photos'}</span></div><button className="dc-send-button" type="submit" aria-label="Send message" disabled={busy || preparing || !draft.trim() || !online || !ready}>{busy ? <LoaderCircle size={18} className="dc-spin" /> : <ArrowUp size={20} />}</button></div>
        </form>
        <div className="dc-composer-footnote"><span>{hasMessages ? 'Ask for a change, or present this space to your client.' : 'Photos, ideas and a space that feels like you.'}</span><span className="dc-keyboard-hint">Enter to send · Shift + Enter for a new line</span></div>
      </div>
    </div>
  </section>;
}
