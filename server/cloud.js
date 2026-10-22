import {createApp} from './app.js';
import {createPostgresStore} from './postgres-store.js';
import {createMediaStorage} from './media-storage.js';

const databaseDiagnostics = {
  AUTHENTICATION_FAILED: 'Supabase rejected the database credentials. Check the database password and pooler username in DATABASE_URL, then redeploy.',
  POOLER_PROJECT_NOT_FOUND: 'Supabase could not find the project for this pooler connection. Copy the Transaction Pooler connection string from the correct Supabase project, then redeploy.',
  DATABASE_HOST_NOT_FOUND: 'The database hostname could not be found. Check that DATABASE_URL contains the complete Supabase Transaction Pooler hostname, then redeploy.',
  DATABASE_CONNECTION_TIMEOUT: 'A connection to the database could not be established. Check that the Supabase project is active and DATABASE_URL uses the Transaction Pooler hostname and port 6543.',
  DATABASE_TLS_ERROR: 'The database certificate could not be verified or a secure connection could not be established. Check the Supabase connection settings and trusted certificate configuration.',
  DATABASE_ACCESS_DENIED: 'The database connection does not have permission to initialize this workspace. Use the database credentials from the Supabase project Connect panel.',
  DATABASE_INITIALIZATION_FAILED: 'The database was reached, but the workspace tables could not be initialized. The application database setup needs investigation.',
  UNKNOWN: 'The database could not be reached. Check the Supabase project is active and DATABASE_URL uses the Transaction Pooler, then try again.',
};
const tlsErrorCodes = new Set([
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'CERT_SIGNATURE_FAILURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]);

// Return only fixed classifications. Driver errors can contain credentials,
// SQL, and hostnames, so neither their text nor their raw codes leave here.
function databaseDiagnostic(error) {
  const seen = new Set();
  for (let depth = 0; depth < 4 && error && typeof error === 'object' && !seen.has(error); depth++) {
    seen.add(error);
    const code = error.code;
    if (code === '28P01' || code === '28000') return 'AUTHENTICATION_FAILED';
    if (code === 'XX000' && typeof error.message === 'string' && /tenant or user not found|tenant not found|user not found/i.test(error.message.slice(0, 200))) return 'POOLER_PROJECT_NOT_FOUND';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DATABASE_HOST_NOT_FOUND';
    if (['CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNREFUSED'].includes(code)) return 'DATABASE_CONNECTION_TIMEOUT';
    if (tlsErrorCodes.has(code)) return 'DATABASE_TLS_ERROR';
    if (code === '42501') return 'DATABASE_ACCESS_DENIED';
    if (typeof code === 'string' && /^42[0-9A-Z]{3}$/.test(code)) return 'DATABASE_INITIALIZATION_FAILED';
    error = error.cause;
  }
  return 'UNKNOWN';
}

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
      const diagnostic = databaseDiagnostic(error);
      return setupError(res, 'DATABASE_UNAVAILABLE', databaseDiagnostics[diagnostic], diagnostic);
    }
  };
}
