# SSM commercial market map

This is the local collection and evidence layer for the full configured service
footprint. It extends the earlier Discovery V2 work through read-only backfills;
the existing CRM, production discovery tasks, and relationship workflows keep
their existing identifiers and contracts.

The map contains organisations, provisional place identities, physical-location
observations, properties, tenants, parent assertions, school boards, public
contact routes, source runs, field assertions, and a durable research frontier.
An account may have several roles. A discovered organisation does not need a
website, email address, named person, or current buying signal to be retained.

## Start locally

Python 3.9+ supports the core CLI. HTML parsing requires `lxml`; XLS/XLSX and
Overture collection are optional connectors. An isolated environment keeps
these dependencies separate from the Next.js application:

```sh
python3 -m venv /private/tmp/ssm-market-map-env
/private/tmp/ssm-market-map-env/bin/python -m pip install -r scripts/market_map/requirements.txt
# Only when collecting the optional cloud place baseline:
/private/tmp/ssm-market-map-env/bin/python -m pip install overturemaps==0.18.0
python3 -B scripts/market-map.py init
python3 -B scripts/market-map.py --help
```

The default database is `partnership-system/state/market-map.sqlite`. It and the
dated operational run folders are ignored by Git. `--database PATH` before a
subcommand selects an isolated store. SQL migrations are versioned and checked
against their applied hashes. No production database credentials are needed.

## Operator workflow

```sh
# See source scope, access, reuse status, and supported adapters.
python3 -B scripts/market-map.py sources

# Add or revise explicit source configuration; this does not collect anything.
python3 -B scripts/market-map.py sources --import path/to/source-registry.json

# Retrieve one permitted source. Every operation has request/byte/row/page caps.
python3 -B scripts/market-map.py collect durham-business-sites \
  --max-records 10000 --max-pages 100 --max-requests 100 \
  --output partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/durham-refresh

# Restart after a saved adapter checkpoint. Saved batches can also be imported
# independently without network access; repeating the same batch is idempotent.
python3 -B scripts/market-map.py import-batch path/to/batch.json
python3 -B scripts/market-map.py collect SOURCE_ID --checkpoint path/to/recovery-batch.json

# Search locations and source classifications, including individual corridors.
python3 -B scripts/market-map.py query --city Windsor --street Walker --limit 100
python3 -B scripts/market-map.py query --city Toronto --street Yonge --limit 100
python3 -B scripts/market-map.py query --category manufacturing --limit 100

# Versioned mappings use source NAICS or controlled Overture category labels.
python3 -B scripts/market-map.py classify

# Bound each public website wave; unresolved frontier entries remain durable.
python3 -B scripts/market-map.py relationships --seed --seed-limit 10 \
  --max-depth 2 --pages-per-domain 20 --max-jobs 40 --max-requests 60

python3 -B scripts/market-map.py export \
  --output partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/exports
python3 -B scripts/market-map.py reviews --limit 100
```

The broad source registry includes municipal/economic directories, chambers,
employment surveys, business licences, association rosters, BIA directories,
industrial parks, corporate branch/franchise locators, malls, property
portfolios, school boards, procurement awards, zoning/parcels, and project/news
sources. An identified source is not an executed search. Unconfigured tasks
stay visible rather than silently being marked complete.

## Reuse the acquired evidence

The dated work log and acquisition manifests record the actual paths used in
the October 26 run. These commands reuse those artifacts without fresh crawling:

```sh
python3 -B scripts/market-map.py backfill --legacy \
  partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15/discovery-v2-baseline/evidence.sqlite
python3 -B scripts/market-map.py backfill-snapshots

python3 -B scripts/market-map.py import-schools \
  partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/coverage-source-acquisition/ontario-schools-batch.json \
  --source-registry partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/coverage-source-acquisition/source-fragment.json

python3 -B scripts/market-map.py import-geographies \
  partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/coverage-source-acquisition/ontario-boundaries-attributes.json \
  --source partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/coverage-source-acquisition/official-geography-source.json

python3 -B scripts/market-map.py import-properties \
  partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/property-acquisition

python3 -B scripts/market-map.py import-charities \
  partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/institution-acquisition --batch-size 500
python3 -B scripts/market-map.py import-institution-rosters \
  partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/institution-acquisition

python3 -B scripts/market-map.py import-places \
  partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/overture-2026-10-21
python3 -B scripts/market-map.py import-places \
  partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/overture-municipal-wave-2 --batch-size 1000
```

