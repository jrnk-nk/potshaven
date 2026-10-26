# PotsHaven data protection and recovery

The hosted app saves company data in its connected Supabase PostgreSQL database. Storage persistence, access controls, and recovery backups solve different problems. A successful database check does not prove that backups exist or that no data can ever be lost.

## What is saved

| Information | Hosted storage |
| --- | --- |
| Sites, jobs, visits, checklists, team, vehicles, stock and stock history | `potshaven_private.records` |
| Saved design conversations and their links to images | `potshaven_private.records` |
| Uploaded site/plant/completion/branding photos and generated designs | Image bytes in `potshaven_private.media` |
| Owner inbox updates and read receipts | `potshaven_private.activity` |
| Company settings, role-private Company assistant conversations, provider request receipts, session signing secret, sign-in limits, session generations and session revocations | `potshaven_private.metadata` |

Vercel does not fall back to a temporary SQLite database when the configured database fails. A failed save reports an error. Local development and the separate SQLite hosting option use local database/image files instead; those files need their own backups.

Unsent form drafts and attached photos have not been saved. Successful Company assistant exchanges are saved in private conversation history for the signed-in role; the interface reports if a conversation could not be saved. Saved conversations contain text, not replayable commands. Changes accepted through **Save this change** are stored with the company records. Studio messages and images that have been successfully generated are saved. An image URL pointing to another website remains a link; uploading the actual picture is what stores its bytes in the database.

Private database connection strings, role passwords and the OpenAI API key are server environment settings in Vercel. They are not browser configuration or company database records. Retain them separately in an appropriate password manager; never put them in Git or chat.

## Access protection

Schema version 4 enables row-level security (RLS) on all four private tables. There are no browser-access policies: unprivileged database roles are denied by default. Schema, table, column, sequence and function privileges are revoked from `PUBLIC` and the existing Supabase `anon`, `authenticated` and `service_role` roles. Application objects stay in `potshaven_private`, outside the app's browser API.

The trusted backend connects as the database/table owner and intentionally bypasses RLS. Owner and manager sessions are application roles, not Supabase Auth users. The backend therefore still checks every API and media request, filters private fields, and rejects unauthorized writes. RLS alone would not separate the app's owner and manager; it adds protection against direct database access. A stolen privileged database connection can bypass RLS, so keep `DATABASE_URL` private.

A successful sign-out now records an opaque session revocation in the database before clearing the browser cookie. Reusing that signed cookie cannot reopen API records or private photos. Ordinary sign-out leaves other devices signed in. The owner can use **Settings → Account protection** and re-enter the owner password to sign out every device for either role. Durable per-role generations invalidate existing cookies across app instances, including old cookies. Password rotation still invalidates all existing sessions. Shared role passwords do not provide individual staff identity or multifactor authentication.

## Check the running workspace

Sign in as the owner and open **Settings → Your saved workspace → Check saved workspace**. The check reads the database and its actual security catalog. It reports storage, uploaded/generated image persistence, RLS coverage and direct database access protection without returning secrets or business records. A failed check clears the previous result rather than continuing to show a green status.

The panel deliberately reports backups as **unverified**. The app has no Supabase account-management access and cannot inspect the project's backup schedule, retention or point-in-time recovery from a normal database health request.

## Verify recovery backups in Supabase

1. Open the correct Supabase project, then its database backup/recovery settings. Confirm successful backup timestamps and the available retention window. Availability depends on the project's current plan and configuration.
2. Decide how much work the company can afford to recreate after a failure. If that is less than the time between snapshots, configure an appropriate point-in-time recovery option where available. Do not treat a healthy connection as evidence that this is enabled.
3. Ensure a recovery copy includes the complete `potshaven_private` schema: records, metadata (including private assistant histories), media, activity, sequences and functions. The app's uploaded/generated photos are database rows, so they must be included alongside the records. Downloading a client report, taking a screenshot, or copying only the `public` schema is not a company backup.
4. Protect any downloaded backup with encryption and restricted access. A complete database backup contains private company information and session metadata. Keep it out of this repository and public file sharing.
5. Test recovery into a separate database/project before relying on a backup. Use new private test passwords and an isolated deployment with production integrations disabled. Check representative sites, visits, checklists, stock balances/history, uploaded and generated pictures, settings and owner activity. Confirm that manager permissions and the Data protection check still work.
6. Record the successful restore date and which snapshot was tested. Do not restore over the live company database as a test. After an actual recovery, rotate the app role passwords before reopening access: an older snapshot may predate a session revocation.

No automated backup or paid recovery plan is enabled by these repository changes. Those settings require access to the Supabase account; they must be verified there.

