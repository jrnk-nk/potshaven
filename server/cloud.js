import {createApp} from './app.js';
import {createPostgresStore} from './postgres-store.js';
import {createMediaStorage} from './media-storage.js';
import {databaseFailure} from './database-diagnostics.js';

export function createCloudHandler({env = process.env, connect = createPostgresStore} = {}) {
  let pendingApp;
  const setupError = (res, code, message, diagnostic) => {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({error: message, code, ...(diagnostic ? {diagnostic} : {})}));
  };
  async function initialise(connectionString) {
    const store = await connect(connectionString, {seed: false});
    const sessionSecret = await store.getSessionSecret();
    return createApp({
      store, serveClient: false, mediaStorage: createMediaStorage(store), sessionSecret,
      ownerPassword: env.APP_OWNER_PASSWORD, managerPassword: env.APP_MANAGER_PASSWORD,
      imageKey: env.POTSHAVEN_OPENAI_KEY || env.OPENAI_API_KEY || '',
      imageModel: env.POTSHAVEN_IMAGE_MODEL || env.OPENAI_IMAGE_MODEL,
      imageQuality: env.POTSHAVEN_IMAGE_QUALITY || env.OPENAI_IMAGE_QUALITY,
      imageSize: env.POTSHAVEN_IMAGE_SIZE || env.OPENAI_IMAGE_SIZE,
      assistantModel: env.POTSHAVEN_ASSISTANT_MODEL,
    });
  }
  return async function cloudHandler(req, res) {
    const connectionString = env.DATABASE_URL || env.SUPABASE_DB_URL || env.POSTGRES_URL;
    if (!connectionString) return setupError(res, 'DATABASE_NOT_CONFIGURED', 'Connect Supabase and add its Transaction Pooler connection string as DATABASE_URL in Vercel.');
    try {
      const url = new URL(connectionString);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error('Invalid database URL');
    } catch {
      return setupError(res, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL must be the private PostgreSQL Transaction Pooler connection string from Supabase, rather than the project website URL.');
    }
    if (!env.APP_OWNER_PASSWORD || !env.APP_MANAGER_PASSWORD) {
      return setupError(res, 'AUTH_NOT_CONFIGURED', 'Add private APP_OWNER_PASSWORD and APP_MANAGER_PASSWORD values in Vercel to finish setting up the owner and manager accounts.');
    }
    // Vercel rewrites explicitly preserve the requested path so API and media
    // work even if the platform presents the function's own /api/index URL.
    const original = new URL(req.url, 'http://potshaven.internal');
    const routedPath = req.query?.__potshaven_path || original.searchParams.get('__potshaven_path');
    if (typeof routedPath === 'string' && /^\/(api|media)\//.test(routedPath)) {
      original.searchParams.delete('__potshaven_path');
      req.url = routedPath + (original.searchParams.size ? `?${original.searchParams}` : '');
    }
    try {
      if (!pendingApp) pendingApp = initialise(connectionString).catch(error => { pendingApp = undefined; throw error; });
      const app = await pendingApp;
      // Express owns the response. There is no HTTP listener in a Vercel function.
      return app(req, res);
    } catch (error) {
      // Connection errors can contain credentials. Return safe guidance only.
      const failure = databaseFailure(error);
      return setupError(res, failure.code, failure.error, failure.diagnostic);
    }
  };
}
