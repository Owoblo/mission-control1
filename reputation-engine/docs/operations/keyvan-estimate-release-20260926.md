# Guided estimate improvements — September 26, 2026

Release work is on `fix/keyvan-estimate-experience`. The deployable source is `/private/tmp/keyvan-release`, assembled from live deployment `dpl_FdEPuHsmcFmPBp3nMohgUraHUSfR` plus the scoped estimate patch. Do not deploy the older working checkout or replace production with the branch wholesale; live production includes independent telephony and intake changes.

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
- Deliberately stale-version requests to public acceptance and Stripe checkout returned 409 before any acceptance/payment action.
- A real-photo signature check recognized Keyvan's known matching pair without saving inventory.
- Production builds passed mobile-route checks and compilation/type checks. The existing HEIC dependency emits a static-require warning.

## Scope and limits

No customer quote was repriced or resent, no customer was contacted, and no payment was initiated. Keyvan's existing agreement remains $6,900 before HST ($7,797 including HST). Existing agreed-rate-only quotes cannot be retroactively split into packing and moving without a rep deciding the revised scope and price.

Similarity review is bounded to 60 photos and 12 candidate pairs per scan. It is conservative and does not establish a 90–95% inventory-accuracy claim. Existing inventory from rooms excluded from a new scan is preserved for human review rather than deleted automatically.

Prior quote history starts when a new revision is made; historical versions that were never recorded cannot be reconstructed. The customer link shows the latest version, and an already-open older page must refresh before acceptance/payment. Accepted-quote changes continue through the existing change-order flow rather than rewriting the accepted estimate.

Deployment and final live verification are recorded below after promotion.
