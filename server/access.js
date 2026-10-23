import {AppError, collections} from './store.js';

const own = (value, key) => Object.hasOwn(value, key);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const pick = (record, keys) => Object.fromEntries(keys.filter(key => own(record, key)).map(key => [key, record[key]]));
const forbidden = () => new AppError('This action is available to the business owner only.', 403);
const managerCollections = new Set(['places', 'jobs', 'inventory', 'stockMovements', 'workers', 'vehicles', 'purchaseRequests', 'equipment', 'issues', 'careGuides']);
const managerSettings = ['companyName', 'tagline', 'logo', 'accentColor', 'currency', 'phone', 'email'];
const fields = {
  places: ['id', 'name', 'client', 'address', 'phone', 'type', 'measurements', 'image', 'notes', 'inspections', 'createdAt', 'updatedAt'],
  jobs: ['id', 'title', 'placeId', 'date', 'time', 'deadline', 'status', 'type', 'crewIds', 'vehicleId', 'tasks', 'notes', 'photos', 'completionPhotos', 'completedAt', 'routeOrder', 'recurrence', 'previousJobId', 'nextJobId', 'createdAt', 'updatedAt'],
  inventory: ['id', 'name', 'category', 'quantity', 'unit', 'minStock', 'image', 'notes', 'scientificName', 'location', 'createdAt', 'updatedAt'],
  stockMovements: ['id', 'inventoryId', 'itemName', 'type', 'quantity', 'change', 'jobId', 'note', 'actor', 'date', 'balance', 'unit'],
  workers: ['id', 'name', 'role', 'phone', 'skills', 'available', 'workforceType', 'engagementType', 'engagementStart', 'engagementEnd', 'relatedJobId', 'image'],
  vehicles: ['id', 'name', 'registration', 'plate', 'capacity', 'status', 'notes', 'image'],
  purchaseRequests: ['id', 'title', 'quantity', 'estimatedCost', 'status', 'requestedBy', 'date', 'notes', 'requestType', 'category', 'jobId', 'placeId', 'image', 'photos', 'receiptReference', 'createdAt', 'updatedAt'],
  equipment: ['id', 'name', 'type', 'status', 'assignedTo', 'lastService', 'nextService', 'nextServiceDate', 'notes', 'image'],
  issues: ['id', 'title', 'placeId', 'type', 'priority', 'status', 'date', 'description', 'notes', 'assignedTo', 'followUpDate', 'photos', 'image', 'createdAt', 'updatedAt'],
  careGuides: ['id', 'name', 'inventoryId', 'watering', 'light', 'pruning', 'feeding', 'notes', 'image'],
};
const writable = {
  places: ['name', 'client', 'address', 'phone', 'type', 'measurements', 'image', 'notes', 'inspections'],
  jobs: ['title', 'placeId', 'date', 'time', 'deadline', 'status', 'type', 'crewIds', 'vehicleId', 'notes', 'tasks', 'photos', 'completionPhotos', 'completedAt', 'routeOrder', 'recurrence'],
  workers: ['available'],
  vehicles: ['status', 'notes'],
  issues: ['title', 'placeId', 'type', 'priority', 'status', 'date', 'description', 'notes', 'assignedTo', 'followUpDate', 'photos', 'image'],
  purchaseRequests: ['title', 'quantity', 'estimatedCost', 'date', 'notes', 'requestType', 'category', 'jobId', 'placeId', 'image', 'photos', 'receiptReference', 'status', 'requestedBy'],
};
const nested = {
  tasks: ['id', 'text', 'title', 'done'],
  photos: ['id', 'image', 'url', 'caption', 'date', 'takenAt', 'createdAt'],
  completionPhotos: ['id', 'image', 'url', 'caption', 'date', 'takenAt', 'createdAt'],
  inspections: ['id', 'date', 'plantHealth', 'irrigation', 'workNeeded', 'notes', 'photos', 'image'],
};
const numberFields = new Set(['quantity', 'estimatedCost', 'routeOrder', 'minStock', 'change', 'balance']);
const stringArrays = new Set(['crewIds', 'skills']);
const dateFields = new Set(['date', 'deadline', 'followUpDate']);
const validDate = value => value === '' || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const readonlyEcho = ['id', 'createdAt', 'updatedAt', 'previousJobId', 'nextJobId'];
export const isManagerRequest = record => typeof record?.requestedBy === 'string' && record.requestedBy.toLowerCase() === 'manager';
export const canReadCollection = (role, collection) => role === 'owner' || role === 'manager' && managerCollections.has(collection);

function safeLeaf(value) {return value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value);}
function nestedRecord(value, key) {
  if (Array.isArray(value)) return value.map(item => nestedRecord(item, key)).filter(item => item !== undefined);
  if (!object(value)) return safeLeaf(value) ? value : undefined;
  if (!nested[key]) return undefined;
  return Object.fromEntries(Object.entries(pick(value, nested[key])).filter(([name, item]) => nested[name] || safeLeaf(item)).map(([name, item]) => [name, nested[name] ? nestedRecord(item, name) : item]));
}

export function recordForRole(collection, record, role) {
  if (!record || role === 'owner') return record;
  if (!canReadCollection(role, collection) || collection === 'purchaseRequests' && !isManagerRequest(record)) return undefined;
  return Object.fromEntries(Object.entries(pick(record, fields[collection])).filter(([key, value]) => nested[key] && Array.isArray(value) || stringArrays.has(key) && Array.isArray(value) || safeLeaf(value)).map(([key, value]) => [key, nested[key] ? nestedRecord(value, key) : stringArrays.has(key) ? value.filter(item => typeof item === 'string') : value]));
}

