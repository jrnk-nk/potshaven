import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { useApp, money as currency } from '../state';

type Entry = Record<string, any>;
type Editor = { kind: 'item' | 'use' | 'restock' | 'history' | 'request' | 'equipment' | 'care'; item?: Entry } | null;
const today = () => new Date().toISOString().slice(0, 10);

export function LocalDialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const dialog = document.getElementById(titleId)?.closest('[role="dialog"]');
        const controls = dialog?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]');
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    document.getElementById(titleId)?.closest('[role="dialog"]')?.querySelector<HTMLElement>('button, input')?.focus();
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  return <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#102c265e', display: 'grid', placeItems: 'center', padding: 20 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: wide ? 780 : 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 80px #102c2633' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px', borderBottom: '1px solid #edf0ea' }}><h2 id={titleId} style={{ margin: 0, fontSize: 21 }}>{title}</h2><button className="btn btn-ghost" type="button" aria-label="Close dialog" onClick={onClose}>✕</button></div>
      <div style={{ padding: 28 }}>{children}</div>
    </section>
  </div>;
}

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field" style={{ display: 'grid', gap: 7, fontSize: 13, fontWeight: 600 }}>{label}{children}</label>;
}
export function FormButtons({ busy, onClose, label = 'Save changes' }: { busy: boolean; onClose: () => void; label?: string }) {
  return <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : label}</button></div>;
}
function Tag({ children, warning = false }: { children: ReactNode; warning?: boolean }) { return <span className="badge" style={{ background: warning ? '#fff2dc' : '#edf4ec', color: warning ? '#99651e' : '#456d45' }}>{children}</span>; }
function Blank({ text }: { text: string }) { return <div className="empty-state" style={{ padding: 52, textAlign: 'center', color: '#7d897d' }}>{text}</div>; }

export function SimplePageStyles() {
  return <style>{`
    .simple-tools {display:flex;justify-content:space-between;align-items:center;gap:16px;margin:0 0 24px;flex-wrap:wrap}
    .simple-tools label {display:flex;align-items:center;gap:10px;color:#566b4d;font-size:13px;font-weight:500}
    .simple-tools select {border:1px solid #dce4d3;border-radius:8px;background:#fff;color:#344f35;padding:11px 34px 11px 13px;font:inherit;min-height:42px}
    .simple-summary {display:flex;align-items:center;gap:14px;flex-wrap:wrap;color:#65765c;font-size:13px;line-height:1.6}
    .simple-summary strong {color:#355637;font-weight:600}
    .simple-summary .stock-warning {color:#936122;background:#fbf2e1;padding:5px 10px;border-radius:6px}
    .simple-details {border:1px solid #e1e7d8;border-radius:8px;background:#f8faf4;margin-top:15px}
    .simple-details>summary {cursor:pointer;padding:14px 15px;color:#49613f;font-size:13px;font-weight:500;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:10px}
    .simple-details>summary::after {content:'+';font-size:20px;font-weight:400;color:#839675}
    .simple-details[open]>summary::after {content:'−'}
    .simple-details>summary::-webkit-details-marker {display:none}
    .simple-details-content {padding:8px 15px 1px}
    .business-money-line {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid #e1e7d8;border-radius:10px;background:#fff;margin-bottom:23px}
    .business-money-line>div {padding:19px 22px}
    .business-money-line>div+div {border-left:1px solid #e9ede2}
    .business-money-line span {font-size:12px;color:#68785e;display:block;margin-bottom:8px}
    .business-money-line strong {font-size:24px;font-weight:500;color:#355537;letter-spacing:-.5px}
    .business-cost-details {margin:22px 0;background:#fff}
    .business-cost-details>summary {padding:18px 21px;font-size:14px}
    .business-cost-details>section {border:none;border-top:1px solid #e5eadf;border-radius:0;margin-bottom:0!important}
    .stock-page .page-heading h1,.business-page .page-heading h1 {margin-bottom:9px}
    @media(max-width:600px){.simple-tools {align-items:flex-start;gap:13px}.simple-tools label {width:100%;justify-content:space-between}.simple-tools select {min-width:175px;max-width:70%}.simple-summary {font-size:12px;gap:9px}.business-money-line>div {padding:14px 12px}.business-money-line span {font-size:10px;min-height:29px;line-height:1.5}.business-money-line strong {font-size:18px}.simple-details>summary {font-size:12px}}
  `}</style>;
}

