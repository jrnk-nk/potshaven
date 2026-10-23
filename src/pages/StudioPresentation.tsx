import {useEffect, useRef, useState} from 'react';
import {ArrowDownToLine, ImageOff, LoaderCircle, X} from 'lucide-react';
import BrandSignature from '../BrandSignature';
import {BRAND_NAME, BRAND_TAGLINE} from '../branding';
import './StudioPresentation.css';

type Row = Record<string, any>;
type Props = {
  design: Row;
  title: string;
  settings: Row;
  onClose: () => void;
  onDownload: () => void;
  downloading?: boolean;
};

/** A client view contains the finished image and the company's signature only. */
export default function StudioPresentation({design, title, settings, onClose, onDownload, downloading = false}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const [imageFailed, setImageFailed] = useState(false);
  const companyName = settings.companyName || BRAND_NAME;
  const tagline = settings.tagline || BRAND_TAGLINE;
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus({preventScroll: true});
    };
  }, []);

  useEffect(() => setImageFailed(false), [design.image]);

  return <dialog
    ref={dialogRef}
    className="sp-dialog"
    aria-label="Client presentation"
    onCancel={event => {event.preventDefault(); closeRef.current();}}
  >
    <div className="sp-presentation">
      <header className="sp-header">
        <BrandSignature settings={settings} compact className="sp-brand" />
        <div className="sp-actions">
          <button type="button" className="sp-download" aria-label="Download presentation image" onClick={onDownload} disabled={downloading || imageFailed}>
            {downloading ? <LoaderCircle size={18} className="sp-spin" /> : <ArrowDownToLine size={18} />}
            <span>{downloading ? 'Downloading…' : 'Download'}</span>
          </button>
          <button type="button" autoFocus className="sp-close" aria-label="Close presentation" onClick={onClose}><X size={21} /></button>
        </div>
      </header>

      <div className="sp-canvas">
        <figure className="sp-image-frame">
          {imageFailed ? <div className="sp-image-unavailable" role="status"><ImageOff size={32} strokeWidth={1.3} /><strong>This image could not be opened.</strong><p>Close this view and try again.</p></div> : <img className="sp-image" src={design.image} alt={title || 'A beautifully considered space'} onError={() => setImageFailed(true)} />}
        </figure>
      </div>

      <footer className="sp-footer">
        <div className="sp-caption"><span className="sp-caption-rule" aria-hidden="true" /><h1>{title || 'A beautiful space'}</h1></div>
        <div className="sp-signature"><strong>{companyName}</strong><span>{tagline}</span></div>
      </footer>
    </div>
  </dialog>;
}
