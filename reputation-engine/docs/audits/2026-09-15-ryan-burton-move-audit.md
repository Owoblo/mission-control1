# Ryan Burton move audit — September 14, 2026

Audit date: September 15, 2026. Internal operations review.
Lead: `lead_ldt6hew6a`. Quote: `qt_fu989ndmj` / `QT-2026-0731-RB`.

## Finding

The evidence supports a failure to turn disclosed inventory into a reliable work and truck plan. The customer disclosed the daybed with pullout before quoting and explicitly confirmed disassembly/reassembly. Operations reports that the inventory substantially matched the list and that a 26-foot truck was needed. The customer independently reported the truck swap, difficult daybed, and tricky BBQ.

There are three connected problems: insufficient item detail and assembly allowances; inconsistent truck and dispatch records; and a commercial override that reduced the revenue available to cover the work. Exact overrun, actual margin, and minutes attributable to each cause remain unmeasured.

## Evidence and limits

Read directly from production: CRM lead, accepted quote, July–September SMS, call transcripts, follow-up change logs, and the August 18 scope snapshot. Queried `job_outcomes`, `partner_job_reports`, `partner_job_messages`, and `partner_job_assignments` for this lead; each returned no rows. The review job records completion/review activity, not crew working times.

The sole scope snapshot is a **legacy booking backfill**, not an immutable snapshot captured at acceptance. It provides evidence of the August 18 state. Current source code was inspected and its inventory, assembly, and truck functions replayed against the saved inventory. That replay demonstrates current behavior; it does not establish the exact deployed code on July 31 or September 14. An internal time budget survives in the production lead, while its generator is present only in the local recovery tree; do not assume that recovered code is deployed.

Customer photos uploaded: zero. Survey completion: false. Stored listing photos exist, but there is no evidence here of a completed customer walkthrough or measurements of this daybed. No customer contact, production mutation, price adjustment, or deployment was performed for this audit.

## What was promised and what happened

Times below are Ottawa/Toronto local time (EDT), converted from stored UTC timestamps.

| When | Evidence | Meaning |
|---|---|---|
| July 31, 2:01 p.m. | Customer SMS lists king, queen, **day bed with pullout**, dresser, and basement six-seat sectional | Complex furniture was disclosed before the quote was sent |
| July 31, 2:17–2:23 p.m. | Change logs: estimate increased to 3 movers / 7.5h / $1,500, then reduced to 7h / $1,400; relationship override applied to $1,000 | There was an operational baseline distinct from the selling price |
| July 31, 2:42 p.m. | Rep SMS promises **3 movers, one 20-foot truck**, disassembly and reassembly, and a binding estimate | Clear customer-facing truck and service commitment |
| July 31, 3:01 p.m. | Customer asks whether disassembly/reassembly is included; rep says yes. Customer says they will handle light items | A furniture-only list can still represent substantial work |
| July 31, evening | Quote logs show $1,000 → $900 discount, then $900 → $1,400, then restoration to $900; customer also reports seeing changing prices | Conflicting saves/recalculations need investigation; concurrent or stale editing is a hypothesis, not established cause |
| August 18 | Backfilled scope has **26ft** on the lead; inventory still 687 cu ft / 2,015 lb | The 26-foot field predates the move; it cannot be explained solely as a move-day correction |
| August 26 | Stored time budget: 8 crew-clock hours, customer range 7–9, mode `shadow` | A later planning number did not replace the accepted quote's seven hours |
| September 4 | Customer agrees by SMS to September 14 at **10 a.m.** | Accepted quote still shows September 11 / 9 a.m.; crew note also shows September 11 |
| September 14, 9:42 a.m. | Customer says crew arrived early with too small a truck and seemed surprised by the items | Direct evidence of arrival/truck mismatch; this is not a measured work start |
| September 14, 9:47 a.m. | Rep says inventory dimensions were underestimated and a bigger truck has been picked up | Truck swap confirmed by contemporaneous communication; first truck size and swap duration are not recorded |
| September 14, 1:26 p.m. | Customer says crew is getting the last items, daybed was tricky, destination has no steps | Daybed caused pickup difficulty; destination condition was clarified only on move day in this record |
| September 14, 2:59 p.m. | Customer says unloading is underway, BBQ and daughter's bed took longer, probably another couple of hours | BBQ is a second item-specific delay contributor |
| September 14, 4:05 p.m. | Customer: “I think they know how to put it together now :)” | Reassembly difficulty corroborated; does not quantify assembly time |
| September 14, 5:45 p.m. | Final payment recorded | Payment time is not the crew finish time |

## 1. Why the smaller truck was recommended

The saved inventory totals **687 cu ft, 2,015 lb, 20 included units**. Recalculation agrees with those totals: this is not an arithmetic summation error.

The current code has incompatible truck selectors:

