# Saturn Star Partner Ecosystem — implementation roadmap

## Architectural boundary

The CRM, internal Operations views, partner-company portal, and crew field view use one underlying data model. They are not synchronized products. Access differs by organization, role, assignment, and data classification.

Information classes:

- **Internal only:** margin, internal notes, customer-success/claims strategy, management reviews, unrestricted financial and legal data.
- **Partner company:** offers, assigned jobs, company team/resources, compliance, company earnings, incidents, partner-visible messages.
- **Assigned crew:** only the job packet, required customer/contact data, statuses, checklists, evidence upload, field reports, and job communication.
- **Pre-award offer:** city-level route, operational scope, timing, resources, compensation, and sanitized briefing—never customer identity or exact addresses.

## Implemented foundation

- Partner company directory and hard eligibility/ranking inputs.
- Quote/Operations-fed readiness gate requiring booked status, confirmed deposit, route, crew size, and estimated timing.
- Suggested partner payout, editable by authorized Operations staff.
- Automatically generated pre-award sanitized brief and post-award crew brief.
- Exclusive/manual-award and controlled first-acceptance modes with offer expiration.
- SMS and email offer delivery with secure response links.
- Atomic award, crew-dispatch handoff, partner assignment, and pending-completion ledger entry.
- Dedicated Operations number with inbound partner SMS linked to the awarded job.
- Job-linked portal/SMS communication timeline.
- Structured field reports with severity, evidence, Operations exception queue, acknowledgement, investigation, approval, and resolution.
- Scope-related field reports create pending quote changes without changing customer price.
- Categorized photo/video evidence stored on the same CRM job.
- Data foundations for partner members/roles, vehicles, equipment capabilities, availability, documents, versioned rates, job versions/acknowledgements, immutable ledger entries, and audit events.

## Next operational release

1. Partner authentication and organization-scoped authorization. Map authenticated users to `partner_members`; enforce owner/dispatcher/crew permissions in API authorization and database policies.
2. Partner 360 UI. Add tabs for members, vehicles, availability, documents, assignments, conversations, incidents, earnings, performance, and internal-only notes.
3. Crew/vehicle assignment. Require named approved crew and verified vehicles before the 24-hour confirmation deadline; check schedule overlap and capacity.
4. Status and checklist workflow. Persist Preparing, En Route, Arrived, Started, Completed plus pre-job, arrival, and completion checklists against `partner_job_assignments`.
5. Job version acknowledgement. Snapshot important accepted-job changes, notify the partner, and require acknowledgement before dispatch.
6. Live operations board. Aggregate today’s assignments and open reports into normal, delayed, no-show risk, incident, and scope-change lanes.
7. Offer-wave worker. Expire unanswered exclusive offers and offer the next ranked candidate; surface backup partners without automatically making unsafe assignments.

## Infrastructure-dependent release

- Stripe Connect onboarding, account status webhooks, transfers, payout batches, failures, reversals, and reconciliation.
- Document storage, jurisdiction-specific compliance rules, expiration reminders, and verification approvals.
- E-signature integration with agreement versions and immutable signing evidence.
- Partner email inbound routing and job association.
- Push notification delivery and partner-controlled preferences, with mandatory critical notices.
- Claims case management, partner responses, evidence requests, decisions, and restricted internal legal notes.
- Offline action queue for statuses, checklists, and evidence uploads in poor-connectivity environments.

## Guardrails

- Automation prepares and recommends; Operations controls unusual, specialty, high-value, or incomplete jobs.
- Contractors never renegotiate Saturn Star customer pricing. Added scope pauses until authorized.
- Ledger corrections are new entries or reversals; historical money is not silently overwritten.
- Suspended, expired, uninsured, unqualified, conflicted, or under-capacity partners cannot receive work.
- SMS returns users to secure context. Portal is routine, SMS is time-sensitive, phone is critical, and email is formal/non-urgent.
- Every meaningful action is connected to partner, job, actor, timestamp, and visibility class.
