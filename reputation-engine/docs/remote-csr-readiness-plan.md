# Remote CSR Readiness Plan

Date: 2026-04-21

## Goal

Make Mission Control reliable enough that a remote CSR can:

1. answer or return inbound calls fast
2. see the full customer context immediately
3. build or send a quote without guessing
4. follow up consistently
5. work inside guardrails without breaking data, pricing, or lead ownership

The target is simple:

- a new CSR should be able to answer a lead, collect details, send a quote, and set next steps in under 5 minutes

## What Already Exists

Mission Control is not starting from zero. The current system already has a strong base:

- Twilio-backed inbound and outbound calls
- branch-aware SMS routing and thread history
- call recording, transcription, and AI summaries
- lead inbox, pipeline, and lead-detail workspace
- estimate builder with quote types and pricing logic
- MLS-photo inventory enrichment
- customer photo-survey flow for non-MLS jobs
- automation status controls:
  - `active`
  - `paused`
  - `handoff`
  - `do_not_contact`
- role primitives already in auth:
  - `owner`
  - `manager`
  - `sales_rep`
  - `crew`
- `assignedRep` already exists on the lead model

That means the job is not “build a CSR system from scratch.”
The job is to harden ownership, visibility, permissions, and rep workflow.

## Main Gaps Before Remote CSR Scale

### 1. Lead ownership is present but too light

Current state:

- `assignedRep` exists, but it behaves more like a label than a full ownership system

Needed:

- explicit owner on every active lead
- claim / reassign / takeover rules
- visible “who owns this now” across inbox, pipeline, lead page, and quote pages

### 2. Rep identity is not strong enough in audit flow

Current state:

- actions are visible in some places, but not every important action is stamped with a real rep identity

Needed:

- every critical action should show:
  - who did it
  - when they did it
  - what changed

Especially:

- answered call
- sent SMS
- sent quote
- changed stage
- changed pricing
- added discount
- marked booked
- reassigned lead

### 3. Permissions are not fully productized yet

Current state:

- roles exist in auth
- product behavior is not yet fully shaped around those roles

Needed:

- clean rules for who can:
  - view all leads
  - edit all leads
  - edit pricing
  - apply discounts
  - reassign leads
  - manage users

### 4. Inbox and pipeline still need clearer rep workflow

Current state:

- inbox, lead page, and pipeline all exist
- branch identity is already a strong part of the model

Needed:

- unread / awaiting-reply logic
- “my leads” and “team leads” views
- clear “owner”, “last inbound”, and “next action” visibility everywhere

### 5. Quote fallback for non-MLS jobs is good, but not fully complete

Current state:

- manual inventory
- item presets
- labor-only / packing-only modes
- customer photo survey link

Needed:

- direct rep upload of customer media into a lead
- direct MMS photo ingestion into the same inventory pipeline
- stronger “quote missing data” warnings before a rep sends bad pricing

### 6. Rep performance visibility is still too soft

Needed:

- simple rep scoreboard
- SLA tracking
- quote lag tracking
- missed-call follow-up tracking

### 7. Multi-rep voice routing is documented, but not implemented

Current state:

- future-state direction is already captured in `sales-automation-rollout.md`

Needed later:

- rep availability states
- simultaneous ringing pool
- busy-state suppression

This is not first priority for onboarding CSRs, but it should stay on the roadmap.

## Recommended Implementation Phases

## Phase 1: Bullet-Ready Baseline

This is the minimum software layer that should be finished before multiple remote CSRs work leads daily.

### A. Make rep ownership first-class

Add these fields to the lead model:

- `assignedRepUserId`
- `assignedRepName`
- `leadOwnerStatus`
  - `unassigned`
  - `assigned`
  - `reassigned`
  - `handoff`
- `ownedAt`
- `lastTouchedByUserId`
- `lastTouchedByName`
- `lastTouchedAt`

Rules:

- whoever answers or claims the lead becomes the owner by default
- manager / owner can reassign
- if untouched for a defined window, lead becomes eligible for takeover

Recommended first rule:

- untouched for 2 business hours after new inbound activity = flag for reassignment

### B. Add visible rep ownership everywhere

Update UI surfaces so these are always obvious:

- Inbox row
  - owner
  - branch
  - last inbound channel
  - unread state
- Pipeline card
  - owner
  - quote status
  - follow-up due state
  - last inbound preview
