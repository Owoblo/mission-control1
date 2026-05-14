# Destination Address Trigger Plan

## Goal

Turn every inbound booked move into a second opportunity automatically:

1. A sales rep enters the destination address during intake or quote building.
2. Mission Control silently checks whether that address is in-market.
3. If it maps to a current or recent listing, Mission Control identifies the listing agent.
4. The system checks whether we already know that agent and whether listing-photo inventory is already available.
5. Mission Control creates a structured outreach opportunity and runs the agent sequence without interrupting the rep.

This plan also folds in the adjacent workflow gaps from the voice notes:

- lead date changes must update the current quote
- deposit receipt + booking confirmation should be automatic and consistent
- pre-move reminders should be queued automatically, not sent manually from a page
- operations needs a better dispatch view, assignments, and a printable job sheet

## Current System Map

### Sales / quote stack already in place

- `app/sales/new/page.tsx`
  Creates a new sales lead and already performs MLS lookup, but only for the origin address.
- `app/sales/leads/[id]/page.tsx`
  Main sales workspace with autosave, quote building, payment handling, reminder actions, and inventory hydration.
- `app/api/sales/leads/route.ts`
  Creates CRM leads in `crm_leads`.
- `app/api/sales/quotes/route.ts`
  Creates CRM quotes from a lead.
- `app/api/sales/quotes/[id]/route.ts`
  Updates the quote and syncs lead stage from quote status.
- `app/api/public/quotes/[id]/route.ts`
  Handles public quote view + accept/decline flow.
- `lib/sales.ts`
  Normalization, pricing, quote estimation, and lead-stage sync.
- `lib/server/sales-repository.ts`
  Supabase access for `crm_leads`, `crm_quotes`, `crm_followup_logs`, listings lookup, and listing inventory scans.

### Listing and inventory intelligence already in place

- `app/api/sales/enrich/address/route.ts`
  Looks up MLS data for an address and optionally analyzes listing photos.
- `lib/server/sales-repository.ts`
  Already supports:
  - `lookupListingsByAddress`
  - `getListingInventoryScan`
  - `saveListingInventoryScan`

### Messaging infrastructure already in place

- `app/api/sales/send/route.ts`
  Sends outbound email or SMS and logs follow-up activity.
- `app/api/sales/leads/[id]/confirm-job/route.ts`
  Sends booking confirmation SMS/email when a job is confirmed.
- `app/api/sales/deposit-receipt/route.ts`
  Sends a branded deposit receipt email.
- `worker/saturn-lead-intake.js`
  Exposes `/send-email` and `/send-sms` for internal automation.

### Operations pieces already in place

- `app/sales/operations/page.tsx`
  Shows booked jobs, payment state, crew assignment, and crew notes.
- `app/crew/calendar/page.tsx`
  Crew-facing schedule view of assigned jobs.
- `app/sales/booked/page.tsx`
  Has a manual 48-hour reminder button, but not automated scheduling.
- `app/sales/quotes/[id]/page.tsx`
  Already stores:
  - `moveDescription` for customer-facing scope
  - `internalNotes` for crew/internal use

### Partner / outreach pipeline already in place

- `app/api/marketing/contacts/route.ts`
- `app/api/marketing/queue/route.ts`
- `app/api/marketing/touches/route.ts`
- `app/api/marketing/signals/route.ts`
- `lib/marketing.ts`

Mission Control already has a separate partnership pipeline with:

- `market_contacts`
- `market_touches`
- `market_queue`
- `market_signals`
- `market_sequences`

This is important because the agent workflow should plug into this pipeline instead of inventing another outreach subsystem.

## Gaps Against The New Brief

### 1. Destination trigger does not exist

The system currently enriches the origin address manually. There is no silent destination-side trigger when `destAddress` changes.

### 2. No local service-area guard for the agent opportunity

The route-estimate code already understands branches and local vs medium vs long-distance routes, but there is no destination market eligibility check for this workflow.

### 3. No agent-resolution workflow

Listings lookup returns listing data and photos, but the app does not currently:

- extract the agent reliably from the matched listing
- look up the agent in a structured contacts table
- fill missing contact details from enrichment/search

### 4. No warm/cold agent state check linked to outreach history

The partnership system can already track contact stage and touches, but the sales flow does not use it when a listing-based opportunity is detected.

### 5. No idempotent opportunity record

We need a dedicated record of:

- which lead/quote triggered the opportunity
- which destination address was analyzed
- which listing was matched
- which agent was targeted
- whether outreach has already started

