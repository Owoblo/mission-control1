# Pricing audit: Saba Munshey and Emmanuel

Audit date: 2026-07-30

Scope: production lead and quote snapshots, inventory arithmetic, cubic-foot and
weight assumptions, truck/crew recommendation, access and specialty context,
route contribution, and final quote arithmetic. No production records were
changed.

## Executive findings

1. The saved quote is not a reproducible pricing record. `CRMQuote` persists the
   headline inputs and totals, but not `pricingBreakdown`, the route snapshot,
   inventory snapshot, job-factor snapshot, penalties, buffers, or the engine
   version. A later lead edit can therefore make the quote look inexplicable.
2. Both reference jobs were sent/viewed while material scope was unresolved.
   Emmanuel's sent quote explicitly says both origin and destination access and
   packing status are unknown. Saba's viewed quote says packing is unknown even
   though the current lead says `packed`.
3. Emmanuel said there would be "a lot of boxes" and could not provide a count.
   The saved inventory contains only the boxes visible in photos and no
   `estimatedBoxes` factor. The quote therefore treats unknown hidden volume as
   zero.
4. Group-dimension normalization is capable of creating implausible per-unit
   values. Emmanuel's six dining chairs are stored as 2 cu ft / 2.5 lb each,
   well below the catalog's normal dining-chair values. Other grouped box rows
   were not normalized consistently.
5. Saba's saved pricing inputs are internally inconsistent: the quote stores a
   40% long-distance markup rate, but the $2,233 subtotal equals $1,650 labor
   plus $583 truck cost with no 40% truck-cost markup.
6. Truck count is reasonable for the currently recorded volume and weight in
   both cases (one 26-ft truck), but confidence is not reasonable while hidden
   box volume and access remain unknown. The system currently expresses a
   deterministic count without a capacity confidence or reserve requirement.

## Emmanuel

Production references:

- Lead: `lead_lkygkm087`
- Sent quote: `qt_0eyu01yli`
- Earlier draft: `qt_uegxxnv2a`

### Inventory and capacity

- Stored and recomputed totals agree: 42 units, 773 cu ft, 1,968 lb.
- At the pricing engine's 1,600-cu-ft / 10,000-lb local safe limits, the
  recorded load uses about 48% of volume and 20% of payload. One 26-ft truck is
  adequate for the recorded inventory.
- This is not a complete-load conclusion. The customer explicitly said there
  would be many boxes and could not count them. Only photographed boxes are in
  the 773-cu-ft total.
- Several quantity labels and quantity fields duplicate the same concept
  (`"2 ... Boxes"` with `qty: 2`). This makes it hard to tell whether dimensions
  are per-unit or group totals.
- Six dining chairs are only 12 cu ft / 15 lb in aggregate in the saved data.
  That is not operationally credible and understates both cube and handling.

### Price reconstruction

- Three-mover local rate: $200/hour.
- The engine reproduces the saved 6.25 hours exactly:
  - 2.50 hours loading, calculated from 1,968 lb ÷ 260 lb per mover-hour ÷
    three movers and rounded to a quarter hour.
  - 1.75 hours unloading, calculated from 1,968 lb ÷ 380 lb per mover-hour ÷
    three movers and rounded to a quarter hour.
  - 0.75 hours travel. This is the engine's fallback when no verified route
    snapshot is supplied; the saved quote has zero billable/operational
    distance and therefore is not using a reproducible map route.
  - 1.00 hour for disassembly and reassembly of four detected items: twin bed
    with mattress, full bed with mattress, twin bed frame, and dining table.
  - 0.25 hours load/unload buffer.
- Pre-tax price: 6.25 × $200 = $1,250.
- HST: $162.50.
- Total: $1,412.50.
- Deposit: 20% = $282.50.

The price is arithmetically consistent with the saved hours and rate. It is not
scope-complete: the quote warning says one inventory decision, both-side
access, and packing status were unresolved. No explicit access time or unknown
box reserve is present in the saved price.

