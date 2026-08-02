# Partnership prospect segmentation

Generated July 30, 2026 from:

- `commercial-all-regions-all-statuses.csv` (2,466 listing rows)
- `rentals-all-regions-all-statuses.csv` (2,823 listing rows)
- Live Partnership CRM (8,892 contacts at comparison time)

## Results

- 1,255 unique source candidates after source deduplication
- 813 excluded because the person or organization already matched the CRM
- 36 excluded as listing platforms, industry aggregators, or address-shaped bad source data
- 406 new candidates
  - 281 commercial realtors
  - 25 rental realtors
  - 20 property-management prospects
  - 80 commercial/rental companies needing a named contact
- 296 candidates have a direct phone number or email
- 110 require contact enrichment

## Recommended campaign structure

1. **Commercial realtor campaign**
   - Use `new-commercial-realtors.csv`.
   - Position Star Movers around office, retail, industrial, tenant, and business relocations.
   - Keep the campaign separate from residential realtor messaging.

2. **Rental realtor campaign**
   - Use `new-rental-realtors.csv`.
   - Focus on renter move coordination, short-notice availability, and a dependable referral option.

3. **Property-management campaign**
   - Use `new-property-management.csv`.
   - Focus on tenant turnover, resident move support, elevator/building coordination, and repeat volume.
   - Enrich named operations, leasing, or property-management decision makers before outreach where needed.

4. **Company enrichment queue**
   - Use `new-company-prospects-needing-contacts.csv`.
   - Find a named commercial broker, managing broker, leasing lead, operations lead, or property manager.
   - Do not send person-style outreach to unnamed companies.

## Safety checks

- `excluded-existing-crm-matches.csv` is the audit trail for records removed as existing CRM contacts.
- `excluded-non-prospects.csv` contains source rows that should not be imported.
- `new-contacts-needing-enrichment.csv` should be enriched before sending.
- `all-new-direct-contact-ready.csv` contains the new candidates with at least one direct channel, but still requires campaign-level review and consent/suppression checks.
- No records were imported and no outreach was sent.
