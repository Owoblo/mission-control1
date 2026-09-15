# Ryan Burton implementation — restart recovery

Date: September 15, 2026.

## Recovered state

The laptop restart left the audit, operating-playbook revision, and CRM implementation in the working tree, uncommitted. The latest repository commit at recovery was `ba400b2` (`Fix sales follow-up wall filtering`). Separate partnership work and migrations were also present; this recovery did not change them.

The [original audit](2026-09-15-ryan-burton-move-audit.md) describes behavior replayed before the corrective implementation. Its references to “current code” are historical audit observations, not descriptions of the repaired working tree.

## Local implementation recovered and verified

- Complex furniture gets separate disassembly/reassembly tasks, worker counts, evidence fields and provisional allowances. The interim complex-item default is 45 minutes at origin plus 60 at destination with two workers; it is not a measured standard derived from Ryan's job.
- Inventory edits retain disclosed handling mechanisms without automatically adding another physical item.
- Truck selectors share planning capacities, respect a selected truck, and expose insufficient capacity and uncertain furniture geometry.
- The operating-plan editor records truck, access, assembly instructions, hours, rationale and version-specific operations approval.
- Crew briefings use structured current fields; binding-quote sending and crew confirmation have operating-review checks.
- Quote revisions use conditional database writes to reject competing stale saves. Final-margin checks account for discounts.
- Operational outcomes record actuals and findings separately from customer repricing; completed moves without actuals remain visible for review.

## Fixes completed after restart

1. Expanded approval version detection to include the effective date when only the quote has a date, both saved truck-size/count sources, and reservation logistics. Changing a previously masked field now expires approval.
2. Added a truck-count discrepancy warning. A truck move marked “no truck needed” cannot be cleared by recording a rationale; the reservation status must be corrected.
3. Preserved existing damage flags, customer rating, review/referral flags and notes when saving operational actuals. Explicit corrections remain possible.
4. Added regression tests for these cases and updated the playbook's implementation-status reference.

## Validation

- `npm run typecheck` — passed.
- `npm run test:logic` — 315 tests passed, zero failures.
- `npx tsx scripts/test-move-audit-persistence.ts` — passed; fake database transport only. Covers competing quote writes, stale retries, fresh revisions, creation and conditional lead saves.
- `git diff --check` — passed.

These are local checks. This recovery did not deploy, mutate production records, send messages, or perform a browser acceptance test.

## Hardening completed after recovery

- Saved operations reviews now contain detached inventory/scope, truck-capacity calculation, assembly tasks and review reasons. Subsequent changes do not alter historical snapshots.
- Crew confirmations record the acknowledged plan fingerprint and an acknowledgement history. Changed plans show reconfirmation required, and stale acknowledgements are rejected.
- Planning and outcome handlers enforce representative ownership and operations/manager branch boundaries. Middleware now admits operations leads to the scoped planning/outcome endpoints and operations lead updates.
- Canonical actuals and their reporting summary commit together on the lead using a conditional write. The legacy reporting table is a retryable projection. Failed reporting updates preserve actuals and leave a visible pending flag; concurrent projection updates use a version condition. Customer outcomes survive operational-only saves.
- All three actuals entry points send a revision. Simultaneous saves have one winner; a stale writer cannot overwrite that winner. Conditional lead timestamps advance even within the same millisecond.
- The editor retains save/error messages across refresh, rejects assembly edits without evidence, supports legacy items without IDs, and exposes actual start/finish times. Recorded times must agree with working hours and breaks.
- Explicit assembly requirements override generic furniture exclusions. Invalid legacy assembly values fall back to provisional allowances. Assembly instructions alone do not establish measured loaded dimensions.
- Excluded items with missing reasons or contradictory confirmation status require reconciliation. These flags do not invent Ryan's final inventory disposition.
- Truck capacity fails closed on invalid counts, negative/nonfinite inputs and unsupported sizes. Fractional dimensions round upward. More than a thousand volume/weight combinations exercise capacity invariants.
- Production TypeScript excludes recovery archives and research outputs. A clean production build succeeded; a later rebuild exhausted local disk, so only generated Next.js cache was cleared before rebuilding.

## Expanded verification and rollout

- Logic suite: 319 tests passed, including capacity-grid assertions.
- Actual handler/repository/React integration: 37 API status checks plus middleware gates, immutable snapshots, stale acknowledgements, simultaneous saves, injected lead/reporting failures and Chromium editor checks at mobile width.
- Offline persistence test: passed. No real customer records, messages or payments were used by the mutation tests.
- Type checking: passed after the final nullable-record guard fix.
- Test tooling is isolated from application dependencies. To rerun the workflow harness: install `playwright` and `tsx` into a temporary npm prefix, then run `scripts/test-move-workflow.ts` with that prefix's `tsx` and `NODE_PATH` set to its `node_modules`. Chromium must be installed for Playwright.
- Release is staged from an isolated source copy that excludes unrelated uncommitted partnership work and local recovery/environment files. Production promotion is tracked below after verification.

## Ryan's audit remains open

The missing facts are listed in the original audit: actual crew/start/finish/breaks, initial truck and swap time, daybed and BBQ work, carrying routes, final inventory and direct costs. Payment time does not establish finish time. The $149.40 payment/quote difference still needs receipt and rescheduling-fee reconciliation. No actuals were invented during recovery.