Keep the same place-import batch size when replaying an existing folder so its
batch fingerprints remain identical. Each committed batch survives an interrupted
process; an interrupted transaction rolls back. GERS identifiers are scoped to a
single provider release across envelopes, so overlapping boxes update existing
identities. Cross-release and uncertain company/site matches remain reviewable.

To collect another explicit Overture envelope, use the optional environment:

```sh
cd scripts
/private/tmp/ssm-market-map-env/bin/python -m market_map.places \
  --area toronto-core-west --release 2026-10-21.0 \
  --max-records 30000 --max-output-bytes 100000000 --deadline-seconds 180 \
  --output ../partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/another-place-wave
```

These boxes are explicit collection envelopes, not municipal boundaries.
Releases can be retired; a missing reader is a recorded block, not an empty city.
The initial broad GTA box reached its output cap with geographical skew, which
is why the next wave used smaller Toronto, Peel, York, Durham, and Halton tiles.
Partial envelopes remain partial. A completed provider query is not complete
coverage of local businesses, properties, or tenants.

## Data and evidence safeguards

- Stable generated internal IDs; company names are never primary keys.
- Source-scoped record IDs; a directory root URL cannot collapse its rows.
- Separate organisations, branches, properties, brands, and franchisee candidates.
- A shared domain, address, company name, or call-centre phone is insufficient
  to merge entities. Strong registration IDs or corroborated site features are
  required; ambiguous cases are retained and queued.
- New lower-confidence observations fill unknowns without replacing manually
  verified values. Competing assertions retain their evidence and dates.
- Reviewed identity resolutions are reversible links. They never delete the
  original entities or rewrite historical evidence.
- Official Ontario LIO municipality IDs have an explicit namespace. They are
  not Statistics Canada CSDUIDs. Ambiguous short names are held for review.
- Industry, entity type, location type, service hypotheses, account roles, and
  fulfilment capability are separate axes. Categorisation proves none of the
  other axes. Unmapped source categories stay available.
- Public contact routes carry publication evidence, verification, eligibility,
  and suppression separately. All discovery routes start `research_only`.

Raw structured records retain complete original payloads. Large payloads are
losslessly compressed in SQLite; `get_raw_payload(raw_id)` verifies SHA-256 and
restores the original. `compact` converts older inline rows without changing
their IDs, hashes, observation times, or assertions. Large acquired JSONL files
are gzip-compressed only after independent decompressed hash/byte verification.

SQLite uses a bounded page cache, mmap, WAL, and `synchronous=FULL`. No durability
setting is reduced to speed up collection. The ID/export contracts provide the
migration path to PostgreSQL; the current migrations and SQL are SQLite-specific.

## Relationships and properties

Source claims retain direction: customer → claimed supplier, sponsor → recipient,
member → association, tenant → property, school → board, and subsidiary → parent.
Generic partner lists and logos do not prove current contracts. Project references
retain separately described roles; a listed project is not automatically an active
contract, property ownership, or an immediate buying signal.

Website discovery checks the source-reported domain against homepage identity,
follows relevant pages, and queues related identities. Related domains must show
Ontario relevance before deeper traversal. Non-Ontario related parents can remain
in the evidence without opening an unbounded global crawl. Depth-limited,
page-limited, retry, held, and pending tasks remain visible between waves.

For example, a mall directory can support `A&W → tenant_at → Devonshire Mall`.
A separate official address page supports the mall's street address. Neither
assertion identifies the franchise owner, a particular unit, or an active lease.

School programmes, summer/continuing education, care/treatment sites, and virtual
records remain distinct from claims about ordinary physical school buildings.
Licence records with no recorded cancellation are licence-derived candidates;
they do not establish that a business is currently operating.

## Charities and institution rosters

The saved CRA batch contains 30,570 Ontario records from the licensed 2024 T3010
Identification dataset, downloaded from the official Open Government resource.
It retains the complete published charity account number under `CA-CRA-charity`,
raw category codes, optional published websites, and the original CSV bytes.
Annual-return evidence supports the nonprofit classification; it supplies no
current registration-status field. Current status remains `unverified`.
Addresses are `mailing_address` observations with `source_mailing_address_only`
status. They do not establish a physical church, mosque, office, or campus.
Exact service-locality label matches remain separate from boundary eligibility.

