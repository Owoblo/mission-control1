# CRM audit remediation — 23 October 2026

Built from production master `f377c947177f961453c4c8cb77b7ffffc6f96cd5`, preserving card funding review, balance authorization consent/capture, reviewed partner handoffs, branch restrictions, public quote restrictions and suppression gates. The unrelated dirty local feature branch was not deployed.

| Audit finding | Repair |
| --- | --- |
| F01 release drift | Clean master-based release, source SHA metadata, clean-checkout/ancestry guard, deployment route contracts and CI. Source builds use Vercel's environment. |
| F02 public staff dialer tools | Exact public callback list; global backfill requires owner or global manager in its own handler. Native partnership dialer access stays authenticated. |
| F03 unsigned dial-status | Signature verification precedes all parsing and side effects. Telnyx SIP inbound classification also respects the customer and branch addresses. |
| F04 repeat collections | Durable, leased command journal and Stripe idempotency for deposit, saved-card deposit, balance and authorization mutations. Provider facts survive CRM failures; a single database transaction updates quote and lead. Unresolved commands block a new collection. Customer checkout and staff collection share exclusion. Scoped reconciliation reads Stripe without collecting again. |
| F05 missing jobs/callback | Restore missing email reply, discovery, daily brief and SES event handlers; authenticate all scheduled marketing paths. SNS verification pins the topic, certificate origin and signed envelope. |
| F06 session recovery | Refresh a valid session near expiry, revalidate the current profile and offer sign-in over the existing form after a 401. No write replay. Actual browser test verifies new-lead draft preservation. |
| F07 mobile handoff trust | Verify active Twilio legs, signed-in identity, customer phone and servicing branch. Conference and transfer controls verify ownership and membership before mutations. |
| F08 automatic local handoff | Keep master's reviewed handoff and suppression workflow. Do not port the local unreviewed automatic lead-creation path. |
| F09 SIP sync | Query E.164 and SIP forms, retain every parent/child recording, merge logs with optimistic concurrency and save SID mappings after persistence. Archived links survive Twilio retention. Scope checks precede provider reads. |
| F10 moved-on feedback | Separate an outcome from a supplied reason. Track reserved/submitted/blocked/unknown separately; never mark a failed send as delivered or automatically repeat an uncertain request. |
| F11 lost contractor alerts | Commit pricing and per-recipient alert jobs together. Bounded retries after explicit SES rejection; uncertain/crashed sends stay held. Replace the restored partnership alert's Resend dependency with the SES outbox. |
| F12 wrong referred name | Prefer explicit customer naming evidence. Greeting addressees and conflicting names remain unconfirmed. |
| F13 missing source dependencies | Track required helpers and already-live ledger/payment/digest migrations. Check mobile API routes and scheduled routes in production output. Repair the mobile SDK patch's whitespace-sensitive matching and verify a fresh install. |
| F14 dependency advisories | Update Next, Sentry, Sharp and affected transitive packages. Dependency audit reports zero known vulnerabilities. |

## Recording evidence and repair

The supplied lead `lead_5p16pkjjt` had 10 CRM call references, 8 with playback, while four provider recording SIDs were absent from those references. One missing recording was already archived against that exact lead. Three unmapped SIP root calls retained recordings at Twilio. The repair hydrates exact-lead archive references on read and makes explicit sync recover every parent/child recording with stable, distinct timeline IDs. Collapsed call-card behavior is preserved. Recordings assigned to another lead are not silently reassigned.

## Verification

- 678 logic tests.
- 17 database/controller regression tests covering partial saves, provider response loss, concurrent payment requests, every direct collection path, capture/cancellation, funding details, callback boundaries, SIP/multiple recording recovery, cron access, alert deduplication and append-only lifecycle history.
- Reviewed partner handoff database suite.
- 11 mobile unit tests and a fresh mobile install with the native SDK patch applied twice successfully.
- Web typecheck and production build; scheduled/mobile route output checks.
- Headless Chrome: actual new-lead form receives 401, retains entered fields through sign-in, and does not resubmit automatically.
- `npm audit`: zero known vulnerabilities in the web dependency tree.

The payment and alert migrations were tested in isolated PostgreSQL before installation. Live verification uses validation-only payment requests. No live card charges or customer test messages are sent. Native source changes require a future signed mobile binary release; this web release does not publish an iOS binary.

## Repeating the browser check

Run `npm run test:logic`, then start the built app with `AUTH_SECRET=isolated-browser-fixture npm start -- --hostname 127.0.0.1 --port 3107`. In another terminal run `PLAYWRIGHT_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser:session`. All browser API responses are intercepted fixtures.

## Additional payment display finding

For the supplied lead `lead_yr45l7cw6`, the $500 display originated from `depositAmount=500`, `depositMethod=etransfer`, `depositDate=2026-10-22`. Its quote had no payment receipts or Stripe PaymentIntent reference. A read-only Stripe query confirmed the same account as the screenshot and no PaymentIntents since 20 October. This establishes a recorded deposit flag, without establishing that a bank transfer actually cleared. The UI now says “recorded” and flags earlier entries without a linked receipt. Existing financial history is preserved for reconciliation. Balance collection uses the actual outstanding amount, and a later balance receipt retains an earlier deposit without double counting or reviving refunded amounts.
