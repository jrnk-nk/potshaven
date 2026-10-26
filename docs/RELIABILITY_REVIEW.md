# Reliability and access review — 26 October 2026

This review covers the Company assistant upgrade, an isolated business handoff and recovery drill, workspace security, unified Sites and the owner’s manager activity inbox. Tests use isolated company data and injected failures; they do not establish that every possible failure has been eliminated.

## Changes

- Owner account protection adds password-length/separation checks and password-confirmed sign-out of every device for a selected role. Private session generations are checked on every authenticated API/media request; legacy cookies default to generation zero. Database failures fail closed. Sign-out controls do not enable MFA or identify individual staff.
- Provider admission, request receipts, capacity and rate limits now live in the shared protected database. Two app instances cannot independently admit the same request or concurrent conversation. Expired leases never authorize repeating an uncertain request ID.
- Studio request recovery uses a stable allocated design ID to find committed work after lost save responses. The browser can check status after reload without another paid call. Exact explicit retries retain the original ID/body; separate requests require a deliberate choice. Provider errors no longer present uncertain saves as confirmed generation failures.
- GitHub checks use immutable action pins, a high-severity production dependency gate and fixture-only failure artifacts. Weekly dependency update proposals are enabled. Branch-protection and deployment-gate settings remain outside repository verification.

- Company assistant conversations are stored privately per account role in the existing protected metadata table. Completed replies save on the server before the response. Stable exchange IDs and atomic version checks protect retries and concurrent edits; reopening history never restores executable proposals. Older conversations remain available through pagination. Drafts are not saved, and persistence errors remain visible.
- Site-focused planning and name relevance improve retrieval beyond the first 80 records, while explicit context coverage avoids implying that a bounded reply reviewed every record. Recent visit text, equipment and permitted supply requests support planning. Photos are not analysed by this assistant.
- Priority alerts include upcoming work, cross-site assignments, equipment servicing, urgent follow-ups and pending supplies. The attention list refreshes every minute while visible and on focus without a paid model call. Work-plan previews preserve assignment warnings from other sites; WhatsApp delivery remains manual.
- New supply proposals are pending requests requiring positive quantities and valid references. They never approve supplies, order items or change stock. Business mutations still require explicit review and ordinary server permission checks.
- An owner-only connection check makes a short real provider request without company records. Configured credentials alone are not reported as verified provider access.
- A real HTTP/PostgreSQL handoff test exercises owner setup, manager work and owner review, then restarts and restores a separate disposable database. The restored copy preserves photos, conversations, stock history, inbox read receipts and RLS. This tests application recovery logic, not the live Supabase backup schedule.
- Manual operator tooling streams a complete private-schema dump into authenticated encryption and refuses to overwrite existing files or place backups in the repository. Decryption never restores a database. Production account access is still needed to create and verify a live recovery copy.

- Supabase schema migration 4 enables default-deny RLS on all app tables, removes browser-role grants and retains backend authorization. An owner-only check reports actual storage and access protection; backup schedules remain unverified without Supabase account access.
- Browser headers block framing and unsafe base/form redirects while preserving camera uploads and photo reports. A real browser regression confirms an unrelated website cannot embed the workspace.
- Server-side session revocation prevents a signed-out cookie being reused on API or private media routes. Session checks fail closed when revocation status cannot be read.

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

Release checks passed: `npm run build`, 217 tests in the complete `npm test` run, the complete 16-script `npm run test:browser` suite (including 21 assistant, six account-protection and five studio-recovery scenarios), and `npm run test:production`. `npm audit` reported no known dependency vulnerabilities at the time of this review.

Public production checks cover site assets, the sign-in screen, a current database health read and rejection of unauthenticated workspace access. They do not verify authenticated company records, paid image generation, API billing, or Supabase dashboard settings and backups.

## Operational limits

Supabase, Vercel and internet availability can still interrupt service. Recovery cannot fix invalid credentials, a paused/deleted project or a provider outage. No review establishes that software is free of all security risks.

Access currently uses shared owner and manager passwords, rather than individual staff identities or multifactor authentication. Successful sign-out now revokes that session in the private database before clearing its cookie; copied cookies from the revoked session are rejected. Other sessions retain their original expiry unless passwords are rotated. Keep passwords distinct and private, and use the provider accounts' own security and backup controls.
