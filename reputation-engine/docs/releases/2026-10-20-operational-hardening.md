# Operational hardening release — October 20

Built from current origin/master in an isolated checkout. Changes: legacy jobs role/record access; fail-closed missing session roles; narrowed public quote mutation response with matching customer UI; corrected quote acceptance notification; current versioned sales coaching; partner draft provenance with mandatory audit persistence, actual model identity, timeout and output-token bound; authenticated performance-health endpoint.

The shared partner conversation and sales-ownership safeguards from master are retained. No customer messages, payments, quotes or opportunity classifications are changed by deployment. Legacy roleless sessions must sign in again.

Verification: full logic suite, typecheck, production build and live negative role probes. AI provenance is tested with stubbed model output and failing storage; no real customer draft is generated for testing. Database migration is idempotent and restricts audit tables to service_role; live table availability checked before release.

Remaining audit work is not represented as completed: private-media migration (ops-media mixes public business cards and customer material), full historical triage/accepted handoff workflow, comprehensive all-channel stop/spend controls, session revocation, real-case human calibration, recovery/deletion drills and external contracts. Bucket visibility must not be changed before consumer migration and verification.

Media inventory on October 20: survey-photos has 380 root entries, ops-media 12 (including partnership-library, partnership-chat and video-playback), property-uploads 2. These are root entries, not total object counts. No objects or visibility settings changed in this release.

Rollback: revert this release commit and deploy the resulting tested commit. Audit schema is additive and can remain. Do not revert prior closed-lead, shared-context or payment protections. Validate /api/jobs denials and /api/ops/performance-health against the deployed release.

## Live recovery follow-through

Production verification exposed four historical failed automation jobs. Reviewed their current context before cancelling the stale jobs: one verification-code/non-sales message, one customer-confirmed competitor loss, one invalid masked destination, one historical email credential failure. Created internal recovery tasks for the latter two, due October 21 at 9am Toronto; no messages replayed. Preserve the original errors and reconciliation reasons.

Queue deduplication now returns the existing failed/cancelled receipt rather than inventing a new job ID for the same key; a concurrent unique-key conflict reads the winner without resetting it. Health reports unresolved manual recovery tasks as warning so moving a failed job into human review does not hide the work. Validation: 665 logic tests pass, including failed/cancelled retry and concurrent deduplication cases.