The acquired first-party rosters contain 106 Toronto/York labour-council entries,
84 Ontario Construction Secretariat union/local links, 24 entries on Ontario's
university page, and 573 Public Appointments Secretariat bodies. These are
published roster observations with limited factual reuse review. The university
page includes Royal Military College; its 24 entries are not all provincially
funded universities. Public-appointments bodies include community and professional
institutions, so they are not all classified as government bodies. Explicit
ministry labels support `listed_under_ministry`; council affiliates support
`member_of`. These rosters create no physical offices or named-person records.

The OREA schedule's guarded access was blocked; its known revision is October
2024, so current membership remains unverified. Federal department retrieval
timed out. Both source leads and their blocks are saved without importing guessed
records. CRA's current-status bulk-request route is recorded for later manual
work; no request or external message was submitted.

Both institution import commands read local artifacts without network calls.
Charity batches commit source records and all scope metadata atomically, publish
checkpoints after commit, and replay safely with the same batch size. Roster
imports commit each acquired source atomically and preserve held source statuses.

## Exports, coverage, and costs

The acquired baseline also supports a street/corridor research index without
waiting for SQL consolidation:

```sh
python3 -B -m scripts.market_map.corridors \
  --input partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/acquired-inventory/configured-service-area-business-candidates.csv.gz \
  --output partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/corridor-inventory
```

`city-street-candidate-summary.csv` groups simple published-address candidates
within each publisher city label. The parser removes a leading house-number
token; unit/spelling variants can fragment groups, so these are not official
street counts. `named-corridor-candidates.csv.gz` preserves the full original
provider fields, IDs, contributor/licence metadata and research-only status.
Walker, Lauzon Road, Lauzon Parkway, Yonge and Bloor use explicit address-phrase
and service-catchment matches. The user's Lawson spelling remains a separate
unresolved research label. Zero matches do not establish absence. Neither index
asserts zoning, parcel boundaries, verified occupancy or a current lease.

`manifest.json` lists datasets, actual filenames, row counts, and SHA-256 hashes.
Small datasets are CSV/JSONL; larger datasets use CSV.gz/JSONL.gz. Original raw
payloads have their own decoded gzip JSONL dataset; metadata exports link to it.
`topline.json`, `city-summary.csv`, `category-summary.csv`, `COVERAGE-REPORT.md`,
and `blocked-source-handoff.csv` are convenient starting points.

Coverage is geography × sector × source family. Broad-directory retrieval cannot
complete a narrower sector or neighbourhood cell. Reports distinguish provisional
account/place identities, location/programme observations, and distinct normalized
addresses. Missing records are research gaps, never proof of absence. No market
completeness percentage is emitted without an appropriate named benchmark.

HTTP adapters meter requests, bytes, time, and errors. Optional cloud-library
internal requests/transfer bytes remain explicitly unknown when uninstrumented;
zero paid-service calls does not mean zero compute/network cost. Historical
replays retain original observation dates and unknown historical collection costs.

## CRM integration and deployment boundary

The CRM mapping contract is `ssm-market-map:<organisation_id>` plus existing
`partner_companies.id`, `market_contacts.id`, and existing referral/job links.
Only a local dry-run comparator is implemented:

```sh
python3 -B scripts/market-map.py crm-dry-run path/to/local-crm-snapshot.json \
  --output partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/crm-preview
```

It suggests reviewable matches from exact name/domain/locality corroboration,
preserves suppression evidence, and proposes no field overwrites or enrolment.
Production CRM writes, deployment, a recurring production scheduler, named-person
enrichment, and campaigns are not part of this local release. The existing app's
production research task flow remains its integration point for a later deployment.

## Verification

The first verification pipeline runs alongside ongoing acquisition. It opens the
inventory using SQLite URI `mode=ro` and writes only derived files and disposable
TEMP aggregates. Use a new versioned output directory for each loaded snapshot:

```sh
python3 -B -m scripts.market_map.verification_pilot \
  --database partnership-system/state/market-map.sqlite \
  --output path/to/verification-pilot/revision-N --pilot-size 2000
python3 -B -m scripts.market_map.website_verification \
  --pilot path/to/verification-pilot/revision-N \
  --output path/to/website-observations/revision-N --max-domains 24 --max-pages 2
python3 -B -m scripts.market_map.verification_view \
  --pilot path/to/verification-pilot/revision-N --output path/to/pilot-view.html \
  --observations path/to/website-observations/revision-N/observations.jsonl
```

The baseline retains every loaded organisation, location and contact row. Pilot
eligibility considers all locations, excludes conflicting geography from clean
service-label representation, and balances available labels, source IDs/types,
industries and other observed strata. This is a purposive sample, not an estimator
of whole-market verification rates. Missing/unrepresented configured labels and
uncategorised records remain explicit. Review CSV cells are formula-escaped.

Website observations fetch only bounded public pages with the guarded transport;
robots/challenges and out-of-scope redirects become review receipts. Domain-level
name evidence, published contact links, branch operation, mailbox validity,
phone reachability and purchasing authority have separate statuses. No page
observation confers contact eligibility. The website job plan is bound to the
pilot manifest and resume skips existing job receipts. No messages, paid lookups
or inventory edits are performed. Coordinate dots and simplified municipality
outlines in the local view are context, not verified occupancy or boundaries.

```sh
python3 -B -m unittest discover -s tests/market_map -v
python3 -B -m unittest discover -s tests/discovery_v2 -v
```

Acceptance fixtures cover repeat ingestion, interrupted transactions, durable
cursor recovery, changing publisher IDs, franchises/branches/tenants, competing
assertions, relationship direction, bounded traversal, access blocks, paid-source
gates, count/ID reconciliation, gzip/raw round trips, exports, suppression, and
read-only CRM mapping. Live/fixture/blocked results are recorded separately in the
dated work log and per-source manifests.

### Full-inventory email evidence

`email_acquisition` seeds a separate SQLite research queue from a read-only
inventory scan and resumes website work by domain and page frontier. Use
`--seed-main PATH --seed-seconds 600` to refresh seeds, `--import-published PATH`
for source-scoped JSONL or gzip evidence, and `--run --workers 8 --max-domains 512`
for a resumable work batch. Every invocation requires `--queue PATH`;
`--output DIRECTORY` exports a consistent evidence snapshot and status counts.
Batch limits do not cap the inventory or establish whole-site completeness.

`structured_email_recovery` recovers explicit email fields from preserved provider
captures, including `/raw_payload/properties/emails` omitted by older normalized
email columns. Its manifests retain source hashes, record IDs, field paths and
query coverage. Repeated observations, record/email associations and distinct
address strings have separate counts. Provider-reported addresses and website
publication evidence do not establish mailbox validity, company ownership or
outreach eligibility. All remain research-only; these collectors send no messages
and do not modify the main inventory.

Relationship discovery can feed `relationship_email_bridge --input HANDOFF.jsonl
--queue EMAIL_QUEUE.sqlite --receipt RECEIPT.json`. Each supported direct-link
candidate is assigned a research-only `relationship-candidate:` identifier;
it does not become a canonical inventory organisation. Domain jobs are deduplicated
while every distinct source relationship and its provenance is retained in
`relationship_discovery_evidence`. Name-only, social-profile and unresolved
website candidates remain review evidence. A new pending route can reopen a
previously observed domain; replay does not duplicate jobs or provenance rows.

Logo coverage now has a separate audit. Each newly observed relationship page
retains a compressed `logo-inventories` record, including empty alt text, parent
link titles, filenames, SVG/lazy-image metadata and unresolved occurrences.
`visual-review-queue.jsonl` lists relationship pages needing visual review;
historical pages without this audit remain explicitly counted as unaudited.
This is a review queue, not a claim that every site has already been rendered.

`relationship_visual_audit.mjs` uses an isolated browser supplied by guarded
public-source requests. It saves rendered image/link comparisons, an entire
grid screenshot and individual image screenshots. Screenshot pixel dimensions
must cover all image bounds, including content overflowing its parent element.
Known missing resources and rendering errors remain in its manifest. Reviewed
grid claims are checked against the exact original image XPath, attributes,
published link and screenshot hashes before entering the recursive queue.
`reviewed_grid_members` records unique reviewed slots independently of repeated
raw observations, so the Josslin audit counts 25 partners rather than adding
the previous partial capture to the repaired list.