- Lead page header
  - owner
  - branch line
  - source / tracking source
  - automation state
- Quote page
  - quote owner / last editor

### C. Lock in role behavior

Recommended rules:

- `owner`
  - full access
  - user management
  - pricing controls
  - reassignments
  - audit access
  - automation controls
- `manager`
  - see all leads
  - reassign leads
  - review calls and quotes
  - edit quotes
  - apply discounts up to a manager threshold
- `sales_rep`
  - work leads
  - send SMS / email
  - answer / place calls
  - build quotes
  - edit their owned leads
  - view team leads
  - cannot manage users
  - cannot delete leads
  - cannot silently overwrite protected pricing history
- `crew`
  - no sales workspace access
  - operations only

### D. Protect pricing actions

Add permission gates around:

- discount application
- price override totals
- quote acceptance adjustments
- deposit edits after booking

Recommended first thresholds:

- rep can apply small standard discount only
- manager can apply larger discount
- only owner can override final total directly

### E. Add rep activity audit events

Every action below should create an event:

- `lead_claimed`
- `lead_reassigned`
- `call_answered`
- `call_missed`
- `sms_sent`
- `email_sent`
- `quote_created`
- `quote_sent`
- `quote_discount_applied`
- `quote_total_overridden`
- `followup_set`
- `lead_stage_changed`

Each event should store:

- `userId`
- `userName`
- `leadId`
- `quoteId` when applicable
- timestamp
- machine-readable payload

## Phase 2: CSR Operating Clarity

This phase makes the product easier to run, coach, and audit.

### A. Add “My Work” views

New filters:

- `My inbox`
- `My leads`
- `Unassigned`
- `Needs reply`
- `Follow-up due today`
- `Quote not sent after call`
- `Team view`

These should work on:

- Inbox
- Pipeline
- Quote workspace list

### B. Add unread and awaiting-reply logic

Track per lead:

- `inboundUnreadCount`
- `lastInboundChannel`
- `lastInboundAt`
- `lastInboundPreview`
- `awaitingReply`

Rules:

- if last message is inbound and no outbound reply after it, `awaitingReply = true`
- if quote promised but not sent, show warning
- if missed call not returned, show warning

### C. Add CSR SLA widgets

Minimum metrics:

- speed to first response
- quote send time after first call
- missed calls not returned
- follow-ups overdue
- bookings by rep

Manager dashboard should show:

- per-rep calls handled
- per-rep quotes sent
- per-rep booked jobs
- per-rep overdue leads

### D. Tighten lead timeline

Timeline should clearly show:

- actual SMS preview, not only “SMS sent”
- actual email subject and short preview
- quote sent timestamps
- owner changes
- follow-up promises
- consultation recordings

That turns the lead page into a true operating record.

## Phase 3: Quote Intake Hardening

This phase makes the software safer for reps when MLS photos are missing or the move is custom.

### A. Add direct rep-side media upload

On the lead page, allow rep uploads for:

- customer-sent photos
- screenshots
- room photos sent outside the survey flow

These uploads should feed the same inventory enrichment pipeline already used by the survey.

### B. Add inbound MMS ingestion

If a customer texts photos directly to a branch line:

- store media on the lead
- attach to the SMS thread
- allow one-click “scan into inventory”

This removes the gap between messaging and quote prep.

### C. Add quote readiness checks

Before “Send Quote”, validate:

- move date present or explicitly flexible
- origin present
- destination present if required
- inventory source known:
  - MLS
  - survey photos
  - manual inventory
  - rep-upload media
- job factors reviewed

If weak:

- show warning
- require rep confirmation

### D. Add guided fallback quoting modes

When no MLS and no customer media exist, present fast fallback flows:

- studio / 1-bedroom / 2-bedroom / 3-bedroom quick templates
- labor-only quick intake
- packing-only quick intake
- specialty-item add-ons

This reduces rep hesitation and keeps pricing consistent.

## Phase 4: Remote Rep Voice Routing

Do this after the baseline CSR workflow is stable.

### Implement:

- rep availability states
  - `available`
  - `busy`
  - `wrap_up`
  - `offline`
- simultaneous ringing to available reps
- first-answer-wins routing
- skip reps already on active calls
- missed-call fallback:
  - voicemail
  - auto SMS
  - internal alert