Without this, the same address could be re-triggered multiple times from autosave, re-open, quote updates, or duplicate leads.

### 6. Date-sync bug is real

`crm_leads` and `crm_quotes` both store `moveDate`.

Right now:

- updating the lead does not propagate `moveDate` into the quote
- updating the quote does not intentionally backfill `moveDate` into the lead
- operations pages often render `quote.moveDate || lead.moveDate`

That means date changes can drift between sales, quote, and operations views.

### 7. Post-booking automation is only partial

Current state:

- booking confirmation exists
- deposit receipt exists
- Stripe webhook marks deposit received
- manual deposit flow sends a receipt from the lead page
- pre-move reminder is still manual from `app/sales/booked/page.tsx`

What is missing:

- one consistent "booking automation" path
- automatic receipt after Stripe deposit
- automatic thank-you / confirmation queue
- automatic reminder queue relative to move date

### 8. Operations still lacks a true dispatch packet

Current ops support is enough for assignment, not enough for field execution.

What is missing:

- a calendar-first dispatch board
- a printable move sheet / crew packet
- structured handoff language for the crew
- explicit scope, specialty items, access constraints, payment state, and key notes in one place

## Recommended Architecture

## Core design choice

Use the existing `market_*` pipeline for agent relationship state and sequence execution, but add a dedicated opportunity table for move-trigger logic.

### Why not use only `market_signals`?

`market_signals` is good for generic awareness, but this workflow needs more operational context than a generic signal table should own:

- lead ID
- quote ID
- destination address snapshot
- listing zpid
- inventory-scan availability
- contact-resolution status
- outreach start/completion state
- dedupe key per lead + address + listing + agent

### New table recommended

Add a new Supabase table, for example:

- `move_opportunities`

Suggested fields:

- `id`
- `source_lead_id`
- `source_quote_id`
- `trigger_type` (`destination_move_in`)
- `status` (`new`, `ineligible`, `matched`, `contact_missing`, `queued`, `sent`, `responded`, `closed`)
- `origin_address`
- `destination_address`
- `destination_city`
- `branch`
- `service_area_match`
- `listing_zpid`
- `listing_address`
- `listing_city`
- `listing_snapshot`
- `agent_name`
- `agent_email`
- `agent_phone`
- `agent_contact_id`
- `agent_warmth` (`warm`, `cold`, `unknown`)
- `inventory_scan_available`
- `inventory_scan_source`
- `outreach_started_at`
- `outreach_completed_at`
- `notes`
- `dedupe_key`
- `created_at`
- `updated_at`

This table becomes the source of truth for the workflow itself.

### Reuse existing tables for relationship + sequence

- `market_contacts`
  Canonical agent/contact record.
- `market_touches`
  Outreach history and warm/cold evidence.
- `market_queue`
  Future sequence steps.
- `market_sequences`
  Sequence templates and timing.
- `market_signals`
  Optional high-level signal record if we want visibility in the marketing UI.

## Proposed Workflow

### Phase A: detect

Trigger on:

- lead create
- lead update when `destAddress` materially changes
- quote create if destination data exists but no opportunity record exists

Recommended entrypoint:

- new internal helper in `lib/server`
- invoked from `app/api/sales/leads/route.ts`
- invoked from `app/api/sales/leads/[id]/route.ts`
- optionally invoked from `app/api/sales/quotes/route.ts` as a safety net

The helper should:

1. normalize destination address
2. check service area
3. exit silently if out of market
4. look up listing match
5. exit silently if no listing
6. create or update a `move_opportunities` record

### Phase B: resolve

Once a listing is found:

1. extract listing/agent data from MLS row
2. attempt to match to `market_contacts`
3. if incomplete:
   - try Supabase contact tables first
   - then use an enrichment/search provider
4. persist final contact snapshot back to:
   - `move_opportunities`
   - `market_contacts` if it is a new or improved contact

### Phase C: qualify

The system determines:

- `warm`
  Existing `market_contact` with touches/stage indicating prior outreach.
- `cold`
  New contact or no meaningful prior interaction.

Warmth should be derived from:

- `market_contacts.stage`
- `market_touches`
- recent `market_queue` activity

### Phase D: inventory check

Use existing listing inventory support:

- `lookupListingsByAddress`
- `getListingInventoryScan`
- `saveListingInventoryScan`

If a completed scan exists:

- flag the opportunity as remote-quote-capable

If not:

- do not block outreach
- optionally queue a background photo analysis if photos exist and AI is configured