export function InventoryPage() {
  const { data, refresh, create, update, notify } = useApp();
  const [tab, setTab] = useState('All stock');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All categories');
  const [editor, setEditor] = useState<Editor>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [image, setImage] = useState('');
  const inventory: Entry[] = data.inventory || [];
  const requests: Entry[] = data.purchaseRequests || [];
  const equipment: Entry[] = data.equipment || [];
  const guides: Entry[] = data.careGuides || [];
  const lowStock = inventory.filter(item => Number(item.quantity) <= Number(item.minStock));
  const filtered = inventory.filter(item => (category === 'All categories' || item.category === category) && `${item.name} ${item.category} ${item.notes || ''}`.toLowerCase().includes(search.toLowerCase()));
  const open = (kind: NonNullable<Editor>['kind'], item?: Entry) => { setError(''); setImage(item?.image || ''); setEditor({ kind, item }); };
  const close = () => { if (!busy) setEditor(null); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setBusy(true); setError('');
    const values: Entry = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (editor.kind === 'use' || editor.kind === 'restock') {
        const response = await fetch(`/api/inventory/${editor.item?.id}/${editor.kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, quantity: Number(values.quantity) }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Stock could not be updated.');
        await refresh(); notify(editor.kind === 'use' ? 'Stock deducted and usage recorded.' : 'Stock replenished.');
      } else {
        const collection = { item: 'inventory', request: 'purchaseRequests', equipment: 'equipment', care: 'careGuides' }[editor.kind as 'item' | 'request' | 'equipment' | 'care'];
        if (!collection) return;
        for (const key of ['quantity', 'minStock', 'cost', 'estimatedCost', 'serviceInterval']) if (key in values) values[key] = Number(values[key]);
        if (editor.kind === 'item') values.image = image;
        if (editor.kind === 'request' && !editor.item) { values.status = 'Pending'; values.requestedBy = data.role === 'owner' ? 'Owner' : 'Manager'; values.date = today(); }
        if (editor.item) await update(collection, editor.item.id, values); else await create(collection, values);
        notify(editor.item ? 'Changes saved.' : 'Added successfully.');
      }
      setEditor(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  }
  async function requestDecision(item: Entry, status: string) { try { await update('purchaseRequests', item.id, { status }); notify(`Purchase request ${status.toLowerCase()}.`); } catch (err) { notify(err instanceof Error ? err.message : 'Unable to update request.'); } }
  const item = editor?.item;
  const tabs = ['All stock', 'Purchase requests', 'Equipment', 'Plant care'];
  return <div className="stock-page"><SimplePageStyles />
    <div className="page-heading"><div><h1>Plants & stock</h1><p className="muted">See what you have. Record what you use.</p></div><button className="btn btn-primary" onClick={() => open(tab === 'Purchase requests' ? 'request' : tab === 'Equipment' ? 'equipment' : tab === 'Plant care' ? 'care' : 'item')}>＋ {tab === 'Purchase requests' ? 'New request' : tab === 'Equipment' ? 'Add equipment' : tab === 'Plant care' ? 'Add care guide' : 'Add stock'}</button></div>
    <div className="simple-tools"><div className="simple-summary"><span><strong>{inventory.length}</strong> stock items</span>{lowStock.length > 0 && <span className="stock-warning"><strong>{lowStock.length}</strong> need restocking</span>}</div><label>Inventory tools<select aria-label="Inventory tools" value={tab} onChange={event => setTab(event.target.value)}>{tabs.map(name => <option key={name} value={name}>{name === 'All stock' ? 'Plants & stock' : name === 'Purchase requests' ? `Purchases${requests.some(request => request.status === 'Pending') ? ` (${requests.filter(request => request.status === 'Pending').length} waiting)` : ''}` : name}</option>)}</select></label></div>
    {tab === 'All stock' && <>
      <div className="toolbar" style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}><input className="search-input" aria-label="Search inventory" placeholder="Search plants, tools, supplies…" value={search} onChange={e => setSearch(e.target.value)} /><select style={{ padding: '11px 13px', border: '1px solid #dce4d3', borderRadius: 8, background: '#fff', color: '#455e3b', fontSize: 13 }} aria-label="Filter category" value={category} onChange={e => setCategory(e.target.value)}><option>All categories</option><option>Plants</option><option>Materials</option><option>Tools</option></select></div>
      {filtered.length ? <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))', gap: 22 }}>{filtered.map(stock => <article className="panel" key={stock.id} style={{ overflow: 'hidden' }}>
        <div style={{ height: 190, overflow: 'hidden', background: '#f0f2e9', position: 'relative', display: 'grid', placeItems: 'center' }}>{stock.image ? <img src={stock.image} alt={stock.name} loading="lazy" style={{ position: 'absolute', inset: 0, height: '100%', width: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} /> : <span style={{ fontSize: 66 }}>{stock.category === 'Plants' ? '🌿' : stock.category === 'Tools' ? '🪴' : '◌'}</span>}{Number(stock.quantity) <= Number(stock.minStock) && <span style={{ position: 'absolute', left: 14, top: 14 }}><Tag warning>Low stock</Tag></span>}<button className="btn btn-secondary btn-sm" style={{ position: 'absolute', right: 10, top: 10, padding: '6px 9px' }} aria-label={`Edit ${stock.name}`} onClick={() => open('item', stock)}>✎</button></div>
        <div style={{ padding: 19 }}><h3 style={{ margin: '7px 0 6px', fontSize: 17 }}>{stock.name}</h3><div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 15 }}><strong style={{ fontSize: 23, color: Number(stock.quantity) <= Number(stock.minStock) ? '#ad762c' : '#31563b' }}>{stock.quantity}</strong><span className="muted" style={{ fontSize: 12 }}>{stock.unit || 'units'} available</span></div><div style={{ display: 'flex', gap: 8 }}><button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => open('use', stock)} disabled={Number(stock.quantity) <= 0}>Use stock</button><button className="btn btn-ghost btn-sm" onClick={() => open('restock', stock)}>＋ Restock</button></div><button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0, marginTop: 9, fontSize: 11 }} onClick={() => open('history', stock)}>View stock history →</button></div>
      </article>)}</div> : <Blank text="No inventory matches your search. Add stock to start tracking it." />}
    </>}
    {tab === 'Purchase requests' && <div className="panel table-wrap">{requests.length ? <table className="data-table"><thead><tr><th>Item requested</th><th>Quantity</th><th>Estimated cost</th><th>Requested by</th><th>Status</th><th>Actions</th></tr></thead><tbody>{requests.map(request => <tr key={request.id}><td><strong>{request.title || request.name}</strong><div className="muted" style={{ fontSize: 11 }}>{request.notes}</div></td><td>{request.quantity}</td><td>{currency(request.estimatedCost)}</td><td>{request.requestedBy}</td><td><Tag warning={request.status === 'Pending'}>{request.status}</Tag></td><td><div style={{ display: 'flex', gap: 7 }}>{request.status === 'Pending' && data.role === 'owner' ? <><button className="btn btn-secondary btn-sm" onClick={() => requestDecision(request, 'Approved')}>Approve</button><button className="btn btn-ghost btn-sm" onClick={() => requestDecision(request, 'Rejected')}>Decline</button></> : <button className="btn btn-ghost btn-sm" onClick={() => open('request', request)}>View / edit</button>}</div></td></tr>)}</tbody></table> : <Blank text="No purchase requests yet. Request materials whenever your team needs them." />}</div>}
    {tab === 'Equipment' && <div className="panel table-wrap">{equipment.length ? <table className="data-table"><thead><tr><th>Equipment</th><th>Assigned to</th><th>Last serviced</th><th>Next service</th><th>Condition</th><th /></tr></thead><tbody>{equipment.map(tool => <tr key={tool.id}><td><strong>{tool.name}</strong><div className="muted" style={{ fontSize: 11 }}>{tool.notes}</div></td><td>{tool.assignedTo || 'Store'}</td><td>{tool.lastService || '—'}</td><td style={{ color: (tool.nextService || tool.nextServiceDate) <= today() ? '#ad762c' : undefined }}>{tool.nextService || tool.nextServiceDate || 'Not scheduled'}</td><td><Tag warning={tool.status === 'Needs service'}>{tool.status || 'Good'}</Tag></td><td><button className="btn btn-ghost btn-sm" onClick={() => open('equipment', tool)}>Manage →</button></td></tr>)}</tbody></table> : <Blank text="Add equipment to track servicing and who has it." />}</div>}
    {tab === 'Plant care' && (guides.length ? <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>{guides.map(guide => <article className="panel" key={guide.id} style={{ padding: 25 }}><span className="eyebrow">PLANT CARE GUIDE</span><h3>{guide.name || guide.plantName}</h3>{[['Watering', guide.watering], ['Pruning', guide.pruning], ['Fertilising', guide.fertilizing || guide.fertilising || guide.feeding], ['Sunlight', guide.sunlight || guide.light]].map(([label, text]) => text && <div style={{ padding: '10px 0', borderBottom: '1px solid #eef0e9' }} key={label}><span className="muted" style={{ fontSize: 11 }}>{label}</span><p style={{ fontSize: 13, margin: '5px 0' }}>{text}</p></div>)}<button className="btn btn-ghost btn-sm" style={{ marginTop: 17, paddingLeft: 0 }} onClick={() => open('care', guide)}>Edit care instructions →</button></article>)}</div> : <Blank text="Add watering, pruning and feeding instructions for your plants." />)}
    {editor && <LocalDialog title={{ item: item ? 'Edit stock item' : 'Add stock item', use: `Use ${item?.name || 'stock'}`, restock: `Restock ${item?.name || 'item'}`, history: `${item?.name || 'Item'} · Stock history`, request: item ? 'Edit purchase request' : 'New purchase request', equipment: item ? 'Manage equipment' : 'Add equipment', care: item ? 'Edit plant care guide' : 'New plant care guide' }[editor.kind]} onClose={close} wide={editor.kind === 'history'}>
      {editor.kind === 'history' ? <><p className="muted">Every usage and replenishment is recorded here.</p><div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Movement</th><th>Quantity</th><th>Job / note</th></tr></thead><tbody>{(data.stockMovements || []).filter((movement: Entry) => movement.inventoryId === item?.id || movement.itemId === item?.id).map((movement: Entry) => <tr key={movement.id}><td>{new Date(movement.createdAt || movement.date).toLocaleDateString()}</td><td>{movement.type}</td><td>{movement.quantity}</td><td>{data.jobs.find((job: Entry) => job.id === movement.jobId)?.title || 'General stock'}{movement.note && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{movement.note}</div>}</td></tr>)}</tbody></table>{!(data.stockMovements || []).some((movement: Entry) => movement.inventoryId === item?.id || movement.itemId === item?.id) && <Blank text="No movements recorded for this item yet." />}</div></> : <form onSubmit={submit}>
        {error && <p role="alert" style={{ padding: 12, color: '#a13b35', background: '#fff0ed', borderRadius: 8 }}>{error}</p>}
        {editor.kind === 'item' && <><div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 22 }}>{image ? <img src={image} alt="Stock preview" style={{ width: 80, height: 80, borderRadius: 12, objectFit: 'cover' }} /> : <div style={{ width: 80, height: 80, background: '#eef3e9', display: 'grid', placeItems: 'center', borderRadius: 12, fontSize: 30 }}>🌿</div>}<FormField label="Stock photo"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Choose a PNG, JPEG or WebP photo.'); return; } if (file.size > 5 * 1024 * 1024) { setError('Choose a photo smaller than 5 MB.'); return; } const reader = new FileReader(); reader.onload = () => setImage(String(reader.result)); reader.readAsDataURL(file); }} /></FormField></div><div className="form-grid"><FormField label="Name"><input name="name" defaultValue={item?.name} required placeholder="e.g. Golden cane palm" /></FormField><FormField label="Category"><select name="category" defaultValue={item?.category || 'Plants'}><option>Plants</option><option>Materials</option><option>Tools</option></select></FormField><FormField label="Quantity available"><input name="quantity" type="number" min="0" step="0.01" defaultValue={item?.quantity ?? 0} required /></FormField><FormField label="Unit"><input name="unit" defaultValue={item?.unit || 'plants'} required placeholder="plants, bags, pieces…" /></FormField></div><details className="simple-details"><summary>Cost & stock alerts</summary><div className="simple-details-content"><div className="form-grid"><FormField label="Low-stock threshold"><input name="minStock" type="number" min="0" step="0.01" defaultValue={item?.minStock ?? 5} /></FormField><FormField label={`Unit cost (${data.settings.currency || 'GHS'})`}><input name="cost" type="number" min="0" step="0.01" defaultValue={item?.cost ?? 0} /></FormField></div><FormField label="Notes"><textarea name="notes" rows={3} defaultValue={item?.notes} placeholder="Size, variety, nursery location…" /></FormField></div></details></>}
        {(editor.kind === 'use' || editor.kind === 'restock') && <><p className="muted">Currently available: <strong>{item?.quantity} {item?.unit}</strong></p><FormField label={editor.kind === 'use' ? 'Quantity used' : 'Quantity received'}><input name="quantity" type="number" min="0.01" max={editor.kind === 'use' ? item?.quantity : undefined} step="0.01" defaultValue={1} required /></FormField>{editor.kind === 'use' && <FormField label="Used on job"><select name="jobId" required defaultValue=""><option value="" disabled>Select a job</option>{data.jobs.map((job: Entry) => <option value={job.id} key={job.id}>{job.title}</option>)}</select></FormField>}<FormField label="Note"><textarea name="note" rows={3} placeholder={editor.kind === 'use' ? 'Where was this stock used?' : 'Supplier, delivery or receipt details…'} /></FormField><p className="muted" style={{ fontSize: 12 }}>{editor.kind === 'use' ? 'This quantity will be deducted immediately and recorded against the selected job.' : 'This quantity will be added to available stock and recorded in its history.'}</p></>}
        {editor.kind === 'request' && <><FormField label="Item or materials needed"><input name="title" defaultValue={item?.title || item?.name} required placeholder="e.g. 20 terracotta planters" /></FormField><div className="form-grid"><FormField label="Quantity"><input name="quantity" type="number" min="1" defaultValue={item?.quantity || 1} required /></FormField><FormField label={`Estimated total (${data.settings.currency || 'GHS'})`}><input name="estimatedCost" type="number" min="0" step="0.01" defaultValue={item?.estimatedCost || 0} required /></FormField></div><FormField label="Reason / supplier details"><textarea name="notes" rows={3} defaultValue={item?.notes} /></FormField>{item && <p className="muted">Status: {item.status}</p>}</>}
        {editor.kind === 'equipment' && <><FormField label="Equipment name"><input name="name" defaultValue={item?.name} required placeholder="e.g. STIHL hedge trimmer" /></FormField><div className="form-grid"><FormField label="Assigned to"><input name="assignedTo" defaultValue={item?.assignedTo || 'Store'} /></FormField><FormField label="Condition"><select name="status" defaultValue={item?.status || 'Good'}><option>Good</option><option>Available</option><option>In use</option><option>Needs service</option><option>In repair</option><option>Retired</option></select></FormField><FormField label="Last service"><input name="lastService" type="date" defaultValue={item?.lastService} /></FormField><FormField label="Next service due"><input name="nextService" type="date" defaultValue={item?.nextService || item?.nextServiceDate} required /></FormField></div><FormField label="Notes / serial number"><textarea name="notes" rows={3} defaultValue={item?.notes} /></FormField></>}
        {editor.kind === 'care' && <><FormField label="Plant name"><input name="name" defaultValue={item?.name || item?.plantName} required /></FormField>{[['watering', 'Watering'], ['pruning', 'Pruning'], ['fertilizing', 'Fertilising'], ['sunlight', 'Sunlight']].map(([key, label]) => <FormField label={label} key={key}><textarea name={key} rows={2} defaultValue={item?.[key] || (key === 'fertilizing' ? item?.feeding : key === 'sunlight' ? item?.light : '')} placeholder={`Describe ${label.toLowerCase()} requirements…`} /></FormField>)}</>}
        <FormButtons busy={busy} onClose={close} label={editor.kind === 'use' ? 'Deduct stock' : editor.kind === 'restock' ? 'Add to stock' : 'Save changes'} />
      </form>}
    </LocalDialog>}
  </div>;
}
