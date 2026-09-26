# Guided estimate improvements — September 26, 2026

Release work is on `fix/keyvan-estimate-experience`. The final deployable source is `/private/tmp/keyvan-concurrent-latest`, assembled from concurrent live deployment `dpl_7cquRBb5XseZ1CM1LQPKhF8MqdXi` plus the scoped estimate patch. This preserves the concurrent GTA marketing, phone routing, business-card and adjustable SMS campaign changes. Do not deploy the older working checkout or replace production with the branch wholesale; live production includes independent telephony and intake changes.

## Shipped behavior

- Essential parking/carry questions remain visible; townhouse access no longer opens the full questionnaire by default.
- Exact duplicate survey photos are counted once across room labels. Removed uploads are excluded. Conservative visual similarity suggestions display both photos for review and never merge distinct files automatically.
- A service package captures packing rooms, remaining box allowance, fragile contents, materials, unpacking level, and cleaning scope. Bedroom/fullness/progress presets are suggestions that require customer confirmation.
- Per-job cost assumptions are editable. Defaults reuse the existing $25 loaded labour/hour assumption and 38% contribution target; they are planning defaults, not measured guarantees. Packing, unpacking, materials, cleaning and a confirmed truck hold feed the same contribution costing used by the recommendation and server margin gate.
- Packing, unpacking and materials can be removed independently. Price overrides retain unpacking. A scope edit invalidates an applied package until it is reviewed and reapplied.
- Date alternatives/ranges and a possible overnight hold generate a specific lead follow-up without postponing an existing earlier reminder. A confirmed pickup date synchronizes to the lead.
- A confirmed loaded-truck overnight hold uses nights, truck count, actual truck/parking costs, additional delivery cost, location and delivery date. A possible hold is explicitly excluded until confirmed; warehouse-storage costs are not added for the hold itself.
- Recorded customer confirmations satisfy the hidden-area checklist without a second mandatory note. Estimates still need quantity/volume and basis. Inventory and job factors save before the quote; failures stop preview.
- Operations warnings collapse into one line. Legacy extras are under Additional services. The revision reason appears at Review in Guided mode. Nonblocking warnings can proceed to a clearly labelled planning preview.
- Explicit price/scope revisions preserve the prior commercial snapshot and increment the customer-visible version. The CRM exposes previous prices, lines and scope. Acceptance and checkout reject a stale version before changing the quote or contacting the payment provider. Accepted quotes retain the existing locked-quote/change-order workflow.
- The quote leads with the before-HST service price, followed by HST and the total. Deposit arithmetic is unchanged. New internal service-cost settings and version-history metadata are withheld from public responses.

## Validation

- Full release TypeScript check passed.
- The full production-source logic suite ran 529 tests: 527 passed. Two failures reproduce on an untouched copy of the same production snapshot: the partnership assistant social-media response assertion and the signed missed-call message assertion. Their source is unchanged by this release.
- Focused service, quote revision, pricing, photo, access and readiness tests passed.
- Local browser checks covered applying a package, removing packing while retaining unpacking/materials, two possible dates, an optional unpriced hold, visible parking choices, and desktop/mobile quotes.
- Deployed browser checks opened the actual guided CRM estimate and customer quote at desktop/mobile sizes. Browser API writes were blocked during these checks.
- On immutable staged deployments, stale-version acceptance and checkout requests returned 409. A subsequent live-domain test reached a concurrent deployment without that guard and caused the corrected incident below. All subsequent customer browser checks block writes; no further real-customer POST tests are permitted.
- A real-photo signature check recognized Keyvan's known matching pair without saving inventory.
- Production builds passed mobile-route checks and compilation/type checks. The existing HEIC dependency emits a static-require warning.

## Scope and limits

No customer quote was repriced or resent, and no payment was initiated. An unintended acceptance and its downstream records were corrected as described below. Keyvan's existing agreement remains $6,900 before HST ($7,797 including HST). Existing agreed-rate-only quotes cannot be retroactively split into packing and moving without a rep deciding the revised scope and price.

Similarity review is bounded to 60 photos and 12 candidate pairs per scan. It is conservative and does not establish a 90–95% inventory-accuracy claim. Existing inventory from rooms excluded from a new scan is preserved for human review rather than deleted automatically.

Prior quote history starts when a new revision is made; historical versions that were never recorded cannot be reconstructed. The customer link shows the latest version, and an already-open older page must refresh before acceptance/payment. Accepted-quote changes continue through the existing change-order flow rather than rewriting the accepted estimate.

Deployment and final live verification are recorded below after promotion.

## Live verification incident and correction

At 2026-09-26 20:40:46 UTC, a stale-version test against the canonical domain unexpectedly accepted Keyvan’s quote. A concurrent deployment (`dpl_E6oXuKCY7m1cAeWjB47y1RgbS2H3`) had replaced the tested release and did not contain the guard. Using a real customer record for a supposed fail-closed test was unsafe; subsequent verification uses browser-blocked writes and read-only requests only.

