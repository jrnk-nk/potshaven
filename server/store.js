import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { seedData } from './seed.js';
import {validateWorkforce} from './workforce-validation.js';

export const collections = ['places', 'jobs', 'inventory', 'stockMovements', 'workers', 'vehicles', 'contracts', 'payments', 'expenses', 'purchaseRequests', 'equipment', 'issues', 'careGuides', 'designs'];
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function nextOccurrence(scheduledDate, recurrence, now = new Date()) {
  const original = new Date(`${scheduledDate}T12:00:00Z`);
  if (Number.isNaN(original.getTime()) || original.toISOString().slice(0, 10) !== scheduledDate) throw new AppError('A valid scheduled date is required for recurring maintenance.');
  const today = now.toISOString().slice(0, 10);
  const intervals = { Weekly: 7, Fortnightly: 14, Monthly: 1, Quarterly: 3 };
  if (!Object.hasOwn(intervals, recurrence)) throw new AppError('Choose a supported maintenance recurrence.');
  const dayInterval = ['Weekly', 'Fortnightly'].includes(recurrence) ? intervals[recurrence] : null;
  let occurrence = 1;
  if (dayInterval) occurrence = Math.max(1, Math.floor((new Date(`${today}T12:00:00Z`) - original) / (86400000 * dayInterval)) + 1);
  else occurrence = Math.max(1, Math.floor(((now.getUTCFullYear() - original.getUTCFullYear()) * 12 + now.getUTCMonth() - original.getUTCMonth()) / intervals[recurrence]));
  for (let attempt = 0; attempt < 3; attempt++, occurrence++) {
    let date;
    if (dayInterval) date = new Date(original.getTime() + occurrence * dayInterval * 86400000);
    else {
      const month = original.getUTCMonth() + occurrence * intervals[recurrence];
      const lastDay = new Date(Date.UTC(original.getUTCFullYear(), month + 1, 0)).getUTCDate();
      date = new Date(Date.UTC(original.getUTCFullYear(), month, Math.min(original.getUTCDate(), lastDay), 12));
    }
    const result = date.toISOString().slice(0, 10);
    if (result > today) return result;
  }
  throw new AppError('Could not calculate the next maintenance visit.');
}

function text(value, name, required = false) {
  if (required && (typeof value !== 'string' || !value.trim())) throw new AppError(`${name} is required.`);
  if (value !== undefined && (typeof value !== 'string' || value.length > 20000)) throw new AppError(`${name} must be text of at most 20,000 characters.`);
}

function nonnegative(value, name) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new AppError(`${name} must be a nonnegative number.`);
}

