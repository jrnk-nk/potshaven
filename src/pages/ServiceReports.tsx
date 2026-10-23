import {useEffect, useState} from 'react';
import {useApp} from '../state';

type Entry = Record<string, any>;
const prettyDate = (date: string) => date ? new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}) : '—';
const escapeHtml = (value: any) => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
function StatusTag({value}: {value: string}) {return <span className="badge">{value}</span>;}
function NoEntries({label}: {label: string}) {return <p className="muted" style={{padding: '28px 0'}}>{label}</p>;}
function reportTask(task: any) { return { text: typeof task === 'string' ? task : task?.title || task?.text || task?.label || 'Untitled task', status: typeof task === 'string' ? 'Not individually confirmed' : task?.done === true ? 'Completed' : 'Pending / not confirmed' }; }

// Reports are downloaded as standalone files, so authenticated server images must
// be embedded while this browser still has access to the signed-in workspace.
async function reportImage(source: string, label: string): Promise<string> {
  if (/^data:image\//i.test(source)) return source;
  try {
    const url = new URL(source, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported image address.');
    const response = await fetch(url.href, { credentials: 'same-origin', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Image unavailable.');
    const image = await response.blob();
    if (!image.type.startsWith('image/')) throw new Error('Invalid image response.');
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image could not be read.'));
      reader.onerror = () => reject(new Error('Image could not be read.'));
      reader.readAsDataURL(image);
    });
  } catch {
    throw new Error(`${label} could not be included. Check your connection and sign in again if needed, then retry the download.`);
  }
}
function reportPhotos(job: Entry): string[] {
  const photos = Array.isArray(job.photos) && job.photos.length ? job.photos : Array.isArray(job.completionPhotos) ? job.completionPhotos : [];
  return photos.map((photo: any) => typeof photo === 'string' ? photo : photo?.url || photo?.image).filter((source: unknown): source is string => typeof source === 'string' && source.length > 0);
}

export default function ServiceReports({siteId, jobId}: {siteId?: string; jobId?: string}) {
  const {data, notify} = useApp();
  const [reportJob, setReportJob] = useState(jobId || '');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState('');
  useEffect(() => {setReportJob(jobId || ''); setReportError('');}, [siteId, jobId]);
  const jobs: Entry[] = data.jobs || [];
  const places: Entry[] = data.places || [];
  const completed = jobs.filter(job => job.status === 'Completed' && (!siteId || job.placeId === siteId));
  const selectedJob = completed.find(job => job.id === reportJob) || completed.find(job => job.id === jobId) || completed[0];
  const selectedPlace = places.find(place => place.id === selectedJob?.placeId);
  const company = data.settings?.companyName || 'PotsHaven';
  const reportText = selectedJob ? `${company} · Maintenance service report\n\n${selectedPlace?.name || 'Site'}\n${prettyDate(selectedJob.date)}\n\n${selectedJob.title}\nVisit status: ${selectedJob.status}\n${(selectedJob.tasks || []).map((task: any) => { const record = reportTask(task); return `[${record.status}] ${record.text}`; }).join('\n') || 'No individual tasks were recorded for this visit.'}\n\n${selectedJob.notes || 'Thank you for trusting us with your space.'}` : '';
  async function downloadReport() {
    if (!selectedJob || reportBusy) return;
    setReportBusy(true); setReportError('');
    try {
      const tasks = (selectedJob.tasks || []).map((task: any) => { const record = reportTask(task); return `<li><strong>${escapeHtml(record.status)}</strong> — ${escapeHtml(record.text)}</li>`; }).join('');
      const [embeddedPhotos, logo] = await Promise.all([
        Promise.all(reportPhotos(selectedJob).map(source => reportImage(source, 'A service visit photo'))),
        typeof data.settings?.logo === 'string' && data.settings.logo ? reportImage(data.settings.logo, 'The company logo') : Promise.resolve(''),
      ]);
      const photos = embeddedPhotos.map(source => `<img src="${escapeHtml(source)}" alt="Service visit photo" style="width:100%;border-radius:10px;margin-top:16px"/>`).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(company)} · Service report</title><style>body{font:15px/1.7 Arial,sans-serif;color:#284633;max-width:760px;margin:50px auto;padding:24px}h1{font-size:36px}small{letter-spacing:2px;color:#7b8c78}header{padding-bottom:24px;border-bottom:2px solid #446e44}li{padding:5px}footer{border-top:1px solid #dde4d9;margin-top:40px;padding-top:20px;color:#768471}.print{background:#365b3c;color:white;border:0;border-radius:7px;padding:12px 18px;cursor:pointer}@media print{.print{display:none}body{margin:0}}</style></head><body><header>${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(company)} logo" style="max-height:70px;max-width:200px"/>` : `<h2>${escapeHtml(company)}</h2>`}<small>MAINTENANCE SERVICE REPORT</small><h1>${escapeHtml(selectedPlace?.name || 'Site')}</h1><p>${escapeHtml(selectedPlace?.address)}<br>${escapeHtml(prettyDate(selectedJob.date))}</p></header><h2>${escapeHtml(selectedJob.title)}</h2><p>Prepared for ${escapeHtml(selectedPlace?.client || 'our valued client')}</p><p>Visit status: ${escapeHtml(selectedJob.status)}</p><h3>Task record</h3><ul>${tasks || '<li>No individual tasks were recorded for this visit.</li>'}</ul><p>${escapeHtml(selectedJob.notes || 'Thank you for trusting us with your space.')}</p>${photos}<footer>${escapeHtml(company)} · Beautiful spaces, thoughtfully cared for.</footer><p><button class="print" onclick="window.print()">Print / Save as PDF</button></p></body></html>`;
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-service-report-${selectedJob.date}.html`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Service report downloaded. Open it to print or save as PDF.');
    } catch (err) { setReportError(err instanceof Error ? err.message : 'The report could not be downloaded. Please try again.'); }
    finally { setReportBusy(false); }
  }
  return <><div className="toolbar" style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 22 }}><select style={{maxWidth: '100%'}} aria-label="Select completed job for report" value={selectedJob?.id || ''} disabled={reportBusy} onChange={event => { setReportJob(event.target.value); setReportError(''); }}><option value="" disabled>Choose a completed job</option>{completed.map(job => <option value={job.id} key={job.id}>{job.title} · {prettyDate(job.date)}</option>)}</select>{selectedJob && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><a className="btn btn-secondary" href={`https://wa.me/?text=${encodeURIComponent(reportText)}`} target="_blank" rel="noreferrer">Share summary to WhatsApp ↗</a><button className="btn btn-primary" disabled={reportBusy} aria-busy={reportBusy} onClick={() => void downloadReport()}>{reportBusy ? 'Preparing report…' : '↓ Download report'}</button></div>}</div>{reportError && <p className="form-error" role="alert" style={{ marginBottom: 18 }}>{reportError}</p>}{selectedJob ? <article className="panel service-report-preview" style={{ maxWidth: 760, padding: 'clamp(24px, 5vw, 56px)', margin: '0 auto' }}><header style={{ borderBottom: '2px solid #8aa17a', paddingBottom: 24, marginBottom: 25 }}>{data.settings?.logo ? <img src={data.settings.logo} alt={`${company} logo`} style={{ maxHeight: 64, maxWidth: 190, marginBottom: 18 }} /> : <div style={{ fontSize: 24, color: '#3d653f', fontFamily: 'Georgia, serif', marginBottom: 23 }}>❧ {company}</div>}<div className="eyebrow">MAINTENANCE SERVICE REPORT</div><h2 style={{ fontSize: 30, fontWeight: 500, margin: '12px 0 8px' }}>{selectedPlace?.name || 'Site'}</h2><p className="muted" style={{ margin: 0 }}>{selectedPlace?.address}</p><p className="muted" style={{ fontSize: 12 }}>{prettyDate(selectedJob.date)} · Prepared for {selectedPlace?.client || 'our valued client'}</p></header><StatusTag value="Completed" /><h3 style={{ marginTop: 22 }}>{selectedJob.title}</h3><p className="muted" style={{ fontSize: 13 }}>Task record · completion confirmed individually below</p>{(selectedJob.tasks || []).length ? <ul style={{ listStyle: 'none', padding: 0 }}>{selectedJob.tasks.map((task: any, index: number) => { const record = reportTask(task); return <li key={index} style={{ borderBottom: '1px solid #edf0e8', padding: '12px 0', fontSize: 14 }}><span style={{ display: 'block', color: record.status === 'Completed' ? '#396447' : '#9b742f', fontSize: 11, marginBottom: 5 }}>{record.status}</span>{record.text}</li>; })}</ul> : <p>No individual tasks were recorded for this visit.</p>}<p style={{ fontSize: 13, lineHeight: 1.8 }}>{selectedJob.notes || 'Thank you for trusting us with your space.'}</p>{reportPhotos(selectedJob).map((photo: string, index: number) => <img key={index} src={photo} alt={`Completed work ${index + 1}`} style={{ width: '100%', borderRadius: 12, marginTop: 14 }} />)}<footer className="muted" style={{ marginTop: 40, paddingTop: 18, borderTop: '1px solid #edf0e8', fontSize: 11 }}>{company} · Beautiful spaces, thoughtfully cared for.</footer></article> : <NoEntries label="Complete a maintenance job to create its client service report." />}</>;
}
