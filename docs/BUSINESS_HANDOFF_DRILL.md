# Business workflow and recovery drill

Run `node --test server/business-handoff.test.js` to exercise the real HTTP API, signed owner/manager sessions, and an isolated PostgreSQL database. The test uses temporary example records; it never accesses the live business database or calls OpenAI.

The drill checks:

- The owner creates a site, a weekly external worker, a vehicle, plant inventory with a photo, and a recurring maintenance job.
- The manager assigns the approved worker and vehicle, records a site inspection with a photo, uses two plants, requests supplies, and completes the checklist with a completion photo.
- Stock decreases once, a stock movement is recorded, and completion schedules the next maintenance visit with an unchecked checklist.
- The owner receives the manager's assignment, visit, stock-use, request and completion updates. Acknowledging an update persists its read receipt. The manager cannot approve supplies or access private owner notes, agreement references, conversations, studio records or the owner inbox.
- Owner and manager conversations are saved separately and excluded from generic workspace responses. A new application instance reopens the same records, photo, conversations and inbox receipts.
- A complete database archive is restored into a **separate embedded PostgreSQL instance**. The drill checks all four private tables and their access protection before application startup can repair anything. It then verifies records, uploaded image bytes, settings, private conversations and owner receipts, followed by a successful new stock movement and conversation update.
- Rotating the restored app's passwords rejects sessions issued before recovery. New writes in the restored database leave the source database unchanged.

This is an automated test of application persistence, role boundaries and recovery behavior. It does **not** verify Supabase's production backup schedule, retention, account settings, or the restoration of an actual provider backup. It also does not verify real OpenAI billing or model access. The owner-facing protection check continues to report backups as unverified.

Before using the app as the only business record, verify production backup retention and restore a real backup into a separate project using [the recovery guide](DATA_PROTECTION.md). A signed-in production assistant reply and studio generation must also succeed. Never restore over live company data merely to test recovery.
