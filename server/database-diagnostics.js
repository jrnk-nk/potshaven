const databaseDiagnostics = {
  AUTHENTICATION_FAILED: 'Supabase rejected the database credentials. Check the database password and pooler username in DATABASE_URL, then redeploy.',
  POOLER_PROJECT_NOT_FOUND: 'Supabase could not find the project for this pooler connection. Copy the Transaction Pooler connection string from the correct Supabase project, then redeploy.',
  DATABASE_HOST_NOT_FOUND: 'The database hostname could not be found. Check that DATABASE_URL contains the complete Supabase Transaction Pooler hostname, then redeploy.',
  DATABASE_CONNECTION_TIMEOUT: 'A connection to the database could not be established. Check that the Supabase project is active and DATABASE_URL uses the Transaction Pooler hostname and port 6543.',
  DATABASE_CONNECTION_LOST: 'The database connection was interrupted. Check the Supabase project is active, then try reconnecting to your workspace.',
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
export function databaseDiagnostic(error) {
  const seen = new Set();
  for (let depth = 0; depth < 4 && error && typeof error === 'object' && !seen.has(error); depth++) {
    seen.add(error);
    const code = error.code;
    if (code === '28P01' || code === '28000') return 'AUTHENTICATION_FAILED';
    if (code === 'XX000' && typeof error.message === 'string' && /tenant or user not found|tenant not found|user not found/i.test(error.message.slice(0, 200))) return 'POOLER_PROJECT_NOT_FOUND';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DATABASE_HOST_NOT_FOUND';
    if (['CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNREFUSED'].includes(code)) return 'DATABASE_CONNECTION_TIMEOUT';
    if (['ECONNRESET', 'EPIPE', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED', '57P01', '57P02', '57P03'].includes(code) || (typeof code === 'string' && /^08[0-9A-Z]{3}$/.test(code))) return 'DATABASE_CONNECTION_LOST';
    if (tlsErrorCodes.has(code)) return 'DATABASE_TLS_ERROR';
    if (code === '42501') return 'DATABASE_ACCESS_DENIED';
    if (code === 'WORKSPACE_SCHEMA_INVALID' || (typeof code === 'string' && /^42[0-9A-Z]{3}$/.test(code))) return 'DATABASE_INITIALIZATION_FAILED';
    error = error.cause;
  }
  return 'UNKNOWN';
}

export function databaseFailure(error) {
  const diagnostic = databaseDiagnostic(error);
  return {error: databaseDiagnostics[diagnostic], code: 'DATABASE_UNAVAILABLE', diagnostic};
}
