import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {AppError, activityData} from './store.js';

const text = value => typeof value === 'string' ? value.slice(0, 200) : '';
const names = {places: 'site', jobs: 'job', inventory: 'stock item', workers: 'worker availability', vehicles: 'vehicle', purchaseRequests: 'supply request', issues: 'site issue'};

/** Build only operational facts, before the mutation that commits this event. */
export async function managerActivity(store, {role, collection, operation, record, previous, quantity, jobId} = {}) {
  if (role !== 'manager' || !Object.hasOwn(names, collection) || !record?.id) return undefined;
  if (operation === 'update' && isDeepStrictEqual(record, previous)) return undefined;
  let action = operation === 'create' ? 'created' : 'updated';
  let summary = `${operation === 'create' ? 'Created' : 'Updated'} ${names[collection]}`;
  if (collection === 'jobs') {
    if (record.status === 'Completed' && previous?.status !== 'Completed') {
      action = 'completed'; summary = record.type === 'Maintenance' ? 'Completed a maintenance visit' : 'Completed a job';
    } else if (previous && (!isDeepStrictEqual(record.crewIds, previous.crewIds) || record.vehicleId !== previous.vehicleId)) {
      action = 'assigned'; summary = 'Updated people or transport assigned to a job';
    } else if (previous && !isDeepStrictEqual(record.tasks, previous.tasks)) summary = 'Updated a job checklist';
  } else if (collection === 'places' && previous && !isDeepStrictEqual(record.inspections, previous.inspections)) {
    action = 'visit_recorded'; summary = 'Recorded or updated a site visit';
  } else if (collection === 'inventory' && operation === 'use') {
    action = 'stock_used'; summary = 'Recorded stock used on a job';
  }
  const linkedJobId = text(jobId || record.jobId || (collection === 'jobs' ? record.id : ''));
  const job = linkedJobId && collection !== 'jobs' ? await store.get('jobs', linkedJobId) : collection === 'jobs' ? record : null;
  const siteId = text(collection === 'places' ? record.id : record.placeId || job?.placeId || '');
  const site = siteId ? collection === 'places' ? record : await store.get('places', siteId) : null;
  return activityData({
    id: randomUUID(), actor: 'Manager account', action, collection,
    recordId: text(record.id), title: text(record.name || record.title || names[collection]),
    siteId, siteName: text(site?.name), summary, createdAt: new Date().toISOString(),
    ...(linkedJobId ? {jobId: linkedJobId} : {}),
    ...(action === 'stock_used' ? {quantity, unit: text(record.unit || 'units')} : {}),
  });
}

export function installActivity(app, {store}) {
  const owner = (req, res, next) => req.role === 'owner' ? next() : next(new AppError('Activity updates are available to the business owner only.', 403));
  app.get('/api/activity', owner, async (req, res, next) => {
    try {
      const raw = req.query.limit;
      if (raw !== undefined && (typeof raw !== 'string' || !/^\d{1,3}$/.test(raw))) throw new AppError('Choose an activity limit from 1 to 100.');
      res.json(await store.activityFeed(raw === undefined ? 50 : Number(raw)));
    } catch (error) { next(error); }
  });
  app.post('/api/activity/read-all', owner, async (req, res, next) => {
    try { await store.readAllActivity(); res.json({ok: true}); }
    catch (error) { next(error); }
  });
  app.post('/api/activity/:id/read', owner, async (req, res, next) => {
    try { res.json({item: await store.readActivity(req.params.id)}); }
    catch (error) { next(error); }
  });
}
