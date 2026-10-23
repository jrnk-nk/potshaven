# PotsHaven data protection and recovery

The hosted app saves company data in its connected Supabase PostgreSQL database. Storage persistence, access controls, and recovery backups solve different problems. A successful database check does not prove that backups exist or that no data can ever be lost.

## What is saved

| Information | Hosted storage |
| --- | --- |
| Sites, jobs, visits, checklists, team, vehicles, stock and stock history | `potshaven_private.records` |
| Saved design conversations and their links to images | `potshaven_private.records` |
| Uploaded site/plant/completion/branding photos and generated designs | Image bytes in `potshaven_private.media` |
| Owner inbox updates and read receipts | `potshaven_private.activity` |
| Company settings, session signing secret, sign-in limits and session revocations | `potshaven_private.metadata` |

Vercel does not fall back to a temporary SQLite database when the configured database fails. A failed save reports an error. Local development and the separate SQLite hosting option use local database/image files instead; those files need their own backups.

Unsent form drafts and attached photos have not been saved. The Company assistant's discussion is temporary; changes accepted through **Save this change** are stored with the company records. Studio messages and images that have been successfully generated are saved. An image URL pointing to another website remains a link; uploading the actual picture is what stores its bytes in the database.

Private database connection strings, role passwords and the OpenAI API key are server environment settings in Vercel. They are not browser configuration or company database records. Retain them separately in an appropriate password manager; never put them in Git or chat.

## Access protection

Schema version 4 enables row-level security (RLS) on all four private tables. There are no browser-access policies: unprivileged database roles are denied by default. Schema, table, column, sequence and function privileges are revoked from `PUBLIC` and the existing Supabase `anon`, `authenticated` and `service_role` roles. Application objects stay in `potshaven_private`, outside the app's browser API.

The trusted backend connects as the database/table owner and intentionally bypasses RLS. Owner and manager sessions are application roles, not Supabase Auth users. The backend therefore still checks every API and media request, filters private fields, and rejects unauthorized writes. RLS alone would not separate the app's owner and manager; it adds protection against direct database access. A stolen privileged database connection can bypass RLS, so keep `DATABASE_URL` private.

A successful sign-out now records an opaque session revocation in the database before clearing the browser cookie. Reusing that signed cookie cannot reopen API records or private photos. Other devices stay signed in. Password rotation invalidates all existing sessions. Shared role passwords do not provide individual staff identity or multifactor authentication.

## Check the running workspace

Sign in as the owner and open **Settings → Your saved workspace → Check saved workspace**. The check reads the database and its actual security catalog. It reports storage, uploaded/generated image persistence, RLS coverage and direct database access protection without returning secrets or business records. A failed check clears the previous result rather than continuing to show a green status.

The panel deliberately reports backups as **unverified**. The app has no Supabase account-management access and cannot inspect the project's backup schedule, retention or point-in-time recovery from a normal database health request.

## Verify recovery backups in Supabase

1. Open the correct Supabase project, then its database backup/recovery settings. Confirm successful backup timestamps and the available retention window. Availability depends on the project's current plan and configuration.
2. Decide how much work the company can afford to recreate after a failure. If that is less than the time between snapshots, configure an appropriate point-in-time recovery option where available. Do not treat a healthy connection as evidence that this is enabled.
3. Ensure a recovery copy includes the complete `potshaven_private` schema: records, metadata, media, activity, sequences and functions. The app's uploaded/generated photos are database rows, so they must be included alongside the records. Downloading a client report, taking a screenshot, or copying only the `public` schema is not a company backup.
4. Protect any downloaded backup with encryption and restricted access. A complete database backup contains private company information and session metadata. Keep it out of this repository and public file sharing.
5. Test recovery into a separate database/project before relying on a backup. Use new private test passwords and an isolated deployment with production integrations disabled. Check representative sites, visits, checklists, stock balances/history, uploaded and generated pictures, settings and owner activity. Confirm that manager permissions and the Data protection check still work.
6. Record the successful restore date and which snapshot was tested. Do not restore over the live company database as a test. After an actual recovery, rotate the app role passwords before reopening access: an older snapshot may predate a session revocation.

No automated backup or paid recovery plan is enabled by these repository changes. Those settings require access to the Supabase account; they must be verified there.
