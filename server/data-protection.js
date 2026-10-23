import {AppError} from './store.js';

/** Owner-visible checks report verified configuration, never company data. */
export function installDataProtection(app, {store, mediaStorage}) {
  app.get('/api/data-protection', async (req, res, next) => {
    try {
      if (req.role !== 'owner') throw new AppError('Data protection checks are available to the business owner only.', 403);
      let status;
      if (typeof store.dataProtection === 'function') status = await store.dataProtection();
      else {
        if (mediaStorage) throw new AppError('Hosted database protection could not be verified. Please try again.', 503);
        if (typeof store.health === 'function') await store.health();
        else await store.settings();
        status = {storage: 'sqlite', database: 'connected', rls: null};
      }
      if (!['postgres', 'sqlite'].includes(status?.storage) || status.database !== 'connected') throw new AppError('Storage status could not be verified. Please try again.', 503);
      const rls = status.rls;
      if (status.storage === 'postgres' && (!rls || typeof rls.enabled !== 'boolean' || typeof rls.browserAccessBlocked !== 'boolean' || !Number.isSafeInteger(rls.protectedTables) || !Number.isSafeInteger(rls.totalTables) || rls.totalTables < 1 || rls.protectedTables < 0 || rls.protectedTables > rls.totalTables)) throw new AppError('Database protection could not be verified. Please try again.', 503);
      res.set('Cache-Control', 'private, no-store').vary('Cookie').json({
        checkedAt: new Date().toISOString(), storage: status.storage, database: status.database,
        durableMedia: status.storage === 'postgres' && Boolean(mediaStorage),
        rls: status.storage === 'postgres' ? {enabled: rls.enabled, protectedTables: rls.protectedTables, totalTables: rls.totalTables, browserAccessBlocked: rls.browserAccessBlocked} : null,
        // Provider backup retention/PITR are account settings; a database read
        // cannot establish that they are enabled or that a restore was tested.
        backups: 'unverified',
      });
    } catch (error) {next(error);}
  });
}
