# Reliability and access review — 23 October 2026

This review covers workspace recovery, unified Sites, financial features being temporarily disabled, and the owner’s manager activity inbox. Tests use isolated company data and injected failures; they do not establish that every possible failure has been eliminated.

## Changes

- Shared server configuration uses plain JavaScript so Vercel can package its runtime imports correctly. The production smoke check imports the cloud entry point with TypeScript stripping disabled, catching the dependency issue found during live release verification.

- Sites brings project work, maintenance, inspections, photos, follow-ups and service reports together. Existing site/job records and legacy links remain usable.
- Money features are disabled for both roles in the interface, API responses and assistant proposals. Financial records and hidden nested metadata remain stored; operational edits cannot erase those values.
- Manager operational saves and the owner’s activity event commit together. Private activity has owner-only reads, persistent read receipts and an unread count. The browser refreshes every 30 seconds while visible and clears activity when the session changes.
- Site visits append atomically using stable visit IDs. Concurrent visits are retained, repeated successful submissions are deduplicated, and ambiguous connection failures do not trigger a repeated write. Only confirmed, uncommitted compare-and-swap conflicts are retried.
- Record edits from the current app send their opening/last-loaded snapshot. The server compares the role-visible snapshot, then checks the complete stored snapshot under its write lock. Stale checklists and old inventory forms cannot undo newer work or stock deductions. Legacy direct API writes that omit `_expected` retain their existing unconditional behavior; they do not gain stale-client protection.

- Interrupted response streams, body timeouts and truncated temporary-error responses allow automatic workspace recovery. Invalid successful responses still show an error instead of becoming an empty company workspace.
- Known PostgreSQL reads retry one temporary connection failure. Writes and paid generation requests are never replayed automatically; a response can be lost after a save commits.
- Failed cloud initialization releases its database pool, preventing repeated startup failures from leaking Supabase connections.
- Manager updates compare the authorized record inside the database write lock. Delayed edits cannot reverse an owner approval, change a newly protected project deadline, or restore outdated private task metadata.
- Owner and manager password-attempt limits are isolated and stored atomically in the private database. Signing in to one role cannot clear the other's failures, and a fresh Vercel instance cannot reset the limit. Counters use HMAC keys instead of storing raw IP addresses or passwords.

## Verification scope

Regression tests use temporary SQLite databases, embedded PostgreSQL, injected connection failures and browser workflows. They cover recovery, stock deductions after a lost response, role boundaries, concurrent edits and sign-in isolation. Provider requests in automated studio and assistant tests are mocked.

Release checks passed: `npm run build`, all 138 tests in `npm test`, the complete 12-script `npm run test:browser` suite, and `npm run test:production`. `npm audit` reported no known dependency vulnerabilities at the time of this review.

Public production checks confirm site assets, the sign-in screen, a current database health read and rejection of unauthenticated workspace access. They do not verify authenticated company records, paid image generation, API billing, or Supabase dashboard settings and backups.

## Operational limits

Supabase, Vercel and internet availability can still interrupt service. Recovery cannot fix invalid credentials, a paused/deleted project or a provider outage. No review establishes that software is free of all security risks.

Access currently uses shared owner and manager passwords, rather than individual staff identities or multifactor authentication. Signing out clears the browser cookie; an already copied session cookie remains usable until its 12-hour expiry or a password change. Keep passwords distinct and private, and use the provider accounts' own security and backup controls.
