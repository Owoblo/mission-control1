# CRM release recovery — October 5, 2026

The laptop restart removed the temporary release checkout before the deployed CRM updates could be pushed to master. This release reconciles those changes with master at `c807b0660b6d0abb2fff7b00365e860642896fc9`.

## Recovered sources

- Merged `fix/mobile-customer-line` at `51d7357`: customer-history caller ID, SMS sender selection, and the phone app fixes.
- Merged `fix/nurture-lifecycle` at `6551ffc`: Lost evidence and failed-save handling, dedicated Nurture controls, scheduled check-ins, assigned reminders, automatic return to active follow-up, Toronto validation, and quote-resend corrections.
- Recovered all 984 source files from verified production deployment `dpl_4uRo6gFTQNecjLHsDDq9RtXm3VZG` (`mission-control1-reputation-engine-hcz9fo979.vercel.app`). Applied its additional changes without deleting repository files omitted from the deployment upload.
- Recovered the October 5 audio-MMS display patch from the saved session and local source.

## Included production updates

- Thelma's estimate save feedback, legacy agreed-price metadata repair, and discounts after an override; inventory failures keep the editor open.
- Individual and bulk Follow-up Lost actions collect evidence and retain failed saves for retry.
- Database deadlines, contact-directory recovery, visible retry states, notification request sharing, and scheduled database health checks.
- Quote and inventory usability improvements, scan cancellation and photo deduplication, box-count reconciliation, and access editing.
- Linked additional jobs and combined move logistics while protecting accepted/paid agreements and deposits.
- Ottawa branch dashboard scope and branch-specific telephony visibility.

The recovered production source already contains the Nurture lifecycle changes. They must not be stripped while resolving overlaps in lead updates, notifications, or Lost dialogs. Existing master MLS fixes are retained.

## Validation

- Full logic suite: 560 tests passed. Updated obsolete source-text assertions to check pricing behavior, and added compiled test alias resolution so the documented test command runs the recovered tests.
- Nurture API fixtures: four transitions, save/reload persistence, and check-in persistence passed.
- Nurture scheduler fixture: automatic return, custom return window, assigned reminders, Lost isolation, and repeat-run idempotency passed.
- Quote resend/revision fixtures: unchanged resend and reason-required price revision passed.
- Customer-line resolver fixture and all 11 mobile tests passed.
- Audio/image/video/file classification: five checks passed.
- Clean locked-dependency installation, TypeScript, and the full Next.js production build passed (183 static pages). The existing HEIC dependency emits a webpack dynamic-require warning.
- Browser checks against the production build: manager quote rejection is visible inside the estimate, retry saves the displayed total with a revision reason, and an inventory-save failure retains the open editor with a warning.

Fixtures use synthetic records and mocked writes. No customer messages or financial records are changed by these checks.