- `lib/uhaul-calculator.ts`, `truckSizeFromCubicFeet`: 601–900 cu ft selects **20ft**. Ryan's 687 reproduces the truck promised in the SMS.
- `lib/truck-planning.ts`, `recommendTruckLoadPlan`: 15ft has 750 usable cu ft / 5,000 lb capacity and the smallest fitting option wins. Ryan's inventory selects **15ft at 92% volume utilization**. This helper is used by customer recommendation reasoning.
- The persisted lead and August scope specify **26ft**. The accepted quote stores truck count but has no saved truck size or load-plan calculation.

Neither selector accepts item geometry, non-stackability, dismantled component shapes, dimension confidence, or the committed truck size as an input. A capacity allowance cannot fix incorrect item measurements or a generic furniture label. The July 20ft promise is consistent with the volume selector, but the evidence does not identify which screen or instruction the driver used to obtain the first truck.

**Conclusion:** estimated volume made a smaller truck appear sufficient, and the system failed to reconcile that recommendation with the 26ft record and the actual dispatch plan. The operational report establishes that 26ft was needed on this job; we do not yet have measured load volume or payload to recalibrate a universal threshold.

## 2. Why the daybed and work time were underestimated

### A disclosed mechanism was lost

The retained inventory says `Daybed`, **50 cu ft / 100 lb**, with the generic note `Disassembly required`. A removed inventory key explicitly says `day bed pullout` and 40 cu ft. The August snapshot already contains that removal.

This could have been deduplication or a scope edit; there is no recorded reason establishing which. Either way, the retained item does not preserve the pullout mechanism. Do not automatically restore a second bed or add 40 cu ft: the pullout may be a component of the same bed. Reconcile the components and retain the assembly/weight detail on the parent item.

### The allowance treats different assemblies alike

Current estimator replay detects five items: kitchen table, two bed frames, daybed, and kitchen hutch. It allocates **1.25 crew-clock hours total**, or **15 minutes per item for both ends combined**, assuming parallel work. The saved later budget also has a raw 1.25-hour service component.

A mechanism-heavy daybed receives the same allowance as a simple table. The calculation does not allocate separate disassembly and reassembly tasks, skilled worker requirements, or time during which two movers cannot do other work. Generic `Desk`, `Shelve`, and `6 Seat sectional sofa` names do not trigger this assembly counter; their actual assembly requirements remain to be verified.

The move-intelligence detector is also inconsistent: its word-boundary patterns do not recognize plain `Daybed` as `bed`, and it reads item text rather than the customer's original SMS. Replay classifies the saved daybed as **standard handling**, with disassembly likelihood **0.08** and sleeper probability **0**. Changing only the label to `Daybed with pullout` raises handling to **elevated** and sleeper probability to **0.98**, but leaves disassembly likelihood at **0.08**. These are heuristic model outputs, not measured probabilities. The preserved `pullout` wording would provide a handling signal, but is missing from the retained item. Its priced extra minutes concern verified stair handling, not mechanism-specific assembly work.

### Low assumed weight lowers handling time too

With three movers and 2,015 lb, the current base calculation produces approximately **2.58h loading + 1.77h unloading**, before travel, assembly, access, and buffer. Whenever positive weight exists, it uses weight-based productivity instead of the volume fallback. Generic low weights therefore affect both capacity and labor estimates. The daybed's real weight was not measured; operations' report that it was heavy supports review, not an invented replacement weight.

### Access was unknown but budgeted as confirmed zero

The inventory contains a basement sectional, but origin/destination access fields are null, stair counts are zero, and qualification says `accessKnown: false`. The saved time budget nevertheless labels zero access hours **confirmed**, with no review reasons. Basement location is a reason to investigate the carrying route, not proof of stairs; a walkout is possible.

**Conclusion:** the known daybed work was under-described and priced with a generic allowance. Truck exchange and BBQ handling also contributed. We cannot assign all excess time to the bed or determine exact overrun without crew actuals.

## 3. Why the price was smaller

| Step | Pre-tax amount |
|---|---:|
| Recorded calculated baseline: 3 movers × 7h at the $200 crew rate | $1,400 |
| Relationship price override | $1,000 |
| Additional 10% discount on $1,000 | −$100 |
| Accepted service subtotal | **$900** |

The final service price is **$500 / 35.7% below the calculated baseline**, not simply a 10% promotion. Follow-up logs attribute the override and discount edits to Thelma Ufot; Ommy's subsequent quote edits restored higher values before the final correction. This is evidence of editing history, not proof of intent or the underlying software fault.

The override note calls a projected **40.9% margin** healthy and says approval was not required. Other quote notes mention **34.4%** and possible manager review. At the implied $591 cost basis, $1,000 gives 40.9% and $900 gives 34.3%; that approximately explains the two numbers, but actual cost and historical cost inputs are not saved here. Current approval behavior is role-dependent and cannot establish whether historical authorization was appropriate.