export function validate(collection, record) {
  if (!collections.includes(collection)) throw new AppError('Unknown record type.', 404);
  if (!record || Array.isArray(record) || typeof record !== 'object') throw new AppError('A record object is required.');
  validateWorkforce(collection, record, AppError);
  if (JSON.stringify(record).length > 12000000) throw new AppError('Record is too large.', 413);
  const required = { places: ['name'], jobs: ['title'], inventory: ['name'], workers: ['name'], vehicles: ['name'], contracts: ['title'], payments: ['description'], expenses: ['description'], purchaseRequests: ['title'], equipment: ['name'], issues: ['title'], careGuides: ['name'], designs: ['title'] };
  for (const name of required[collection] || []) text(record[name], name, true);
  for (const name of ['quantity', 'cost', 'minStock', 'amount', 'estimatedCost', 'budget']) nonnegative(record[name], name);
  if (collection === 'jobs') {
    if (!['Scheduled', 'In progress', 'Completed', 'Overdue'].includes(record.status)) throw new AppError('Choose a valid job status.');
    if (!['Maintenance', 'Project'].includes(record.type)) throw new AppError('Choose Maintenance or Project.');
    if (!Array.isArray(record.crewIds) || !Array.isArray(record.tasks)) throw new AppError('Job crew and tasks must be lists.');
    if (record.recurrence && !['None', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly'].includes(record.recurrence)) throw new AppError('Choose a valid maintenance recurrence.');
  }
  if (collection === 'inventory' && !['Plants', 'Materials', 'Tools'].includes(record.category)) throw new AppError('Choose Plants, Materials, or Tools.');
  for (const [name, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.length > (name === 'image' ? 11000000 : 20000)) throw new AppError(`${name} is too long.`);
  }
  if (record.image && typeof record.image === 'string' && !/^(https:\/\/|\/images\/|\/media\/|data:image\/(png|jpeg|webp);base64,)/.test(record.image)) throw new AppError('Use an HTTPS image URL or an uploaded image.');
}

export function createStore(filename = '.data/potshaven.db', { seed = true, now = new Date() } = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection, id)); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  const find = db.prepare('SELECT data FROM records WHERE collection = ? AND id = ?');
  const list = db.prepare('SELECT data FROM records WHERE collection = ? ORDER BY rowid');
  const upsert = db.prepare('INSERT INTO records (collection, id, data) VALUES (?, ?, ?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data');
  const getMeta = db.prepare('SELECT value FROM metadata WHERE key = ?');
  const setMeta = db.prepare('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const store = {
    db,
    close: () => db.close(),
    list(collection) { return list.all(collection).map(row => JSON.parse(row.data)); },
    get(collection, id) { const row = find.get(collection, id); return row ? JSON.parse(row.data) : undefined; },
    put(collection, input) {
      validate(collection, input);
      const record = { ...input, id: input.id || randomUUID() };
      upsert.run(collection, record.id, JSON.stringify(record));
      return record;
    },
    update(collection, id, input, actor = 'Owner', {expected} = {}) {
      return transaction(() => {
        const previous = store.get(collection, id);
        if (!previous) throw new AppError('Record not found.', 404);
        // Role authorization may have depended on status, type, or private
        // nested fields. Check its snapshot while the write lock is held.
        if (expected != null && !isDeepStrictEqual(previous, expected)) throw new AppError('This record changed while you were editing. Refresh and try again.', 409);
        let next = store.put(collection, { ...previous, ...input, id });
        if (collection === 'inventory' && previous.quantity !== next.quantity) {
          const delta = next.quantity - previous.quantity;
          store.put('stockMovements', { id: randomUUID(), inventoryId: id, itemName: next.name, type: 'adjustment', quantity: Math.abs(delta), change: delta, jobId: '', note: 'Stock count adjusted', actor, date: new Date().toISOString(), balance: next.quantity, unitCost: next.cost || 0, totalCost: 0 });
        }
        if (collection === 'jobs' && next.type === 'Maintenance' && next.status === 'Completed' && previous.status !== 'Completed' && next.recurrence && next.recurrence !== 'None' && !previous.nextJobId) {
          const existingFollowUp = store.list('jobs').find(job => job.previousJobId === id);
          let nextJobId = existingFollowUp?.id;
          if (!nextJobId) {
            const anchor = next.recurrenceAnchorDate || next.date;
            const lowerBound = next.date > new Date().toISOString().slice(0, 10) ? new Date(`${next.date}T12:00:00Z`) : new Date();
            const date = nextOccurrence(anchor, next.recurrence, lowerBound);
            const offset = new Date(`${date}T12:00:00Z`) - new Date(`${next.date}T12:00:00Z`);
            if (next.deadline && Number.isNaN(new Date(`${next.deadline}T12:00:00Z`).getTime())) throw new AppError('A valid deadline is required for recurring maintenance.');
            const deadline = next.deadline ? new Date(new Date(`${next.deadline}T12:00:00Z`).getTime() + offset).toISOString().slice(0, 10) : date;
            const { nextJobId: ignoredNextId, completedAt: ignoredCompletion, ...template } = next;
            const followUp = store.put('jobs', { ...template, id: randomUUID(), previousJobId: id, recurrenceAnchorDate: anchor, date, deadline, status: 'Scheduled', tasks: next.tasks.map(task => typeof task === 'string' ? { text: task, done: false } : { ...task, done: false }), photos: [], completionPhotos: [], createdAt: new Date().toISOString() });
            nextJobId = followUp.id;
          }
          next = store.put('jobs', { ...next, nextJobId, completedAt: new Date().toISOString() });
        }
        return next;
      });
    },
    remove(collection, id) {
      if (!store.get(collection, id)) throw new AppError('Record not found.', 404);
      const dependent = { places: [['jobs', 'placeId'], ['contracts', 'placeId'], ['payments', 'placeId'], ['issues', 'placeId']], workers: [['jobs', 'crewIds']], vehicles: [['jobs', 'vehicleId']], jobs: [['expenses', 'jobId'], ['stockMovements', 'jobId']], inventory: [['stockMovements', 'inventoryId']] };
      for (const [other, field] of dependent[collection] || []) {
        if (store.list(other).some(record => Array.isArray(record[field]) ? record[field].includes(id) : record[field] === id)) throw new AppError('This record is used elsewhere. Update its linked records before deleting it.', 409);
      }
      db.prepare('DELETE FROM records WHERE collection = ? AND id = ?').run(collection, id);
    },
    settings() { const row = getMeta.get('settings'); return row ? JSON.parse(row.value) : {}; },
    recordLoginAttempt(key, accepted, now = Date.now()) {
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || typeof accepted !== 'boolean' || !Number.isSafeInteger(now) || now < 0) throw new AppError('Invalid sign-in attempt.');
      return transaction(() => {
        db.prepare("DELETE FROM metadata WHERE key LIKE 'login-attempt:%' AND json_extract(value, '$.until') <= ?").run(now);
        const metadataKey = `login-attempt:${key}`;
        const row = getMeta.get(metadataKey);
        const previous = row ? JSON.parse(row.value) : null;
        const active = previous && previous.until > now;
        if (active && previous.count >= 10) return false;
        if (accepted) db.prepare('DELETE FROM metadata WHERE key = ?').run(metadataKey);
        else setMeta.run(metadataKey, JSON.stringify({count: (active ? previous.count : 0) + 1, until: active ? previous.until : now + 15 * 60 * 1000}));
        return true;
      });
    },
    updateSettings(input) {
      const allowed = ['companyName', 'ownerName', 'tagline', 'email', 'phone', 'currency', 'logo', 'watermark', 'address', 'accentColor'];
      const clean = {};
      for (const key of allowed) if (Object.hasOwn(input, key)) {
        if (typeof input[key] !== 'string' || input[key].length > (key === 'logo' ? 3000000 : 500)) throw new AppError(`Invalid ${key}.`);
        clean[key] = input[key];
      }
      if (clean.accentColor && !/^#[a-fA-F0-9]{6}$/.test(clean.accentColor)) throw new AppError('Choose a valid six-digit accent colour.');
      if (clean.currency && !Intl.supportedValuesOf('currency').includes(clean.currency)) throw new AppError('Choose a supported ISO currency code, such as GHS, USD or GBP.');
      if (clean.logo && !/^(https:\/\/|\/branding\/potshaven-logo\.png$|\/media\/uploads\/[a-f0-9]{64}\.(png|jpg|webp)$|data:image\/(png|jpeg|webp);base64,)/.test(clean.logo)) throw new AppError('Upload a PNG, JPG, or WebP logo.');
      const settings = { ...store.settings(), ...clean };
      setMeta.run('settings', JSON.stringify(settings));
      return settings;
    },
    stock(id, quantity, { type = 'use', jobId = '', note = '', actor = 'Owner' } = {}) {
      if (!Number.isFinite(quantity) || quantity <= 0) throw new AppError('Quantity must be greater than zero.');
      if (!['use', 'restock'].includes(type)) throw new AppError('Unknown stock operation.');
      if (jobId && !store.get('jobs', jobId)) throw new AppError('Choose an existing job.');
      text(note, 'Note');
      return transaction(() => {
        const item = store.get('inventory', id);
        if (!item) throw new AppError('Inventory item not found.', 404);
        if (type === 'use' && quantity > item.quantity) throw new AppError(`Only ${item.quantity} ${item.unit || 'units'} available.`, 409);
        const next = store.put('inventory', { ...item, quantity: Number((item.quantity + (type === 'use' ? -quantity : quantity)).toFixed(4)) });
        const movement = store.put('stockMovements', { id: randomUUID(), inventoryId: id, itemName: item.name, type, quantity, jobId, note, actor, date: new Date().toISOString(), balance: next.quantity, unitCost: item.cost || 0, totalCost: type === 'use' ? quantity * (item.cost || 0) : 0 });
        return { item: next, movement };
      });
    },
    state() { return Object.fromEntries([...collections.map(collection => [collection, store.list(collection)]), ['settings', store.settings()]]); },
  };
  if (seed && !getMeta.get('initialized')) transaction(() => {
    const initial = seedData(now);
    for (const collection of collections) for (const record of initial[collection] || []) store.put(collection, record);
    store.updateSettings(initial.settings);
    setMeta.run('initialized', 'true');
  });
  else if (!getMeta.get('initialized')) transaction(() => {
    store.updateSettings(seedData(now).settings);
    setMeta.run('initialized', 'true');
  });
  return store;
}
