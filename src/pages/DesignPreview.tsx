import {useEffect, useRef, useState} from 'react';
import {X, Columns2, Image as ImageIcon} from 'lucide-react';
import './DesignPreview.css';

type Props = {image: string; original?: string; version: number; onClose: () => void};
export default function DesignPreview({image, original, version, onClose}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [view, setView] = useState<'design' | 'original' | 'compare'>(original ? 'compare' : 'design');
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialog?.showModal();
    return () => {dialog?.close(); document.body.style.overflow = overflow; previous?.focus();};
  }, []);
  return <dialog ref={ref} className="dp-dialog" aria-label={`View design version ${version}`} onCancel={event => {event.preventDefault(); close.current();}} onClick={event => {if(event.target === event.currentTarget) close.current();}}>
    <div className="dp-panel">
      <header><div><span>TAKE A CLOSER LOOK</span><h2>Version {version}</h2></div><button type="button" aria-label="Close image preview" onClick={onClose}><X size={20}/></button></header>
      {original && <div className="dp-tabs" role="group" aria-label="Image view"><button type="button" aria-pressed={view === 'compare'} onClick={() => setView('compare')}><Columns2 size={16}/> Before & after</button><button type="button" aria-pressed={view === 'original'} onClick={() => setView('original')}>Original</button><button type="button" aria-pressed={view === 'design'} onClick={() => setView('design')}><ImageIcon size={16}/> Design</button></div>}
      <div className={`dp-images${view === 'compare' ? ' dp-compare' : ''}`}>
        {original && view !== 'design' && <figure><figcaption>ORIGINAL PHOTO</figcaption><img src={original} alt="Original site photo"/></figure>}
        {view !== 'original' && <figure><figcaption>DESIGN · VERSION {version}</figcaption><img src={image} alt={`Enlarged design version ${version}`}/></figure>}
      </div>
    </div>
  </dialog>;
}
