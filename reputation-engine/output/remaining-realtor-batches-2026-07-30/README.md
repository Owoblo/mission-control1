# Remaining realtor batches

Generated July 30, 2026 by comparing three Windsor/Chatham realtor exports and
the previously filtered rental-realtor list against the live Partnership CRM.

## Source comparison

- 2,045 realtor source rows
- 1,815 unique realtor candidates after cross-file deduplication
- 1,611 already present in the live CRM/outreach
- 204 new realtor candidates
- 25 rental-derived candidates, all associated with Windsor/Essex

After combining the new Windsor/Chatham realtors with the Windsor rental
candidates and deduplicating the people:

- 225 unique candidates in the complete review file
- 172 SMS-ready destinations
- 53 excluded from SMS because the primary phone is missing, invalid, or shared
  with another candidate in the batch

## Files

- `windsor-chatham-remaining-realtors-sms-ready.csv` is the upload-ready second
  residential realtor batch.
- `windsor-chatham-remaining-realtors-all.csv` preserves every new candidate,
  including contacts that need enrichment.
- `windsor-chatham-remaining-realtors-sms-excluded.csv` explains every
  batch-level exclusion.
- `excluded-existing-crm-matches.csv` is the audit trail for existing contacts.

## Remaining rental markets

All 25 genuinely new rental-realtor candidates from the earlier filtering were
associated with Windsor/Essex. None remained for Kitchener/Waterloo/Guelph,
London/Sarnia/Woodstock, or Ottawa after the live CRM comparison, so no empty
campaign files were created for those market lines.

No contacts were imported and no outreach was scheduled.
