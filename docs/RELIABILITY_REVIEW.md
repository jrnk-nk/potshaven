# Reliability and access review — 23 October 2026

The deployed site and its public database health check were reachable during this review. The reported workspace error could not be reproduced with an authenticated production session. Local failure injection did identify recovery and permission bugs, which this release fixes.

## Changes

- Interrupted response streams, body timeouts and truncated temporary-error responses allow automatic workspace recovery. Invalid successful responses still show an error instead of becoming an empty company workspace.
- Known PostgreSQL reads retry one temporary connection failure. Writes and paid generation requests are never replayed automatically; a response can be lost after a save commits.
- Failed cloud initialization releases its database pool, preventing repeated startup failures from leaking Supabase connections.
- Manager updates compare the authorized record inside the database write lock. Delayed edits cannot reverse an owner approval, change a newly protected project deadline, or restore outdated private task metadata.
- Owner and manager password-attempt limits are isolated and stored atomically in the private database. Signing in to one role cannot clear the other's failures, and a fresh Vercel instance cannot reset the limit. Counters use HMAC keys instead of storing raw IP addresses or passwords.

## Verification scope

Regression tests use temporary SQLite databases, embedded PostgreSQL, injected connection failures and browser workflows. They cover recovery, stock deductions after a lost response, role boundaries, concurrent edits and sign-in isolation. Provider requests in automated studio and assistant tests are mocked.

Release checks passed: `npm run build`, all 117 tests in `npm test`, the complete 11-script `npm run test:browser` suite, and `npm run test:production`. `npm audit` reported no known dependency vulnerabilities at the time of this review.

Public production checks confirm site assets, the sign-in screen, a current database health read and rejection of unauthenticated workspace access. They do not verify authenticated company records, paid image generation, API billing, or Supabase dashboard settings and backups.

## Operational limits

Supabase, Vercel and internet availability can still interrupt service. Recovery cannot fix invalid credentials, a paused/deleted project or a provider outage. No review establishes that software is free of all security risks.

Access currently uses shared owner and manager passwords, rather than individual staff identities or multifactor authentication. Signing out clears the browser cookie; an already copied session cookie remains usable until its 12-hour expiry or a password change. Keep passwords distinct and private, and use the provider accounts' own security and backup controls.
