import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent} from 'react';
import {ArrowDownToLine, ArrowRight, ArrowUp, Check, ChevronDown, CornerUpLeft, History, ImagePlus, LoaderCircle, Plus, Sparkles, Sprout, X} from 'lucide-react';
import {useApp} from '../state';
import {prepareImage} from '../images';
import './DesignChat.css';

type Row = Record<string, any>;
type Photo = {id: string; image: string; name: string};
type PendingMessage = {prompt: string; photos: Photo[]};
type Conversation = {id: string; designs: Row[]; title: string; updatedAt: string};
type Props = {downloadBranded: (design: Row, settings: Row) => Promise<void>};

const selectionKey = 'potshaven:design-conversation';
const suggestions = [
  {label: 'A welcoming entrance', prompt: 'Create a welcoming entrance with beautiful plants and elegant pots.'},
  {label: 'A greener roundabout', prompt: 'Design a lush, colourful roundabout that is easy to maintain.'},
  {label: 'Refresh a garden', prompt: 'Give this garden a fresh look with thoughtful planting and natural colours.'},
];
const message = (error: unknown) => error instanceof Error ? error.message : 'Your design could not be created. Please try again.';
const dateValue = (design: Row) => Date.parse(design.createdAt || '') || 0;
function initialSelection() {try {return localStorage.getItem(selectionKey) || '';} catch {return '';}}
function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Saved design' : date.toLocaleDateString('en-GH', {month: 'short', day: 'numeric'});
}