This phase should preserve:

- branch identity
- call recording
- transcription
- lead creation
- source attribution

## Product Rules To Enforce

These should become product rules, not “team habits.”

### 1. No lead without an owner

Every active sales lead must be:

- assigned
- or clearly marked `unassigned`

No hidden ownership.

### 2. No call without a log

Every inbound and outbound call should create:

- log record
- rep identity when known
- branch identity
- recording when available

### 3. No quote without an audit trail

Track:

- who built it
- who changed totals
- who sent it
- who discounted it

### 4. No missed inbound without a next step

If inbound call or SMS is unanswered:

- flag it
- remind rep
- or auto-message customer

### 5. No silent rep takeover

If ownership changes:

- log the handoff
- show the previous owner
- show why it changed

## Recommended Data Model Additions

### Lead

- `assignedRepUserId`
- `assignedRepName`
- `ownedAt`
- `lastTouchedByUserId`
- `lastTouchedByName`
- `lastTouchedAt`
- `awaitingReply`
- `inboundUnreadCount`
- `lastInboundChannel`
- `lastInboundPreview`
- `lastQuotedAt`
- `quotePreparedByUserId`
- `quotePreparedByName`
- `quoteSentByUserId`
- `quoteSentByName`

### Quote

- `ownerUserId`
- `ownerName`
- `lastEditedByUserId`
- `lastEditedByName`
- `discountAppliedByUserId`
- `discountAppliedByName`
- `overrideAppliedByUserId`
- `overrideAppliedByName`

### Activity / Audit

- store rep identity on all critical events
- use structured event payloads so dashboards can be built cleanly later

## Suggested Rollout Order

1. First-class ownership fields and claim / reassign flow
2. Role-based restrictions for pricing and admin actions
3. Inbox / pipeline “my work” and awaiting-reply visibility
4. Rep activity dashboard and SLA metrics
5. Rep-side media upload and MMS ingestion
6. Quote-readiness guardrails
7. Voice availability and multi-rep routing

## What Not To Overbuild Yet

Do not build these first:

- complex enterprise permission hierarchies
- department-based record visibility
- custom role builders
- advanced queue routing logic
- heavy AI orchestration layers for every tiny action

The goal is not “enterprise software.”
The goal is:

- speed
- clarity
- ownership
- consistency

## Definition Of Ready For Remote CSRs

Mission Control is ready when a new remote CSR can:

1. log in with a stable account
2. answer or return a lead from one screen
3. see who owns the lead and whether it needs reply
4. capture move details without hunting
5. send a quote fast
6. leave a clean audit trail automatically
7. follow up from reminders, not memory

If those seven are true, the system is ready enough to onboard remote CSRs without chaos.

## Immediate Next Build Recommendation

If development starts now, the highest-leverage first sprint should be:

1. real rep ownership fields tied to actual users
2. claim / reassign / takeover logic
3. rep identity on quote and communication audit events
4. inbox + pipeline filters for `my leads`, `unassigned`, and `awaiting reply`
5. media upload into the quote workflow for non-MLS moves

That sprint would do more for remote CSR readiness than any fancy dashboard or AI layer.

## Implementation Snapshot

Updated April 21, 2026.

### Shipped now

- first-class rep ownership fields are live on leads
- inbox claim flow assigns ownership automatically
- lead reassignment is restricted to manager / owner paths
- pipeline now has owner-focused views for `team`, `my leads`, and `unassigned`
- quote discount thresholds are enforced:
  - sales reps up to 10%
  - managers up to 20%
  - direct override remains owner-only
- missed inbound calls now trigger:
  - a CRM alert
  - a deduped missed-call SMS fallback
  - branch-aware reply routing
- rep-side media upload now feeds the same inventory analysis path as the customer survey
- lead, quote, follow-up, consultation, note, handoff, message-send, and outcome routes now enforce ownership-aware write permissions
- lead and quote UI now show clear view-only states for non-owner reps instead of letting them hit avoidable 403s

### Still next

- server-side `my work` scoping for inbox and overview queries
- inbound MMS ingestion straight from branch SMS threads into lead media
- quote-readiness guardrails before send
- SLA widgets:
  - speed to first response
  - quote lag
  - overdue follow-ups
  - missed-call recovery
- multi-rep availability routing for simultaneous ringing once remote reps are active
