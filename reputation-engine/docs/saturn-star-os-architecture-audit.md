# Saturn Star OS architecture audit

> **The Saturn Star operating system should make the entire company feel planned. It should convert incoming demand into prepared jobs, guide teams through execution, reveal risks before they become problems and preserve a clear record from first contact to final follow-up.**

## Audit standard

Every important screen must answer:

1. What is happening?
2. What matters now?
3. Who owns it?
4. What must happen next?

The brand playbook adds five non-negotiable qualities: calm, organized, clear, human and trustworthy. In software, those qualities must come from operational truth rather than decoration.

## Executive finding

Saturn Star already has more operational depth than the navigation suggests. The core sales record contains intake, customer identity, move facts, inventory, estimates, quotes, booking, deposits, crew, truck reservations, readiness checks, dispatch responses, execution logs, payments and review state. The main architectural problem is fragmentation: each department sees a different slice and the product does not consistently expose one authoritative job state.

The safest path is to make the existing lead-plus-quote record behave as the first job spine, then separate durable objects only where workflow pressure requires it. A premature database rewrite would add risk without making the interface more effortless.

## Current capability map

### Intake — strong foundation

- Website lead capture, manual creation and smart intake
- Phone, SMS and email ingestion
- Missed-call and voicemail handling
- Referral and partnership capture
- Lead identity matching and duplicate handling
- Branch and source attribution

Primary gap: ownership and response exceptions are not presented as company-wide operational obligations.

### Sales — strong but screen-heavy

- Qualification, property and access facts
- Inventory capture, scans and customer verification
- Route calculation and estimation
- Quote creation, revision, approval and delivery
- Follow-up automation and communication history
- Quote acceptance and deposits

Primary gap: stages and data fields often dominate the customer decision blocker and next action.

### Operations — substantial capability

- Booked-job calendar
- Crew and role assignment
- Crew dispatch confirmation
- Truck requirements and reservations
- Access, parking, tools and briefing checklist
- Branch capacity estimates
- Dispatch brief generation

Primary gap: readiness logic lived inside the operations screen instead of being a shared source of truth visible to leadership and the job record.

### Live execution — partially implemented

- Move phases and timestamps
- Actual-versus-estimated hours
- Issue recording
- Photos, receipts and expense capture
- On-site scope and price changes

Primary gap: the field experience is still a job card with multiple controls, not a linear moving-day workflow with one dominant action and explicit offline behavior.

### Completion and care — present but distributed

- Balance collection and receipts
- Review requests and review completion
- Customer feedback notes
- Crew payouts and expenses
- Partner referral updates

Primary gap: claims, complaints, appreciation and formal closeout do not yet form one completion workflow.

### Management — broad reporting, fragmented intervention

- Sales analytics and drilldowns
- Finance views
- Rep performance
- Branch capacity
- Activity feed
- Partnership reporting

Primary gap: leadership has metrics but no single exception-first operating view spanning departments.

## Object model assessment

### Objects already represented well

- lead / opportunity
- person and contact identity
- estimate and quote
- inventory and services
- booking and job facts
- communication and follow-up
- payment records
- crew assignment and payout
- truck reservation
- execution events and issues
- referral and partner
- review
- branch / city

### Objects that need clearer first-class treatment

- job, distinct from the original opportunity when one customer has multiple moves
- task with action, reason, channel, timing and intended outcome
- promise with owner, evidence and completion state
- truck and equipment inventory rather than reservation fields alone
- shift and crew availability
- claim and incident lifecycle
- invoice and refund lifecycle
- document requirements
- customer confirmation

## Navigation finding

The current sidebar is feature-oriented: Dashboard, Follow-Up, Inbox, Pipeline, Quotes, Booked, Operations, Finance and other tools. The target architecture is environment-oriented:

- Intake
- Sales
- Operations
- Live
- Care
- Management

Existing pages can remain, but navigation should progressively group them beneath these six environments and give each role a different default entrance.

## Implemented first slice

The first slice establishes shared operational truth without a migration:

- A continuous derived operating stage from Lead through Closed
- Five transparent readiness dimensions: customer, financial, crew, equipment and operational
- Plain-language readiness states
- Central exception derivation for unowned demand, waiting customers, unsent quotes, unpaid deposits, missing preparation, live issues, unpaid completed jobs and missing care follow-up
- A leadership home organized into Now, Today, Attention needed, Operating spine and Business health
- Automated logic tests for the new domain rules

## Recommended delivery sequence

### Phase 1 — operational truth

1. Complete the shared job spine and readiness rules.
2. Place job stage, readiness and exceptions on every booked-job surface.
3. Make ownership mandatory at intake and handoff boundaries.
4. Reorganize navigation around the six environments.

### Phase 2 — job record

1. Recompose the lead detail into the four-zone job record.
2. Build one narrative across calls, quotes, payments, dispatch and execution.
3. Add explicit tasks and promises.
4. Make assumptions and unresolved requirements prominent.

### Phase 3 — live execution

1. Build the linear crew-lead mobile flow.
2. Add one-action-at-a-time phase progression.
3. Surface live exceptions to dispatch automatically.
4. Establish resilient photo, signature and time capture.

### Phase 4 — completion and learning

1. Formalize completion checklist, claims and complaints.
2. Join payment, review, partner update and appreciation into closeout.
3. Feed estimate accuracy, actual hours, incidents and objections into management learning.

## Product quality gate

Before shipping a screen, verify:

- There is one primary question.
- The authoritative status is visible.
- Ownership is visible.
- The next action is specific.
- Normal work remains quiet.
- Exceptions explain why they matter.
- Brand colour is restrained and semantic status remains honest.
- The screen uses real operational proof.
- The user does not need another page to understand the immediate decision.