The source call says the homes are about nine minutes apart, but the engine did
not price a verified nine-minute route plus yard-to-origin and
destination-to-yard travel. The call also says this is a four-bedroom home,
while the saved inventory contains only Bedroom 1, Bedroom 2, and Bedroom 3.
The missing fourth-bedroom scope must be resolved before relying on the hours.

### Quote-history concern

The earlier draft was $768.40 total (2 movers, 4.25 hours). The sent quote was
$1,412.50 (3 movers, 6.25 hours). Because neither quote stores the detailed
calculation snapshot, the exact reason for the $644.10 increase cannot be
audited reliably after the fact.

## Saba Munshey

Production references:

- Lead: `lead_6ajuy6ghv`
- Viewed quote: `qt_p965clm4i`

### Inventory and capacity

- Stored and recomputed totals agree: 22 units, 752 cu ft, 1,725 lb.
- At the long-distance engine limits (1,800 cu ft / 10,000 lb), the recorded
  shipment uses about 42% of volume and 17% of payload. One 26-ft truck is
  adequate for the recorded inventory.
- Four platform beds and a dining table imply substantial disassembly and
  reassembly work. The engine's keyword rules can detect these, but the saved
  quote does not retain the detected-item list or applied penalty snapshot.
- The upright freezer has `included: true` and `status: "excluded"` at the same
  time. Totals include it. Inclusion state must have one canonical meaning.
- Access is represented by null elevator values, with no floors, stairs,
  parking, doorway, or carry-distance confirmation.

### Price reconstruction

- Three-mover long-distance labor rate: $200/hour.
- Saved estimated time: 8.25 hours.
- Labor: 8.25 × $200 = $1,650.
- Saved truck cost: $583.
- Saved subtotal: $2,233 = $1,650 + $583.
- HST: $290.29.
- Total: $2,523.29.
- Deposit: 40% = $1,009.31.

The quote also stores `longDistanceMarkupRate: 40`. If that rate applied to the
$583 operational truck base, it would add $233.20 before tax, but it is absent
from the saved subtotal. The stored rate and stored price cannot both describe
the calculation that produced the quote.

## Source-code findings

- `lib/sales.ts` is the authoritative quote engine.
- Local truck capacity is 1,600 cu ft; long-distance capacity is 1,800 cu ft;
  payload is 10,000 lb.
- A separate `suggestTruckConfig` adds a 10% volume buffer, while
  `suggestTruckCount` does not. Other truck helpers use additional capacity
  bands. These overlapping rules can display different recommendations for the
  same inventory.
- Access penalties only apply when structured job factors are present. Unknown
  access produces warnings elsewhere but adds no conservative time to price.
- Hidden boxes add volume only above a 50-box allowance and only when
  `estimatedBoxes` is known. An explicitly unknown large box count adds zero.
- Hot tubs and pool tables are warning-only flags; their actual subcontractor
  charge is not calculated by the engine.
- The quote API saves totals but discards the returned `pricingBreakdown`.

## Required controls before calling a quote accurate

1. Persist an immutable quote calculation snapshot containing inventory and
   totals, route legs, access factors, specialty/disassembly scope, truck
   capacity rule, crew rate, every hour adjustment, operational costs, markup,
   engine version, and override history.
2. Block "binding" send when inventory count/volume, packing, origin access, or
   destination access is unresolved. Allow only an explicitly labeled
   provisional range.
3. Represent truck advice as recorded load, reserve/unknown volume, capacity
   utilization, payload utilization, recommended truck size/count, and a
   confidence state.
4. Make inventory dimensions canonical per unit. Validate values against the
   preset catalog and prevent item labels containing a count from silently
   multiplying that count again.
5. Make `included` the canonical inclusion flag and derive display status from
   it, or enforce that `included` and `status` cannot conflict.
6. Treat unknown boxes/garage/basement/shed contents as unresolved volume, not
   zero volume.
7. Add a price invariant: saved subtotal must equal the sum of saved line
   items, and all saved cost/markup fields must reconcile to those line items.
8. Consolidate all truck-size and truck-count decisions behind one capacity
   policy used by scanning, estimating, operations, and U-Haul costing.