export function collectionForRole(collection, records, role) {
  if (role === 'owner') return records;
  if (!canReadCollection(role, collection)) return [];
  return records.map(record => recordForRole(collection, record, role)).filter(Boolean);
}

export function workspaceForRole(state, role) {
  if (role === 'owner') return state;
  const result = Object.fromEntries(collections.map(collection => [collection, collectionForRole(collection, Array.isArray(state[collection]) ? state[collection] : [], role)]));
  result.settings = Object.fromEntries(Object.entries(pick(object(state.settings) ? state.settings : {}, managerSettings)).filter(([, value]) => safeLeaf(value)));
  return result;
}

function assertNested(value, key) {
  if (!Array.isArray(value)) throw new AppError('Tasks, photos, and inspections must be lists.');
  for (const item of value) {
    if (typeof item === 'string' && key !== 'inspections') continue;
    if (!object(item) || Object.keys(item).some(name => !nested[key].includes(name))) throw forbidden();
    for (const [name, child] of Object.entries(item)) {
      if (nested[name]) {assertNested(child, name); continue;}
      if (name === 'done' ? typeof child !== 'boolean' : typeof child !== 'string') throw new AppError('Use valid text and checkbox values in tasks, photos, and inspections.');
    }
  }
}

/** Both ordinary CRUD and assistant proposals share the same write boundary. */
export function authorizeMutation(role, collection, operation, payload = {}, existing) {
  if (role === 'owner') return payload;
  if (role !== 'manager' || operation === 'delete' || !writable[collection] || !['create', 'update'].includes(operation)) throw forbidden();
  if (operation === 'create' && ['workers', 'vehicles'].includes(collection)) throw forbidden();
  if (!object(payload)) throw new AppError('A record object is required.');
  if (collection === 'purchaseRequests') {
    if (existing && (!isManagerRequest(existing) || existing.status !== 'Pending')) throw forbidden();
    if (payload.status !== undefined && payload.status !== 'Pending') throw forbidden();
    if (payload.requestedBy !== undefined && (typeof payload.requestedBy !== 'string' || payload.requestedBy.toLowerCase() !== 'manager')) throw forbidden();
  }
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (readonlyEcho.includes(key) && existing && JSON.stringify(value) === JSON.stringify(existing[key])) continue;
    if (!writable[collection].includes(key)) throw forbidden();
    if (nested[key]) assertNested(value, key);
    else if (stringArrays.has(key)) {if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new AppError('Choose existing people for this assignment.');}
    else if (numberFields.has(key)) {if (typeof value !== 'number' || !Number.isFinite(value)) throw new AppError('Use a valid number.');}
    else if (key === 'available') {if (typeof value !== 'boolean') throw new AppError('Choose available or unavailable.');}
    else if (key === 'completedAt' && value === null) {/* Reopening a job clears its timestamp. */}
    else if (typeof value !== 'string') throw new AppError('Use text for this field.');
    if (dateFields.has(key) && !validDate(value)) throw new AppError('Choose a valid date.');
    result[key] = value;
  }
  if (collection === 'jobs') {
    if ((operation === 'create' && (result.type || 'Maintenance') !== 'Maintenance') || (existing && result.type !== undefined && result.type !== existing.type)) throw forbidden();
    if (existing?.type === 'Project' && result.deadline !== undefined && result.deadline !== existing.deadline) throw forbidden();
    if (existing?.type === 'Project') delete result.deadline;
  }
  if (collection === 'workers' && typeof result.available !== 'boolean') throw new AppError('Choose available or unavailable.');
  if (collection === 'vehicles' && result.status !== undefined && !['Available', 'In use', 'Servicing', 'Unavailable'].includes(result.status)) throw new AppError('Choose a valid vehicle status.');
  if (collection === 'purchaseRequests' && operation === 'create') Object.assign(result, {status: 'Pending', requestedBy: 'manager'});
  return result;
}

/** Read access follows explicit references in operational records, not filenames. */
export function mediaPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') && !/^https?:\/\//.test(value)) return '';
  try {const path = new URL(value, 'https://potshaven.invalid').pathname; return path.startsWith('/media/') ? path : '';} catch {return '';}
}
export function referencedMedia(state) {
  const result = new Set();
  const visit = value => {
    if (typeof value === 'string') {const path = mediaPath(value); if (path) result.add(path);}
    else if (Array.isArray(value)) value.forEach(visit);
    else if (object(value)) Object.values(value).forEach(visit);
  };
  visit(state);
  return result;
}
export function assertMediaReferences(payload, allowed) {
  for (const path of referencedMedia(payload)) if (!allowed.has(path)) throw forbidden();
}


/** Preserve private metadata on matching operational subrecords during manager edits. */
export function preserveOperationalMetadata(payload, previous) {
  if (!previous) return payload;
  const identity = (item, key) => {
    if (typeof item === 'string') return item;
    if (!object(item)) return '';
    return key === 'tasks' ? item.id || item.text || item.title || '' : key === 'inspections' ? item.id || '' : item.image || item.url || item.id || '';
  };
  const result = {...payload};
  for (const key of Object.keys(nested)) {
    if (!Array.isArray(payload[key]) || !Array.isArray(previous[key])) continue;
    result[key] = payload[key].map(item => {
      const id = identity(item, key);
      const matches = id ? previous[key].filter(old => identity(old, key) === id) : [];
      if (matches.length !== 1 || !object(matches[0])) return item;
      if (typeof item === 'string') return matches[0];
      return preserveOperationalMetadata({...matches[0], ...item}, matches[0]);
    });
  }
  return result;
}
