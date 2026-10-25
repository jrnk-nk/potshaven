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

const conversationId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function assistantConversationKey(role, id) {
  if (!['owner', 'manager'].includes(role)) throw new AppError('Please sign in to open saved conversations.', 401);
  if (id === undefined) return `assistant-chat:${role}:`;
  if (!conversationId(id)) throw new AppError('Choose a valid conversation.');
  return `assistant-chat:${role}:${id.toLowerCase()}`;
}
export function assistantConversationOffset(value = 0) {
  if (!Number.isInteger(value) || value < 0 || value > 1000000) throw new AppError('Choose a conversation offset from 0 to 1,000,000.');
  return value;
}
export function assistantConversationSummary(value) {
  if (!value || !conversationId(value.id) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 80 || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) || !Number.isInteger(value.version) || value.version < 1 || value.version > 50 || value.messageCount !== value.version * 2) throw new AppError('This saved conversation could not be opened. Please try again.', 503);
  return {id: value.id.toLowerCase(), title: value.title, updatedAt: value.updatedAt, version: value.version, messageCount: value.messageCount};
}
export function assistantConversationResult(value) {
  if (!value) return undefined;
  const summary = assistantConversationSummary({...value, messageCount: Array.isArray(value.messages) ? value.messages.length : null});
  const messages = value.messages.map((message, index) => {
    const role = index % 2 ? 'assistant' : 'user';
    if (!message || message.role !== role || typeof message.id !== 'string' || !message.id.endsWith(`:${role}`) || !conversationId(message.id.slice(0, -(role.length + 1))) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > (role === 'user' ? 4000 : 8000) || typeof message.createdAt !== 'string' || !Number.isFinite(Date.parse(message.createdAt))) throw new AppError('This saved conversation could not be opened. Please try again.', 503);
    if (index % 2 && message.id.slice(0, -10) !== value.messages[index - 1].id.slice(0, -5)) throw new AppError('This saved conversation could not be opened. Please try again.', 503);
    return {id: message.id, role, content: message.content, createdAt: message.createdAt};
  });
  if (new Set(messages.map(message => message.id)).size !== messages.length) throw new AppError('This saved conversation could not be opened. Please try again.', 503);
  const {messageCount: ignoredCount, ...result} = summary;
  return {...result, messages};
}
export function assistantExchangeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['exchangeId', 'expectedVersion', 'user', 'assistant'].includes(key)) || !conversationId(input.exchangeId) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 50 || typeof input.user !== 'string' || !input.user.trim() || input.user.length > 4000 || typeof input.assistant !== 'string' || !input.assistant.trim() || input.assistant.length > 8000) throw new AppError('Save a complete conversation exchange with a valid version.');
  return {...input, exchangeId: input.exchangeId.toLowerCase()};
}
export function nextAssistantConversation(id, exchange, previous) {
  const saved = assistantConversationResult(previous);
  const existing = saved?.messages.find(message => message.id === `${exchange.exchangeId}:user`);
  if (existing) {
    if (existing.content !== exchange.user || saved.messages.find(message => message.id === `${exchange.exchangeId}:assistant`)?.content !== exchange.assistant) throw new AppError('This message reference already contains a different exchange. Reopen the saved conversation.', 409);
    return {value: saved, unchanged: true};
  }
  if (!saved && exchange.expectedVersion > 0) throw new AppError('Saved conversation not found.', 404);
  if (saved && saved.version !== exchange.expectedVersion) throw new AppError('This conversation changed on another device. Reopen the saved conversation before continuing.', 409);
  if (saved?.version === 50) throw new AppError('This conversation is full. Start a new conversation to keep all saved messages.', 409);
  const timestamp = new Date().toISOString();
  return {value: {id: id.toLowerCase(), title: saved?.title || exchange.user.trim().replace(/\s+/g, ' ').slice(0, 80), updatedAt: timestamp, version: (saved?.version || 0) + 1, messages: [...(saved?.messages || []), ...['user', 'assistant'].map(role => ({id: `${exchange.exchangeId}:${role}`, role, content: exchange[role], createdAt: timestamp}))]}, unchanged: false};
}

