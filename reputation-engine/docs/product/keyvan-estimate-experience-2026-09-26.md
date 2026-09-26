# Guided estimates: Keyvan review and proposed workflow

Reviewed September 26, 2026. Live CRM reads only; no customer record, quote, price, task, or message was changed.

## What Keyvan's record establishes

- Ottawa townhouse to a detached home in Barrie; 13 uploaded survey photos.
- Photos 4 (Bedroom 1) and 13 (Office / Den) have identical SHA-256 hashes. They are the same file, not merely similar angles. Existing deduplication happens inside each room, after grouping; this explains the duplicated office.
- The lead stores November 11, 2026, `moveDateFlexible: false`, and same-day delivery. Its flexibility note says the date depends on discussions with his lawyer. The reported November 11–12 choice and possible overnight truck hold are not represented accurately by those fields.
- A September 28 follow-up already exists, labelled “Provisional quote sent — confirm scope blind spots and access before finalizing (9 items pending).” It is too generic for this conversation.
- Quote `qt_dvfp6u805` is viewed, with $6,900 subtotal, $897 HST, and $7,797 total. It has a single agreed-rate line. Its saved customer scope has no service notes naming packing, unpacking, materials, or cleaning. These services cannot safely be inferred as included from the stored price alone.
- The quote's provisional wording lists unresolved hidden areas while the current lead has customer confirmations for those areas. This mismatch needs a fresh review against the current draft before sending; it does not establish which UI action produced the stale snapshot.
- The pricing override handler preserves packing and cleaning lines but omits unpacking. This is a concrete code defect; it does not prove how every service disappeared from this particular quote.

## First fixes prepared in code

Branch: `fix/keyvan-estimate-experience`, based on `origin/master` at `2b83e7c`. The original working checkout is older and contains substantial unrelated changes, so these fixes are isolated in `/private/tmp/keyvan-estimate-experience/reputation-engine`.

1. Deduplicate identical files across the complete survey upload before grouping by room. Removed uploads are excluded. The scan response and rep notice explain skipped duplicates. Original photos and existing inventory in unscanned rooms are preserved.
2. Show truck parking and the truck-to-entrance walk immediately. Townhouses start with the essential questions, with additional access details expandable. The existing standard-driveway confirmation for houses remains available. No townhouse is automatically declared to have simple access.
3. Preserve unpacking when applying a manual price override.
4. Capture selected, priced packing, materials, unpacking, and cleaning services in the customer scope. Customer interest alone and unpriced placeholders do not become inclusions. Internal costs are not copied into this summary.
5. Restore the quote's before-tax service price as the main number, with HST and the full total below it. Deposit math and the payable total stay unchanged.

Validation: TypeScript check passed; 56 focused tests passed covering photo grouping, service scope, access, quote readiness, pricing protection, contribution costing, storage removal, and guided stages. No browser visual pass or production deployment was performed.

Limitations: byte-identical photo detection does not detect recompressed files or different angles. Previously generated duplicate inventory in an unscanned room is retained for review rather than deleted automatically. Existing sent quotes are not retroactively populated with assumed services. Package pricing, date ranges, overnight truck holds, and immutable quote versions below are proposals, not implemented features.

## Packing: one customer price, explicit internal scope

Bedroom count should prefill an estimate, not determine a binding price by itself. A sparsely furnished two-bedroom home and a full two-bedroom home with a kitchen, pantry, books, and fragile collections can require very different packing time.

Ask these six short questions:

1. **What are we packing?** Whole home / selected rooms / fragile items only. Select the actual rooms.
2. **How much remains unpacked?** Nothing packed / about half packed / mostly packed. Confirm closets, drawers, kitchen cupboards, pantry, basement, and garage contents; furniture photos do not show these reliably.
3. **How full are those rooms?** Light / typical / full, supported by a box estimate or cupboard photos.
4. **Anything needing special protection?** Glassware, artwork, collections, electronics, unusually heavy contents, or custom crates.
5. **Who supplies materials?** Customer / us. Record the included quantities of standard boxes, wardrobe boxes, paper, tape, and special protection.
6. **What does unpacking mean?** None / essentials only / all agreed boxes. Define basic placement and empty-box consolidation separately from organizing cupboards, detailed setup, and waste removal.

Offer independent service selections that compose into packages:

- Packing labour only; customer supplies materials.
- Packing + unpacking; materials supplied by customer or explicitly selected.
- Packing + unpacking + an agreed materials kit.
- Cleaning as a separate scoped service, still bundled into the customer's total.

Use one calculation for the recommendation and margin check:

`service cost = packer labour-hours × loaded hourly cost + unpacker labour-hours × loaded hourly cost + materials cost + travel/setup + subcontracted services`

`before-tax selling price = (service cost + operational contingency) ÷ (1 − target contribution margin − applicable revenue-based fees)`

Loaded cost includes the applicable labour burden. Labour-hours mean people multiplied by hours. Do not charge the customer for the same labour twice through both moving hours and separate packing lines. Only include a fee in the denominator if it has not already been accounted for in the pricing model.

