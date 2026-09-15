# Quote-send regression and hotfix — September 15, 2026

## Cause

The Burton hardening incorrectly required `buildMoveOperatingPlan(...).ready` before sending binding quotes. Because every truck move requires an operations review, ordinary quote sending was coupled to dispatch clearance. The same change disabled the existing owner/manager exception in both the send endpoint and outbox worker. Tests initially asserted that owners should be blocked, and missed the intended sales workflow.

## Correction

Commit `4fed43b` separates quote scope readiness from dispatch clearance. Routine scope-ready binding quotes can be sent before truck reservation/crew-packet approval. Existing owner/manager sending is restored, including the recorded exception in the send-job result and the worker that delivers it. Sales representatives retain the existing unresolved-scope check. Daybed assembly calculations, truck recommendations, price-edit protection and crew-dispatch review remain in place.

## Verification and release

- 333 logic tests passed, including a routine binding quote that is sendable while dispatch remains uncleared.
- 42 handler checks passed. Added positive owner status-change and owner/manager outbox-delivery tests, representative scope rejection, duplicate-send protection, and confirmation that sending does not approve dispatch. The delivery provider was mocked; no real messages were sent.
- Type checking and the Vercel production build passed, including all nine mobile API route/build checks.
- The hotfix was applied to a source snapshot verified against production deployment `dpl_GFjxtFcKUm7AUrV7A7Ewxg9f135F`, preserving intervening work.
- Promoted deployment: `dpl_J7DtqLjQdR2QSxqXofbJUrNAZya3` / https://mission-control1-reputation-engine-471hhfr04.vercel.app.
- Staged and live authenticated smoke tests passed the former owner gate and reached invalid-channel validation. The invalid channel rejects the diagnostic before any outbox job can be created; quote status, revision and total remained unchanged.

This fixes the blanket approval regression. The user's particular customer/error was requested but was not supplied during the hotfix, so the live diagnostic used the existing Burton quote without sending it.

## Integration onto master

The original working branch diverged from master. The Burton commits were applied to an isolated checkout of `6821871`, preserving master's tax-inclusive override semantics, explicit customer price revisions, quote scope readiness, provisional delivery, declined-quote protection, acquisition interviews, and job telemetry. Scope review remains separate from dispatch approval. Owner/manager exceptions are recorded in the outbox and retained after successful delivery.

The integration tests now cover 418 logic cases and 44 actual-handler checks, including provisional sales-rep delivery, blocked declined quotes, preserved damage telemetry, owner/manager delivery, duplicate retries, stale edits, and concurrent actuals. The repository persistence harness also verifies competing quote writes and lead updates. Provider delivery is mocked in all sending tests. The existing live deployment passed a non-sending owner-gate diagnostic; this does not imply that the master integration has been deployed.

Final verification used master's locked dependencies (`npm ci`): type checking, all 418 logic tests, 44 workflow checks, repository persistence checks, and `next build` passed. The build generated all 179 static pages; it reported non-blocking existing HEIC dependency and Browserslist warnings. Generated test/build output is excluded from the commit.