export default function DesignChat({downloadBranded}: Props) {
  const {data, connection, refresh, update, notify} = useApp();
  const [activeId, setActiveId] = useState(initialSelection);
  const [recentResults, setRecentResults] = useState<Row[]>([]);
  const [draft, setDraft] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editFromId, setEditFromId] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
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
      id, designs: versions, title: versions[0].title || versions[0].prompt || 'Untitled design', updatedAt: versions[versions.length - 1].createdAt || '',
    })).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  }, [designs]);
  const conversation = conversations.find(item => item.id === activeId);
  const versions = conversation?.designs || [];
  const latest = versions[versions.length - 1];
  const parent = versions.find(design => design.id === editFromId) || latest;
  const selectedVersion = parent ? versions.findIndex(design => design.id === parent.id) + 1 : 0;
  const hasMessages = versions.length > 0 || busy;

  useEffect(() => {try {if (activeId) localStorage.setItem(selectionKey, activeId); else localStorage.removeItem(selectionKey);} catch {/* A private browsing session can still use the studio. */}}, [activeId]);
  useLayoutEffect(() => {
    // A new conversation reuses the scroll container. Reset the old chat's
    // scroll position before painting the welcome screen on shorter phones.
    if (!hasMessages && threadRef.current) threadRef.current.scrollTop = 0;
  }, [activeId, hasMessages]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;}
  }, [draft]);
  useEffect(() => {
    if (!hasMessages) return;
    const frame = requestAnimationFrame(() => bottomRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'}));
    return () => cancelAnimationFrame(frame);
  }, [activeId, versions.length, busy, hasMessages]);
  useEffect(() => {
    if (!historyOpen) return;
    const outside = (event: PointerEvent) => {
      if (!historyRef.current?.contains(event.target as Node) && !historyButtonRef.current?.contains(event.target as Node)) setHistoryOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {if (event.key === 'Escape') {setHistoryOpen(false); historyButtonRef.current?.focus();}};
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => {document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);};
  }, [historyOpen]);

  function selectConversation(id: string) {
    if (busy || preparing) return;
    if (!id && threadRef.current) threadRef.current.scrollTop = 0;
    setActiveId(id); setDraft(''); setPhotos([]); setError(''); setEditFromId(''); setHistoryOpen(false);
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
    if (!ready) {setError('Connect the design studio in Settings to create images.'); return;}
    const submitted = {prompt, photos: [...photos]};
    inFlight.current = true; setPending(submitted); setError(''); setDraft(''); setPhotos([]); setHistoryOpen(false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 295000);
    try {
      const response = await fetch('/api/designs/generate', {
        method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({prompt, ...(submitted.photos.length ? {referenceImages: submitted.photos.map(photo => photo.image)} : {}), ...(parent ? {parentDesignId: parent.id} : {})}),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) void refresh();
        throw new Error(typeof result?.error === 'string' ? result.error : 'Your design could not be created. Please try again.');
      }
      const design = result?.design || result;
      if (!design?.id || !design.image) throw new Error('Your design could not be opened. Please refresh the conversation before trying again.');
      setRecentResults(current => [...current.filter(item => item.id !== design.id), design]);
      setActiveId(design.conversationId || design.id); setEditFromId('');
      notify('Your design is ready.');
      void refresh();
    } catch (caught) {
      setDraft(submitted.prompt); setPhotos(submitted.photos);
      setError(controller.signal.aborted ? 'This design is taking longer than expected. Check your recent designs before trying again.' : message(caught));
      if (controller.signal.aborted) void refresh();
    } finally {
      clearTimeout(timeout); inFlight.current = false; setPending(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }
  function keyboardSend(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault(); void send();}
  }
  async function download(design: Row) {
    setActionBusy(`download-${design.id}`); setError('');
    try {await downloadBranded(design, data.settings || {}); notify('Branded image downloaded.');}
    catch (caught) {setError(message(caught));}
    finally {setActionBusy('');}
  }
  async function publish(design: Row) {
    setActionBusy(`publish-${design.id}`); setError('');
    try {await update('designs', design.id, {published: !design.published}); notify(design.published ? 'Removed from your portfolio.' : 'Added to your portfolio.');}
    catch (caught) {setError(message(caught));}
    finally {setActionBusy('');}
  }

  return <section className={`design-chat${hasMessages ? ' dc-has-messages' : ''}`} aria-label="Design studio">
    <header className="dc-header">
      <div className="dc-heading"><span className="dc-eyebrow">ROOM FOR YOUR IDEAS</span><h1>Design studio<span className="dc-heading-dot" /></h1></div>
      <div className="dc-header-actions">
        {conversations.length > 0 && <button type="button" ref={historyButtonRef} aria-label="Recent designs" className={`dc-header-button${historyOpen ? ' is-open' : ''}`} onClick={() => setHistoryOpen(open => !open)} aria-expanded={historyOpen} aria-controls="dc-recent-chats" disabled={busy || preparing}><History size={16} /><span>Recent designs</span><ChevronDown size={13} /></button>}
        <button type="button" className="dc-new-button" onClick={() => selectConversation('')} disabled={busy || preparing}><Plus size={16} /><span>New design</span></button>
      </div>
      {historyOpen && <div className="dc-history" id="dc-recent-chats" ref={historyRef}><div className="dc-history-heading"><strong>Your conversations</strong><button type="button" className="dc-icon-button" aria-label="Close recent designs" onClick={() => setHistoryOpen(false)}><X size={16} /></button></div><div className="dc-history-list">{conversations.map(item => <button key={item.id} type="button" className={`dc-history-item${item.id === activeId ? ' is-active' : ''}`} aria-pressed={item.id === activeId} onClick={() => selectConversation(item.id)}><img src={item.designs[item.designs.length - 1].image} alt="" loading="lazy" /><span><strong>{item.title}</strong><small>{timeLabel(item.updatedAt)} · {item.designs.length} {item.designs.length === 1 ? 'version' : 'versions'}</small></span>{item.id === activeId && <Check size={15} />}</button>)}</div></div>}
    </header>

    <div className="dc-body">
      <div ref={threadRef} className={`dc-thread${!hasMessages ? ' dc-thread-empty' : ''}`} role="log" aria-label="Design conversation" aria-live="polite" aria-busy={busy}>
        {!hasMessages ? <div className="dc-welcome"><div className="dc-botanical" aria-hidden="true"><Sprout size={43} strokeWidth={1.15} /><Sparkles className="dc-botanical-spark" size={17} strokeWidth={1.3} /></div><span className="dc-welcome-eyebrow">A LITTLE IMAGINATION. A FRESH POSSIBILITY.</span><h2>What shall we create?</h2><p>Add a photo of the place, then describe your idea.<br className="dc-desktop-break" /> We can keep refining it together.</p><div className="dc-suggestions" aria-label="Ideas to get started">{suggestions.map((suggestion, index) => <button key={suggestion.label} type="button" onClick={() => {setDraft(suggestion.prompt); setError(''); textareaRef.current?.focus();}}><span className="dc-suggestion-number">0{index + 1}</span>{suggestion.label}<ArrowRight size={13} /></button>)}</div></div> : <div className="dc-messages">{versions.map((design, index) => <article className="dc-turn" key={design.id}>
          <div className="dc-user-message"><span className="dc-message-label">YOU</span>{Array.isArray(design.referenceImages) && design.referenceImages.length > 0 && <div className="dc-message-photos">{design.referenceImages.map((image: string, photoIndex: number) => <img key={`${image}-${photoIndex}`} src={image} alt={`Reference photo ${photoIndex + 1}`} loading="lazy" />)}</div>}<p>{design.prompt || design.title}</p>{design.parentDesignId && design.parentDesignId !== versions[index - 1]?.id && <span className="dc-branch-label"><CornerUpLeft size={11} />Editing version {Math.max(1, versions.findIndex(item => item.id === design.parentDesignId) + 1)}</span>}</div>
          <div className="dc-studio-reply"><div className="dc-reply-heading"><span className="dc-reply-avatar"><Sprout size={17} strokeWidth={1.5} /></span><strong>{index ? 'Your updated concept' : 'Your first concept'}</strong><span className="dc-version">VERSION {String(index + 1).padStart(2, '0')}</span></div><div className="dc-image-card"><img className="dc-design-image" src={design.image} alt={`Design version ${index + 1}`} loading="lazy" /><div className="dc-image-actions"><button type="button" aria-label="Download image" onClick={() => void download(design)} disabled={Boolean(actionBusy)}>{actionBusy === `download-${design.id}` ? <LoaderCircle size={14} className="dc-spin" /> : <ArrowDownToLine size={14} />}<span>Download</span></button><button type="button" aria-label={design.published ? 'Remove from portfolio' : 'Add to portfolio'} aria-pressed={Boolean(design.published)} onClick={() => void publish(design)} disabled={Boolean(actionBusy) || !online}>{actionBusy === `publish-${design.id}` ? <LoaderCircle size={14} className="dc-spin" /> : design.published ? <Check size={14} /> : <Plus size={14} />}<span>{design.published ? 'In portfolio' : 'Add to portfolio'}</span></button><button type="button" className={editFromId === design.id ? 'is-selected' : ''} aria-pressed={editFromId === design.id} onClick={() => {setEditFromId(design.id); setError(''); textareaRef.current?.focus();}} disabled={busy || preparing}><CornerUpLeft size={14} /><span>Edit this version</span></button></div></div></div>
        </article>)}{pending && <article className="dc-turn dc-pending-turn"><div className="dc-user-message"><span className="dc-message-label">YOU</span>{pending.photos.length > 0 && <div className="dc-message-photos">{pending.photos.map((photo, index) => <img key={photo.id} src={photo.image} alt={`Reference photo ${index + 1}`} />)}</div>}<p>{pending.prompt}</p></div><div className="dc-creating" role="status"><span className="dc-creating-icon"><Sprout size={22} strokeWidth={1.3} /></span><div><strong>Creating your design…</strong><span>A thoughtful design takes a little time.</span></div><span className="dc-typing"><i /><i /><i /></span></div></article>}<div ref={bottomRef} className="dc-scroll-anchor" /></div>}
      </div>

      <div className="dc-composer-area">
        {!ready && <div className="dc-connection-note"><Sparkles size={17} /><span>Connect the design studio in <a href="#settings">Settings <ArrowRight size={11} /></a> to create images.</span></div>}
        {!online && <div className="dc-offline-note">Reconnect before sending. Your message will stay here.</div>}
        {error && <div className="dc-error" role="alert"><span>{error}</span><button type="button" className="dc-icon-button" aria-label="Dismiss design error" onClick={() => setError('')}><X size={15} /></button></div>}
        {editFromId && parent && <div className="dc-editing"><img src={parent.image} alt="" /><span><strong>Editing version {selectedVersion}</strong><small>Describe what you’d like to change.</small></span><button type="button" className="dc-icon-button" aria-label="Use latest version" onClick={() => setEditFromId('')} disabled={busy}><X size={15} /></button></div>}
        <form className={`dc-composer${busy ? ' is-busy' : ''}`} onSubmit={event => void send(event)}>
          {photos.length > 0 && <div className="dc-attachments">{photos.map((photo, index) => <div className="dc-attachment" key={photo.id}><img src={photo.image} alt={`Attached photo ${index + 1}`} /><button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setPhotos(current => current.filter(item => item.id !== photo.id))} disabled={busy || preparing}><X size={12} /></button><span>{photo.name}</span></div>)}</div>}
          <textarea ref={textareaRef} aria-label="Message design studio" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={keyboardSend} placeholder={busy ? 'Your design is on its way…' : 'Describe your idea or ask for a change…'} maxLength={6000} rows={2} disabled={busy} />
          <div className="dc-composer-toolbar"><div className="dc-compose-left"><button type="button" className="dc-attach-button" aria-label="Add photos" onClick={() => inputRef.current?.click()} disabled={busy || preparing || photos.length >= 4}>{preparing ? <LoaderCircle size={18} className="dc-spin" /> : <ImagePlus size={18} />}<span>{preparing ? 'Preparing photos…' : 'Add photos'}</span></button><input ref={inputRef} type="file" className="dc-file-input" tabIndex={-1} aria-label="Upload reference photos" accept="image/jpeg,image/png,image/webp" multiple onChange={event => void addPhotos(event)} disabled={busy || preparing || photos.length >= 4} /><span className="dc-photo-count">{photos.length ? `${photos.length} / 4` : 'Up to 4 photos'}</span></div><button className="dc-send-button" type="submit" aria-label="Send message" disabled={busy || preparing || !draft.trim() || !online || !ready}>{busy ? <LoaderCircle size={18} className="dc-spin" /> : <ArrowUp size={20} />}</button></div>
        </form>
        <div className="dc-composer-footnote"><span>{hasMessages ? 'Ask for a change. Every version stays in your conversation.' : 'Your ideas, photos, and finished designs. All in one place.'}</span><span className="dc-keyboard-hint">Enter to send · Shift + Enter for a new line</span></div>
      </div>
    </div>
  </section>;
}