Illustration only, not an approved rate: $600 cost plus $60 contingency, with 35% target contribution and 3% fees, gives $660 ÷ 0.62 = $1,064.52 before tax; a configured rounding rule could make that $1,075. Actual rates, productivity, and margin must be calibrated from completed jobs. Do not silently activate new rates from this illustration.

The existing code already has packing crew-rate estimates and an unpacking model using a box estimate. They need one shared, configurable scope and cost model rather than a second competing calculator. Track actual packing/unpacking hours and material usage after each job to improve the bedroom presets.

For a flat-rate materials package, ordinary usage variation is absorbed by the allowance and contingency. Additional customer-requested scope uses a reviewed change order. The current materials copy describing “charge actual usage and credit unused supplies” is a different commercial model and should not be mixed into a fixed package unnoticed.

Cleaning needs its own questions: which home(s), size, empty or occupied, condition, and whether appliances/cupboards/windows are included. Base its internal cost on a confirmed subcontractor price or measured labour estimate.

## Flexible dates and an overnight truck hold

Represent the date state explicitly: confirmed date / choosing between dates / range / unknown. For this case, show “November 11 or 12 — awaiting closing confirmation,” subject to confirming that these are the intended alternatives.

Keep pickup and delivery dates separate. Add “Loaded truck held overnight” as a service distinct from warehouse storage. Capture nights, truck count, secure holding location, delivery timing, and whether the hold is confirmed or only a possibility. Internal costing includes truck availability/rental, parking/security, any crew accommodation or travel, and genuine extra dispatch work. Do not add warehouse unloading/reloading when the load stays aboard.

A possible hold should produce an explicit alternative or optional price pending selection; it must not silently become a customer commitment. A confirmed hold becomes part of the bundled scope and schedule.

Use the existing September 28 follow-up rather than duplicating it. Proposed task wording: “Confirm closing/pickup date (Nov 11 or 12), whether the loaded truck must be held overnight, delivery date, and packing/unpacking/materials/cleaning inclusions before finalizing.” Record truck reservation status independently from customer date preference.

## A calmer guided flow and send experience

Keep both Simple and Guided, remembering each rep's choice. In Guided, show the few relevant questions at each step and put unusual cases behind additional details.

Suggested sequence: move basics and date certainty → origin access → destination access and timing gap → deduplicated room inventory → service scope → internal costing → customer preview.

Put the missing-information checklist in the relevant step, not a stack of new prompts at Send. Give each pending item a direct link to its question. Distinguish missing information, material pricing risk, and a genuinely blocking error. Provisional estimates must be clearly labelled; removing noise must not silently convert uncertain scope into a firm promise.

“Apply recommended price” should use the same persisted service selections and cost basis as the margin calculation. Show one acknowledgement for an authorized exception, keyed to the scope and price approved. Invalidate that acknowledgement only when a material change makes the approval stale. Preserve both server-side pricing protections and the reason for the exception.

Before delivery, save and reload the latest draft, recompute readiness from that saved state, and preview the exact customer snapshot. This is the acceptance criterion for fixing the stale-checklist problem; the current investigation did not reproduce its full sequence in a browser.

## Revisions and change orders

The current system has revision checks and a price-change audit, but the quote editor describes a same-link revised view. That is not equivalent to an immutable customer-visible version history.

For a sent but unaccepted quote: “Revise estimate” copies the previous snapshot into a new draft version. Removing packing changes the scoped services, related labour/material costs, subtotal, HST, deposit, and balance together. Show the price difference and plain-language change summary before resending. Preserve the old version and prevent accepting a superseded version.

For an accepted quote: use a separately approved change order and preserve the accepted agreement. Record the price delta, changed services, approval, existing payments, and remaining balance. Never re-create the full deposit charge or silently rewrite the accepted scope.

Removing packing must explicitly address unpacking and materials; do not assume the customer also cancelled them.

## Customer quote presentation

Lead with the move and a clear scope summary. Present included services without requiring customers to decipher internal invoice lines. Then show:

- Your move: **$6,900** before HST
- HST: **$897**
- Total including HST: **$7,797**

Continue with pickup/delivery timing, inventory and care details, what the customer needs to confirm, deposit and remaining balance, and one clear acceptance action. Keep the tone calm and specific. Avoid showing internal margin figures, uncertainty percentages, or a raw technical checklist as customer-facing prose.

## Proposed next implementation order

1. Validate and release the first fixes above.
2. Unify service scope and costing; make rate assumptions configurable and add the six packing questions.
3. Add date alternatives, overnight hold costing/scheduling, and a deduplicated confirmation task.
4. Fix saved-draft/readiness synchronization and consolidate approval prompts.
5. Add immutable estimate revisions and accepted-quote change orders.
6. Add conservative similar-photo/overlapping-angle review with side-by-side evidence and a keep-both option. Measure false merges and missed duplicates against reviewed surveys before promising an accuracy percentage.