### Phase E: queue outreach

Once contact resolution succeeds:

1. create or update `market_contact`
2. create a queue seed event for the agent
3. attach move-specific context to the queue item message draft
4. store the linkage in `move_opportunities`

Recommended first sequence:

1. heartfelt email immediately
2. SMS same day if phone exists
3. follow-up email or phone task next business day

Sequence message context should include:

- move into the destination is already underway
- current occupant may benefit from a discounted route
- listing-photo scan may allow remote quoting
- referral incentive is available

## Service Area Logic

Keep this simple in v1.

### Recommended rule

Start with a configurable city whitelist:

- Windsor
- LaSalle
- Tecumseh
- Amherstburg
- Essex
- Lakeshore
- Chatham
- Chatham-Kent
- Leamington

Then optionally add:

- branch-based radius
- postal-prefix checks
- geofence polygons later

### Why whitelist first

- deterministic
- easy to audit
- avoids geocoding cost and ambiguity during the first release

## Date Synchronization Plan

This should be fixed before the trigger rollout.

### Problem

Lead and quote both store move date, and they drift.

### Rule

For a linked lead/quote pair:

- lead remains the primary editable customer record
- quote should mirror operationally relevant customer fields:
  - `moveDate`
  - `originAddress`
  - `originCity`
  - `destCity`
  - possibly `moveType`

### Required changes

- `app/api/sales/leads/[id]/route.ts`
  If a linked quote exists and lead fields changed, patch the quote too.
- `app/api/sales/quotes/[id]/route.ts`
  If quote fields like `moveDate` are edited directly, patch the lead too.
- ensure both pages reload consistent values after autosave

### Minimum fields to sync now

- `moveDate`
- `originAddress`
- `originCity`
- `destCity`

Potentially add `destAddress` to quote storage later if we want quotes to own full destination text.

### Safe real-time sync now

These are the fields we should keep live automatically because they affect customer-facing truth without silently changing pricing logic:

- lead `moveDate` <-> quote `moveDate`
- lead `originAddress` <-> quote `originAddress`
- lead `originCity` <-> quote `originCity`
- lead `destCity` <-> quote `destCity`
- lead `name` -> client `name`
- lead `email` -> client `email`
- lead `phone` -> client `phone`

This is enough for the same quote link to stay accurate for:

- updated dates
- updated route/location wording
- updated customer contact details
- re-sent quote messages using the same acceptance link

### Keep explicit/manual for now

These should not auto-sync from lead edits in v1 because they can change pricing or scope in ways that are too risky to do invisibly:

- `lineItems`
- `subtotal`
- `hst`
- `total`
- `deposit`
- `balance`
- `crewSize`
- `truckCount`
- `estimatedHours`
- `moveType`
- `moveDescription`
- `internalNotes`

For those fields, the right pattern is:

1. rep updates the lead or quote
2. rep previews the revised quote
3. rep saves and re-sends the same link if they want to notify the customer

That gives us live truth without hidden repricing.

## Booking Automation Plan

## Desired lifecycle

1. Quote accepted
2. Deposit paid or manually logged
3. Customer receives:
   - booking confirmation
   - payment receipt
   - thank-you / next steps
4. Reminder is queued automatically based on move date

### What to normalize

Create one shared booking-automation helper that handles:

- send confirmation
- send receipt when appropriate
- create reminder schedule entries
- log follow-up/timeline events

### Current inconsistency

- manual deposit flow sends receipt from lead page
- Stripe webhook only updates payment status
- `confirm-job` sends confirmation but not receipt
- pre-move reminder is manual

### Proposed fix

When deposit is recorded, regardless of source:

- call shared booking automation helper
- mark lead as booked if quote already accepted
- send receipt automatically if email exists
- create queued reminder tasks:
  - 7 days before if desired later
  - 48 hours before
  - day-before fallback if date changed late

## Operations Upgrade Plan

## Current foundation

- operations board exists
- crew calendar exists
- assigned crew + crew note exist
- quote has `moveDescription` and `internalNotes`

## What to add

### 1. Calendar-first dispatch view

Add a real move calendar to operations, backed by booked leads/quotes.

Needs:

- day/week view
- unassigned jobs bucket
- assigned jobs by date
- payment-state chip
- crew-count/truck-count summary

### 2. Dispatch packet / move sheet

Add a printable move packet route, for example:

- `/sales/operations/jobs/[leadId]/print`

Contents:

