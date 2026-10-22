import {getCACertificates} from 'node:tls';
import {SUPABASE_DATABASE_CA_CERTIFICATES} from './supabase-ca.js';

export function databaseTlsOptions(connectionString) {
  const hostname = new URL(connectionString).hostname.toLowerCase();
  const supabase = hostname.endsWith('.pooler.supabase.com') || /^db\.[a-z0-9-]+\.supabase\.co$/.test(hostname);
  // Supabase signs database certificates with its own production roots, which
  // are absent from Node's default public CA list. Preserve the existing trust
  // store and hostname verification while adding those roots for Supabase.
  return {
    rejectUnauthorized: true,
    ...(supabase ? {ca: [...getCACertificates('default'), ...SUPABASE_DATABASE_CA_CERTIFICATES]} : {}),
  };
}