// Activity is an owner-only operational ledger, separate from company records.
// Never persist a raw request, notes, financial fields, or a claimed staff name.
export function activityData(input) {
  if (input == null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Invalid activity record.');
  if (input.actor !== 'Manager account' || !['created', 'updated', 'completed', 'visit_recorded', 'stock_used', 'assigned'].includes(input.action) || !['places', 'jobs', 'inventory', 'workers', 'vehicles', 'purchaseRequests', 'issues'].includes(input.collection)) throw new AppError('Invalid activity record.');
  const result = {actor: 'Manager account', action: input.action, collection: input.collection, readAt: null};
  for (const key of ['id', 'recordId', 'title', 'siteId', 'siteName', 'summary', 'createdAt', 'jobId', 'unit']) {
    if (input[key] === undefined && ['jobId', 'unit'].includes(key)) continue;
    if (typeof input[key] !== 'string' || input[key].length > 200 || ['id', 'recordId', 'createdAt'].includes(key) && !input[key]) throw new AppError('Invalid activity record.');
    result[key] = input[key];
  }
  if (!Number.isFinite(Date.parse(result.createdAt))) throw new AppError('Invalid activity date.');
  if (input.quantity !== undefined) {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new AppError('Invalid activity quantity.');
    result.quantity = input.quantity;
  }
  return result;
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
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection, id)); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS activity (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, data TEXT NOT NULL);');
  db.exec("CREATE INDEX IF NOT EXISTS activity_unread ON activity(sequence) WHERE json_extract(data, '$.readAt') IS NULL");
  const find = db.prepare('SELECT data FROM records WHERE collection = ? AND id = ?');
  const list = db.prepare('SELECT data FROM records WHERE collection = ? ORDER BY rowid');
  const upsert = db.prepare('INSERT INTO records (collection, id, data) VALUES (?, ?, ?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data');
  const getMeta = db.prepare('SELECT value FROM metadata WHERE key = ?');
  const setMeta = db.prepare('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const insertActivity = db.prepare('INSERT INTO activity(id,data) VALUES (?,?)');
  const appendActivity = value => { if (value) insertActivity.run(value.id, JSON.stringify(value)); };
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const store = {
    db,
    close: () => db.close(),
    list(collection) { return list.all(collection).map(row => JSON.parse(row.data)); },
    get(collection, id) { const row = find.get(collection, id); return row ? JSON.parse(row.data) : undefined; },
    put(collection, input, {activity} = {}) {
      validate(collection, input);
      const record = { ...input, id: input.id || randomUUID() };
      const event = activityData(activity);
      const save = () => { upsert.run(collection, record.id, JSON.stringify(record)); appendActivity(event); return record; };
      return event ? transaction(save) : save();
    },
    update(collection, id, input, actor = 'Owner', {expected, activity} = {}) {
      const event = activityData(activity);
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
        appendActivity(event);
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
    assistantConversations(role, {offset = 0} = {}) {
      const prefix = assistantConversationKey(role);
      assistantConversationOffset(offset);
      const items = db.prepare("SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.title') AS title, json_extract(value, '$.updatedAt') AS updatedAt, json_extract(value, '$.version') AS version, json_array_length(json_extract(value, '$.messages')) AS messageCount FROM metadata WHERE key LIKE ? ORDER BY json_extract(value, '$.updatedAt') DESC, key DESC LIMIT 50 OFFSET ?").all(`${prefix}%`, offset).map(assistantConversationSummary);
      const total = db.prepare('SELECT count(*) AS count FROM metadata WHERE key LIKE ?').get(`${prefix}%`).count;
      return {items, total, nextOffset: offset + items.length < total ? offset + items.length : null};
    },
    assistantConversation(role, id) {
      const row = getMeta.get(assistantConversationKey(role, id));
      return row ? assistantConversationResult(JSON.parse(row.value)) : undefined;
    },
    appendAssistantExchange(role, id, input) {
      const key = assistantConversationKey(role, id), exchange = assistantExchangeInput(input);
      return transaction(() => {
        const previous = store.assistantConversation(role, id);
        const next = nextAssistantConversation(id, exchange, previous);
        if (!next.unchanged) setMeta.run(key, JSON.stringify(next.value));
        return next.value;
      });
    },
    isSessionRevoked(key, now = Date.now()) {
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(now) || now < 0) throw new AppError('Invalid session reference.');
      const row = getMeta.get(`session-revoked:${key}`);
      if (!row) return false;
      const value = JSON.parse(row.value);
      if (!Number.isSafeInteger(value?.expiresAt) || value.expiresAt < 0) throw new AppError('Session verification is temporarily unavailable.', 503);
      return value.expiresAt > now;
    },
    revokeSession(key, expiresAt, now = Date.now()) {
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= now) throw new AppError('Invalid session reference.');
      return transaction(() => {
        db.prepare("DELETE FROM metadata WHERE key LIKE 'session-revoked:%' AND json_extract(value, '$.expiresAt') <= ?").run(now);
        const reference = `session-revoked:${key}`;
        const previous = getMeta.get(reference);
        const previousExpiry = previous ? JSON.parse(previous.value)?.expiresAt : 0;
        if (!Number.isSafeInteger(previousExpiry) || previousExpiry < 0) throw new AppError('Session verification is temporarily unavailable.', 503);
        setMeta.run(reference, JSON.stringify({expiresAt: Math.max(expiresAt, previousExpiry)}));
      });
    },
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
    stock(id, quantity, { type = 'use', jobId = '', note = '', actor = 'Owner', activity } = {}) {
      if (!Number.isFinite(quantity) || quantity <= 0) throw new AppError('Quantity must be greater than zero.');
      if (!['use', 'restock'].includes(type)) throw new AppError('Unknown stock operation.');
      if (jobId && !store.get('jobs', jobId)) throw new AppError('Choose an existing job.');
      text(note, 'Note');
      const event = activityData(activity);
      return transaction(() => {
        const item = store.get('inventory', id);
        if (!item) throw new AppError('Inventory item not found.', 404);
        if (type === 'use' && quantity > item.quantity) throw new AppError(`Only ${item.quantity} ${item.unit || 'units'} available.`, 409);
        const next = store.put('inventory', { ...item, quantity: Number((item.quantity + (type === 'use' ? -quantity : quantity)).toFixed(4)) });
        const movement = store.put('stockMovements', { id: randomUUID(), inventoryId: id, itemName: item.name, type, quantity, jobId, note, actor, date: new Date().toISOString(), balance: next.quantity, unitCost: item.cost || 0, totalCost: type === 'use' ? quantity * (item.cost || 0) : 0 });
        appendActivity(event);
        return { item: next, movement };
      });
    },
    activityFeed(limit = 50) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('Choose an activity limit from 1 to 100.');
      return {items: db.prepare('SELECT data FROM activity ORDER BY sequence DESC LIMIT ?').all(limit).map(row => JSON.parse(row.data)), unreadCount: db.prepare("SELECT count(*) AS count FROM activity WHERE json_extract(data, '$.readAt') IS NULL").get().count};
    },
    readActivity(id) {
      const row = db.prepare("UPDATE activity SET data = json_set(data, '$.readAt', coalesce(json_extract(data, '$.readAt'), ?)) WHERE id = ? RETURNING data").get(new Date().toISOString(), id);
      if (!row) throw new AppError('Activity not found.', 404);
      return JSON.parse(row.data);
    },
    readAllActivity() {
      db.prepare("UPDATE activity SET data = json_set(data, '$.readAt', ?) WHERE json_extract(data, '$.readAt') IS NULL").run(new Date().toISOString());
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