- customer name and contact
- move date
- origin and destination
- crew assignment
- truck count
- quote total / deposit / balance
- move description
- internal notes
- crew note
- inventory summary
- specialty items
- access notes
- parking notes
- route summary

### 3. Structured ops language

Instead of relying on freeform notes alone, create a normalized "ops brief" block assembled from:

- move description
- job factors
- inventory flags
- access details
- crew note
- quote internal notes

This should be readable in-app and printable.

## Recommended Implementation Order

### Sprint 1: data integrity + trigger foundation

1. Fix lead/quote date sync.
2. Add `move_opportunities` table + repository functions.
3. Add destination trigger service with idempotency.
4. Add service-area eligibility logic.
5. Trigger workflow from lead create/update and quote create.

### Sprint 2: listing + agent qualification

1. Match listing by destination address.
2. Resolve agent from listing row or existing contact tables.
3. Match/create `market_contact`.
4. Derive warm/cold state from prior touches and stage.
5. Persist result on the opportunity record.

### Sprint 3: outreach sequencing

1. Seed `market_queue` from qualified opportunities.
2. Add message templates specifically for destination-move-in opportunities.
3. Add a lightweight UI badge in the lead detail page:
   - no opportunity
   - out of area
   - matched, queued
   - warm agent
   - scan available

### Sprint 4: booking automation

1. Centralize deposit/booking automation helper.
2. Trigger receipt from Stripe webhook path too.
3. Automatically create reminder queue items off move date.
4. Remove dependence on manual reminder sending for normal flow.

### Sprint 5: operations handoff

1. Upgrade operations board into calendar-first dispatch.
2. Add dispatch packet route + print view.
3. Assemble normalized ops brief.
4. Add explicit assignment workflow status:
   - unassigned
   - assigned
   - packet ready
   - crew briefed

## Concrete Code Touchpoints

### Likely files to change first

- `app/api/sales/leads/route.ts`
- `app/api/sales/leads/[id]/route.ts`
- `app/api/sales/quotes/route.ts`
- `app/api/sales/quotes/[id]/route.ts`
- `app/api/sales/stripe/webhook/route.ts`
- `app/api/sales/leads/[id]/confirm-job/route.ts`
- `app/api/sales/deposit-receipt/route.ts`
- `app/sales/leads/[id]/page.tsx`
- `app/sales/operations/page.tsx`
- `app/crew/calendar/page.tsx`
- `app/sales/booked/page.tsx`
- `lib/server/sales-repository.ts`
- `lib/sales.ts`
- new `lib/server/move-opportunities.ts`
- new Supabase migration for `move_opportunities`

### Likely files to reuse for agent pipeline

- `app/api/marketing/contacts/route.ts`
- `app/api/marketing/queue/route.ts`
- `app/api/marketing/touches/route.ts`
- `app/api/marketing/signals/route.ts`
- `lib/marketing.ts`

## Open Questions To Resolve Before Build

1. What exact listing table contains the cleanest agent fields?
   The active address enrichment reads `public.listings`, but we need to confirm which columns hold agent name/email/phone.

2. What is the approved enrichment source when the listing record is incomplete?
   If this truly needs web search, we should decide whether that happens:
   - server-side in Next.js
   - in the worker
   - via a dedicated enrichment service

3. Should every matched agent be added to `market_contacts`, or only once the contact has a sendable email/phone?

4. Who owns the sequence after it starts?
   Sales, marketing, or a shared queue view?

5. Do we want automated SMS for agents on v1, or email-first only unless a mobile number is confidently known?

6. Should the operations packet be generated from the lead, the quote, or a separate dispatch entity?
   My recommendation: lead + quote combined for v1, separate dispatch entity only if needed later.

## Recommended First Deliverable

The highest-leverage first milestone is:

1. fix lead/quote date sync
2. add the silent destination trigger
3. write opportunity records to Supabase
4. show opportunity status in the lead detail page
5. queue agent outreach using the existing `market_*` system

That gets the main revenue flywheel live without waiting for the full ops/calendar rebuild.

## Short Version

Mission Control already has 80 percent of the pieces:

- CRM leads and quotes
- MLS match + photo scan logic
- outbound email/SMS
- partner outreach pipeline
- operations assignment views

The missing work is not a greenfield build. It is a careful integration project:

- synchronize sales data cleanly
- add a destination-trigger service
- introduce an idempotent move-opportunity record
- route agent outreach through the existing partnership pipeline
- automate booking and reminder steps
- turn ops notes into a true dispatch handoff
