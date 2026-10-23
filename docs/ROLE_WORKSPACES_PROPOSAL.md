# Proposed owner and manager workspaces

This is a proposal for review. The permissions below have **not been applied**. Current authentication and permissions remain in place until the user confirms the intended split.

| Area | Manager: daily operations | Owner: business control |
| --- | --- | --- |
| Home | Today's work, incomplete tasks, crews, vehicles, operational alerts | Company performance, costs, approvals, project progress, and operational overview |
| Schedule and projects | Plan visits, assign approved people and vehicles, update checklists/photos/progress, flag deadline changes | Full control, including project scope, contractual deadlines, budgets, and costs |
| Places | Operational site details, contacts needed for visits, photos, care notes, and maintenance issues | Full client records, private commercial notes, and record deletion |
| People | View approved workers, skills, availability, and agreement start/end dates; assign to jobs; request additional workers | Hire/archive workers, set pay, record approved/signed agreements, and view confidential worker terms |
| Vehicles | Assign approved vehicles, record fuel/maintenance needs, flag unavailable transport | Add/archive fleet, approve repairs, and see company-wide vehicle costs |
| Inventory | View stock/photos, record actual job usage, request restocking, and flag discrepancies | Stock corrections/deletions, purchasing, supplier costs, and purchase approvals |
| Spending | Submit supply requests and receipts; see the status of own requests | Approve spending, manage supplier payments, and view the full expense ledger |
| Finance | No company finance area | Revenue, profit, invoices, client payments, budgets, payroll/pay rates, and financial reports |
| Studio | Space gallery/chat, working ideas, chosen concepts, and branded downloads | All studio controls and approval/publication of the public portfolio |
| Reports | Prepare operational completion reports and daily WhatsApp instructions | Publish client-facing reports and portfolio; view financial and company-wide reports |
| Company settings | Personal session and sign-out only | Company identity, branding, account access, connections, and administrative settings |
| Assistant | Answers from permitted operational records; proposes only permitted actions | Company-wide answers and owner-authorized actions |

The manager navigation would be **Today, Schedule, Places, Stock, Studio**, with Team & vehicles and Requests under More. The owner navigation would emphasize **Overview, Projects, Money, Approvals, People**, with operational tools available as well.

If confirmed, implementation must enforce these rules in the API and returned workspace data as well as the interface. Hiding a menu alone is insufficient. The assistant's context, proposed actions, searches, notifications, exports, and downloads must follow the same role boundaries. Existing company records should be preserved.

Daily alerts describe saved records; the manager still confirms actual work and completion with the crew. Preparing a WhatsApp message never sends it automatically.
