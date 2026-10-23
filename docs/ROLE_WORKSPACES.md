# Owner and manager workspaces

These role boundaries apply to the interface, API, returned records, assistant actions and private media. The manager runs daily operations using approved people, vehicles and stock. The owner also handles studio work, hiring, supply approvals and company administration.

**Money features are temporarily disabled for both roles.** Financial pages, amounts, budgets, prices, pay, expenses, payments and receipt requests are unavailable. Saved financial records remain in storage; operational updates preserve hidden values. Supply requests and stock quantities remain available.

| Area | Manager: daily operations | Owner: company oversight |
| --- | --- | --- |
| Home | Today's work, incomplete tasks, crews, vehicles and operational alerts | Sites, visits, overdue work, supply approvals and project progress |
| Sites | Site details, contacts, photos, visit observations, maintenance, follow-ups and existing project progress | The same site workspace, plus project creation, scope, deadlines and record deletion |
| Schedule | Plan maintenance visits, assign approved people/vehicles and update checklists/photos | Plan visits and manage all project deadlines |
| People | View approved workers, skills, availability and agreement dates; assign jobs; request additional workers | Hire/archive workers and record approved/signed agreements |
| Vehicles | Assign approved vehicles, update availability and record maintenance needs | Add/archive vehicles and manage the fleet |
| Inventory | View stock/photos, record job-linked usage and request supplies | Stock corrections/restocking, stock records and supply approvals |
| Manager activity | No inbox access; permitted saved changes produce owner updates | Read recent activity, open the related site/work and mark updates as read |
| Studio, gallery and portfolio | No access | Space gallery/chat, concepts, branded downloads, client presentation and portfolio |
| Reports | Daily briefs, site visit reports, completion photos, checklists and WhatsApp instructions | Branded client reports and company portfolio |
| Company settings | Session information and sign-out | Company identity, branding and administrative settings |
| Assistant | Answers from permitted operational records and proposes permitted changes | Owner-supported operational context and changes; no money features |

The manager’s main navigation is **Today, Schedule, Sites, Inventory, Team & vehicles**, with Company assistant under More. The owner’s main navigation is **Home, Sites, Schedule, Team & vehicles, Design studio**, with Inventory, Company assistant, Portfolio & reports and Manager activity under More. Places and Projects are no longer separate screens. Existing `#places` and `#projects` bookmarks normalize to `#sites`, preserving a `?site=ID` link when present.

The server applies collection and field allowlists to workspace data, collection reads, write responses, stock usage and assistant context/actions. Manager attempts to open private pages, read design or financial collections, generate images, hire workers, create vehicles, adjust or receive stock, approve supplies or delete records are rejected. Project creation and contractual deadlines remain owner-only. Managers can update approved-worker availability and vehicle status/notes, create Maintenance visits, update operational project progress, and submit pending supply/service requests. No role can use financial fields or payment/expense APIs while the feature is disabled.

Operational records retain hidden fields when a permitted update is saved. The API checks the current record under the database write lock to reject intervening changes. Collection edits can also send an optional `_expected` baseline from when the form opened, preventing a stale form from overwriting a newer permitted change. Forms using this precondition retain the draft on a 409 conflict and ask the user to refresh. Nested records with hidden financial details cannot be silently removed by a redacted form. Site visits append to the latest history with a stable visit ID; concurrent visits are preserved and stale forms cannot remove saved visits.

Manager changes create an operational event in the same transaction as the saved change. Failed or rejected changes produce no event. The owner-only inbox shows the latest 100 events and an unread count across stored events; read status persists across devices and deployments. It checks every 30 seconds while the page is visible, on focus/reconnection, and when refreshed manually. It does not send push notifications, emails or WhatsApp messages, and does not backfill old work as new activity.

There is one shared manager login, so requests are scoped by `requestedBy: manager` and activity identifies **Manager account**. This is the account responsible for the change, not a claim about which individual worker used it. Individual attribution would require separate accounts. Activity stores limited operational metadata and links, not raw requests, notes, credentials or financial payloads.

Authenticated media is checked against assets referenced by permitted operational records and company branding. Private design URLs cannot be attached to a manager record to gain access. Media responses use `private, no-store` and vary by Cookie. Signing out clears cached records and private studio drafts after logout succeeds; account changes also clear those drafts. Late responses from a previous account cannot populate the next session.

Daily alerts describe saved records; the manager still confirms actual work and completion with the crew. Preparing a WhatsApp message never sends it automatically.
