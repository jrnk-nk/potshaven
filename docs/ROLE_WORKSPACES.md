# Owner and manager workspaces

These role boundaries are implemented. The studio, gallery, portfolio, finances, hiring, pay, approvals, and company administration belong to the owner. The manager runs daily operations using approved people, vehicles, and stock.

| Area | Manager: daily operations | Owner: business control |
| --- | --- | --- |
| Home | Today's work, incomplete tasks, crews, vehicles, operational alerts | Company performance, costs, approvals, project progress, and operational overview |
| Schedule and projects | Plan visits, assign approved people and vehicles, update checklists/photos/progress, flag deadline changes | Full control, including project scope, contractual deadlines, budgets, and costs |
| Places | Operational site details, contacts needed for visits, photos, care notes, and maintenance issues | Full client records, private commercial notes, and record deletion |
| People | View approved workers, skills, availability, and agreement start/end dates; assign to jobs; request additional workers | Hire/archive workers, set pay, record approved/signed agreements, and view confidential worker terms |
| Vehicles | Assign approved vehicles, record fuel/maintenance needs, flag unavailable transport | Add/archive fleet, approve repairs, and see company-wide vehicle costs |
| Inventory | View stock/photos, record actual job usage, request restocking, and flag discrepancies | Stock corrections/deletions, purchasing, supplier costs, and purchase approvals |
| Spending | Submit supply requests and receipts; see the status of own requests | Approve spending, manage supplier payments, and view the full expense ledger |
| Finance | No company finance area | Client payments, recorded income/costs, budgets, worker pay rates, and financial reports |
| Studio, gallery and portfolio | No access | Space gallery/chat, concepts, branded downloads, client presentation and publication |
| Reports | Daily work briefs, completion photos, checklists and WhatsApp instructions | Client reports, portfolio and financial/company-wide reports |
| Company settings | Personal session and sign-out only | Company identity, branding, account access, connections, and administrative settings |
| Assistant | Answers from permitted operational records; proposes only permitted actions | Owner-supported company context and actions |

The manager’s main navigation is **Today, Schedule, Places, Inventory, Team & vehicles**, with Projects and Company assistant under More. The owner’s main navigation is **Home, Projects, Business, Team & vehicles, Design studio**, with all operational tools available under More. The owner’s home shows payments, recorded costs, approvals, and project progress; the manager’s home shows schedules, tasks, assignments, and operational reminders.

The server applies collection and field allowlists to workspace data, collection reads, write responses, stock usage, and assistant context/actions. Manager attempts to open private pages, read financial/design collections, generate images, hire workers, create vehicles, adjust or receive stock, approve purchases, or delete records are rejected. Operational records keep their owner-only fields when managers update permitted details. Managers can update approved-worker availability and vehicle status/notes; create Maintenance visits; update operational project progress without changing contractual deadlines; and submit pending supply, service, or receipt requests.

Authenticated media is checked against assets referenced by permitted operational records and company branding. Private design URLs cannot be attached to a manager record to gain access. Media responses use `private, no-store` and vary by Cookie. Signing out clears cached records and private studio drafts after the logout succeeds; account changes also clear those drafts. Late responses from a previous account cannot populate the next session.

There is one shared manager login role, so manager requests are scoped by `requestedBy: manager`; the app does not claim per-person manager accounts. A multi-manager identity system would need distinct account IDs. Existing company records are preserved.

Daily alerts describe saved records; the manager still confirms actual work and completion with the crew. Preparing a WhatsApp message never sends it automatically.