## Create an additional encrypted recovery copy

An administrator can run `scripts/backup-workspace.mjs` from a trusted computer with Node 24 and PostgreSQL client tools (`pg_dump`). The client version must be compatible with the database server. This is an additional manual logical backup, not a substitute for verifying Supabase's scheduled backups or point-in-time recovery.

The command dumps the complete `potshaven_private` schema in PostgreSQL custom format, including image bytes, private chat history, session metadata and records hidden from the current interface. It streams the dump into AES-256-GCM encryption with a separate passphrase-derived key; the unencrypted backup is not written to disk during creation. TLS certificate and hostname verification remain enabled. Connection credentials go to `pg_dump` through its private environment, never its command arguments. Application secrets such as the OpenAI key and role passwords are not passed to `pg_dump`.

Use the **direct connection or Session pooler** from Supabase's Connect panel for this operator task. The app's Transaction pooler URL on port 6543 is rejected by the backup tool. Keep the backup passphrase in a password manager separately from the encrypted file; losing it prevents recovery. No password or connection string should be entered into chat, Git, or command-line arguments.

For example, in Bash on a trusted administrator computer, run from the repository:

```bash
mkdir -m 700 -p "$HOME/PotsHaven-backups"
read -rs -p 'Supabase direct or Session pooler URL: ' POTSHAVEN_BACKUP_DATABASE_URL
printf '\n'
read -rs -p 'Separate strong backup passphrase (16+ characters): ' POTSHAVEN_BACKUP_PASSPHRASE
printf '\n'
export POTSHAVEN_BACKUP_DATABASE_URL POTSHAVEN_BACKUP_PASSPHRASE
node scripts/backup-workspace.mjs backup --output "$HOME/PotsHaven-backups/company-$(date -u +%Y%m%dT%H%M%SZ).phbackup"
unset POTSHAVEN_BACKUP_DATABASE_URL POTSHAVEN_BACKUP_PASSPHRASE
```

Output must be a new absolute filename outside the repository, including through symbolic links. Existing backups are never overwritten. Published files are created with owner-only permissions. The tool only publishes a backup after `pg_dump` succeeds and encryption finishes. Failed runs remove their temporary directory. A forced process kill or computer failure can leave that restricted temporary directory behind; remove it before retrying. Set `POTSHAVEN_PG_DUMP` only if the executable is outside the normal PATH, or `POTSHAVEN_BACKUP_CA_FILE` if an administrator supplies a different trusted database CA bundle. TLS verification cannot be disabled through URL options.

Keep a second encrypted copy in a separately controlled location. Record the backup timestamp, database/project identity, file location, and restore-test result in the business's private operations records. The command does not upload a backup, schedule future runs, change database records, or mark Supabase recovery as verified.

## Authenticate and test a recovery copy

On the trusted restore computer, choose the actual encrypted file and a new output filename outside the repository. Supply the same passphrase privately:

```bash
read -rs -p 'Backup passphrase: ' POTSHAVEN_BACKUP_PASSPHRASE
printf '\n'
export POTSHAVEN_BACKUP_PASSPHRASE
node scripts/backup-workspace.mjs decrypt --input /absolute/private/company.phbackup --output /absolute/private/restore-check.dump
unset POTSHAVEN_BACKUP_PASSPHRASE
pg_restore --list /absolute/private/restore-check.dump
```

Decryption authenticates the entire archive before publishing the plaintext file. An incorrect passphrase, modified file or truncated archive produces no final plaintext output. This command never connects to a database and never restores over company data. The decrypted file contains private business data; keep it restricted and remove it after the drill. Decryption success alone proves file integrity, not that the database can be restored.

Have the database administrator restore that custom archive into a **new, isolated database/project**, using `pg_restore` with error-on-failure and a single transaction. Use the test database's owner for object ownership where the original owner does not exist. Do not point a restore command at the production connection, and do not expose a partially restored database to the app. Run the current backend bootstrap against the isolated restore, with new owner/manager passwords and production AI integrations disabled, so current RLS and app permissions are applied. Then follow the representative-data and role checks above, including saved assistant history. Only record the recovery drill as successful after these checks pass.

Automated repository tests check encryption/decryption, tamper rejection, permissions, credential handling and failed-run cleanup with a simulated `pg_dump` executable. They do not perform a backup of the live Supabase project or establish its recovery retention. A separate isolated application restore test checks saved data and access controls without touching production.

Provider request receipts preserve interrupted-request identity across deployments. Include them in recovery copies. Restoring an older snapshot can also restore older session generations and omit later request receipts: rotate role passwords after recovery and review recent work/provider activity before requesting replacements. Do not automatically replay requests after a restore.