A discount reduces revenue; it does not reduce necessary truck capacity or work. The baseline itself still relied on the weak assembly and inventory assumptions. Restoring $1,400 alone would not correct the operating plan.

Secondary reconciliation item: recorded payments are $203.40 + $963 = **$1,166.40**, versus the quote total of $1,017. The **$149.40 difference** is close to, but not exactly, the $150 rescheduling fee accepted by SMS. There is no corresponding rescheduling line in the saved quote. Reconcile receipts and the fee separately; these records do not establish that the difference was an overtime charge.

## 4. Why the handoff did not catch it

- Crew note says **hourly**, while the accepted quote and customer SMS say **binding**.
- Crew note retains September 11, while the customer agreed to September 14 at 10 a.m.
- Crew note says **$500 deposit**; payment records show **$203.40**.
- Crew note says **“SPECIAL ALERTS: None”**, despite the assembly scope and basement sectional; it lists generic disassembly later without item-specific time or instructions.
- Truck reservation remains `not_needed`, despite a full-service truck move. Checklist flags for truck reservation, tools, packet, access, parking, and final walkthrough are false. These are missing recorded confirmations, not proof that no preparation occurred.
- Only one backfilled scope version was found, despite later date changes.
- The AI summary emphasizes customer satisfaction while treating the truck issue as resolved. A customer praising the crew does not establish that the estimate or job economics were sound.
- No job outcome or partner incident report was found, so completion and review solicitation did not produce the facts needed to improve estimating.

## Corrective priorities

### Immediate operating changes

Apply the new **Complex furniture, truck reconciliation, and post-move learning** section in the operating playbook. Operations owns the final truck choice and assembly task plan. Sales must preserve mechanism details and customer-confirmed inclusions. Reconfirm and regenerate the crew packet whenever scope, date, truck, or service terms change.

### CRM implementation backlog

1. **One saved truck plan:** persist selected size/count, included-scope version, confidence, capacity basis, reviewer, and rationale. All quote, rental, customer, and dispatch screens read it. Reject contradictory dispatch choices pending operations review. Include insufficient capacity and uncertain geometry explicitly; do not silently choose the smallest truck.
2. **Item-specific assembly tasks:** preserve `daybed`, `day bed`, `day-bed`, pullout/trundle/storage mechanisms, model, materials, dimensions, components, and instructions. Model each end separately with required workers and dependencies. An explicit zero count must not silently erase known assembly work without a documented scope decision.
3. **Evidence survives edits:** deduplication merges mechanisms and handling notes; exclusions need a reason and source. Customer-confirmed inclusion should override generic defaults after reconciliation. Ryan explicitly requested the small freezer, but it remains excluded; whether it actually moved is unverified.
4. **Unknown access stays unknown:** require resolution or an explicit provisional planning allowance for significant items. Do not label missing paths confirmed zero. Do not convert an unverified basement inference directly into a charged stair flight.
5. **Reliable commercial revisions:** preserve authorized overrides/discounts across saves, detect stale edits, recalculate final margin after every discount, and retain the approved scope/cost basis. Keep financial overrides separate from resource estimates.
6. **Consistent dispatch packet:** derive billing terms, date/time, deposit, truck, assembly tasks, and scope from authoritative saved fields. Require acknowledgement of revisions and invalidate stale packets.
7. **Learning independent of billing:** collect actuals without implicitly repricing an accepted move. The current outcome endpoint can call billing recalculation; use a deliberate separation when implementing the learning workflow.

### Acceptance checks for those changes

- Ryan's case cannot show 15ft, 20ft, and 26ft across screens for the same committed scope.
- An uncertain pullout daybed produces an explicit operations review and two assembly tasks, not an unqualified 15-minute combined allowance.
- Merging a component retains its mechanism and handling evidence without double-counting volume.
- Unknown access cannot become confirmed zero; a verified level destination can be recorded independently of the origin.
- Rescheduling updates the effective packet and customer-facing operational date without rewriting historical acceptance evidence.
- A second editor cannot overwrite an approved price/discount silently.
- A completed job with no actuals remains visibly pending operational review, even if payment and customer review requests are complete.

## Information still needed to close the audit

Actual crew count and attendance; start/end times and breaks; original truck size; truck exchange departure/return and lost crew time; truck loading/space observations; daybed make/model, photographs or dimensions, components, disassembly/reassembly times and workers; BBQ handling details; origin carrying route; final items moved, including freezer/dining set dispositions; payroll, rental, fuel and other direct costs; rescheduling fee reconciliation.

Capture overlapping tasks carefully: add labor person-hours for cost, and model dependent tasks for elapsed duration. Do not add every worker's task duration together and call it crew-clock time. Use these measurements to calibrate future ranges across comparable jobs, rather than setting a universal daybed allowance from one anecdote.