The quote was restored to viewed, preserving its $6,900 subtotal, with an incremented revision. The lead was restored to quoted with its original September 28 follow-up; legitimate intervening customer data was retained. The false acceptance log now records a correction, the test-created review job is soft-deleted, the automatically captured scope is superseded with an explicit correction reason, and the analytics event is relabelled as a reverted test. Original incident records are retained in private local backups. No payment test ran after the failure. The acceptance handler may have sent an internal email to business@starmovers.ca; it does not send a customer acceptance email.

The combined source passes TypeScript. Its full logic suite reports 533 tests, 530 passing: the two original baseline failures above plus the concurrent marketing test asserting a versioned GTA asset URL. That marketing test and its source are unchanged by the estimate patch.

## Final deployment

Promoted `dpl_64meqhcoQUXbAXkcdiEnw7MV9yHp` (`https://mission-control1-reputation-engine-qnnwglzpo.vercel.app`) to `https://go.quote2move.com` on September 26, 2026. Immediately before promotion, the live alias still matched the captured `dpl_7cquRBb5XseZ1CM1LQPKhF8MqdXi` baseline.

After promotion, read-only requests confirmed the live quote page HTML exactly matches the immutable verified deployment, including deployment IDs and JavaScript assets. Live Chrome checks passed for the actual guided lead view and desktop/mobile public quote fixture, with every browser API write blocked. Final cloud build passed compilation, type checks and all 9 mobile route checks. Full local TypeScript passed against the final combined source; the full logic suite remains 530/533 with the three unrelated failures documented above.

## Override send correction — September 26 follow-up

User reported that the margin override still left Review customer scope disabled. Recalculated object identities could clear the acknowledgement, and the UI retained obsolete 50%/65% thresholds despite the contribution calculator using a 38% target and 30% authorization minimum. Review navigation no longer depends on margin acknowledgement; actual server approval controls remain intact. Acknowledgement is tied to stable financial values and advances directly to review. Price, cost, scope or quote changes invalidate it.

A later live deployment had again omitted the earlier estimate release. The final source `/private/tmp/keyvan-override-fix` was assembled from live `dpl_7gyhzUKy7wv4gjzohvsdprB7gRqv`, preserving its Toronto branch changes, plus the original estimate patch and this correction. Promoted deployment `dpl_Hxa5eWTFoUMfm7Rt5mJ6A7nf2UfC` (`https://mission-control1-reputation-engine-byl6tbz5w.vercel.app`) to the live domain. Immediately before promotion, the live baseline still matched the captured source; afterward, live HTML exactly matched the verified immutable build.

Validation: TypeScript and cloud build passed; 27 focused margin, override, contribution, quote-version, commercial-arithmetic and send tests passed. Browser checks on both immutable and live deployments applied a $4,777.21 override, reached review and preview, and submitted to a fully mocked delivery queue. A separate $1,000 fixture exercised low-margin acknowledgement and stage navigation. Every browser mutation was intercepted and fulfilled locally; public quote GET responses were also fixtures to prevent view notifications. No customer data or communications were changed during these checks.

Future deployments must include this branch's scoped estimate patch or start from the final live snapshot; the old shared checkout is not a complete production baseline.

## Server revision rejection correction — September 26 second follow-up

The prior browser test fulfilled quote saves without running the actual PATCH validator and therefore missed the reported server rejection. Two remaining mismatches were corrected: applying an override now copies its explanation into the explicit revision-reason field, including same-price changes; the quote preview preserves a saved empty discount label instead of inventing “Courtesy discount” and triggering a false commercial revision. Scope-only changes still need a reason, but the shared client/server revision rule now shows that requirement inside the estimate before any save. Failed saves no longer dismiss the estimate modal.

Five integration regressions execute the actual quote PATCH route with isolated repository/session/notification boundaries. They cover unexplained scope rejection, documented same-price scope changes, repeated same-amount overrides, unchanged resends, and the spurious discount-label revision. All 22 focused quote, pricing, send and revision tests passed, as did TypeScript. The stronger browser harness runs its PATCH requests through this actual handler against in-memory records and intercepts delivery separately. It reproduced a 409 in the intermediate build before the discount-label fix. No real customer mutations or messages are permitted in this verification.

Final verification passed on `dpl_9NUPahcCQrATaMjPBWXLQbGk6BCX` (`https://mission-control1-reputation-engine-c8yr8glr8.vercel.app`) and again on the live domain after promotion. The browser's real-handler/in-memory-store test reached delivery, retained low-margin acknowledgement, and displayed missing revision reasons before any mutation. Live HTML exactly matched the verified immutable deployment. The prior live alias was checked immediately before promotion and still matched `dpl_Hxa5eWTFoUMfm7Rt5mJ6A7nf2UfC`. Cloud build and TypeScript passed. No customer records or messages were changed during this follow-up.
